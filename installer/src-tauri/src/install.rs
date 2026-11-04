//! Runs the embedded NSIS package elevated and decides success from the machine state.
//!
//! The shell never writes into the install directory, the registry or shortcuts; the
//! NSIS package stays the only installer engine.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{
    detect::{self, DirCheck, Installed, Relation},
    payload::{PayloadError, Session},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Fresh,
    Update,
    Reinstall,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub dir: String,
    pub mode: Mode,
    pub start_menu_shortcut: bool,
    pub desktop_shortcut: bool,
}

/// Shortcuts a fresh install or reinstall creates; an update keeps the existing ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shortcuts {
    pub start_menu: bool,
    pub desktop: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Extracting,
    Elevating,
    Installing,
}

/// Machine-readable failure reasons; the UI maps them to Chinese summaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailReason {
    /// Installed version is newer than the payload.
    Downgrade,
    /// The request does not fit what is installed (update without an older install).
    ModeMismatch,
    InvalidDir,
    InsufficientSpace,
    /// Debug build without an embedded package.
    NoPayload,
    ExtractFailed,
    LaunchFailed,
    /// NSIS exited with a non-zero code.
    ExitCode,
    /// NSIS exited with 0 but the registry or `slui.exe` does not show the new version.
    VerifyFailed,
    Busy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum InstallOutcome {
    Ok { dir: String },
    Cancelled,
    Failed {
        /// NSIS exit code when the package ran.
        code: Option<u32>,
        reason: FailReason,
        /// System error text for extraction / launch failures.
        detail: Option<String>,
    },
}

fn failed(reason: FailReason) -> InstallOutcome {
    InstallOutcome::Failed { code: None, reason, detail: None }
}

/// NSIS command line. `/D=` must be the last argument and must not be quoted, even
/// when the path contains spaces.
pub fn nsis_args(mode: Mode, dir: &str, shortcuts: Shortcuts) -> String {
    let mut args = vec!["/S"];
    match mode {
        // /UPDATE keeps the existing shortcuts as they are.
        Mode::Update => args.push("/UPDATE"),
        // NSIS's /NS turns off both shortcuts; NSIS_HOOK_POSTINSTALL
        // (src-tauri/windows/installer-hooks.nsh) then creates each one asked for.
        Mode::Fresh | Mode::Reinstall => {
            args.push("/NS");
            if shortcuts.start_menu {
                args.push("/SLUI-STARTMENU");
            }
            if shortcuts.desktop {
                args.push("/SLUI-DESKTOP");
            }
        }
    }
    format!("{} /D={dir}", args.join(" "))
}

/// Re-detects the machine and resolves the directory to install into.
fn target_dir(request: &InstallRequest) -> Result<String, InstallOutcome> {
    resolve_target(request.mode, detect::read_installed(), || detect::check_dir(&request.dir), detect::required_bytes())
}

/// An existing install is never left behind: an older one is only updated in place and a
/// same-version one only reinstalled in place. Installing next to it would keep its
/// `slui.exe` and `uninstall.exe`, and that `uninstall.exe` would later delete the
/// uninstall entry, which then belongs to the new install. `check` (of the requested
/// directory) runs only when that directory matters.
fn resolve_target(
    mode: Mode,
    installed: Option<Installed>,
    check: impl FnOnce() -> DirCheck,
    required_bytes: u64,
) -> Result<String, InstallOutcome> {
    let installed = match (mode, installed) {
        (_, Some(installed)) if installed.relation == Relation::Newer => return Err(failed(FailReason::Downgrade)),
        // An update always goes into the existing directory.
        (Mode::Update, Some(installed)) if installed.relation == Relation::Older => return Ok(installed.dir),
        (Mode::Update, _) | (Mode::Reinstall, None) => return Err(failed(FailReason::ModeMismatch)),
        (Mode::Fresh | Mode::Reinstall, Some(installed)) if installed.relation == Relation::Older => {
            return Err(failed(FailReason::ModeMismatch));
        }
        (Mode::Fresh | Mode::Reinstall, installed) => installed,
    };
    let check = check();
    if check.error.is_some() {
        return Err(failed(FailReason::InvalidDir));
    }
    if check.free_bytes.is_some_and(|free| free < required_bytes) {
        return Err(failed(FailReason::InsufficientSpace));
    }
    match installed {
        // The registry's `InstallLocation`, as an update uses it.
        Some(installed) if same_dir(&check.normalized, &installed.dir) => Ok(installed.dir),
        Some(_) => Err(failed(FailReason::ModeMismatch)),
        None => Ok(check.normalized),
    }
}

/// Success is the source of truth, not the exit code alone: exit 0, the registry shows
/// the payload version installed in `dir` (NSIS writes `/D=` verbatim as
/// `InstallLocation`), and `<dir>\slui.exe` exists.
fn verify(exit_code: u32, dir: &str) -> InstallOutcome {
    if exit_code != 0 {
        return InstallOutcome::Failed { code: Some(exit_code), reason: FailReason::ExitCode, detail: None };
    }
    match detect::read_installed() {
        Some(installed)
            if installed.version == detect::payload_version()
                && same_dir(&installed.dir, dir)
                && Path::new(dir).join(detect::APP_EXE).is_file() =>
        {
            InstallOutcome::Ok { dir: installed.dir }
        }
        _ => InstallOutcome::Failed { code: Some(exit_code), reason: FailReason::VerifyFailed, detail: None },
    }
}

/// Windows paths compare case-insensitively; a trailing separator is not significant.
fn same_dir(a: &str, b: &str) -> bool {
    a.trim_end_matches('\\').to_lowercase() == b.trim_end_matches('\\').to_lowercase()
}

/// Blocking; run on a worker thread. `parent` is the shell window, so the UAC prompt
/// belongs to it.
pub fn install(
    session: &Session,
    request: &InstallRequest,
    parent: isize,
    on_stage: impl Fn(Stage),
) -> InstallOutcome {
    let dir = match target_dir(request) {
        Ok(dir) => dir,
        Err(outcome) => return outcome,
    };

    on_stage(Stage::Extracting);
    let package = match session.extract_payload() {
        Ok(path) => path,
        Err(PayloadError::Missing) => return failed(FailReason::NoPayload),
        Err(PayloadError::Extract(detail)) => {
            return InstallOutcome::Failed { code: None, reason: FailReason::ExtractFailed, detail: Some(detail) };
        }
    };

    on_stage(Stage::Elevating);
    let shortcuts = Shortcuts { start_menu: request.start_menu_shortcut, desktop: request.desktop_shortcut };
    let args = nsis_args(request.mode, &dir, shortcuts);
    let process = match shell_execute(Verb::RunAs, &package, Some(&args), parent) {
        Ok(Some(process)) => process,
        Ok(None) => {
            return InstallOutcome::Failed {
                code: None,
                reason: FailReason::LaunchFailed,
                detail: Some("no process handle".into()),
            };
        }
        Err(ShellError::Cancelled) => return InstallOutcome::Cancelled,
        Err(ShellError::Failed(detail)) => {
            return InstallOutcome::Failed { code: None, reason: FailReason::LaunchFailed, detail: Some(detail) };
        }
    };

    on_stage(Stage::Installing);
    let exit_code = process.wait();
    verify(exit_code, &dir)
}

#[derive(Debug, Clone, Copy)]
pub enum Verb {
    /// Elevated; UAC prompt.
    RunAs,
    /// Default verb; the package's own manifest requests elevation.
    Open,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellError {
    /// The user declined the UAC prompt.
    Cancelled,
    Failed(String),
}

pub struct Process(windows_sys::Win32::Foundation::HANDLE);

impl Process {
    pub fn wait(self) -> u32 {
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
        let mut code = u32::MAX;
        unsafe {
            WaitForSingleObject(self.0, INFINITE);
            if GetExitCodeProcess(self.0, &mut code) == 0 {
                code = u32::MAX;
            }
        }
        code
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// `ShellExecuteExW`; returns the process handle when one was created.
pub fn shell_execute(verb: Verb, file: &Path, args: Option<&str>, parent: isize) -> Result<Option<Process>, ShellError> {
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};

    // ShellExecuteEx may delegate to shell extensions that need COM on this thread. The
    // caller is a pooled worker thread, so a successful init is paired with an uninit.
    let com = unsafe { CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) };
    let result = shell_execute_inner(verb, file, args, parent);
    if com >= 0 {
        unsafe { CoUninitialize() };
    }
    result
}

fn shell_execute_inner(verb: Verb, file: &Path, args: Option<&str>, parent: isize) -> Result<Option<Process>, ShellError> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_CANCELLED},
        UI::{
            Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };

    let verb = detect::wide(match verb {
        Verb::RunAs => "runas",
        Verb::Open => "open",
    });
    let file = detect::wide(&file.display().to_string());
    let args = args.map(detect::wide);
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.hwnd = parent as _;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = args.as_ref().map_or(std::ptr::null(), |args| args.as_ptr());
    info.nShow = SW_SHOWNORMAL;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_CANCELLED {
            return Err(ShellError::Cancelled);
        }
        return Err(ShellError::Failed(std::io::Error::from_raw_os_error(error as i32).to_string()));
    }
    Ok((!info.hProcess.is_null()).then(|| Process(info.hProcess)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOTH: Shortcuts = Shortcuts { start_menu: true, desktop: true };
    const NONE: Shortcuts = Shortcuts { start_menu: false, desktop: false };

    #[test]
    fn fresh_install_args_put_an_unquoted_dir_last() {
        assert_eq!(
            nsis_args(Mode::Fresh, r"C:\Program Files\SLUI", BOTH),
            r"/S /NS /SLUI-STARTMENU /SLUI-DESKTOP /D=C:\Program Files\SLUI"
        );
        assert_eq!(
            nsis_args(Mode::Reinstall, r"D:\Games\SLUI", BOTH),
            r"/S /NS /SLUI-STARTMENU /SLUI-DESKTOP /D=D:\Games\SLUI"
        );
    }

    #[test]
    fn each_shortcut_has_its_own_switch() {
        let start_menu_only = Shortcuts { start_menu: true, desktop: false };
        let desktop_only = Shortcuts { start_menu: false, desktop: true };
        assert_eq!(nsis_args(Mode::Fresh, r"D:\Program Files\SLUI", start_menu_only), r"/S /NS /SLUI-STARTMENU /D=D:\Program Files\SLUI");
        assert_eq!(nsis_args(Mode::Fresh, r"D:\SLUI", desktop_only), r"/S /NS /SLUI-DESKTOP /D=D:\SLUI");
        assert_eq!(nsis_args(Mode::Reinstall, r"D:\SLUI", NONE), r"/S /NS /D=D:\SLUI");
    }

    #[test]
    fn update_args_use_update_mode_and_ignore_the_shortcut_choice() {
        assert_eq!(nsis_args(Mode::Update, r"C:\Program Files\SLUI", NONE), r"/S /UPDATE /D=C:\Program Files\SLUI");
        assert_eq!(nsis_args(Mode::Update, r"C:\Program Files\SLUI", BOTH), r"/S /UPDATE /D=C:\Program Files\SLUI");
    }

    #[test]
    fn args_never_quote_and_always_end_with_the_dir() {
        for mode in [Mode::Fresh, Mode::Update, Mode::Reinstall] {
            for start_menu in [true, false] {
                for desktop in [true, false] {
                    let dir = r"E:\A Dir With Spaces\SLUI";
                    let args = nsis_args(mode, dir, Shortcuts { start_menu, desktop });
                    assert!(args.ends_with(&format!("/D={dir}")), "{args}");
                    assert!(!args.contains('"'), "{args}");
                    assert_eq!(args.matches("/D=").count(), 1, "{args}");
                }
            }
        }
    }

    #[test]
    fn outcomes_serialize_for_the_frontend() {
        let ok = serde_json::to_value(InstallOutcome::Ok { dir: r"C:\SLUI".into() }).unwrap();
        assert_eq!(ok, serde_json::json!({ "kind": "ok", "dir": r"C:\SLUI" }));
        let cancelled = serde_json::to_value(InstallOutcome::Cancelled).unwrap();
        assert_eq!(cancelled, serde_json::json!({ "kind": "cancelled" }));
        let failed = serde_json::to_value(InstallOutcome::Failed {
            code: Some(2),
            reason: FailReason::ExitCode,
            detail: None,
        })
        .unwrap();
        assert_eq!(failed, serde_json::json!({ "kind": "failed", "code": 2, "reason": "exit_code", "detail": null }));
    }

    #[test]
    fn install_dirs_compare_like_windows_paths() {
        assert!(same_dir(r"C:\Program Files\SLUI", r"c:\program files\slui"));
        assert!(same_dir(r"D:\SLUI\", r"D:\SLUI"));
        assert!(!same_dir(r"D:\SLUI", r"D:\SLUI2"));
    }

    const INSTALLED_DIR: &str = r"D:\Games\SLUI";
    const GB: u64 = 1 << 30;

    fn installed(relation: Relation) -> Option<Installed> {
        Some(Installed { version: "0.1.0".into(), dir: INSTALLED_DIR.into(), relation })
    }

    fn checked(normalized: &str) -> impl FnOnce() -> DirCheck {
        let normalized = normalized.to_string();
        move || DirCheck { normalized, free_bytes: Some(GB), error: None }
    }

    fn unchecked() -> DirCheck {
        panic!("the requested directory must not matter here")
    }

    fn mismatch() -> Result<String, InstallOutcome> {
        Err(failed(FailReason::ModeMismatch))
    }

    #[test]
    fn reinstall_stays_in_the_installed_dir() {
        let same = || installed(Relation::Same);
        assert_eq!(resolve_target(Mode::Reinstall, same(), checked(INSTALLED_DIR), GB), Ok(INSTALLED_DIR.into()));
        // Case and a trailing separator do not make another directory; the registry value wins.
        assert_eq!(resolve_target(Mode::Reinstall, same(), checked(r"d:\games\slui\"), GB), Ok(INSTALLED_DIR.into()));
        assert_eq!(resolve_target(Mode::Reinstall, same(), checked(r"E:\SLUI"), GB), mismatch());
        // A fresh install does not leave a same-version install behind either.
        assert_eq!(resolve_target(Mode::Fresh, same(), checked(r"E:\SLUI"), GB), mismatch());
        assert_eq!(resolve_target(Mode::Fresh, same(), checked(INSTALLED_DIR), GB), Ok(INSTALLED_DIR.into()));
        // Nothing left to reinstall.
        assert_eq!(resolve_target(Mode::Reinstall, None, unchecked, GB), mismatch());
    }

    #[test]
    fn older_and_newer_installs_decide_before_the_requested_dir() {
        assert_eq!(resolve_target(Mode::Update, installed(Relation::Older), unchecked, GB), Ok(INSTALLED_DIR.into()));
        assert_eq!(resolve_target(Mode::Update, installed(Relation::Same), unchecked, GB), mismatch());
        assert_eq!(resolve_target(Mode::Update, None, unchecked, GB), mismatch());
        for mode in [Mode::Fresh, Mode::Reinstall] {
            assert_eq!(resolve_target(mode, installed(Relation::Older), unchecked, GB), mismatch());
        }
        for mode in [Mode::Fresh, Mode::Update, Mode::Reinstall] {
            assert_eq!(resolve_target(mode, installed(Relation::Newer), unchecked, GB), Err(failed(FailReason::Downgrade)));
        }
    }

    #[test]
    fn fresh_install_goes_into_the_checked_dir() {
        assert_eq!(resolve_target(Mode::Fresh, None, checked(r"E:\SLUI"), GB), Ok(r"E:\SLUI".into()));
        let invalid = || DirCheck { normalized: "SLUI".into(), free_bytes: None, error: Some(detect::DirError::NotAbsolute) };
        assert_eq!(resolve_target(Mode::Fresh, None, invalid, GB), Err(failed(FailReason::InvalidDir)));
        let full = || DirCheck { normalized: r"E:\SLUI".into(), free_bytes: Some(GB - 1), error: None };
        assert_eq!(resolve_target(Mode::Fresh, None, full, GB), Err(failed(FailReason::InsufficientSpace)));
        // A same-version reinstall checks the requested dir too.
        let same_full = || DirCheck { normalized: INSTALLED_DIR.into(), free_bytes: Some(GB - 1), error: None };
        assert_eq!(
            resolve_target(Mode::Reinstall, installed(Relation::Same), same_full, GB),
            Err(failed(FailReason::InsufficientSpace))
        );
    }

    #[test]
    fn non_zero_exit_code_fails_without_reading_the_registry() {
        assert_eq!(
            verify(2, r"C:\nowhere"),
            InstallOutcome::Failed { code: Some(2), reason: FailReason::ExitCode, detail: None }
        );
    }
}
