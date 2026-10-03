//! WebView2 gate. The shell's UI needs WebView2; when it is missing the shell hands
//! over to the NSIS package's classic wizard, which installs WebView2 itself.

use crate::{
    detect,
    install::{shell_execute, ShellError, Verb},
    payload::{PayloadError, Session},
};

/// Testing switch: `SLUI_SETUP_FORCE_CLASSIC=1` behaves as if WebView2 were missing.
const FORCE_CLASSIC_ENV: &str = "SLUI_SETUP_FORCE_CLASSIC";

pub fn classic_required() -> bool {
    std::env::var(FORCE_CLASSIC_ENV).is_ok_and(|value| value.trim() == "1") || tauri::webview_version().is_err()
}

/// Starts the NSIS package interactively (no arguments; its manifest requests
/// elevation) and returns the shell's exit code. Does not wait for the wizard.
pub fn run_classic(session: &Session) -> i32 {
    let package = match session.extract_payload() {
        Ok(path) => path,
        Err(PayloadError::Missing) => {
            message_box("此安装程序是不含安装包的开发版本，无法安装 SLUI。");
            return 1;
        }
        Err(PayloadError::Write(detail)) => {
            message_box(&format!("无法解压安装文件：{detail}"));
            return 1;
        }
    };
    match shell_execute(Verb::Open, &package, None, 0) {
        Ok(_) => 0,
        // NSIS uses 1 for a user cancel as well.
        Err(ShellError::Cancelled) => 1,
        Err(ShellError::Failed(detail)) => {
            message_box(&format!("无法启动 SLUI 安装向导：{detail}"));
            1
        }
    }
}

fn message_box(text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let text = detect::wide(text);
    let caption = detect::wide("SLUI 安装程序");
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR) };
}
