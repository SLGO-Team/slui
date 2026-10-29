#[macro_use]
mod diag;
mod backdrop;
mod settings;
mod sidecar_socket;
mod steam_profile;
mod theme_pack;
mod updater;

#[cfg(windows)]
use std::sync::{atomic::AtomicIsize, mpsc, OnceLock};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

const HOME_WINDOW: &str = "home";
const OVERLAY_WINDOW: &str = "overlay";

// Read by the keyboard and foreground threads without taking the state lock.
static OVERLAY_ENABLED: AtomicBool = AtomicBool::new(false);
// Whether the game (or the overlay itself) holds the foreground; written by the
// foreground thread.
#[cfg(windows)]
static OVERLAY_OVER_GAME: AtomicBool = AtomicBool::new(false);
// The game window while it holds the foreground, else 0; written by the foreground
// thread and the keyboard events, read by the mouse hook, which must not query processes.
#[cfg(windows)]
static GAME_FOREGROUND_WINDOW: AtomicIsize = AtomicIsize::new(0);

// Whether the overlay page's session is live (connected to the sidecar); set by the page.
static SESSION_LIVE: AtomicBool = AtomicBool::new(false);

// An enabled overlay is visible only over the game, and only while its session is live:
// without the sidecar it has nothing current to show.
#[cfg(windows)]
fn overlay_may_show() -> bool {
    OVERLAY_ENABLED.load(Ordering::SeqCst)
        && OVERLAY_OVER_GAME.load(Ordering::SeqCst)
        && SESSION_LIVE.load(Ordering::SeqCst)
}

// Fixed chat keys, as in CS2: Y opens global chat, U opens team chat.
const VK_Y: u32 = 0x59;
const VK_U: u32 = 0x55;
const VK_CAPITAL: u32 = 0x14;
// Windows virtual-key code of the configurable shop hotkey; B until settings load.
static SHOP_HOTKEY: AtomicU32 = AtomicU32::new(0x42);
// The configurable scoreboard key (held to show); CapsLock until settings load.
static SCOREBOARD_HOTKEY: AtomicU32 = AtomicU32::new(VK_CAPITAL);

// Must match isBindableHotkey in src/platform/hotkeys.ts: letters except the chat
// keys Y and U, and F1-F12. Digits are taken by shop item selection.
fn is_bindable_shop_hotkey(virtual_key: u32) -> bool {
    matches!(virtual_key, 0x41..=0x5A | 0x70..=0x7B) && virtual_key != VK_Y && virtual_key != VK_U
}

// Must match isBindableScoreboardHotkey: the shop's keys plus CapsLock (CS2 holds Tab,
// which SCP:SL uses for the inventory).
fn is_bindable_scoreboard_hotkey(virtual_key: u32) -> bool {
    virtual_key == VK_CAPITAL || is_bindable_shop_hotkey(virtual_key)
}

fn validate_hotkeys(shop: u32, scoreboard: u32) -> Result<(), String> {
    if !is_bindable_shop_hotkey(shop) {
        return Err(format!("Unsupported shop hotkey {shop:#04x}"));
    }
    if !is_bindable_scoreboard_hotkey(scoreboard) {
        return Err(format!("Unsupported scoreboard hotkey {scoreboard:#04x}"));
    }
    if shop == scoreboard {
        return Err("The shop and the scoreboard need different keys".into());
    }
    Ok(())
}

#[tauri::command]
fn set_hotkeys(shop: u32, scoreboard: u32) -> Result<(), String> {
    validate_hotkeys(shop, scoreboard)?;
    SHOP_HOTKEY.store(shop, Ordering::SeqCst);
    SCOREBOARD_HOTKEY.store(scoreboard, Ordering::SeqCst);
    Ok(())
}

// Set by the hook's event thread while the scoreboard key, pressed over the game, is
// down; cleared by its key-up wherever the foreground is (cursor mode moves it).
static SCOREBOARD_HELD: AtomicBool = AtomicBool::new(false);
// The overlay asks for right-click only while it actually shows the passive scoreboard,
// so a press that shows nothing never eats a right-click.
static SCOREBOARD_CAPTURE: AtomicBool = AtomicBool::new(false);
// Development spike (SLUI_SCOREBOARD_SPIKE=1 in a debug build): capture whenever the key
// is held, without the panel, to check in game that a swallowed right-click never aims.
#[cfg_attr(not(windows), allow(dead_code))]
static SCOREBOARD_SPIKE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn set_scoreboard_capture(capture: bool) {
    SCOREBOARD_CAPTURE.store(capture, Ordering::SeqCst);
}

#[cfg_attr(not(windows), allow(dead_code))]
fn scoreboard_captures_right_click() -> bool {
    SCOREBOARD_CAPTURE.load(Ordering::SeqCst)
        || (SCOREBOARD_SPIKE.load(Ordering::SeqCst) && SCOREBOARD_HELD.load(Ordering::SeqCst))
}

#[derive(Clone, Copy, Default, serde::Serialize)]
struct OverlaySnapshot {
    enabled: bool,
    interactive: bool,
}

struct TrayOverlayItem(MenuItem<tauri::Wry>);

#[derive(Default)]
struct GameRunningState(Mutex<bool>);

/// `focused`: the game holds the foreground. `over_game`: the overlay is over the game, i.e. the game or the
/// overlay itself holds the foreground (the overlay's own visibility rule; a null foreground keeps it), so a
/// panel that takes the foreground stays drawn.
#[derive(Clone, Copy, Default, serde::Serialize)]
struct GameForegroundState {
    focused: bool,
    #[serde(rename = "overGame")]
    over_game: bool,
    revision: u64,
}

#[tauri::command]
fn get_game_foreground(
    state: tauri::State<'_, Mutex<GameForegroundState>>,
) -> Result<GameForegroundState, String> {
    state
        .lock()
        .map(|state| *state)
        .map_err(|_| "Game foreground state unavailable".into())
}

#[cfg_attr(not(windows), allow(dead_code))]
fn is_game_executable(path: &str) -> bool {
    path.rsplit(['\\', '/'])
        .next()
        .is_some_and(|name| name.eq_ignore_ascii_case("SCPSL.exe"))
}

/// The verdict for the last foreground window, keyed by its handle and process id: a window never
/// changes process, and a reused handle belongs to a new process id. The foreground poll (every
/// 100 ms) and the keyboard events (every key) then query the executable path only when the
/// foreground window changes. A failed query is not remembered, so it is retried.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Default)]
struct ForegroundProcessCache {
    last: Option<((isize, u32), bool)>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl ForegroundProcessCache {
    const fn new() -> Self {
        Self { last: None }
    }

    /// `query` reads whether the window's process is the game; None when it could not be read.
    fn check(&mut self, window: isize, process_id: u32, query: impl FnOnce() -> Option<bool>) -> bool {
        let key = (window, process_id);
        if let Some((cached, verdict)) = self.last {
            if cached == key {
                return verdict;
            }
        }
        match query() {
            Some(verdict) => {
                self.last = Some((key, verdict));
                verdict
            }
            None => {
                self.last = None;
                false
            }
        }
    }
}

#[cfg(windows)]
static FOREGROUND_PROCESS: Mutex<ForegroundProcessCache> = Mutex::new(ForegroundProcessCache::new());

#[cfg(windows)]
fn is_game_foreground(foreground: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    if foreground.is_null() {
        return false;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(foreground, &mut process_id) };
    if process_id == 0 {
        return false;
    }
    let query = || process_image_path(process_id).map(|path| is_game_executable(&path));
    match FOREGROUND_PROCESS.lock() {
        Ok(mut cache) => cache.check(foreground as isize, process_id, query),
        // A poisoned lock only loses the cache; the answer is still read.
        Err(_) => query().unwrap_or(false),
    }
}

/// The executable path of a process, or None when it cannot be read. Only the path is queried: no process memory or
/// input is accessed.
#[cfg(windows)]
fn process_image_path(process_id: u32) -> Option<String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    };

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return None;
    }
    let mut path = vec![0_u16; 32_768];
    let mut length = path.len() as u32;
    let queried = unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length) };
    unsafe { CloseHandle(process) };
    if queried == 0 {
        return None;
    }
    // A path that is not valid UTF-16 is never the game's; it is still a readable answer.
    Some(String::from_utf16_lossy(&path[..length as usize]))
}

/// Diagnostics: a window as its executable file name and window class, never its title (which can hold anything the
/// player has open).
#[cfg(windows)]
fn describe_foreground(window: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowThreadProcessId};

    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window, &mut process_id) };
    let executable = (process_id != 0)
        .then(|| process_image_path(process_id))
        .flatten()
        .and_then(|path| path.rsplit(['\\', '/']).next().map(str::to_owned))
        .unwrap_or_else(|| "unknown executable".into());
    let mut class = [0_u16; 256];
    let length = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) };
    let class = if length > 0 {
        String::from_utf16_lossy(&class[..length as usize])
    } else {
        "unknown class".into()
    };
    format!("{executable} (class {class})")
}

#[cfg(windows)]
fn publish_game_foreground(app: &tauri::AppHandle, focused: bool, over_game: bool) {
    let state = app.state::<Mutex<GameForegroundState>>();
    let Ok(mut state) = state.lock() else {
        diag!("SLGO: game foreground state unavailable");
        return;
    };
    if state.focused == focused && state.over_game == over_game {
        return;
    }
    state.focused = focused;
    state.over_game = over_game;
    state.revision += 1;
    let snapshot = *state;
    drop(state);
    diag!(
        "SLGO: game foreground {focused}, overlay over game {over_game} (revision {})",
        snapshot.revision
    );
    if let Err(error) = app.emit_to(OVERLAY_WINDOW, "slgo-game-foreground", snapshot) {
        diag!("SLGO: failed to emit game foreground state: {error}");
    }
}

#[derive(serde::Serialize)]
struct SteamIdentityResponse {
    steam_id: String,
}

#[cfg(windows)]
#[tauri::command]
fn get_current_steam_identity() -> Result<Option<SteamIdentityResponse>, String> {
    use std::ffi::c_void;
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
    };

    let subkey: Vec<u16> = "Software\\Valve\\Steam\\ActiveProcess\0"
        .encode_utf16()
        .collect();
    let value_name: Vec<u16> = "ActiveUser\0".encode_utf16().collect();
    let mut account_id = 0_u32;
    let mut value_size = std::mem::size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut account_id as *mut u32 as *mut c_void,
            &mut value_size,
        )
    };

    if result != ERROR_SUCCESS {
        return Ok(None);
    }
    if account_id == 0 {
        return Ok(None);
    }

    const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;
    Ok(Some(SteamIdentityResponse {
        steam_id: (STEAM_ID64_BASE + account_id as u64).to_string(),
    }))
}

#[cfg(not(windows))]
#[tauri::command]
fn get_current_steam_identity() -> Result<Option<SteamIdentityResponse>, String> {
    Ok(None)
}

#[cfg(windows)]
fn apply_overlay_input_mode(window: &tauri::WebviewWindow, interactive: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, HWND_TOPMOST, LWA_ALPHA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE);
        let passive_bits = WS_EX_TRANSPARENT as isize | WS_EX_NOACTIVATE as isize;
        // WS_EX_LAYERED stays on in both modes. Clearing it the first time turns the
        // webview's transparent pixels opaque white; leaving it on without layered
        // attributes fails every hit test, so clicks fall through to the game even
        // when interactive. Full opacity keeps the webview's own per-pixel alpha.
        let next_style = if interactive {
            (style & !passive_bits) | WS_EX_LAYERED as isize
        } else {
            style | passive_bits | WS_EX_LAYERED as isize | WS_EX_TOOLWINDOW as isize
        };
        SetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE, next_style);
        SetLayeredWindowAttributes(hwnd.0 as _, 0, 255, LWA_ALPHA);
        // Only an enabled overlay over the game may be shown; otherwise it stays hidden.
        let show = if overlay_may_show() { SWP_SHOWWINDOW } else { 0 };
        SetWindowPos(
            hwnd.0 as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | show,
        );
    }
    // Re-asserting the overlay's topmost place lifts it away from the backdrops under it.
    backdrop::refresh(window.app_handle());
    // WS_EX_TRANSPARENT above already makes the window click-through. Do not also call
    // set_ignore_cursor_events: tao never saw the SWP_SHOWWINDOW show, so its style
    // refresh would hide the overlay and overwrite these extended styles.
}

// Counterpart to the native show above. tao's hide() is a no-op here because its
// cached visibility still says hidden.
#[cfg(windows)]
fn hide_overlay_window(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    if let Ok(hwnd) = window.hwnd() {
        unsafe { ShowWindow(hwnd.0 as _, SW_HIDE) };
    }
    backdrop::refresh(window.app_handle());
}

fn overlay_snapshot(app: &AppHandle) -> OverlaySnapshot {
    app.state::<Mutex<OverlaySnapshot>>()
        .lock()
        .map(|state| *state)
        .unwrap_or_default()
}

fn publish_overlay_state(app: &AppHandle, snapshot: OverlaySnapshot) {
    if let Some(item) = app.try_state::<TrayOverlayItem>() {
        let label = if snapshot.enabled { "停用 UI" } else { "启用 UI" };
        if let Err(error) = item.0.set_text(label) {
            diag!("SLGO: failed to update tray menu: {error}");
        }
    }
    if let Err(error) = app.emit("slgo-overlay-state", snapshot) {
        diag!("SLGO: failed to emit overlay state: {error}");
    }
}

// Shared by the home window command and the tray menu so both always agree.
fn apply_overlay_enabled(app: &AppHandle, enabled: bool) -> Result<OverlaySnapshot, String> {
    let overlay = app
        .get_webview_window(OVERLAY_WINDOW)
        .ok_or("Overlay window unavailable")?;
    let snapshot = OverlaySnapshot { enabled, interactive: false };
    {
        let state = app.state::<Mutex<OverlaySnapshot>>();
        let mut state = state.lock().map_err(|_| "Overlay state unavailable")?;
        *state = snapshot;
    }
    OVERLAY_ENABLED.store(enabled, Ordering::SeqCst);
    // Always return to passive click-through first. On Windows this also shows
    // the window without activating it when the game holds the foreground; enabling
    // from the home window leaves it hidden until the game comes to the front.
    #[cfg(windows)]
    {
        apply_overlay_input_mode(&overlay, false);
        if !overlay_may_show() {
            hide_overlay_window(&overlay);
        }
    }
    #[cfg(not(windows))]
    {
        let result = if enabled { overlay.show() } else { overlay.hide() };
        result.map_err(|error| format!("Unable to switch overlay window: {error}"))?;
    }
    publish_overlay_state(app, snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn set_overlay_enabled(app: AppHandle, enabled: bool) -> Result<OverlaySnapshot, String> {
    apply_overlay_enabled(&app, enabled)
}

// A sync command runs on the main thread, as visibility changes must.
#[tauri::command]
fn set_overlay_session_live(app: AppHandle, live: bool) {
    if SESSION_LIVE.swap(live, Ordering::SeqCst) == live {
        return;
    }
    diag!("SLGO: overlay session {}", if live { "live" } else { "not live" });
    #[cfg(windows)]
    sync_overlay_visibility(&app);
    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
fn get_overlay_state(app: AppHandle) -> OverlaySnapshot {
    overlay_snapshot(&app)
}

#[tauri::command]
fn set_overlay_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let snapshot = {
        let state = app.state::<Mutex<OverlaySnapshot>>();
        let mut state = state.lock().map_err(|_| "Overlay state unavailable")?;
        if interactive && !state.enabled {
            return Err("Overlay is disabled".into());
        }
        state.interactive = interactive;
        *state
    };
    #[cfg(windows)]
    if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW) {
        apply_overlay_input_mode(&overlay, interactive);
    }
    publish_overlay_state(&app, snapshot);
    Ok(())
}

// The window (normally the game) that had the foreground when a text UI took the
// keyboard; it gets the foreground back when that UI releases it.
#[cfg(windows)]
static KEYBOARD_RETURN_WINDOW: AtomicIsize = AtomicIsize::new(0);

// Interactive mode only changes hit testing. Every overlay UI (shop and chat) also
// makes the overlay the foreground window: a foreground game keeps its cursor locked
// and turns the camera with the mouse, and chat needs the keyboard.
#[tauri::command]
fn set_overlay_keyboard_focus(app: AppHandle, focused: bool) -> Result<(), String> {
    if focused && !overlay_snapshot(&app).interactive {
        return Err("Overlay is not interactive".into());
    }
    #[cfg(windows)]
    {
        let overlay = app
            .get_webview_window(OVERLAY_WINDOW)
            .ok_or("Overlay window unavailable")?;
        let hwnd = overlay.hwnd().map_err(|error| error.to_string())?;
        if focused {
            take_keyboard_focus(hwnd.0 as _)
        } else {
            release_keyboard_focus(hwnd.0 as _);
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = focused;
        Ok(())
    }
}

#[cfg(windows)]
fn take_keyboard_focus(overlay: windows_sys::Win32::Foundation::HWND) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::GetLastError,
        System::Threading::{AttachThreadInput, GetCurrentThreadId},
        UI::{
            Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_MOUSE},
            WindowsAndMessaging::{
                BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
                SetForegroundWindow,
            },
        },
    };

    let foreground = unsafe { GetForegroundWindow() };
    if foreground == overlay {
        return Ok(());
    }
    KEYBOARD_RETURN_WINDOW.store(foreground as isize, Ordering::SeqCst);
    // wry moves focus into the webview when the window receives WM_SETFOCUS.
    let activate = || {
        unsafe { SetForegroundWindow(overlay) };
        let now = unsafe { GetForegroundWindow() };
        now == overlay
    };
    if activate() {
        return Ok(());
    }
    diag!("SLGO: SetForegroundWindow refused ({}); retrying", unsafe {
        GetLastError()
    });

    // The foreground lock admits the process that sent the last input. An empty
    // mouse input (no movement, no buttons, as PowerToys does) makes that this
    // process without the game seeing anything; keys are never synthesized.
    let mut input: INPUT = unsafe { std::mem::zeroed() };
    input.r#type = INPUT_MOUSE;
    let sent = unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
    if sent == 1 && activate() {
        return Ok(());
    }
    diag!(
        "SLGO: foreground refused after empty input (sent {sent}, error {}); attaching input",
        unsafe { GetLastError() }
    );

    // Last resort: share the foreground thread's input state for one attempt.
    let current = unsafe { GetCurrentThreadId() };
    let foreground_thread = if foreground.is_null() {
        0
    } else {
        unsafe { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) }
    };
    let attached = foreground_thread != 0
        && foreground_thread != current
        && unsafe { AttachThreadInput(current, foreground_thread, 1) } != 0;
    unsafe { BringWindowToTop(overlay) };
    let activated = activate();
    if attached {
        unsafe { AttachThreadInput(current, foreground_thread, 0) };
    }
    if activated {
        Ok(())
    } else {
        let error = unsafe { GetLastError() };
        diag!("SLGO: overlay could not take the keyboard (attached {attached}, error {error})");
        Err(format!(
            "Windows refused to give the overlay the keyboard (error {error})"
        ))
    }
}

// Overlay diagnostics (shop key decisions, chat focus and close reasons) go to the log
// (diag.rs) and stderr; the webview console is hard to reach in game.
#[tauri::command]
fn log_overlay_event(message: String) {
    diag!("SLGO overlay: {message}");
}

#[cfg(windows)]
fn release_keyboard_focus(overlay: windows_sys::Win32::Foundation::HWND) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsWindow, SetForegroundWindow,
    };

    let previous =
        KEYBOARD_RETURN_WINDOW.swap(0, Ordering::SeqCst) as windows_sys::Win32::Foundation::HWND;
    // If the player already switched elsewhere, leave the foreground alone.
    if unsafe { GetForegroundWindow() } != overlay || previous.is_null() {
        return;
    }
    if unsafe { IsWindow(previous) } != 0 {
        unsafe { SetForegroundWindow(previous) };
    }
}

fn settings_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("Settings directory unavailable: {error}"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    settings::load(&settings_dir(&app)?)
}

#[tauri::command]
fn save_settings(app: AppHandle, contents: String) -> Result<(), String> {
    settings::save(&settings_dir(&app)?, &contents)?;
    app.emit("slgo-settings-changed", contents)
        .map_err(|error| format!("Settings saved but not broadcast: {error}"))
}

#[tauri::command]
fn get_game_running(state: tauri::State<'_, GameRunningState>) -> bool {
    state.0.lock().map(|running| *running).unwrap_or(false)
}

#[cfg(windows)]
fn is_game_running() -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };

    // Process names only; no handle to the game process itself is opened.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return false;
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = false;
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while more {
        let length = entry
            .szExeFile
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(entry.szExeFile.len());
        if String::from_utf16(&entry.szExeFile[..length]).is_ok_and(|name| is_game_executable(&name)) {
            found = true;
            break;
        }
        more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    found
}

#[cfg(not(windows))]
fn is_game_running() -> bool {
    false
}

fn start_game_process_tracking(app: AppHandle) {
    thread::spawn(move || loop {
        let running = is_game_running();
        let changed = app
            .state::<GameRunningState>()
            .0
            .lock()
            .map(|mut state| std::mem::replace(&mut *state, running) != running)
            .unwrap_or(false);
        if changed {
            diag!("SLGO: game {}", if running { "started" } else { "exited" });
            if let Err(error) = app.emit("slgo-game-running", running) {
                diag!("SLGO: failed to emit game process state: {error}");
            }
        }
        // The game's exit ends its session: the overlay goes off, as from the tray, and the next
        // connection's auto-enable turns it on again.
        if changed && !running {
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || disable_overlay_after_game(&handle)) {
                diag!("SLGO: failed to schedule disabling the overlay: {error}");
            }
        }
        thread::sleep(Duration::from_secs(2));
    });
}

// Main thread only, where the enable command and the tray also run.
fn disable_overlay_after_game(app: &AppHandle) {
    if !overlay_snapshot(app).enabled {
        return;
    }
    match apply_overlay_enabled(app, false) {
        Ok(_) => diag!("SLGO: overlay disabled after the game exited"),
        Err(error) => diag!("SLGO: {error}"),
    }
}

fn show_home(app: &AppHandle, request_attention: bool) {
    let Some(home) = app.get_webview_window(HOME_WINDOW) else {
        return;
    };
    let _ = home.show();
    let _ = home.unminimize();
    let _ = home.set_focus();
    // Windows may refuse to bring another process's window to the front; a
    // flashing taskbar button is the visible fallback, as in ordinary apps.
    if request_attention {
        let _ = home.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

// Selects slui.log in Explorer, so a player can attach it to a report.
fn reveal_log(app: &AppHandle) {
    use tauri_plugin_opener::OpenerExt;

    let Some(path) = diag::path() else {
        diag!("SLGO: no log file to show");
        return;
    };
    if let Err(error) = app.opener().reveal_item_in_dir(path) {
        diag!("SLGO: cannot show the log file: {error}");
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open-home", "打开主界面", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle-overlay", "启用 UI", true, None::<&str>)?;
    let log = MenuItem::with_id(app, "open-log", "打开日志文件夹", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &log, &separator, &quit])?;
    app.manage(TrayOverlayItem(toggle));
    // Inserted after 「启用 UI」 while an update is ready.
    let update = MenuItem::with_id(app, updater::TRAY_ITEM_ID, "", true, None::<&str>)?;
    app.manage(updater::TrayItem::new(menu.clone(), update, 2));

    let mut tray = TrayIconBuilder::with_id("slui")
        .tooltip("SLUI")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-home" => show_home(app, false),
            "toggle-overlay" => {
                let enabled = !overlay_snapshot(app).enabled;
                if let Err(error) = apply_overlay_enabled(app, enabled) {
                    diag!("SLGO: {error}");
                }
            }
            updater::TRAY_ITEM_ID => updater::install_from_tray(app),
            "open-log" => reveal_log(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_home(tray.app_handle(), false);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(windows)]
fn start_foreground_tracking(app: tauri::AppHandle) {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let mut diagnostics = InputDiagnostics::new();
    thread::spawn(move || loop {
        let foreground = unsafe { GetForegroundWindow() };
        let game_foreground = is_game_foreground(foreground);
        diagnostics.sample(foreground, game_foreground);
        // The world blur captures the window the overlay aligns to.
        if game_foreground {
            backdrop::set_game_window(&app, foreground as isize);
        }
        backdrop::tick();
        GAME_FOREGROUND_WINDOW.store(if game_foreground { foreground as isize } else { 0 }, Ordering::SeqCst);

        let overlay_hwnd = app
            .get_webview_window(OVERLAY_WINDOW)
            .and_then(|overlay| overlay.hwnd().ok())
            .map(|hwnd| hwnd.0 as windows_sys::Win32::Foundation::HWND);

        // The overlay is shown only over the game, or while it holds the foreground
        // itself (shop, chat, team menu). A null foreground is a transient switch; keep
        // the current visibility.
        let over_game = if foreground.is_null() {
            OVERLAY_OVER_GAME.load(Ordering::SeqCst)
        } else {
            game_foreground || overlay_hwnd == Some(foreground)
        };
        // The page reads the same sample: a panel that takes the foreground from the game
        // must not see a moment in which neither holds it.
        publish_game_foreground(&app, game_foreground, over_game);

        // Align before showing, so the overlay never appears at a stale rect.
        if game_foreground && OVERLAY_ENABLED.load(Ordering::SeqCst) {
            if let Some(overlay_hwnd) = overlay_hwnd {
                if align_overlay_to(overlay_hwnd, foreground) {
                    backdrop::refresh(&app);
                }
            }
        }

        if !foreground.is_null()
            && OVERLAY_OVER_GAME.swap(over_game, Ordering::SeqCst) != over_game
        {
            // Diagnostics: what took the foreground from the game and the overlay (an open shop or chat closes on
            // that blur, and the overlay hides).
            if !over_game {
                diag!("SLGO: foreground left the game and the overlay: {}", describe_foreground(foreground));
            }
            // Visibility changes run on the main thread, where the enable and
            // interactive commands and the tray also run, so they cannot race.
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || sync_overlay_visibility(&handle)) {
                diag!("SLGO: failed to schedule overlay visibility: {error}");
            }
        }

        thread::sleep(Duration::from_millis(100));
    });
}

/// Diagnostics on the foreground thread: whether the game process runs elevated (a keyboard hook in a
/// non-elevated SLUI does not see keys sent to it), logged when a new game process first holds the foreground;
/// and once a minute in which the game held the foreground, how many input events the hooks were called for.
#[cfg(windows)]
struct InputDiagnostics {
    game_process: u32,
    period_start: std::time::Instant,
    last_sample: std::time::Instant,
    game_foreground: Duration,
}

#[cfg(windows)]
impl InputDiagnostics {
    const PERIOD: Duration = Duration::from_secs(60);

    fn new() -> Self {
        let now = std::time::Instant::now();
        Self { game_process: 0, period_start: now, last_sample: now, game_foreground: Duration::ZERO }
    }

    fn sample(&mut self, foreground: windows_sys::Win32::Foundation::HWND, game_foreground: bool) {
        let now = std::time::Instant::now();
        if game_foreground {
            self.game_foreground += now - self.last_sample;
            self.note_game_process(foreground);
        }
        self.last_sample = now;
        if now - self.period_start < Self::PERIOD {
            return;
        }
        let keys = HOOK_KEY_EVENTS.swap(0, Ordering::Relaxed);
        let mouse = HOOK_MOUSE_EVENTS.swap(0, Ordering::Relaxed);
        if !self.game_foreground.is_zero() {
            diag!(
                "SLGO: input hooks saw {keys} key and {mouse} mouse events in {}s (game foreground {}s)",
                (now - self.period_start).as_secs(),
                self.game_foreground.as_secs()
            );
        }
        self.period_start = now;
        self.game_foreground = Duration::ZERO;
    }

    fn note_game_process(&mut self, window: windows_sys::Win32::Foundation::HWND) {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError},
            System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
            UI::WindowsAndMessaging::GetWindowThreadProcessId,
        };

        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(window, &mut process_id) };
        if process_id == 0 || process_id == self.game_process {
            return;
        }
        self.game_process = process_id;
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        let elevated = if process.is_null() {
            Err(unsafe { GetLastError() })
        } else {
            let elevated = diag::process_elevated(process);
            unsafe { CloseHandle(process) };
            elevated
        };
        diag!("SLGO: game process {process_id} holds the foreground; elevated: {}", diag::elevation_text(elevated));
    }
}

// Returns whether the overlay moved (its backdrops must follow).
#[cfg(windows)]
fn align_overlay_to(
    overlay: windows_sys::Win32::Foundation::HWND,
    game: windows_sys::Win32::Foundation::HWND,
) -> bool {
    use windows_sys::Win32::{
        Foundation::RECT,
        UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER},
    };

    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(game, &mut rect) } == 0 {
        return false;
    }
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    if width <= 0 || height <= 0 {
        return false;
    }
    let mut overlay_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let already_aligned = unsafe {
        GetWindowRect(overlay, &mut overlay_rect) != 0
            && overlay_rect.left == rect.left
            && overlay_rect.top == rect.top
            && overlay_rect.right == rect.right
            && overlay_rect.bottom == rect.bottom
    };
    if !already_aligned {
        unsafe {
            SetWindowPos(
                overlay,
                std::ptr::null_mut(),
                rect.left,
                rect.top,
                width,
                height,
                // Position only: visibility belongs to sync_overlay_visibility.
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }
    !already_aligned
}

// Main thread only. Shows the overlay when it may be shown, hides it otherwise.
#[cfg(windows)]
fn sync_overlay_visibility(app: &AppHandle) {
    let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW) else {
        return;
    };
    if overlay_may_show() {
        apply_overlay_input_mode(&overlay, overlay_snapshot(app).interactive);
    } else {
        hide_overlay_window(&overlay);
    }
}

#[cfg(not(windows))]
fn start_foreground_tracking(_app: tauri::AppHandle) {}

/// `slgo-shortcut` payload. The overlay decides what a shortcut opens.
#[derive(Clone, Copy, serde::Serialize)]
struct ShortcutEvent {
    shortcut: &'static str,
    /// Whether the game had the foreground when the key went down.
    game_foreground: bool,
}

fn overlay_shortcut(vk: u32, shop_hotkey: u32) -> Option<&'static str> {
    match vk {
        VK_Y => Some("chat-global"),
        VK_U => Some("chat-team"),
        _ if vk == shop_hotkey => Some("shop"),
        _ => None,
    }
}

/// `slgo-scoreboard-key` payload: the scoreboard key went down over the game (held) or up.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, serde::Serialize)]
struct ScoreboardKeyEvent {
    held: bool,
}

#[cfg(windows)]
#[derive(Clone, Copy)]
enum HookEvent {
    /// A non-repeat key-down of a key the overlay handles.
    KeyDown(u32),
    /// Diagnostics: a key-down of a handled key that the asynchronous state reports as auto-repeat although it cannot
    /// be one (`repeat_is_suspect`). Its press is dropped like an auto-repeat. `gap_ms`: time since the key's previous
    /// event the hook saw (`None`: none seen); `after_up`: that event was the key's key-up.
    SuspectRepeat { vk: u32, gap_ms: Option<u32>, after_up: bool },
    /// The scoreboard key went up.
    ScoreboardUp,
    /// A right-click swallowed for the scoreboard's cursor mode.
    ScoreboardCursor,
}

#[cfg(windows)]
static HOOK_EVENTS: OnceLock<mpsc::Sender<HookEvent>> = OnceLock::new();
// Set when a right-button press was swallowed, so its release is swallowed too.
#[cfg(windows)]
static RIGHT_BUTTON_SWALLOWED: AtomicBool = AtomicBool::new(false);

// Diagnostics (logged once a minute while the game is foreground): input events the hooks were called for. A
// minute of play without any points to a blind hook (an elevated game) or one Windows removed.
#[cfg(windows)]
static HOOK_KEY_EVENTS: AtomicU32 = AtomicU32::new(0);
#[cfg(windows)]
static HOOK_MOUSE_EVENTS: AtomicU32 = AtomicU32::new(0);
// Each virtual key's last event time (KBDLLHOOKSTRUCT.time, 0 = none seen) and whether that event was a key-down,
// for SuspectRepeat.
#[cfg(windows)]
static KEY_LAST_EVENT_MS: [AtomicU32; 256] = [const { AtomicU32::new(0) }; 256];
#[cfg(windows)]
static KEY_LAST_WAS_DOWN: [AtomicBool; 256] = [const { AtomicBool::new(false) }; 256];
// Windows' longest typematic delay is 1 s (keyboard delay setting 3); later repeats come faster.
#[cfg_attr(not(windows), allow(dead_code))]
const AUTO_REPEAT_MAX_GAP_MS: u32 = 1_500;

/// Diagnostics: whether a key-down that the asynchronous state calls auto-repeat cannot be one. Auto-repeat follows
/// the hook's own key-down of that key within the typematic interval. After its key-up, with no earlier event or after
/// a longer gap, the system's record and the hook's disagree and a fresh press is lost.
#[cfg_attr(not(windows), allow(dead_code))]
fn repeat_is_suspect(last_was_down: bool, gap_ms: Option<u32>) -> bool {
    !last_was_down || gap_ms.is_none_or(|gap| gap > AUTO_REPEAT_MAX_GAP_MS)
}

#[cfg(windows)]
fn send_hook_event(event: HookEvent) {
    if let Some(sender) = HOOK_EVENTS.get() {
        let _ = sender.send(event);
    }
}

#[cfg(windows)]
fn emit_scoreboard_key(app: &AppHandle, held: bool) {
    diag!("SLGO: scoreboard key {}", if held { "held" } else { "released" });
    if let Err(error) = app.emit_to(OVERLAY_WINDOW, "slgo-scoreboard-key", ScoreboardKeyEvent { held }) {
        diag!("SLGO: failed to emit scoreboard key: {error}");
    }
}

#[cfg(windows)]
fn start_keyboard_hook(app: tauri::AppHandle) {
    use windows_sys::Win32::{
        Foundation::GetLastError,
        System::{
            LibraryLoader::GetModuleHandleW,
            Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL},
        },
        UI::{
            Input::KeyboardAndMouse::GetAsyncKeyState,
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW,
                SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT,
                WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
                WM_SYSKEYDOWN, WM_SYSKEYUP,
            },
        },
    };

    // Runs on the hook thread for every key event, so it only classifies and hands off.
    // Keys are never swallowed (CapsLock keeps toggling, as with the plugin's binding).
    unsafe extern "system" fn keyboard_proc(code: i32, wparam: usize, lparam: isize) -> isize {
        let is_down = wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
        let is_up = wparam == WM_KEYUP as usize || wparam == WM_SYSKEYUP as usize;
        if code == HC_ACTION as i32 && (is_down || is_up) && lparam != 0 {
            HOOK_KEY_EVENTS.fetch_add(1, Ordering::Relaxed);
            let info = &*(lparam as *const KBDLLHOOKSTRUCT);
            let vk = info.vkCode;
            // Virtual keys are 1-254; `time` is 0 only right after boot, where a gap is moot.
            let previous_ms = KEY_LAST_EVENT_MS
                .get(vk as usize)
                .map_or(0, |last| last.swap(info.time, Ordering::Relaxed));
            let last_was_down = KEY_LAST_WAS_DOWN
                .get(vk as usize)
                .is_some_and(|last| last.swap(is_down, Ordering::Relaxed));
            let scoreboard = vk == SCOREBOARD_HOTKEY.load(Ordering::Relaxed);
            if is_down {
                // Windows calls low-level hooks before it updates the key's asynchronous
                // state, so that state still tells whether the key was already down: if it
                // was, this key-down is auto-repeat. It is the system's own record of the
                // physical key, so unlike tracking key-ups ourselves it cannot drift when
                // an event is missed, and no timing guess is involved.
                let repeat = (GetAsyncKeyState(vk as i32) as u16) & 0x8000 != 0;
                let handled = scoreboard || overlay_shortcut(vk, SHOP_HOTKEY.load(Ordering::Relaxed)).is_some();
                if !repeat && handled {
                    send_hook_event(HookEvent::KeyDown(vk));
                } else if handled {
                    // Diagnostics only: a fresh press the async state calls a repeat would be dropped here.
                    let gap_ms = (previous_ms != 0).then(|| info.time.wrapping_sub(previous_ms));
                    if repeat_is_suspect(last_was_down, gap_ms) {
                        let after_up = previous_ms != 0 && !last_was_down;
                        send_hook_event(HookEvent::SuspectRepeat { vk, gap_ms, after_up });
                    }
                }
            } else if scoreboard {
                send_hook_event(HookEvent::ScoreboardUp);
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    // Swallows the right button only while the passive scoreboard asks for it and the
    // game holds the foreground; every other mouse event passes untouched.
    unsafe extern "system" fn mouse_proc(code: i32, wparam: usize, lparam: isize) -> isize {
        if code == HC_ACTION as i32 {
            HOOK_MOUSE_EVENTS.fetch_add(1, Ordering::Relaxed);
            if wparam == WM_RBUTTONDOWN as usize && scoreboard_captures_right_click() {
                let game = GAME_FOREGROUND_WINDOW.load(Ordering::Relaxed);
                if game != 0 && GetForegroundWindow() as isize == game {
                    RIGHT_BUTTON_SWALLOWED.store(true, Ordering::SeqCst);
                    send_hook_event(HookEvent::ScoreboardCursor);
                    return 1;
                }
            } else if wparam == WM_RBUTTONUP as usize && RIGHT_BUTTON_SWALLOWED.swap(false, Ordering::SeqCst) {
                return 1;
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    #[cfg(debug_assertions)]
    if std::env::var("SLUI_SCOREBOARD_SPIKE").is_ok_and(|value| value == "1") {
        diag!("SLGO: scoreboard spike on: right-click is captured while the scoreboard key is held");
        SCOREBOARD_SPIKE.store(true, Ordering::SeqCst);
    }

    let (sender, receiver) = mpsc::channel::<HookEvent>();
    let _ = HOOK_EVENTS.set(sender);

    thread::spawn(move || {
        while let Ok(event) = receiver.recv() {
            match event {
                HookEvent::KeyDown(vk) => {
                    if !OVERLAY_ENABLED.load(Ordering::SeqCst) {
                        // The plugin handles its own shop key then; chat keys are not logged (they are typing).
                        if vk == SHOP_HOTKEY.load(Ordering::SeqCst) {
                            diag!("SLGO: hotkey shop ignored: overlay disabled");
                        }
                        continue;
                    }
                    // Read at the press itself: the foreground poll lags up to 100ms, so a
                    // press right after chat hands the game back would otherwise be dropped.
                    let foreground = unsafe { GetForegroundWindow() };
                    let game_foreground = is_game_foreground(foreground);
                    if game_foreground {
                        GAME_FOREGROUND_WINDOW.store(foreground as isize, Ordering::SeqCst);
                    }
                    if vk == SCOREBOARD_HOTKEY.load(Ordering::SeqCst) {
                        if game_foreground && !SCOREBOARD_HELD.swap(true, Ordering::SeqCst) {
                            emit_scoreboard_key(&app, true);
                        }
                        continue;
                    }
                    let Some(shortcut) = overlay_shortcut(vk, SHOP_HOTKEY.load(Ordering::SeqCst)) else {
                        continue;
                    };
                    diag!("SLGO: hotkey {shortcut} (game foreground {game_foreground})");
                    let event = ShortcutEvent {
                        shortcut,
                        game_foreground,
                    };
                    if let Err(error) = app.emit_to(OVERLAY_WINDOW, "slgo-shortcut", event) {
                        diag!("SLGO: failed to emit shortcut: {error}");
                    }
                }
                HookEvent::SuspectRepeat { vk, gap_ms, after_up } => {
                    let key = if vk == SCOREBOARD_HOTKEY.load(Ordering::SeqCst) {
                        "scoreboard"
                    } else {
                        overlay_shortcut(vk, SHOP_HOTKEY.load(Ordering::SeqCst)).unwrap_or("?")
                    };
                    let since = gap_ms.map_or("the hook saw no earlier event".into(), |gap| {
                        format!("the hook's last event of the key was its key-{} {gap} ms ago", if after_up { "up" } else { "down" })
                    });
                    diag!("SLGO: hotkey {key} press dropped: the system already reports the key down ({since})");
                }
                HookEvent::ScoreboardUp => {
                    if SCOREBOARD_HELD.swap(false, Ordering::SeqCst) {
                        emit_scoreboard_key(&app, false);
                    }
                }
                HookEvent::ScoreboardCursor => {
                    diag!("SLGO: scoreboard right-click captured");
                    if let Err(error) = app.emit_to(OVERLAY_WINDOW, "slgo-scoreboard-cursor", ()) {
                        diag!("SLGO: failed to emit scoreboard cursor: {error}");
                    }
                }
            }
        }
    });

    thread::spawn(move || {
        // Windows skips a low-level hook that misses LowLevelHooksTimeout; keep this
        // thread ahead of a busy game so no input event passes unseen. Both hooks share
        // it: their callbacks only classify and hand off.
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL) };
        let module = unsafe { GetModuleHandleW(std::ptr::null()) };
        let keyboard = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0) };
        if keyboard.is_null() {
            diag!("SLGO: failed to install WH_KEYBOARD_LL hook ({})", unsafe {
                GetLastError()
            });
            return;
        }
        let mouse = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) };
        if mouse.is_null() {
            diag!(
                "SLGO: failed to install WH_MOUSE_LL hook ({}); scoreboard cursor mode unavailable",
                unsafe { GetLastError() }
            );
        } else {
            diag!("SLGO: keyboard and mouse hooks installed");
        }
        let mut message = unsafe { std::mem::zeroed() };
        while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
            unsafe { DispatchMessageW(&message) };
        }
        diag!("SLGO: input hook thread stopped");
        unsafe { UnhookWindowsHookEx(keyboard) };
        if !mouse.is_null() {
            unsafe { UnhookWindowsHookEx(mouse) };
        }
    });
}

#[cfg(not(windows))]
fn start_keyboard_hook(_app: tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // Managed on the builder, not in `setup`: Tauri builds the config windows before `setup` runs,
    // and the home window can invoke `updater_start` while the overlay window is still being built.
    let updater = updater::Updater::new(context.package_info().version.to_string());
    tauri::Builder::default()
        // Must be registered first: a second launch exits here and surfaces the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_home(app, true);
        }))
        .register_uri_scheme_protocol(theme_pack::SCHEME, theme_pack::handle)
        .manage(Mutex::new(GameForegroundState::default()))
        .manage(Mutex::new(OverlaySnapshot::default()))
        .manage(GameRunningState::default())
        .manage(sidecar_socket::SidecarSockets::default())
        .manage(updater)
        .setup(|app| {
            // First, so the log has the whole session; a second instance has already exited.
            diag::log_panics();
            let version = &app.package_info().version;
            match app.path().app_log_dir().map_err(|error| error.to_string()).and_then(|dir| diag::init(&dir)) {
                Ok(path) => diag!("SLUI {version} started; log {}", path.display()),
                Err(error) => diag!("SLUI {version} started without a log file: {error}"),
            }
            #[cfg(windows)]
            diag!(
                "Windows {}; SLUI elevated: {}",
                diag::windows_version(),
                diag::elevation_text(diag::process_elevated(unsafe {
                    windows_sys::Win32::System::Threading::GetCurrentProcess()
                }))
            );
            // The overlay starts disabled on every launch and never takes input on its own.
            if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW) {
                #[cfg(windows)]
                apply_overlay_input_mode(&overlay, false);
                let _ = overlay.hide();
            }
            thread::spawn(updater::remove_old_installers);
            build_tray(app)?;
            backdrop::init(app.handle());
            start_foreground_tracking(app.handle().clone());
            start_keyboard_hook(app.handle().clone());
            start_game_process_tracking(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing home only hides it; the tray keeps the app and overlay running.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == HOME_WINDOW {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_overlay_interactive,
            set_overlay_keyboard_focus,
            log_overlay_event,
            set_overlay_enabled,
            set_overlay_session_live,
            set_hotkeys,
            set_scoreboard_capture,
            get_overlay_state,
            load_settings,
            save_settings,
            get_game_running,
            get_current_steam_identity,
            steam_profile::get_steam_profile,
            get_game_foreground,
            backdrop::set_backdrop_regions,
            backdrop::set_backdrop_options,
            backdrop::get_backdrop_available,
            theme_pack::list_theme_pack_files,
            sidecar_socket::sidecar_open,
            sidecar_socket::sidecar_send,
            sidecar_socket::sidecar_close,
            updater::updater_start,
            updater::updater_check_now,
            updater::get_update_state,
            updater::updater_install
        ])
        .plugin(tauri_plugin_opener::init())
        // Rust API only: no capability grants its JS commands; see updater.rs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod foreground_process_cache_tests {
    use super::ForegroundProcessCache;
    use std::cell::Cell;

    #[test]
    fn queries_the_process_only_when_the_foreground_window_changes() {
        let mut cache = ForegroundProcessCache::default();
        let queries = Cell::new(0);
        let query = |verdict: Option<bool>| {
            let queries = &queries;
            move || {
                queries.set(queries.get() + 1);
                verdict
            }
        };
        assert!(cache.check(10, 100, query(Some(true))));
        assert!(cache.check(10, 100, query(Some(false))), "the same window keeps its verdict");
        assert_eq!(queries.get(), 1);
        assert!(!cache.check(20, 200, query(Some(false))), "another window is queried");
        assert!(cache.check(10, 101, query(Some(true))), "a reused handle with a new process is queried");
        assert_eq!(queries.get(), 3);
    }

    #[test]
    fn a_failed_query_is_retried() {
        let mut cache = ForegroundProcessCache::default();
        assert!(!cache.check(10, 100, || None));
        assert!(cache.check(10, 100, || Some(true)), "the failure was not remembered");
        assert!(cache.check(10, 100, || panic!("cached")));
    }
}

#[cfg(test)]
mod hotkey_tests {
    use super::{is_bindable_scoreboard_hotkey, is_bindable_shop_hotkey, overlay_shortcut, repeat_is_suspect, validate_hotkeys};

    #[test]
    fn a_repeat_after_the_key_up_or_with_no_earlier_event_is_suspect() {
        assert!(repeat_is_suspect(false, Some(120)), "the hook saw the key go up");
        assert!(repeat_is_suspect(false, None), "the hook saw no earlier event");
        assert!(repeat_is_suspect(true, Some(2_000)), "longer than any typematic delay");
        assert!(!repeat_is_suspect(true, Some(33)), "auto-repeat after the hook's own key-down");
        assert!(!repeat_is_suspect(true, Some(1_000)), "the longest typematic delay");
    }

    #[test]
    fn overlay_shortcuts_map_the_chat_keys_and_the_configured_shop_key() {
        assert_eq!(overlay_shortcut(0x59, 0x42), Some("chat-global"));
        assert_eq!(overlay_shortcut(0x55, 0x42), Some("chat-team"));
        assert_eq!(overlay_shortcut(0x42, 0x42), Some("shop"));
        assert_eq!(
            overlay_shortcut(0x74, 0x74),
            Some("shop"),
            "F5 as the shop key"
        );
        assert_eq!(
            overlay_shortcut(0x42, 0x74),
            None,
            "B once the shop moved to F5"
        );
        assert_eq!(overlay_shortcut(0x31, 0x42), None);
    }

    #[test]
    fn shop_hotkey_accepts_letters_and_function_keys_except_chat() {
        for vk in [0x41, 0x42, 0x5A, 0x70, 0x7B] {
            assert!(is_bindable_shop_hotkey(vk), "{vk:#x}");
        }
        // Y and U (chat), digits, Escape, F13 and modifiers are rejected.
        for vk in [0x59, 0x55, 0x30, 0x31, 0x39, 0x1B, 0x7C, 0x10, 0x11, 0xA0, 0x14, 0x09, 0] {
            assert!(!is_bindable_shop_hotkey(vk), "{vk:#x}");
        }
    }

    #[test]
    fn scoreboard_hotkey_adds_caps_lock_and_never_shares_the_shop_key() {
        for vk in [0x14, 0x41, 0x5A, 0x70, 0x7B] {
            assert!(is_bindable_scoreboard_hotkey(vk), "{vk:#x}");
        }
        // Tab (the SCP:SL inventory), Y, U, digits and modifiers are rejected.
        for vk in [0x09, 0x59, 0x55, 0x31, 0x10, 0xA0, 0] {
            assert!(!is_bindable_scoreboard_hotkey(vk), "{vk:#x}");
        }
        assert!(validate_hotkeys(0x42, 0x14).is_ok(), "B and CapsLock");
        assert!(validate_hotkeys(0x42, 0x42).is_err(), "one key for both");
        assert!(validate_hotkeys(0x14, 0x42).is_err(), "CapsLock cannot open the shop");
        assert!(validate_hotkeys(0x42, 0x59).is_err(), "Y is the chat key");
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::is_game_executable;

    #[test]
    fn foreground_only_matches_the_game_executable_name() {
        assert!(is_game_executable(
            r"D:\Steam\steamapps\common\SCP Secret Laboratory\SCPSL.exe"
        ));
        assert!(is_game_executable(
            "D:/Games/SCP Secret Laboratory/scpsl.EXE"
        ));
        assert!(!is_game_executable(
            r"D:\Games\SCPSL.exe\UnityCrashHandler64.exe"
        ));
        assert!(!is_game_executable(r"D:\Games\SCPSL.exe.bak"));
        assert!(!is_game_executable(r"D:\Games\SCPSL-Server.exe"));
        assert!(!is_game_executable(r"D:\Games\slui.exe"));
        assert!(!is_game_executable(""));
    }
}
