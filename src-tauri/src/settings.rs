//! Local settings file storage. The frontend owns the schema and normalization;
//! this module only guarantees a readable JSON object on disk and atomic writes.

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SETTINGS_FILE: &str = "settings.json";
const MAX_SETTINGS_BYTES: usize = 64 * 1024;

fn settings_path(dir: &Path) -> PathBuf {
    dir.join(SETTINGS_FILE)
}

fn is_json_object(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok_and(|value| value.is_object())
}

// Keep an unreadable file for diagnosis instead of silently overwriting it.
fn quarantine(path: &Path) {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    let backup = path.with_file_name(format!("{SETTINGS_FILE}.bad-{stamp}"));
    if let Err(error) = fs::rename(path, &backup) {
        eprintln!("SLGO: unable to back up unreadable settings: {error}");
    }
}

/// Returns `None` when the file is missing or unreadable (after backing it up).
pub fn load(dir: &Path) -> Result<Option<String>, String> {
    let path = settings_path(dir);
    match fs::read_to_string(&path) {
        Ok(text) if text.len() <= MAX_SETTINGS_BYTES && is_json_object(&text) => Ok(Some(text)),
        Ok(_) => {
            quarantine(&path);
            Ok(None)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) if error.kind() == ErrorKind::InvalidData => {
            quarantine(&path);
            Ok(None)
        }
        Err(error) => Err(format!("Unable to read settings: {error}")),
    }
}

/// Writes through a temporary file so a crash never leaves a half-written settings file.
pub fn save(dir: &Path, contents: &str) -> Result<(), String> {
    if contents.len() > MAX_SETTINGS_BYTES || !is_json_object(contents) {
        return Err("Settings must be a JSON object".into());
    }
    fs::create_dir_all(dir).map_err(|error| format!("Unable to create settings directory: {error}"))?;
    let path = settings_path(dir);
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents).map_err(|error| format!("Unable to write settings: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Unable to replace settings: {error}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("slui-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn backups(dir: &Path) -> usize {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_name().to_string_lossy().starts_with("settings.json.bad-"))
                    .count()
            })
            .unwrap_or_default()
    }

    #[test]
    fn missing_file_loads_as_none() {
        let dir = scratch_dir("missing");
        assert_eq!(load(&dir), Ok(None));
    }

    #[test]
    fn save_then_load_round_trips_and_replaces() {
        let dir = scratch_dir("round-trip");
        save(&dir, r#"{"version":1,"radar":{"hudScale":1.1}}"#).unwrap();
        save(&dir, r#"{"version":1,"radar":{"hudScale":1.2}}"#).unwrap();
        assert_eq!(load(&dir), Ok(Some(r#"{"version":1,"radar":{"hudScale":1.2}}"#.into())));
        assert!(!dir.join("settings.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_rejects_non_objects() {
        let dir = scratch_dir("reject");
        assert!(save(&dir, "[1,2]").is_err());
        assert!(save(&dir, "{").is_err());
        assert!(save(&dir, &format!(r#"{{"pad":"{}"}}"#, "x".repeat(MAX_SETTINGS_BYTES))).is_err());
        assert_eq!(load(&dir), Ok(None));
    }

    #[test]
    fn corrupt_file_is_backed_up_and_loads_as_none() {
        let dir = scratch_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(settings_path(&dir), "{not json").unwrap();
        assert_eq!(load(&dir), Ok(None));
        assert!(!settings_path(&dir).exists());
        assert_eq!(backups(&dir), 1);

        fs::write(settings_path(&dir), [0xff_u8, 0xfe, 0x00]).unwrap();
        assert_eq!(load(&dir), Ok(None));
        let _ = fs::remove_dir_all(&dir);
    }
}
