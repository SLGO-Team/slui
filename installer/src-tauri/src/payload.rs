//! The NSIS package in this exe's overlay and the per-run temp directory.
//!
//! Everything the shell writes lives in `%TEMP%\slui-setup-<pid>\`: the extracted
//! package and the WebView2 user data. Nothing goes to `%LOCALAPPDATA%`. The directory
//! is removed after the window closes, once the WebView2 processes that lock it have
//! exited; a directory left behind (classic mode, a crash) is removed by the next run.

use std::{
    fs,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use crate::{detect, Role};

const SESSION_PREFIX: &str = "slui-setup-";

#[derive(Debug, Clone)]
pub struct Session {
    pub dir: PathBuf,
}

impl Session {
    /// Creates this run's temp directory and removes stale ones from earlier runs.
    pub fn create() -> Session {
        let temp = std::env::temp_dir();
        // The relocated uninstaller runs from the directory of the process that started it.
        let running_from = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent()?.file_name()?.to_str().and_then(session_pid));
        remove_stale_sessions(&temp, running_from);
        let dir = temp.join(session_dir_name(std::process::id()));
        if let Err(error) = fs::create_dir_all(&dir) {
            eprintln!("slui-setup: cannot create {}: {error}", dir.display());
        }
        Session { dir }
    }

    pub fn webview_data_dir(&self) -> PathBuf {
        self.dir.join("webview")
    }

    /// Copies the NSIS package out of this exe's overlay into the session directory and
    /// returns its path.
    pub fn extract_payload(&self) -> Result<PathBuf, PayloadError> {
        let overlay = crate::overlay().filter(|overlay| overlay.role == Role::Setup).ok_or(PayloadError::Missing)?;
        let extract = || -> io::Result<PathBuf> {
            let mut exe = fs::File::open(std::env::current_exe()?)?;
            exe.seek(SeekFrom::Start(overlay.payload_offset))?;
            fs::create_dir_all(&self.dir)?;
            let path = self.dir.join(payload_file_name(detect::payload_version()));
            let copied = io::copy(&mut exe.take(overlay.payload_bytes), &mut fs::File::create(&path)?)?;
            if copied != overlay.payload_bytes {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the installer file is truncated"));
            }
            Ok(path)
        };
        extract().map_err(|error| PayloadError::Extract(error.to_string()))
    }

    /// Called after the event loop has ended: waits (bounded) for the WebView2
    /// processes started by this shell to exit, since they hold the user data
    /// folder open, then removes the session directory.
    pub fn cleanup_after_exit(&self) {
        wait_for_webview_exit(std::process::id(), Duration::from_secs(10));
        if let Err(error) = fs::remove_dir_all(&self.dir) {
            if self.dir.exists() {
                eprintln!("slui-setup: cannot remove {} ({error}); the next run removes it", self.dir.display());
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayloadError {
    /// Development build without a package (no setup overlay).
    Missing,
    /// Reading the package from this exe or writing it to the session directory failed.
    Extract(String),
}

pub fn payload_file_name(version: &str) -> String {
    format!("SLUI_{version}_x64-setup.exe")
}

fn session_dir_name(pid: u32) -> String {
    format!("{SESSION_PREFIX}{pid}")
}

/// `slui-setup-<pid>` → pid.
pub fn session_pid(name: &str) -> Option<u32> {
    let digits = name.strip_prefix(SESSION_PREFIX)?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn remove_stale_sessions(temp: &Path, keep: Option<u32>) {
    let Ok(entries) = fs::read_dir(temp) else { return };
    let own = std::process::id();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(session_pid) else { continue };
        // file_type() does not follow links: only a real directory named
        // slui-setup-<digits> directly inside %TEMP% is ever removed.
        let real_dir = entry.file_type().is_ok_and(|kind| kind.is_dir() && !kind.is_symlink());
        if pid == own || Some(pid) == keep || !real_dir || process_alive(pid) {
            continue;
        }
        if let Err(error) = fs::remove_dir_all(entry.path()) {
            eprintln!("slui-setup: cannot remove stale {}: {error}", entry.path().display());
        }
    }
}

fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, WAIT_TIMEOUT},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        // Access denied means the process exists but belongs to someone else.
        return unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
    }
    let alive = unsafe { WaitForSingleObject(handle, 0) } == WAIT_TIMEOUT;
    unsafe { CloseHandle(handle) };
    alive
}

/// WebView2 process name; the browser process is a child of the shell and starts the
/// GPU, utility and renderer processes as its own children.
const WEBVIEW_EXE: &str = "msedgewebview2.exe";

/// WebView2 processes descended from `root`. SLUI started from the finish page is also
/// a child of the shell and is deliberately not included.
fn webview_descendants(root: u32) -> Vec<u32> {
    let processes = detect::process_names();
    let mut found = vec![root];
    let mut index = 0;
    while index < found.len() {
        let parent = found[index];
        for (pid, parent_pid, name) in &processes {
            if *parent_pid == parent && name.eq_ignore_ascii_case(WEBVIEW_EXE) && !found.contains(pid) {
                found.push(*pid);
            }
        }
        index += 1;
    }
    found.remove(0);
    found
}

fn wait_for_webview_exit(root: u32, timeout: Duration) {
    ProcessSet::open(webview_descendants(root)).wait(timeout);
}

/// Running SLUI processes and their WebView2 processes, which hold SLUI's WebView2 data.
pub fn app_processes() -> ProcessSet {
    let mut pids = Vec::new();
    for (pid, _, name) in detect::process_names() {
        if name.eq_ignore_ascii_case(detect::APP_EXE) {
            pids.push(pid);
            pids.extend(webview_descendants(pid));
        }
    }
    ProcessSet::open(pids)
}

/// Processes held open by handle, so an exiting process cannot be replaced by a reused pid.
pub struct ProcessSet(Vec<windows_sys::Win32::Foundation::HANDLE>);

impl ProcessSet {
    /// Opens every handle first; processes that already exited are left out.
    pub fn open(pids: Vec<u32>) -> ProcessSet {
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};
        ProcessSet(
            pids.into_iter()
                .map(|pid| unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) })
                .filter(|handle| !handle.is_null())
                .collect(),
        )
    }

    /// Waits until every process has exited or `timeout` has passed.
    pub fn wait(self, timeout: Duration) {
        use windows_sys::Win32::System::Threading::WaitForSingleObject;
        let deadline = Instant::now() + timeout;
        for handle in &self.0 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            unsafe { WaitForSingleObject(*handle, remaining.as_millis().min(u32::MAX as u128) as u32) };
        }
    }
}

impl Drop for ProcessSet {
    fn drop(&mut self) {
        for handle in &self.0 {
            unsafe { windows_sys::Win32::Foundation::CloseHandle(*handle) };
        }
    }
}

// The handles are only waited on and closed; any thread may do either.
unsafe impl Send for ProcessSet {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_session_directory_names() {
        assert_eq!(session_pid("slui-setup-1234"), Some(1234));
        assert_eq!(session_pid(&session_dir_name(42)), Some(42));
        assert_eq!(session_pid("slui-setup-"), None);
        assert_eq!(session_pid("slui-setup-12a"), None);
        assert_eq!(session_pid("slui-setup--1"), None);
        assert_eq!(session_pid("other-1234"), None);
    }

    #[test]
    fn payload_file_name_matches_the_nsis_bundle() {
        assert_eq!(payload_file_name("0.1.0"), "SLUI_0.1.0_x64-setup.exe");
    }

    #[test]
    fn own_process_is_alive() {
        assert!(process_alive(std::process::id()));
    }
}
