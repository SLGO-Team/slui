//! Diagnostics log: timestamped lines in `app_log_dir()/slui.log`. A release build has no console, so its
//! stderr reaches nobody; a player who reports a problem attaches this file (tray 「打开日志文件夹」).
//!
//! Never log typed text or key codes other than the overlay's own hotkeys: the hooks see every key.

use std::{
    fmt,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const FILE_NAME: &str = "slui.log";
/// Earlier sessions kept next to the current one: `slui.1.log` (previous) and `slui.2.log`.
const KEPT_SESSIONS: u32 = 2;
/// One session never writes more than this; a runaway loop cannot fill the disk.
const SESSION_LIMIT_BYTES: u64 = 8 * 1024 * 1024;
/// Lines logged before the file opens (plugin setup) wait here.
const EARLY_LINES_LIMIT: usize = 256;

enum Sink {
    Early(Vec<String>),
    File { file: File, written: u64 },
    Closed,
}

static SINK: Mutex<Sink> = Mutex::new(Sink::Early(Vec::new()));
static PATH: OnceLock<PathBuf> = OnceLock::new();

/// Writes one line to stderr and the log. Use the `diag!` macro.
pub fn write(args: fmt::Arguments) {
    // Formatted before the lock: a panicking Display impl must not poison it.
    let line = format!("{} {args}\n", timestamp(SystemTime::now()));
    eprint!("{line}");
    append(&mut lock(), line);
}

macro_rules! diag {
    ($($arg:tt)*) => {
        $crate::diag::write(format_args!($($arg)*))
    };
}

fn lock() -> MutexGuard<'static, Sink> {
    // A line is appended whole or not at all, so a poisoned lock still holds a usable sink.
    SINK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn append(sink: &mut Sink, line: String) {
    match sink {
        Sink::Early(lines) => {
            if lines.len() < EARLY_LINES_LIMIT {
                lines.push(line);
            }
        }
        Sink::File { file, written } => {
            let size = line.len() as u64;
            if *written + size > SESSION_LIMIT_BYTES {
                let _ = file.write_all(b"log size limit reached; later lines are dropped\n");
                *sink = Sink::Closed;
                return;
            }
            if file.write_all(line.as_bytes()).is_ok() {
                *written += size;
            }
        }
        Sink::Closed => {}
    }
}

/// Opens this session's log in `dir`, rotating the earlier ones, and writes the lines logged so far. Called
/// once, from `setup`: a second instance exits in the single-instance plugin before that, so it never rotates
/// the running instance's log. Returns the file's path.
pub fn init(dir: &Path) -> Result<PathBuf, String> {
    let path = dir.join(FILE_NAME);
    let opened = fs::create_dir_all(dir)
        .and_then(|()| {
            rotate(dir);
            File::create(&path)
        })
        .map_err(|error| format!("cannot open {}: {error}", path.display()));
    let mut sink = lock();
    let Sink::Early(early) = std::mem::replace(&mut *sink, Sink::Closed) else {
        return Err("the log is already open".into());
    };
    let file = opened?;
    *sink = Sink::File { file, written: 0 };
    for line in early {
        append(&mut sink, line);
    }
    drop(sink);
    let _ = PATH.set(path.clone());
    Ok(path)
}

/// The current session's log file, once it is open.
pub fn path() -> Option<&'static Path> {
    PATH.get().map(PathBuf::as_path)
}

fn rotated(dir: &Path, session: u32) -> PathBuf {
    dir.join(format!("slui.{session}.log"))
}

fn rotate(dir: &Path) {
    let _ = fs::remove_file(rotated(dir, KEPT_SESSIONS));
    for session in (1..KEPT_SESSIONS).rev() {
        let _ = fs::rename(rotated(dir, session), rotated(dir, session + 1));
    }
    let _ = fs::rename(dir.join(FILE_NAME), rotated(dir, 1));
}

/// Logs panics before the default hook prints them.
pub fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let line = format!("{} panic: {info}\n", timestamp(SystemTime::now()));
        // A panic while the sink is held (from inside a write) skips the log rather than deadlock.
        if let Ok(mut sink) = SINK.try_lock() {
            append(&mut sink, line);
        }
        default(info);
    }));
}

/// `<DisplayVersion> build <CurrentBuild>.<UBR>`, e.g. `24H2 build 26100.4652`, from the registry.
#[cfg(windows)]
pub fn windows_version() -> String {
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ},
    };

    let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0".encode_utf16().collect();
    let string = |name: &str| -> Option<String> {
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let mut buffer = [0_u16; 64];
        let mut size = std::mem::size_of_val(&buffer) as u32;
        let status = unsafe {
            RegGetValueW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(), &mut size)
        };
        let len = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
        (status == ERROR_SUCCESS && len > 0).then(|| String::from_utf16_lossy(&buffer[..len]))
    };
    let name: Vec<u16> = "UBR\0".encode_utf16().collect();
    let mut ubr = 0_u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let has_ubr = unsafe {
        RegGetValueW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(),
            (&mut ubr as *mut u32).cast(), &mut size)
    } == ERROR_SUCCESS;
    let build = string("CurrentBuild").unwrap_or_else(|| "?".into());
    let build = if has_ubr { format!("{build}.{ubr}") } else { build };
    match string("DisplayVersion") {
        Some(version) => format!("{version} build {build}"),
        None => format!("build {build}"),
    }
}

/// Whether `process` runs elevated (`TokenElevation`); the Win32 error when its token cannot be read.
#[cfg(windows)]
pub fn process_elevated(process: windows_sys::Win32::Foundation::HANDLE) -> Result<bool, u32> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, HANDLE},
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        System::Threading::OpenProcessToken,
    };

    let mut token: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(unsafe { GetLastError() });
    }
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut length = 0_u32;
    let read = unsafe {
        GetTokenInformation(token, TokenElevation, (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut length)
    };
    let result = if read == 0 { Err(unsafe { GetLastError() }) } else { Ok(elevation.TokenIsElevated != 0) };
    unsafe { CloseHandle(token) };
    result
}

/// `yes`, `no` or `unknown (error N)` for a log line.
#[cfg(windows)]
pub fn elevation_text(elevated: Result<bool, u32>) -> String {
    match elevated {
        Ok(true) => "yes".into(),
        Ok(false) => "no".into(),
        Err(error) => format!("unknown (error {error})"),
    }
}

/// UTC, as the server logs, to the millisecond: `2026-10-28T12:03:38.953Z`.
fn timestamp(now: SystemTime) -> String {
    let since_epoch = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since_epoch.as_secs();
    let (year, month, day) = civil_from_days((seconds / 86_400) as i64);
    let in_day = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        in_day / 3_600,
        in_day % 3_600 / 60,
        in_day % 60,
        since_epoch.subsec_millis()
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = (if month_index < 10 { month_index + 3 } else { month_index - 9 }) as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{civil_from_days, rotate, rotated, timestamp, FILE_NAME};
    use std::{
        fs,
        time::{Duration, UNIX_EPOCH},
    };

    #[test]
    fn timestamps_are_utc_to_the_millisecond() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        // 2026-10-24 12:03:38.953 UTC, a line of the competitive server's log.
        let at = UNIX_EPOCH + Duration::from_millis(1_792_843_418_953);
        assert_eq!(timestamp(at), "2026-10-24T12:03:38.953Z");
    }

    #[test]
    fn civil_dates_cover_leap_days_and_year_ends() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(20_818), (2026, 12, 31));
        assert_eq!(civil_from_days(20_819), (2027, 1, 1));
    }

    #[test]
    fn rotation_keeps_two_earlier_sessions() {
        let dir = std::env::temp_dir().join(format!("slui-diag-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for session in ["first", "second", "third", "fourth"] {
            rotate(&dir);
            fs::write(dir.join(FILE_NAME), session).unwrap();
        }
        assert_eq!(fs::read_to_string(dir.join(FILE_NAME)).unwrap(), "fourth");
        assert_eq!(fs::read_to_string(rotated(&dir, 1)).unwrap(), "third");
        assert_eq!(fs::read_to_string(rotated(&dir, 2)).unwrap(), "second");
        assert!(!rotated(&dir, 3).exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
