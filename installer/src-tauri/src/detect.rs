//! What is on this machine: the installed SLUI (HKLM uninstall entry written by the
//! NSIS package), whether SLUI is running, the default install directory, and
//! whether a chosen directory can take the install.

use std::{cmp::Ordering, path::Path};

use serde::Serialize;

/// HKLM, 64-bit view; written by the perMachine NSIS package (`UNINSTKEY`).
pub const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\SLUI";
/// `MainBinaryName` of the NSIS package; NSIS closes this process before installing.
pub const APP_EXE: &str = "slui.exe";
/// Last path segment `pick_dir` appends unless the user already picked it.
pub const APP_DIR_NAME: &str = "SLUI";

pub fn payload_version() -> &'static str {
    env!("SLUI_SETUP_VERSION")
}

pub fn required_bytes() -> u64 {
    env!("SLUI_SETUP_REQUIRED_BYTES").parse().unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Installed {
    pub version: String,
    pub dir: String,
    /// Installed version relative to the payload; the UI does not compare versions itself.
    pub relation: Relation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detect {
    pub payload_version: String,
    pub required_bytes: u64,
    pub default_dir: String,
    pub installed: Option<Installed>,
    pub app_running: bool,
}

pub fn detect() -> Detect {
    Detect {
        payload_version: payload_version().to_string(),
        required_bytes: required_bytes(),
        default_dir: default_dir(),
        installed: read_installed(),
        app_running: app_running(),
    }
}

/// How the installed version relates to the payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Relation {
    Older,
    Same,
    Newer,
}

/// Semver comparison. An installed version that does not parse is treated as older
/// so the user is offered an update rather than being locked out.
pub fn relation(installed: &str, payload: &str) -> Relation {
    let (Ok(installed), Ok(payload)) = (
        semver::Version::parse(installed.trim()),
        semver::Version::parse(payload.trim()),
    ) else {
        return Relation::Older;
    };
    match installed.cmp(&payload) {
        Ordering::Less => Relation::Older,
        Ordering::Equal => Relation::Same,
        Ordering::Greater => Relation::Newer,
    }
}

/// NSIS writes `InstallLocation` wrapped in quotes.
pub fn strip_quotes(value: &str) -> &str {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
        .trim()
}

/// The installed SLUI, or `None` when the entry, either value, or `slui.exe` is missing
/// (treated as a fresh install). currentUser (HKCU) entries are deliberately ignored.
pub fn read_installed() -> Option<Installed> {
    let version = read_hklm_string(UNINSTALL_KEY, "DisplayVersion")?;
    let dir = read_hklm_string(UNINSTALL_KEY, "InstallLocation")?;
    let dir = strip_quotes(&dir).trim_end_matches('\\').to_string();
    let version = version.trim().to_string();
    if version.is_empty() || dir.is_empty() || !Path::new(&dir).join(APP_EXE).is_file() {
        return None;
    }
    let relation = relation(&version, payload_version());
    Some(Installed { version, dir, relation })
}

pub(crate) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(buffer: &[u16]) -> String {
    let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

/// Reads a REG_SZ / REG_EXPAND_SZ from HKLM in the 64-bit registry view, where the
/// x64 NSIS package writes (`SetRegView 64`).
fn read_hklm_string(subkey: &str, value: &str) -> Option<String> {
    use windows_sys::Win32::{
        Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS},
        System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY},
    };

    let subkey = wide(subkey);
    let value = wide(value);
    let flags = RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY;
    let mut size = 0_u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            flags,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS && status != ERROR_MORE_DATA {
        return None;
    }
    // The value can grow between the two calls; retry a few times on ERROR_MORE_DATA.
    for _ in 0..3 {
        let mut buffer = vec![0_u16; (size as usize).div_ceil(2) + 1];
        let mut bytes = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                subkey.as_ptr(),
                value.as_ptr(),
                flags,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        match status {
            ERROR_SUCCESS => return Some(from_wide(&buffer)),
            ERROR_MORE_DATA => size = bytes,
            _ => return None,
        }
    }
    None
}

/// `slui.exe` in the process list (names only; no process is opened).
pub fn app_running() -> bool {
    process_names().iter().any(|(_, _, name)| name.eq_ignore_ascii_case(APP_EXE))
}

/// `(pid, parent pid, exe name)` for every process.
pub(crate) fn process_names() -> Vec<(u32, u32, String)> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    let mut processes = Vec::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while more {
        processes.push((
            entry.th32ProcessID,
            entry.th32ParentProcessID,
            from_wide(&entry.szExeFile),
        ));
        more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    processes
}

/// `FOLDERID_ProgramFiles\SLUI`, the NSIS package's own default (`$PROGRAMFILES64\SLUI`).
pub fn default_dir() -> String {
    format!("{}\\{APP_DIR_NAME}", program_files().trim_end_matches('\\'))
}

fn program_files() -> String {
    use windows_sys::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
    };

    let mut path: windows_sys::core::PWSTR = std::ptr::null_mut();
    let result = unsafe {
        SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT as u32, std::ptr::null_mut(), &mut path)
    };
    let mut resolved = None;
    if result >= 0 && !path.is_null() {
        let length = (0..).take_while(|&index| unsafe { *path.add(index) } != 0).count();
        resolved = Some(String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(path, length) }));
    }
    if !path.is_null() {
        unsafe { CoTaskMemFree(path.cast()) };
    }
    resolved
        .or_else(|| std::env::var("ProgramW6432").ok())
        .unwrap_or_else(|| r"C:\Program Files".to_string())
}

/// Why a directory cannot take the install.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DirError {
    /// Not a full `X:\...` path.
    NotAbsolute,
    /// Characters, segments or names Windows does not allow.
    InvalidChars,
    /// UNC path, network, optical or missing drive.
    NotLocal,
    /// A bare drive root such as `D:\`.
    DriveRoot,
    /// The path exists and is a file.
    NotDirectory,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirCheck {
    pub normalized: String,
    pub free_bytes: Option<u64>,
    pub error: Option<DirError>,
}

const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Pure syntactic normalization: trims, uses backslashes, collapses repeated
/// separators, drops a trailing separator and upper-cases the drive letter.
pub fn normalize_dir(input: &str) -> Result<String, DirError> {
    let path = input.trim().replace('/', "\\");
    if path.starts_with("\\\\") {
        return Err(DirError::NotLocal);
    }
    let bytes = path.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return Err(DirError::NotAbsolute);
    }
    let drive = (bytes[0] as char).to_ascii_uppercase();
    let segments: Vec<&str> = path[3..].split('\\').filter(|segment| !segment.is_empty()).collect();
    if segments.is_empty() {
        return Err(DirError::DriveRoot);
    }
    for segment in &segments {
        let invalid_char = segment
            .chars()
            .any(|ch| (ch as u32) < 0x20 || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'));
        let stem = segment.split('.').next().unwrap_or_default().trim_end();
        let reserved = RESERVED_NAMES.iter().any(|name| stem.eq_ignore_ascii_case(name));
        // Windows silently strips trailing dots and spaces, so "SLUI." would not be the
        // directory the user typed; "." and ".." are relative.
        if invalid_char || reserved || segment.ends_with('.') || segment.ends_with(' ') {
            return Err(DirError::InvalidChars);
        }
    }
    Ok(format!("{drive}:\\{}", segments.join("\\")))
}

/// `<picked>\SLUI`, unless the picked folder already is a `SLUI` folder.
pub fn with_app_dir(picked: &str) -> String {
    let trimmed = picked.trim_end_matches(['\\', '/']);
    let last = trimmed.rsplit(['\\', '/']).next().unwrap_or_default();
    if last.eq_ignore_ascii_case(APP_DIR_NAME) {
        trimmed.to_string()
    } else {
        format!("{trimmed}\\{APP_DIR_NAME}")
    }
}

/// Syntax plus the machine: drive type, file-in-the-way, free space on the volume.
pub fn check_dir(input: &str) -> DirCheck {
    let normalized = match normalize_dir(input) {
        Ok(normalized) => normalized,
        Err(error) => {
            return DirCheck { normalized: input.trim().to_string(), free_bytes: None, error: Some(error) };
        }
    };
    let error = if !is_local_drive(&normalized[..3]) {
        Some(DirError::NotLocal)
    } else if Path::new(&normalized).is_file() {
        Some(DirError::NotDirectory)
    } else {
        None
    };
    let free_bytes = if error == Some(DirError::NotLocal) { None } else { free_bytes(&normalized) };
    DirCheck { normalized, free_bytes, error }
}

fn is_local_drive(root: &str) -> bool {
    use windows_sys::Win32::{
        Storage::FileSystem::GetDriveTypeW,
        System::WindowsProgramming::{DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOVABLE},
    };
    let root = wide(root);
    let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
    matches!(kind, DRIVE_FIXED | DRIVE_RAMDISK | DRIVE_REMOVABLE)
}

/// Free space available to this user on the volume of the nearest existing ancestor.
pub fn free_bytes(dir: &str) -> Option<u64> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let existing = Path::new(dir).ancestors().find(|ancestor| ancestor.is_dir())?;
    let mut path = existing.display().to_string();
    if !path.ends_with('\\') {
        path.push('\\');
    }
    let path = wide(&path);
    let mut free = 0_u64;
    let ok = unsafe { GetDiskFreeSpaceExW(path.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(free)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_quotes_nsis_writes_around_install_location() {
        assert_eq!(strip_quotes("\"C:\\Program Files\\SLUI\""), r"C:\Program Files\SLUI");
        assert_eq!(strip_quotes(r"C:\Program Files\SLUI"), r"C:\Program Files\SLUI");
        assert_eq!(strip_quotes("  \"D:\\SLUI\"  "), r"D:\SLUI");
        assert_eq!(strip_quotes("\"unterminated"), "\"unterminated");
        assert_eq!(strip_quotes("\"\""), "");
    }

    #[test]
    fn classifies_versions_with_semver() {
        assert_eq!(relation("0.1.0", "0.1.1"), Relation::Older);
        assert_eq!(relation("0.1.1", "0.1.1"), Relation::Same);
        assert_eq!(relation("0.2.0", "0.1.1"), Relation::Newer);
        assert_eq!(relation("0.10.0", "0.9.0"), Relation::Newer, "numeric, not lexical");
        assert_eq!(relation("1.0.0-beta.1", "1.0.0"), Relation::Older, "pre-release is older");
        assert_eq!(relation(" 0.1.0 ", "0.1.0"), Relation::Same);
    }

    #[test]
    fn unparsable_installed_version_is_offered_an_update() {
        assert_eq!(relation("", "0.1.0"), Relation::Older);
        assert_eq!(relation("1.0", "0.1.0"), Relation::Older);
        assert_eq!(relation("garbage", "0.1.0"), Relation::Older);
    }

    #[test]
    fn normalizes_directories() {
        assert_eq!(normalize_dir(r"d:\Program Files\SLUI\").unwrap(), r"D:\Program Files\SLUI");
        assert_eq!(normalize_dir("  D:/Games//SLUI  ").unwrap(), r"D:\Games\SLUI");
        assert_eq!(normalize_dir(r"C:\a\b\\\c\\").unwrap(), r"C:\a\b\c");
    }

    #[test]
    fn rejects_invalid_directories() {
        assert_eq!(normalize_dir(""), Err(DirError::NotAbsolute));
        assert_eq!(normalize_dir("SLUI"), Err(DirError::NotAbsolute));
        assert_eq!(normalize_dir(r"\SLUI"), Err(DirError::NotAbsolute));
        assert_eq!(normalize_dir("D:SLUI"), Err(DirError::NotAbsolute));
        assert_eq!(normalize_dir(r"\\server\share\SLUI"), Err(DirError::NotLocal));
        assert_eq!(normalize_dir(r"D:\"), Err(DirError::DriveRoot));
        assert_eq!(normalize_dir("D:"), Err(DirError::NotAbsolute));
        assert_eq!(normalize_dir(r"D:\a|b"), Err(DirError::InvalidChars));
        assert_eq!(normalize_dir(r"D:\a:b"), Err(DirError::InvalidChars));
        assert_eq!(normalize_dir(r"D:\SLUI."), Err(DirError::InvalidChars));
        assert_eq!(normalize_dir(r"D:\..\SLUI"), Err(DirError::InvalidChars));
        assert_eq!(normalize_dir(r"D:\con\SLUI"), Err(DirError::InvalidChars));
        assert_eq!(normalize_dir(r"D:\nul.txt"), Err(DirError::InvalidChars));
        assert!(normalize_dir(r"D:\console").is_ok());
    }

    #[test]
    fn appends_the_app_dir_unless_already_picked() {
        assert_eq!(with_app_dir(r"D:\Program Files"), r"D:\Program Files\SLUI");
        assert_eq!(with_app_dir(r"D:\"), r"D:\SLUI");
        assert_eq!(with_app_dir(r"D:\Games\SLUI"), r"D:\Games\SLUI");
        assert_eq!(with_app_dir(r"D:\Games\slui\"), r"D:\Games\slui");
        assert_eq!(with_app_dir(r"D:\Games\SLUI2"), r"D:\Games\SLUI2\SLUI");
    }

    #[test]
    fn default_dir_is_program_files_slui() {
        let dir = default_dir();
        assert!(dir.ends_with(r"\SLUI"), "{dir}");
        assert!(normalize_dir(&dir).is_ok(), "{dir}");
    }
}
