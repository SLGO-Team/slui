//! Data `scripts/build-installer.mjs` appends to the compiled exe. One release build of
//! this crate becomes both slui-uninstall.exe and SLUI-Setup-<version>.exe; the overlay
//! says which one a file is and, for the installer, carries the SLUI NSIS package:
//!
//! ```text
//! [ payload (payloadBytes) ][ meta: UTF-8 JSON (metaBytes) ][ metaBytes: u32 LE ][ MAGIC ]
//! ```
//!
//! meta = `{"role":"setup"|"uninstall","version":"X.Y.Z","payloadBytes":N,"requiredBytes":N}`.
//! Windows ignores data after the last PE section, so the exe runs unchanged. A signature
//! would be appended after MAGIC: if the exes are ever signed, read up to the PE security
//! directory instead of the end of the file.

use std::io::{Read, Seek, SeekFrom};

use serde::Deserialize;

use crate::Role;

pub const MAGIC: &[u8; 16] = b"SLUISETUP\0v1\0\0\0\0";
const TRAILER_BYTES: u64 = 4 + MAGIC.len() as u64;
const MAX_META_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Overlay {
    pub role: Role,
    /// Offset of the NSIS package in the exe; 0 bytes long for the uninstaller.
    pub payload_offset: u64,
    pub payload_bytes: u64,
    /// Disk space the installed app needs; 0 for the uninstaller.
    pub required_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Meta {
    role: String,
    version: String,
    payload_bytes: u64,
    required_bytes: u64,
}

/// Reads the overlay at the end of `file`. `None` when there is none or it is not one
/// written for `version` (this build's crate version, which release-please keeps equal
/// to the SLUI version).
pub fn read(file: &mut (impl Read + Seek), version: &str) -> Option<Overlay> {
    let len = file.seek(SeekFrom::End(0)).ok()?;
    let trailer_start = len.checked_sub(TRAILER_BYTES)?;
    let mut trailer = [0u8; TRAILER_BYTES as usize];
    file.seek(SeekFrom::Start(trailer_start)).ok()?;
    file.read_exact(&mut trailer).ok()?;
    if &trailer[4..] != MAGIC {
        return None;
    }
    let meta_bytes = u64::from(u32::from_le_bytes(trailer[..4].try_into().ok()?));
    if meta_bytes > MAX_META_BYTES {
        return None;
    }
    let meta_start = trailer_start.checked_sub(meta_bytes)?;
    let mut meta = vec![0u8; meta_bytes as usize];
    file.seek(SeekFrom::Start(meta_start)).ok()?;
    file.read_exact(&mut meta).ok()?;
    let meta: Meta = serde_json::from_slice(&meta).ok()?;
    if meta.version != version {
        return None;
    }
    let role = match meta.role.as_str() {
        "setup" if meta.payload_bytes > 0 && meta.required_bytes > 0 => Role::Setup,
        "uninstall" if meta.payload_bytes == 0 && meta.required_bytes == 0 => Role::Uninstall,
        _ => return None,
    };
    let payload_offset = meta_start.checked_sub(meta.payload_bytes)?;
    Some(Overlay { role, payload_offset, payload_bytes: meta.payload_bytes, required_bytes: meta.required_bytes })
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    const EXE: &[u8] = b"MZ pretend this is the compiled shell";

    fn build(payload: &[u8], meta: &str) -> Vec<u8> {
        let mut file = EXE.to_vec();
        file.extend_from_slice(payload);
        file.extend_from_slice(meta.as_bytes());
        file.extend_from_slice(&(meta.len() as u32).to_le_bytes());
        file.extend_from_slice(MAGIC);
        file
    }

    fn setup_meta(payload_bytes: usize) -> String {
        format!(r#"{{"role":"setup","version":"1.2.3","payloadBytes":{payload_bytes},"requiredBytes":4096}}"#)
    }

    const UNINSTALL_META: &str = r#"{"role":"uninstall","version":"1.2.3","payloadBytes":0,"requiredBytes":0}"#;

    fn read_bytes(file: Vec<u8>) -> Option<Overlay> {
        read(&mut Cursor::new(file), "1.2.3")
    }

    #[test]
    fn reads_the_installer_overlay() {
        let payload = b"NSIS package bytes";
        let overlay = read_bytes(build(payload, &setup_meta(payload.len()))).unwrap();
        assert_eq!(
            overlay,
            Overlay {
                role: Role::Setup,
                payload_offset: EXE.len() as u64,
                payload_bytes: payload.len() as u64,
                required_bytes: 4096,
            }
        );
    }

    #[test]
    fn reads_the_uninstaller_overlay() {
        let overlay = read_bytes(build(b"", UNINSTALL_META)).unwrap();
        assert_eq!(overlay.role, Role::Uninstall);
        assert_eq!(overlay.payload_bytes, 0);
    }

    #[test]
    fn plain_exe_has_no_overlay() {
        assert_eq!(read_bytes(EXE.to_vec()), None);
        assert_eq!(read_bytes(Vec::new()), None);
    }

    #[test]
    fn rejects_a_wrong_magic() {
        let mut file = build(b"", UNINSTALL_META);
        let last = file.len() - 1;
        file[last] = b'x';
        assert_eq!(read_bytes(file), None);
    }

    #[test]
    fn rejects_a_meta_length_beyond_the_file_or_limit() {
        let mut file = build(b"", UNINSTALL_META);
        let at = file.len() - MAGIC.len() - 4;
        let beyond_file = file.len() as u32;
        file[at..at + 4].copy_from_slice(&beyond_file.to_le_bytes());
        assert_eq!(read_bytes(file.clone()), None);
        file[at..at + 4].copy_from_slice(&((MAX_META_BYTES + 1) as u32).to_le_bytes());
        assert_eq!(read_bytes(file), None);
    }

    #[test]
    fn rejects_truncated_or_invalid_meta() {
        assert_eq!(read_bytes(build(b"", &UNINSTALL_META[1..])), None);
        assert_eq!(read_bytes(build(b"", r#"{"role":"uninstall"}"#)), None);
        assert_eq!(read_bytes(build(b"", &UNINSTALL_META.replace("uninstall", "other"))), None);
    }

    #[test]
    fn rejects_another_version() {
        assert_eq!(read_bytes(build(b"", &UNINSTALL_META.replace("1.2.3", "1.2.4"))), None);
    }

    #[test]
    fn rejects_inconsistent_roles() {
        // A setup overlay without a package, an uninstaller with one.
        assert_eq!(read_bytes(build(b"", &setup_meta(0))), None);
        let meta = UNINSTALL_META.replace(r#""payloadBytes":0"#, r#""payloadBytes":3"#);
        assert_eq!(read_bytes(build(b"abc", &meta)), None);
    }

    #[test]
    fn rejects_a_payload_reaching_before_the_file_start() {
        let file = build(b"abc", &setup_meta(EXE.len() + 4));
        assert_eq!(read_bytes(file), None);
    }
}
