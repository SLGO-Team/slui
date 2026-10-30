//! Relaunching SLUI elevated, for a game that runs as administrator: a non-elevated SLUI cannot see keys sent to it
//! or take the foreground from it (UIPI). The running instance starts `slui.exe --after-pid <its pid>` through the
//! UAC prompt and exits; the new instance waits for it before the single-instance check, which would otherwise hand
//! the launch back to the old instance and exit.

use std::time::Duration;

use tauri::AppHandle;

const AFTER_PID: &str = "--after-pid";
/// How long a relaunched instance waits for the old one; it continues afterwards (the single-instance check then
/// hands off, as for any second launch).
#[cfg_attr(not(windows), allow(dead_code))]
const WAIT_FOR_PREVIOUS: Duration = Duration::from_secs(10);

/// The arguments of the relaunched instance.
#[cfg_attr(not(windows), allow(dead_code))]
fn relaunch_args(pid: u32) -> String {
    format!("{AFTER_PID} {pid}")
}

/// The previous instance a relaunch waits for (`--after-pid <pid>`); anything else on the command line is ignored.
fn after_pid(args: impl IntoIterator<Item = String>) -> Option<u32> {
    let mut args = args.into_iter();
    let mut pid = None;
    while let Some(arg) = args.next() {
        if arg == AFTER_PID {
            pid = args.next().and_then(|value| value.parse().ok()).filter(|&pid| pid != 0);
        }
    }
    pid
}

/// A relaunch's wait for the previous instance, logged once the log is open.
#[derive(Clone, Copy)]
pub struct PreviousInstance {
    pid: u32,
    exited: bool,
}

impl PreviousInstance {
    pub fn log(self) {
        if self.exited {
            diag!("SLGO: started by a relaunch; previous instance {} has exited", self.pid);
        } else {
            diag!(
                "SLGO: started by a relaunch; previous instance {} still runs after {}s",
                self.pid,
                WAIT_FOR_PREVIOUS.as_secs()
            );
        }
    }
}

/// Before the single-instance check: waits for the instance named by `--after-pid` to exit.
pub fn wait_for_previous_instance() -> Option<PreviousInstance> {
    let pid = after_pid(std::env::args().skip(1))?;
    Some(PreviousInstance { pid, exited: wait_for_exit(pid) })
}

#[cfg(windows)]
fn wait_for_exit(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };

    let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if process.is_null() {
        // The process is gone already (an elevated caller is never denied SYNCHRONIZE on its own user's process).
        return true;
    }
    let waited = unsafe { WaitForSingleObject(process, WAIT_FOR_PREVIOUS.as_millis() as u32) };
    unsafe { CloseHandle(process) };
    waited == WAIT_OBJECT_0
}

#[cfg(not(windows))]
fn wait_for_exit(_pid: u32) -> bool {
    true
}

/// Starts this executable elevated through the UAC prompt. `Err("cancelled")` when the player declined it; on success
/// this instance exits.
#[tauri::command]
pub async fn relaunch_elevated(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;

        // The prompt belongs to the home window, where the player asked for it.
        let owner = app
            .get_webview_window("home")
            .and_then(|home| home.hwnd().ok())
            .map_or(0, |hwnd| hwnd.0 as isize);
        diag!("SLGO: elevated relaunch requested");
        let launched = tauri::async_runtime::spawn_blocking(move || launch_elevated(owner))
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result);
        match launched {
            Ok(()) => {
                diag!("SLGO: relaunching elevated; exiting");
                app.exit(0);
                Ok(())
            }
            Err(error) => {
                diag!("SLGO: elevated relaunch not started: {error}");
                Err(error)
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Relaunching elevated is only supported on Windows".into())
    }
}

#[cfg(windows)]
fn launch_elevated(owner: isize) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_CANCELLED},
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE},
        UI::{
            Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };

    let exe = std::env::current_exe().map_err(|error| format!("Cannot find slui.exe: {error}"))?;
    let wide = |text: &str| text.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let file = wide(&exe.to_string_lossy());
    let verb = wide("runas");
    let parameters = wide(&relaunch_args(std::process::id()));

    // ShellExecuteEx may hand the verb to shell extensions, which expect COM on the calling thread.
    let com = unsafe { CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) };
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOASYNC;
    info.hwnd = owner as _;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    let started = unsafe { ShellExecuteExW(&mut info) } != 0;
    let error = unsafe { GetLastError() };
    if com >= 0 {
        unsafe { CoUninitialize() };
    }
    match (started, error) {
        (true, _) => Ok(()),
        (false, ERROR_CANCELLED) => Err("cancelled".into()),
        (false, error) => Err(format!("Windows did not start SLUI elevated (error {error})")),
    }
}

#[cfg(test)]
mod tests {
    use super::{after_pid, relaunch_args};

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn the_relaunch_names_this_process() {
        assert_eq!(relaunch_args(4242), "--after-pid 4242");
        assert_eq!(after_pid(args(&relaunch_args(4242))), Some(4242));
    }

    #[test]
    fn other_arguments_and_bad_pids_are_ignored() {
        assert_eq!(after_pid(args("")), None);
        assert_eq!(after_pid(args("--update")), None);
        assert_eq!(after_pid(args("--after-pid")), None, "no value");
        assert_eq!(after_pid(args("--after-pid abc")), None);
        assert_eq!(after_pid(args("--after-pid 0")), None, "never a real process");
        assert_eq!(after_pid(args("--flag --after-pid 7 other")), Some(7));
    }
}
