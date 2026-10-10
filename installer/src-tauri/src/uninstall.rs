//! The branded uninstaller (uninstall overlay): how it was started, its temp copy,
//! and the NSIS uninstall it runs elevated.
//!
//! NSIS (`<dir>\uninstall.exe`) stays the only engine that touches the install directory,
//! the registry and shortcuts. This process is never elevated; it only removes the
//! invoking user's own SLUI data directories.
//!
//! The copy in the install directory never runs the UI: it would lock
//! `slui-uninstall.exe` and with it the directory while NSIS deletes them. It starts a
//! temp copy instead, the same thing NSIS does for `uninstall.exe`.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::{
    detect,
    install::{shell_execute, ShellError, Verb},
    payload::{self, Session},
    webview2::message_box,
};

/// Switch of the temp copy started by the copy in the install directory.
pub const RELOCATED_ARG: &str = "--relocated";

/// How long the user data waits for SLUI's processes that NSIS closed.
const APP_EXIT_TIMEOUT: Duration = Duration::from_secs(10);

/// How this process was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Launch<'a> {
    /// NSIS arguments (`/S` from tools, `/UPDATE _?=<dir>` from the NSIS wizard): they
    /// go to `uninstall.exe` unchanged.
    Forward(&'a str),
    /// The temp copy started by [`relocate`].
    Relocated,
    /// No arguments: Apps & features, a double click, `tauri dev`.
    Direct,
}

pub fn classify_launch(args: &str) -> Launch<'_> {
    match args.trim() {
        "" => Launch::Direct,
        RELOCATED_ARG => Launch::Relocated,
        args => Launch::Forward(args),
    }
}

/// The arguments of a Windows command line, verbatim. Parsed arguments would lose the
/// form NSIS needs (`_?=<dir>` last and unquoted, even with spaces). The program name
/// ends at its closing quote when it starts with one, else at the first space or tab;
/// it has no escapes.
pub fn command_line_args(command_line: &str) -> &str {
    let rest = match command_line.strip_prefix('"') {
        Some(quoted) => quoted.find('"').map_or("", |end| &quoted[end + 1..]),
        None => command_line.find([' ', '\t']).map_or("", |end| &command_line[end..]),
    };
    rest.trim_start_matches([' ', '\t'])
}

pub fn own_command_line() -> String {
    use windows_sys::Win32::System::Environment::GetCommandLineW;
    let line = unsafe { GetCommandLineW() };
    if line.is_null() {
        return String::new();
    }
    let length = (0..).take_while(|&index| unsafe { *line.add(index) } != 0).count();
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(line, length) })
}

fn own_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// Runs the `uninstall.exe` next to this exe with `args` and returns its exit code.
/// `open` lets the package's manifest ask for elevation when the caller is not elevated.
pub fn forward(args: &str) -> i32 {
    let Some(nsis) = own_dir().map(|dir| dir.join(detect::NSIS_UNINSTALLER_EXE)) else {
        return 2;
    };
    match shell_execute(Verb::Open, &nsis, Some(args), 0) {
        Ok(Some(process)) => process.wait() as i32,
        Ok(None) => {
            eprintln!("slui-uninstall: {} started without a process handle", nsis.display());
            2
        }
        // NSIS uses 1 for a user cancel as well.
        Err(ShellError::Cancelled) => 1,
        Err(ShellError::Failed(detail)) => {
            eprintln!("slui-uninstall: cannot start {}: {detail}", nsis.display());
            2
        }
    }
}

/// Without WebView2: the NSIS uninstall wizard of the installed SLUI. Does not wait.
pub fn run_classic() -> i32 {
    let Some(installed) = installed_entry() else {
        message_box("未找到已安装的 SLUI。");
        return 1;
    };
    let nsis = Path::new(&installed.dir).join(detect::NSIS_UNINSTALLER_EXE);
    match shell_execute(Verb::Open, &nsis, None, 0) {
        Ok(_) => 0,
        Err(ShellError::Cancelled) => 1,
        Err(ShellError::Failed(detail)) => {
            message_box(&format!("无法启动 SLUI 卸载向导：{detail}"));
            1
        }
    }
}

/// Whether this exe runs from the installed SLUI's directory.
pub fn running_from_install_dir() -> bool {
    match (own_dir(), detect::read_entry()) {
        (Some(own), Some((_, dir))) => same_dir(&own.display().to_string(), &dir),
        _ => false,
    }
}

/// Copies this exe into `session`'s directory and starts the copy with [`RELOCATED_ARG`].
/// The session directory stays behind on purpose: the copy runs from it, and NSIS
/// schedules it for deletion (`/SLUI-CLEANUP`) or the next run's stale sweep removes it.
pub fn relocate(session: &Session) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    fs::create_dir_all(&session.dir).map_err(|error| error.to_string())?;
    let copy = session.dir.join(detect::UNINSTALLER_EXE);
    fs::copy(&exe, &copy).map_err(|error| error.to_string())?;
    // A working directory inside the install directory would keep NSIS from removing it.
    Command::new(&copy)
        .arg(RELOCATED_ARG)
        .current_dir(std::env::temp_dir())
        .spawn()
        .map(drop)
        .map_err(|error| error.to_string())
}

/// Windows paths compare case-insensitively; a trailing separator is not significant.
fn same_dir(a: &str, b: &str) -> bool {
    a.trim_end_matches('\\').to_lowercase() == b.trim_end_matches('\\').to_lowercase()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstalledEntry {
    pub version: String,
    pub dir: String,
}

/// The uninstall entry, as long as its `uninstall.exe` is there. Unlike the installer's
/// detection, a missing `slui.exe` does not hide a broken install from the uninstaller.
pub fn installed_entry() -> Option<InstalledEntry> {
    let (version, dir) = detect::read_entry()?;
    Path::new(&dir)
        .join(detect::NSIS_UNINSTALLER_EXE)
        .is_file()
        .then_some(InstalledEntry { version, dir })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallDetect {
    pub installed: Option<InstalledEntry>,
    /// `<dir>\theme-pack` exists.
    pub theme_pack: bool,
    /// One of the current user's SLUI data directories exists.
    pub user_data: bool,
    pub app_running: bool,
}

pub fn detect_state() -> UninstallDetect {
    let installed = installed_entry();
    let theme_pack = installed
        .as_ref()
        .is_some_and(|installed| Path::new(&installed.dir).join(detect::THEME_PACK_DIR).is_dir());
    UninstallDetect {
        installed,
        theme_pack,
        user_data: detect::user_data_dirs().iter().any(|dir| dir.exists()),
        app_running: detect::app_running(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallRequest {
    /// Also delete `<dir>\theme-pack`.
    pub theme_pack: bool,
    /// Also delete the user's SLUI data directories.
    pub user_data: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Preparing,
    Elevating,
    Uninstalling,
    Cleaning,
}

/// Machine-readable failure reasons; the UI maps them to Chinese summaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailReason {
    NotInstalled,
    /// `uninstall.exe` could not be copied out of the install directory.
    CopyFailed,
    LaunchFailed,
    /// NSIS exited with a non-zero code.
    ExitCode,
    /// NSIS exited with 0 but the entry, `slui.exe` or a theme pack asked to go is still there.
    VerifyFailed,
    Busy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum UninstallOutcome {
    #[serde(rename_all = "camelCase")]
    Ok {
        dir: String,
        /// `<dir>\theme-pack` is still there (not asked to go).
        theme_pack_kept: bool,
        /// User data directories that could not be removed.
        user_data_error: Option<String>,
    },
    Cancelled,
    Failed {
        /// NSIS exit code when the uninstaller ran.
        code: Option<u32>,
        reason: FailReason,
        detail: Option<String>,
    },
}

pub fn failed(reason: FailReason) -> UninstallOutcome {
    UninstallOutcome::Failed { code: None, reason, detail: None }
}

/// NSIS command line. `_?=` runs the uninstaller where it is (so the caller can wait for
/// it) with `dir` as `$INSTDIR`; it must be last and must not be quoted, even with spaces.
/// Switches: src-tauri/windows/installer-hooks.nsh.
pub fn nsis_args(dir: &str, request: UninstallRequest, cleanup: bool) -> String {
    let mut args = vec!["/S"];
    if request.theme_pack {
        args.push("/SLUI-THEME-PACK");
    }
    if request.user_data {
        args.push("/SLUI-APPDATA");
    }
    if cleanup {
        args.push("/SLUI-CLEANUP");
    }
    format!("{} _?={dir}", args.join(" "))
}

/// Where the copy of `uninstall.exe` runs from, and whether NSIS schedules it and this
/// exe for deletion: the relocated copy's own directory, else (development runs from
/// target/) the session directory, which `cleanup_after_exit` removes.
fn work_dir(session: &Session, relocated: bool) -> (PathBuf, bool) {
    let relocation = own_dir().filter(|dir| {
        relocated && dir.file_name().and_then(|name| name.to_str()).and_then(payload::session_pid).is_some()
    });
    match relocation {
        Some(dir) => (dir, true),
        None => (session.dir.clone(), false),
    }
}

/// Success is the machine state, not the exit code alone: exit 0, the uninstall entry
/// gone, `slui.exe` gone, and the theme pack gone when it was asked to go.
fn verify(exit_code: u32, dir: &str, request: UninstallRequest) -> Option<UninstallOutcome> {
    if exit_code != 0 {
        return Some(UninstallOutcome::Failed { code: Some(exit_code), reason: FailReason::ExitCode, detail: None });
    }
    let dir = Path::new(dir);
    let left = detect::entry_exists()
        || dir.join(detect::APP_EXE).exists()
        || (request.theme_pack && dir.join(detect::THEME_PACK_DIR).exists());
    left.then_some(UninstallOutcome::Failed { code: Some(exit_code), reason: FailReason::VerifyFailed, detail: None })
}

/// Removes the current user's SLUI data directories; returns what could not be removed.
fn remove_user_data() -> Option<String> {
    let errors: Vec<String> = detect::user_data_dirs()
        .into_iter()
        .filter(|dir| dir.exists())
        .filter_map(|dir| fs::remove_dir_all(&dir).err().map(|error| format!("{}：{error}", dir.display())))
        .collect();
    (!errors.is_empty()).then(|| errors.join("\n"))
}

/// Blocking; run on a worker thread. `parent` is the uninstaller window, so the UAC
/// prompt belongs to it.
pub fn uninstall(
    session: &Session,
    relocated: bool,
    request: UninstallRequest,
    parent: isize,
    on_stage: impl Fn(Stage),
) -> UninstallOutcome {
    let Some(installed) = installed_entry() else {
        return failed(FailReason::NotInstalled);
    };
    let dir = installed.dir;

    on_stage(Stage::Preparing);
    let (work, cleanup) = work_dir(session, relocated);
    let nsis = work.join(detect::NSIS_UNINSTALLER_EXE);
    let copied = fs::create_dir_all(&work)
        .and_then(|()| fs::copy(Path::new(&dir).join(detect::NSIS_UNINSTALLER_EXE), &nsis));
    if let Err(error) = copied {
        return UninstallOutcome::Failed { code: None, reason: FailReason::CopyFailed, detail: Some(error.to_string()) };
    }
    // Opened before NSIS closes SLUI: SLUI's WebView2 processes outlive it briefly and
    // keep its data directory locked.
    let app_processes = request.user_data.then(payload::app_processes);

    on_stage(Stage::Elevating);
    let args = nsis_args(&dir, request, cleanup);
    let process = match shell_execute(Verb::RunAs, &nsis, Some(&args), parent) {
        Ok(Some(process)) => process,
        Ok(None) => {
            return UninstallOutcome::Failed {
                code: None,
                reason: FailReason::LaunchFailed,
                detail: Some("no process handle".into()),
            };
        }
        Err(ShellError::Cancelled) => return UninstallOutcome::Cancelled,
        Err(ShellError::Failed(detail)) => {
            return UninstallOutcome::Failed { code: None, reason: FailReason::LaunchFailed, detail: Some(detail) };
        }
    };

    on_stage(Stage::Uninstalling);
    let exit_code = process.wait();
    if let Some(failure) = verify(exit_code, &dir, request) {
        return failure;
    }

    let user_data_error = match app_processes {
        Some(processes) => {
            on_stage(Stage::Cleaning);
            processes.wait(APP_EXIT_TIMEOUT);
            remove_user_data()
        }
        None => None,
    };
    let theme_pack_kept = Path::new(&dir).join(detect::THEME_PACK_DIR).exists();
    UninstallOutcome::Ok { dir, theme_pack_kept, user_data_error }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: UninstallRequest = UninstallRequest { theme_pack: false, user_data: false };
    const BOTH: UninstallRequest = UninstallRequest { theme_pack: true, user_data: true };

    #[test]
    fn args_end_with_an_unquoted_install_dir() {
        assert_eq!(nsis_args(r"C:\Program Files\SLUI", NONE, false), r"/S _?=C:\Program Files\SLUI");
        assert_eq!(
            nsis_args(r"D:\Games\SLUI", BOTH, true),
            r"/S /SLUI-THEME-PACK /SLUI-APPDATA /SLUI-CLEANUP _?=D:\Games\SLUI"
        );
        let theme_only = UninstallRequest { theme_pack: true, user_data: false };
        assert_eq!(nsis_args(r"D:\SLUI", theme_only, false), r"/S /SLUI-THEME-PACK _?=D:\SLUI");
        let data_only = UninstallRequest { theme_pack: false, user_data: true };
        assert_eq!(nsis_args(r"D:\SLUI", data_only, true), r"/S /SLUI-APPDATA /SLUI-CLEANUP _?=D:\SLUI");
    }

    #[test]
    fn args_never_quote_and_name_the_dir_once() {
        for theme_pack in [true, false] {
            for user_data in [true, false] {
                for cleanup in [true, false] {
                    let dir = r"E:\A Dir With Spaces\SLUI";
                    let args = nsis_args(dir, UninstallRequest { theme_pack, user_data }, cleanup);
                    assert!(args.starts_with("/S "), "{args}");
                    assert!(args.ends_with(&format!(" _?={dir}")), "{args}");
                    assert!(!args.contains('"'), "{args}");
                    assert_eq!(args.matches("_?=").count(), 1, "{args}");
                }
            }
        }
    }

    #[test]
    fn command_line_args_are_taken_verbatim() {
        assert_eq!(command_line_args(r#""C:\Program Files\SLUI\slui-uninstall.exe""#), "");
        assert_eq!(command_line_args(r#""C:\Program Files\SLUI\slui-uninstall.exe" /S"#), "/S");
        assert_eq!(
            command_line_args(r#""C:\Program Files\SLUI\slui-uninstall.exe" /UPDATE _?=C:\Program Files\SLUI"#),
            r"/UPDATE _?=C:\Program Files\SLUI"
        );
        assert_eq!(command_line_args(r"C:\SLUI\slui-uninstall.exe  /S /P"), "/S /P");
        assert_eq!(command_line_args("slui-uninstall.exe\t--relocated"), "--relocated");
        assert_eq!(command_line_args("slui-uninstall.exe"), "");
        assert_eq!(command_line_args(r#""unterminated"#), "");
        assert_eq!(command_line_args(""), "");
    }

    #[test]
    fn launches_are_classified_by_their_arguments() {
        assert_eq!(classify_launch(""), Launch::Direct);
        assert_eq!(classify_launch("  "), Launch::Direct);
        assert_eq!(classify_launch(RELOCATED_ARG), Launch::Relocated);
        assert_eq!(classify_launch("/S"), Launch::Forward("/S"));
        assert_eq!(classify_launch(r"/UPDATE _?=C:\SLUI"), Launch::Forward(r"/UPDATE _?=C:\SLUI"));
        assert_eq!(classify_launch("--relocated /S"), Launch::Forward("--relocated /S"));
    }

    #[test]
    fn outcomes_serialize_for_the_frontend() {
        let ok = serde_json::to_value(UninstallOutcome::Ok {
            dir: r"C:\SLUI".into(),
            theme_pack_kept: true,
            user_data_error: None,
        })
        .unwrap();
        assert_eq!(
            ok,
            serde_json::json!({ "kind": "ok", "dir": r"C:\SLUI", "themePackKept": true, "userDataError": null })
        );
        assert_eq!(serde_json::to_value(UninstallOutcome::Cancelled).unwrap(), serde_json::json!({ "kind": "cancelled" }));
        let failed = serde_json::to_value(UninstallOutcome::Failed {
            code: Some(2),
            reason: FailReason::VerifyFailed,
            detail: None,
        })
        .unwrap();
        assert_eq!(failed, serde_json::json!({ "kind": "failed", "code": 2, "reason": "verify_failed", "detail": null }));
        assert_eq!(serde_json::to_value(Stage::Cleaning).unwrap(), serde_json::json!("cleaning"));
    }

    #[test]
    fn requests_deserialize_from_the_frontend() {
        let request: UninstallRequest = serde_json::from_value(serde_json::json!({ "themePack": true, "userData": false })).unwrap();
        assert_eq!(request, UninstallRequest { theme_pack: true, user_data: false });
    }

    #[test]
    fn non_zero_exit_code_fails_without_reading_the_machine() {
        assert_eq!(
            verify(2, r"C:\nowhere", BOTH),
            Some(UninstallOutcome::Failed { code: Some(2), reason: FailReason::ExitCode, detail: None })
        );
    }

    #[test]
    fn an_unrelocated_run_works_in_the_session_directory() {
        let session = Session { dir: std::env::temp_dir().join("slui-setup-test-session") };
        assert_eq!(work_dir(&session, false), (session.dir.clone(), false));
        // The test binary does not run from a slui-setup-<pid> directory.
        assert_eq!(work_dir(&session, true), (session.dir.clone(), false));
    }
}
