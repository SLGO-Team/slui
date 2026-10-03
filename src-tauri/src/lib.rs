mod settings;
mod theme_pack;

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

// An enabled overlay is visible only over the game.
#[cfg(windows)]
fn overlay_may_show() -> bool {
    OVERLAY_ENABLED.load(Ordering::SeqCst) && OVERLAY_OVER_GAME.load(Ordering::SeqCst)
}

// Fixed chat keys, as in CS2: Y opens global chat, U opens team chat.
const VK_Y: u32 = 0x59;
const VK_U: u32 = 0x55;
// Windows virtual-key code of the configurable shop hotkey; B until settings load.
static SHOP_HOTKEY: AtomicU32 = AtomicU32::new(0x42);

// Must match isBindableHotkey in src/platform/hotkeys.ts: letters except the chat
// keys Y and U, and F1-F12. Digits are taken by shop item selection.
fn is_bindable_shop_hotkey(virtual_key: u32) -> bool {
    matches!(virtual_key, 0x41..=0x5A | 0x70..=0x7B) && virtual_key != VK_Y && virtual_key != VK_U
}

#[tauri::command]
fn set_shop_hotkey(virtual_key: u32) -> Result<(), String> {
    if !is_bindable_shop_hotkey(virtual_key) {
        return Err(format!("Unsupported shop hotkey {virtual_key:#04x}"));
    }
    SHOP_HOTKEY.store(virtual_key, Ordering::SeqCst);
    Ok(())
}

#[derive(Clone, Copy, Default, serde::Serialize)]
struct OverlaySnapshot {
    enabled: bool,
    interactive: bool,
}

struct TrayOverlayItem(MenuItem<tauri::Wry>);

#[derive(Default)]
struct GameRunningState(Mutex<bool>);

#[derive(Clone, Copy, Default, serde::Serialize)]
struct GameForegroundState {
    focused: bool,
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

#[cfg(windows)]
fn is_game_foreground(foreground: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::GetWindowThreadProcessId,
    };

    if foreground.is_null() {
        return false;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(foreground, &mut process_id) };
    if process_id == 0 {
        return false;
    }
    // Only query the executable path; no process memory or game input is accessed.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return false;
    }
    let mut path = [0_u16; 32_768];
    let mut length = path.len() as u32;
    let queried = unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length) };
    unsafe { CloseHandle(process) };
    queried != 0
        && String::from_utf16(&path[..length as usize]).is_ok_and(|path| is_game_executable(&path))
}

#[cfg(windows)]
fn publish_game_foreground(app: &tauri::AppHandle, focused: bool) {
    let state = app.state::<Mutex<GameForegroundState>>();
    let Ok(mut state) = state.lock() else {
        eprintln!("SLGO: game foreground state unavailable");
        return;
    };
    if state.focused == focused {
        return;
    }
    state.focused = focused;
    state.revision += 1;
    let snapshot = *state;
    drop(state);
    eprintln!(
        "SLGO: game foreground {focused} (revision {})",
        snapshot.revision
    );
    if let Err(error) = app.emit_to(OVERLAY_WINDOW, "slgo-game-foreground", snapshot) {
        eprintln!("SLGO: failed to emit game foreground state: {error}");
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
            eprintln!("SLGO: failed to update tray menu: {error}");
        }
    }
    if let Err(error) = app.emit("slgo-overlay-state", snapshot) {
        eprintln!("SLGO: failed to emit overlay state: {error}");
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
    eprintln!("SLGO: SetForegroundWindow refused ({}); retrying", unsafe {
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
    eprintln!(
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
        eprintln!("SLGO: overlay could not take the keyboard (attached {attached}, error {error})");
        Err(format!(
            "Windows refused to give the overlay the keyboard (error {error})"
        ))
    }
}

// Overlay diagnostics (chat focus and close reasons) go to the process's stderr,
// which `npm run tauri dev` shows; the webview console is hard to reach in game.
#[tauri::command]
fn log_overlay_event(message: String) {
    eprintln!("SLGO overlay: {message}");
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
            if let Err(error) = app.emit("slgo-game-running", running) {
                eprintln!("SLGO: failed to emit game process state: {error}");
            }
        }
        thread::sleep(Duration::from_secs(2));
    });
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

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open-home", "打开主界面", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle-overlay", "启用 UI", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &separator, &quit])?;
    app.manage(TrayOverlayItem(toggle));

    let mut tray = TrayIconBuilder::with_id("slui")
        .tooltip("SLUI")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-home" => show_home(app, false),
            "toggle-overlay" => {
                let enabled = !overlay_snapshot(app).enabled;
                if let Err(error) = apply_overlay_enabled(app, enabled) {
                    eprintln!("SLGO: {error}");
                }
            }
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

    thread::spawn(move || loop {
        let foreground = unsafe { GetForegroundWindow() };
        let game_foreground = is_game_foreground(foreground);
        publish_game_foreground(&app, game_foreground);

        let overlay_hwnd = app
            .get_webview_window(OVERLAY_WINDOW)
            .and_then(|overlay| overlay.hwnd().ok())
            .map(|hwnd| hwnd.0 as windows_sys::Win32::Foundation::HWND);

        // Align before showing, so the overlay never appears at a stale rect.
        if game_foreground && OVERLAY_ENABLED.load(Ordering::SeqCst) {
            if let Some(overlay_hwnd) = overlay_hwnd {
                align_overlay_to(overlay_hwnd, foreground);
            }
        }

        // The overlay is shown only over the game, or while it holds the foreground
        // itself (shop and chat). A null foreground is a transient switch; keep the
        // current visibility.
        if !foreground.is_null() {
            let over_game = game_foreground || overlay_hwnd == Some(foreground);
            if OVERLAY_OVER_GAME.swap(over_game, Ordering::SeqCst) != over_game {
                // Visibility changes run on the main thread, where the enable and
                // interactive commands and the tray also run, so they cannot race.
                let handle = app.clone();
                if let Err(error) = app.run_on_main_thread(move || sync_overlay_visibility(&handle)) {
                    eprintln!("SLGO: failed to schedule overlay visibility: {error}");
                }
            }
        }

        thread::sleep(Duration::from_millis(100));
    });
}

#[cfg(windows)]
fn align_overlay_to(
    overlay: windows_sys::Win32::Foundation::HWND,
    game: windows_sys::Win32::Foundation::HWND,
) {
    use windows_sys::Win32::{
        Foundation::RECT,
        UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER},
    };

    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(game, &mut rect) } == 0 {
        return;
    }
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    if width <= 0 || height <= 0 {
        return;
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

#[cfg(windows)]
static KEY_PRESSES: OnceLock<mpsc::Sender<u32>> = OnceLock::new();

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
                SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, WH_KEYBOARD_LL,
                WM_KEYDOWN, WM_SYSKEYDOWN,
            },
        },
    };

    // Runs on the hook thread for every key event, so it only classifies and hands off.
    unsafe extern "system" fn keyboard_proc(code: i32, wparam: usize, lparam: isize) -> isize {
        let is_down = wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
        if code == HC_ACTION as i32 && is_down && lparam != 0 {
            let vk = (*(lparam as *const KBDLLHOOKSTRUCT)).vkCode;
            // Windows calls low-level hooks before it updates the key's asynchronous
            // state, so that state still tells whether the key was already down: if it
            // was, this key-down is auto-repeat. It is the system's own record of the
            // physical key, so unlike tracking key-ups ourselves it cannot drift when
            // an event is missed, and no timing guess is involved.
            let repeat = (GetAsyncKeyState(vk as i32) as u16) & 0x8000 != 0;
            if !repeat && overlay_shortcut(vk, SHOP_HOTKEY.load(Ordering::Relaxed)).is_some() {
                if let Some(sender) = KEY_PRESSES.get() {
                    let _ = sender.send(vk);
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    let (sender, receiver) = mpsc::channel::<u32>();
    let _ = KEY_PRESSES.set(sender);

    thread::spawn(move || {
        while let Ok(vk) = receiver.recv() {
            if !OVERLAY_ENABLED.load(Ordering::SeqCst) {
                continue;
            }
            let Some(shortcut) = overlay_shortcut(vk, SHOP_HOTKEY.load(Ordering::SeqCst)) else {
                continue;
            };
            // Read at the press itself: the foreground poll lags up to 100ms, so a
            // press right after chat hands the game back would otherwise be dropped.
            let game_foreground = is_game_foreground(unsafe { GetForegroundWindow() });
            eprintln!("SLGO: hotkey {shortcut} (game foreground {game_foreground})");
            let event = ShortcutEvent {
                shortcut,
                game_foreground,
            };
            if let Err(error) = app.emit_to(OVERLAY_WINDOW, "slgo-shortcut", event) {
                eprintln!("SLGO: failed to emit shortcut: {error}");
            }
        }
    });

    thread::spawn(move || {
        // Windows skips a low-level hook that misses LowLevelHooksTimeout; keep this
        // thread ahead of a busy game so no key event passes unseen.
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL) };
        let module = unsafe { GetModuleHandleW(std::ptr::null()) };
        let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0) };
        if hook.is_null() {
            eprintln!("SLGO: failed to install WH_KEYBOARD_LL hook ({})", unsafe {
                GetLastError()
            });
            return;
        }
        let mut message = unsafe { std::mem::zeroed() };
        while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
            unsafe { DispatchMessageW(&message) };
        }
        unsafe { UnhookWindowsHookEx(hook) };
    });
}

#[cfg(not(windows))]
fn start_keyboard_hook(_app: tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch exits here and surfaces the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_home(app, true);
        }))
        .register_uri_scheme_protocol(theme_pack::SCHEME, theme_pack::handle)
        .manage(Mutex::new(GameForegroundState::default()))
        .manage(Mutex::new(OverlaySnapshot::default()))
        .manage(GameRunningState::default())
        .setup(|app| {
            // The overlay starts disabled on every launch and never takes input on its own.
            if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW) {
                #[cfg(windows)]
                apply_overlay_input_mode(&overlay, false);
                let _ = overlay.hide();
            }
            build_tray(app)?;
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
            set_shop_hotkey,
            get_overlay_state,
            load_settings,
            save_settings,
            get_game_running,
            get_current_steam_identity,
            get_game_foreground,
            theme_pack::list_theme_pack_files
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod hotkey_tests {
    use super::{is_bindable_shop_hotkey, overlay_shortcut};

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
        for vk in [0x59, 0x55, 0x30, 0x31, 0x39, 0x1B, 0x7C, 0x10, 0x11, 0xA0, 0] {
            assert!(!is_bindable_shop_hotkey(vk), "{vk:#x}");
        }
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
