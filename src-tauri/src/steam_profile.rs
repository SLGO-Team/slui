//! Persona name and avatar of a Steam account for the home window, read from the local
//! Steam client: `config/loginusers.vdf` (Steam writes it at sign-in; its account picker
//! shows these names) and `config/avatarcache/<SteamID64>.png` (Steam's own avatar cache).
//! No Web API key and no network request: steamcommunity.com is often unreachable.

use std::{
    fs, io,
    iter::Peekable,
    path::{Path, PathBuf},
    str::Chars,
};

use base64::Engine;

// Steam caches 184 px PNGs of about 50-70 KB; a file far above that is not an avatar.
const MAX_AVATAR_BYTES: u64 = 1024 * 1024;

#[derive(serde::Serialize, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SteamProfile {
    persona_name: Option<String>,
    /// `data:` URL, so the webview needs no file access.
    avatar_url: Option<String>,
}

#[tauri::command]
pub async fn get_steam_profile(steam_id: String) -> Result<SteamProfile, String> {
    let steam_id = parse_steam_id(&steam_id).ok_or("invalid SteamID")?;
    tauri::async_runtime::spawn_blocking(move || read_profile(steam_path().as_deref(), steam_id))
        .await
        .map_err(|error| error.to_string())
}

/// The file names are built from the parsed number, never from the caller's string.
fn parse_steam_id(text: &str) -> Option<u64> {
    (text.len() == 17 && text.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

fn read_profile(steam_root: Option<&Path>, steam_id: u64) -> SteamProfile {
    let Some(config) = steam_root.map(|root| root.join("config")) else {
        return SteamProfile::default();
    };
    let login_users = config.join("loginusers.vdf");
    let avatar = config.join("avatarcache").join(format!("{steam_id}.png"));
    SteamProfile {
        persona_name: read_optional(&login_users, |path| fs::read_to_string(path))
            .and_then(|text| persona_name(&text, steam_id)),
        avatar_url: read_optional(&avatar, read_avatar).flatten(),
    }
}

/// A missing file is a normal state (no sign-in on this PC yet, avatar not cached); any other
/// failure is logged and treated the same way.
fn read_optional<T>(path: &Path, read: impl FnOnce(&Path) -> io::Result<T>) -> Option<T> {
    match read(path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            eprintln!("SLGO: unable to read {}: {error}", path.display());
            None
        }
    }
}

fn read_avatar(path: &Path) -> io::Result<Option<String>> {
    if fs::metadata(path)?.len() > MAX_AVATAR_BYTES {
        return Ok(None);
    }
    let bytes = fs::read(path)?;
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else {
        return Ok(None);
    };
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{data}")))
}

fn persona_name(login_users: &str, steam_id: u64) -> Option<String> {
    let root = parse_vdf(login_users)?;
    let users = find(&root, "users")?.block()?;
    let user = find(users, &steam_id.to_string())?.block()?;
    let name = find(user, "PersonaName")?.text()?.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

// ---- Valve KeyValues text ----

#[derive(Debug, PartialEq)]
enum Node {
    Text(String),
    Block(Vec<(String, Node)>),
}

impl Node {
    fn text(&self) -> Option<&str> {
        match self {
            Node::Text(text) => Some(text),
            Node::Block(_) => None,
        }
    }

    fn block(&self) -> Option<&[(String, Node)]> {
        match self {
            Node::Block(pairs) => Some(pairs),
            Node::Text(_) => None,
        }
    }
}

/// Keys are case-insensitive, as in Valve's own reader.
fn find<'a>(pairs: &'a [(String, Node)], key: &str) -> Option<&'a Node> {
    pairs.iter().find(|(name, _)| name.eq_ignore_ascii_case(key)).map(|(_, node)| node)
}

#[derive(Debug, PartialEq)]
enum Token {
    Text(String),
    Open,
    Close,
}

/// `"key" "value"` pairs and `"key" { ... }` blocks; `//` comments, `[$PLATFORM]` conditionals
/// (skipped), unquoted tokens, and the `\" \\ \n \t` escapes Steam writes in quoted strings.
struct Lexer<'a> {
    chars: Peekable<Chars<'a>>,
}

impl Iterator for Lexer<'_> {
    type Item = Token;

    fn next(&mut self) -> Option<Token> {
        loop {
            match self.chars.next()? {
                ch if ch.is_whitespace() => {}
                '{' => return Some(Token::Open),
                '}' => return Some(Token::Close),
                '"' => return Some(Token::Text(self.quoted())),
                '[' => while self.chars.next().is_some_and(|ch| ch != ']') {},
                '/' if self.chars.peek() == Some(&'/') => while self.chars.next().is_some_and(|ch| ch != '\n') {},
                first => return Some(Token::Text(self.unquoted(first))),
            }
        }
    }
}

impl Lexer<'_> {
    fn quoted(&mut self) -> String {
        let mut text = String::new();
        while let Some(ch) = self.chars.next() {
            match ch {
                '"' => break,
                '\\' => match self.chars.next() {
                    Some('n') => text.push('\n'),
                    Some('t') => text.push('\t'),
                    Some(escaped @ ('\\' | '"')) => text.push(escaped),
                    Some(other) => text.extend(['\\', other]),
                    None => text.push('\\'),
                },
                _ => text.push(ch),
            }
        }
        text
    }

    fn unquoted(&mut self, first: char) -> String {
        let mut text = String::from(first);
        while let Some(&ch) = self.chars.peek() {
            if ch.is_whitespace() || matches!(ch, '"' | '{' | '}') {
                break;
            }
            text.push(ch);
            self.chars.next();
        }
        text
    }
}

fn parse_vdf(text: &str) -> Option<Vec<(String, Node)>> {
    parse_block(&mut Lexer { chars: text.chars().peekable() }, false)
}

/// `None` for unbalanced braces or a key without a value.
fn parse_block(lexer: &mut Lexer, nested: bool) -> Option<Vec<(String, Node)>> {
    let mut pairs = Vec::new();
    loop {
        match lexer.next() {
            None => return (!nested).then_some(pairs),
            Some(Token::Close) => return nested.then_some(pairs),
            Some(Token::Open) => return None,
            Some(Token::Text(key)) => {
                let value = match lexer.next()? {
                    Token::Text(value) => Node::Text(value),
                    Token::Open => Node::Block(parse_block(lexer, true)?),
                    Token::Close => return None,
                };
                pairs.push((key, value));
            }
        }
    }
}

// ---- Steam install directory ----

#[cfg(windows)]
fn steam_path() -> Option<PathBuf> {
    use std::{ffi::c_void, os::windows::ffi::OsStringExt};
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ},
    };

    let subkey: Vec<u16> = "Software\\Valve\\Steam\0".encode_utf16().collect();
    let value_name: Vec<u16> = "SteamPath\0".encode_utf16().collect();
    let query = |buffer: *mut c_void, size: &mut u32| unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer,
            size,
        )
    };
    let mut size = 0_u32;
    if query(std::ptr::null_mut(), &mut size) != ERROR_SUCCESS || size < 2 {
        return None;
    }
    let mut buffer = vec![0_u16; size as usize / 2];
    if query(buffer.as_mut_ptr().cast(), &mut size) != ERROR_SUCCESS {
        return None;
    }
    let len = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
    (len > 0).then(|| PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len])))
}

#[cfg(not(windows))]
fn steam_path() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOGIN_USERS: &str = r#""users"
{
	"76561198000000001"
	{
		"AccountName"		"nova_account"
		"PersonaName"		"Nova"
		"MostRecent"		"1"
	}
	// Comment lines and platform conditionals are skipped.
	"76561198000000002"
	{
		"AccountName"		"rook_account"	[$WIN32]
		"personaname"		"  深空 \"Rook\" \\ 观测  "
	}
	"76561198000000003"
	{
		"PersonaName"		""
	}
}
"#;

    #[test]
    fn reads_the_persona_name_of_the_requested_account() {
        assert_eq!(persona_name(LOGIN_USERS, 76561198000000001).as_deref(), Some("Nova"));
        assert_eq!(persona_name(LOGIN_USERS, 76561198000000002).as_deref(), Some(r#"深空 "Rook" \ 观测"#));
    }

    #[test]
    fn missing_or_empty_names_and_malformed_files_have_no_name() {
        assert_eq!(persona_name(LOGIN_USERS, 76561198000000003), None);
        assert_eq!(persona_name(LOGIN_USERS, 76561198000000009), None);
        assert_eq!(persona_name(r#""users" { "76561198000000001" { "PersonaName" "Nova" }"#, 76561198000000001), None);
        assert_eq!(persona_name(r#""users" { "76561198000000001" "PersonaName" }"#, 76561198000000001), None);
        assert_eq!(persona_name("", 76561198000000001), None);
    }

    #[test]
    fn lexes_unquoted_tokens_and_escapes() {
        let tokens: Vec<_> = Lexer { chars: r#"key value{"a\tb\q"}"#.chars().peekable() }.collect();
        assert_eq!(
            tokens,
            [
                Token::Text("key".into()),
                Token::Text("value".into()),
                Token::Open,
                Token::Text("a\tb\\q".into()),
                Token::Close,
            ]
        );
    }

    #[test]
    fn accepts_only_seventeen_digit_steam_ids() {
        assert_eq!(parse_steam_id("76561198000000001"), Some(76561198000000001));
        for bad in ["", "7656119800000000", "765611980000000012", "7656119800000000a", "../../../../windows", "+6561198000000001"] {
            assert_eq!(parse_steam_id(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn reads_name_and_avatar_from_the_steam_config_directory() {
        let root = std::env::temp_dir().join(format!("slui-steam-profile-{}", std::process::id()));
        let cache = root.join("config").join("avatarcache");
        fs::create_dir_all(&cache).unwrap();
        fs::write(root.join("config").join("loginusers.vdf"), LOGIN_USERS).unwrap();
        fs::write(cache.join("76561198000000001.png"), b"\x89PNG\r\n\x1a\nrest").unwrap();
        fs::write(cache.join("76561198000000002.png"), b"<html>not an image</html>").unwrap();

        assert_eq!(
            read_profile(Some(&root), 76561198000000001),
            SteamProfile {
                persona_name: Some("Nova".into()),
                avatar_url: Some("data:image/png;base64,iVBORw0KGgpyZXN0".into()),
            }
        );
        let rook = read_profile(Some(&root), 76561198000000002);
        assert_eq!(rook.avatar_url, None, "a file that is no image is not used");
        assert_eq!(read_profile(Some(&root), 76561198000000009), SteamProfile::default());
        assert_eq!(read_profile(Some(&root.join("missing")), 76561198000000001), SteamProfile::default());
        assert_eq!(read_profile(None, 76561198000000001), SteamProfile::default());
        fs::remove_dir_all(&root).unwrap();
    }

    // Reads this PC's Steam client for the given account:
    //     SLUI_STEAM_PROBE_ID=<SteamID64> cargo test -p slui -- --ignored probe_the_local
    #[test]
    #[ignore = "needs a signed-in Steam client and SLUI_STEAM_PROBE_ID"]
    fn probe_the_local_steam_client() {
        let steam_id = parse_steam_id(&std::env::var("SLUI_STEAM_PROBE_ID").expect("SLUI_STEAM_PROBE_ID")).unwrap();
        let root = steam_path().expect("SteamPath registry value");
        let profile = read_profile(Some(&root), steam_id);
        let avatar = profile.avatar_url.as_deref().map(|url| &url[..url.len().min(40)]);
        println!("{}: name {:?}, avatar {:?}", root.display(), profile.persona_name, avatar);
        assert!(profile.persona_name.is_some() && profile.avatar_url.is_some());
    }
}
