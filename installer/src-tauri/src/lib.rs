//! SLUI installer shell: a branded UI that schedules the embedded SLUI NSIS package.
//! The same build is also the branded uninstaller that runs the installed NSIS
//! uninstaller (see `uninstall`); the overlay appended after compilation says which
//! (see `overlay`).

pub mod detect;
pub mod install;
pub mod overlay;
pub mod payload;
pub mod uninstall;
pub mod webview2;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};

use tauri::{ipc::Channel, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::{
    detect::{DirCheck, Detect},
    install::{FailReason, InstallOutcome, InstallRequest, Stage},
    payload::Session,
    uninstall::{UninstallDetect, UninstallOutcome, UninstallRequest},
};

const MAIN_WINDOW: &str = "main";

/// What this exe is: SLUI-Setup-<version>.exe or slui-uninstall.exe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Setup,
    Uninstall,
}

/// Debug builds without an overlay (`npm run installer:dev`): `uninstall` here selects
/// the uninstall UI, anything else the setup UI without a package.
const DEV_ROLE_ENV: &str = "SLUI_SETUP_ROLE";

/// The overlay of this exe, read once.
pub fn overlay() -> Option<&'static overlay::Overlay> {
    static OVERLAY: OnceLock<Option<overlay::Overlay>> = OnceLock::new();
    OVERLAY
        .get_or_init(|| {
            let mut exe = std::fs::File::open(std::env::current_exe().ok()?).ok()?;
            overlay::read(&mut exe, env!("CARGO_PKG_VERSION"))
        })
        .as_ref()
}

/// This exe's role; `None` for a release exe without an overlay (not produced by
/// scripts/build-installer.mjs, or damaged).
pub fn role() -> Option<Role> {
    match overlay() {
        Some(overlay) => Some(overlay.role),
        None if cfg!(debug_assertions) => Some(match std::env::var(DEV_ROLE_ENV).as_deref() {
            Ok("uninstall") => Role::Uninstall,
            _ => Role::Setup,
        }),
        None => None,
    }
}

impl Role {
    pub fn title(self) -> &'static str {
        match self {
            Role::Setup => "SLUI 安装程序",
            Role::Uninstall => "SLUI 卸载程序",
        }
    }
}

/// Set while an NSIS package runs; the window refuses to close meanwhile.
#[derive(Default)]
struct Installing(AtomicBool);

/// The uninstaller runs as the temp copy started by the one in the install directory.
struct Relocated(bool);

#[tauri::command]
async fn detect() -> Detect {
    detect::detect()
}

#[tauri::command]
async fn check_dir(dir: String) -> DirCheck {
    detect::check_dir(&dir)
}

/// Folder picker; the result gets `\SLUI` appended unless the picked folder is one.
#[tauri::command]
async fn pick_dir(window: WebviewWindow, current: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let start = std::path::Path::new(&current)
        .ancestors()
        .find(|ancestor| ancestor.is_dir())
        .map(|ancestor| ancestor.to_path_buf());
    let mut dialog = window.dialog().file().set_title("选择安装位置").set_parent(&window);
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .ok()
        .flatten()?;
    let path = picked.into_path().ok()?;
    Some(detect::with_app_dir(&path.display().to_string()))
}

#[tauri::command]
async fn install(
    window: WebviewWindow,
    req: InstallRequest,
    on_stage: Channel<Stage>,
) -> Result<InstallOutcome, String> {
    let installing = window.state::<Installing>();
    if installing.0.swap(true, Ordering::SeqCst) {
        return Ok(InstallOutcome::Failed { code: None, reason: FailReason::Busy, detail: None });
    }
    let session = window.state::<Session>().inner().clone();
    let parent = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        install::install(&session, &req, parent, |stage| {
            if let Err(error) = on_stage.send(stage) {
                eprintln!("slui-setup: cannot report stage {stage:?}: {error}");
            }
        })
    })
    .await
    .map_err(|error| error.to_string());
    installing.0.store(false, Ordering::SeqCst);
    outcome
}

/// Starts the installed SLUI as the current (non-elevated) user, then closes the shell.
/// The directory comes from the registry, not from the UI.
///
/// Closes by destroying the window, the same path as the close button: destroying the
/// webview shuts its WebView2 processes down so `cleanup_after_exit` can remove the
/// session directory. `AppHandle::exit` ends the event loop with the webview still alive,
/// its WebView2 processes outlive the cleanup wait and the user data stays in %TEMP%.
#[tauri::command]
fn launch(window: WebviewWindow) -> Result<(), String> {
    let installed = detect::read_installed().ok_or("未找到已安装的 SLUI")?;
    let dir = std::path::Path::new(&installed.dir);
    std::process::Command::new(dir.join(detect::APP_EXE))
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动 SLUI：{error}"))?;
    window.destroy().map_err(|error| format!("无法关闭安装程序：{error}"))
}

#[tauri::command]
async fn uninstall_detect() -> UninstallDetect {
    uninstall::detect_state()
}

#[tauri::command]
async fn uninstall(
    window: WebviewWindow,
    req: UninstallRequest,
    on_stage: Channel<uninstall::Stage>,
) -> Result<UninstallOutcome, String> {
    let installing = window.state::<Installing>();
    if installing.0.swap(true, Ordering::SeqCst) {
        return Ok(uninstall::failed(uninstall::FailReason::Busy));
    }
    let session = window.state::<Session>().inner().clone();
    let relocated = window.state::<Relocated>().0;
    let parent = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        uninstall::uninstall(&session, relocated, req, parent, |stage| {
            if let Err(error) = on_stage.send(stage) {
                eprintln!("slui-uninstall: cannot report stage {stage:?}: {error}");
            }
        })
    })
    .await
    .map_err(|error| error.to_string());
    installing.0.store(false, Ordering::SeqCst);
    outcome
}

/// Runs the window of `role` until it closes and returns the exit code.
/// `relocated` only matters to the uninstaller.
pub fn run(role: Role, session: Session, relocated: bool) -> i32 {
    let data_dir = session.webview_data_dir();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Installing::default())
        .manage(Relocated(relocated))
        .manage(session)
        .setup(move |app| {
            // Created here rather than in tauri.conf.json so the WebView2 user data goes to
            // the session temp directory instead of %LOCALAPPDATA%\com.slui.setup.
            let mut window = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::default())
                .title(role.title())
                .inner_size(640.0, 440.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .center()
                .background_color(tauri::webview::Color(9, 14, 21, 255))
                .data_directory(data_dir.clone());
            if role == Role::Uninstall {
                // Read synchronously by installer/src/main.tsx to pick the uninstall UI.
                window = window.initialization_script("window.__SLUI_SETUP_ROLE__ = \"uninstall\";");
            }
            window.build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Installing>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                }
            }
        });
    // Each role exposes only its own commands to its webview.
    let builder = match role {
        Role::Setup => builder.invoke_handler(tauri::generate_handler![detect, check_dir, pick_dir, install, launch]),
        Role::Uninstall => builder.invoke_handler(tauri::generate_handler![uninstall_detect, uninstall]),
    };
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building the installer shell");
    app.run_return(|_, _| {})
}
