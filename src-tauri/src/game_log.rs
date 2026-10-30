//! The game's own log (`Player.log`), read for the sidecar's game-log proof: when
//! SLUI's address does not match the game connection, the plugin prints a one-time
//! challenge to the player's game console, the game client writes it to this file,
//! and only this PC can read it. Rust only reads complete lines from an offset; the
//! line format lives in the protocol package. Nothing read is stored or uploaded.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

/// At most this much per call; the next call continues from the returned offset.
const MAX_READ: u64 = 1 << 20;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct GameLogChunk {
    offset: u64,
    text: String,
}

/// Unity's default player log: `%USERPROFILE%\AppData\LocalLow\<company>\<product>\Player.log`.
/// A game started with `-logFile` writes elsewhere; the proof then fails like any other.
fn log_path() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    Some(PathBuf::from(profile).join("AppData").join("LocalLow").join("Northwood").join("SCPSL").join("Player.log"))
}

fn size_of(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Complete lines from `offset` on, and the offset to continue from. A file shorter
/// than `offset` was rewritten (the game restarted), so it is read from the start.
/// A missing file reads as empty.
fn read_from(path: &Path, offset: u64) -> GameLogChunk {
    let empty = |offset| GameLogChunk { offset, text: String::new() };
    let Ok(mut file) = File::open(path) else { return empty(0) };
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let start = if len < offset { 0 } else { offset };
    let end = len.min(start + MAX_READ);
    if end <= start || file.seek(SeekFrom::Start(start)).is_err() {
        return empty(start);
    }
    let mut buffer = Vec::with_capacity((end - start) as usize);
    if file.take(end - start).read_to_end(&mut buffer).is_err() {
        return empty(start);
    }
    // A partial last line is read again next time; a single line longer than a whole
    // chunk is skipped so the reader still moves on.
    let complete = buffer.iter().rposition(|&byte| byte == b'\n').map_or(0, |index| index + 1);
    let taken = if complete == 0 && buffer.len() as u64 == MAX_READ { buffer.len() } else { complete };
    GameLogChunk { offset: start + taken as u64, text: String::from_utf8_lossy(&buffer[..taken]).into_owned() }
}

/// Where the game log ends now (0 when there is none); a proof reads what follows.
#[tauri::command]
pub fn game_log_size() -> u64 {
    log_path().map_or(0, |path| size_of(&path))
}

#[tauri::command]
pub fn game_log_read(offset: u64) -> GameLogChunk {
    log_path().map_or(GameLogChunk { offset: 0, text: String::new() }, |path| read_from(&path, offset))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_log(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("slui-game-log-{name}-{}.log", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    fn append(path: &Path, text: &str) {
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn reads_complete_lines_and_keeps_a_partial_one_for_later() {
        let path = temp_log("partial");
        append(&path, "[FROM SERVER] first\r\n[FROM SERVER] sec");
        let chunk = read_from(&path, 0);
        assert_eq!(chunk.text, "[FROM SERVER] first\r\n");
        append(&path, "ond\n");
        let next = read_from(&path, chunk.offset);
        assert_eq!(next.text, "[FROM SERVER] second\n");
        assert_eq!(next.offset, size_of(&path));
        assert_eq!(read_from(&path, next.offset), GameLogChunk { offset: next.offset, text: String::new() });
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_rewritten_log_is_read_from_the_start() {
        let path = temp_log("rewritten");
        append(&path, "old session line that is long enough\n");
        let end = size_of(&path);
        std::fs::write(&path, "new\n").unwrap();
        assert_eq!(read_from(&path, end), GameLogChunk { offset: 4, text: "new\n".into() });
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_missing_log_reads_as_empty() {
        let path = temp_log("missing");
        assert_eq!(size_of(&path), 0);
        assert_eq!(read_from(&path, 42), GameLogChunk { offset: 0, text: String::new() });
    }
}
