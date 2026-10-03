//! Optional theme pack: a `theme-pack/` directory installed next to the app whose
//! fonts and sounds override the bundled defaults file by file. The pack is never
//! part of the repository; the webview reads it through the `theme` URI scheme.

use std::{
    borrow::Cow,
    fs,
    path::{Component, Path, PathBuf},
};

use tauri::{
    http::{header, Request, Response, StatusCode},
    AppHandle, Manager, Runtime, UriSchemeContext,
};

pub const SCHEME: &str = "theme";
const PACK_DIR: &str = "theme-pack";
// The pack is a flat `fonts/` + `sounds/` layout; deeper trees are ignored.
const MAX_DEPTH: usize = 2;

fn pack_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let installed = app.path().resource_dir().ok().map(|dir| dir.join(PACK_DIR));
    if installed.as_deref().is_some_and(Path::is_dir) {
        return installed;
    }
    // `tauri dev` runs from target/debug, so development reads the repo-local pack.
    if cfg!(debug_assertions) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(PACK_DIR);
        if repo.is_dir() {
            return Some(repo);
        }
    }
    None
}

/// Maps a URL path such as `/fonts/a.otf` to a file inside `root`, rejecting
/// anything that could leave the pack directory.
fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let relative = Path::new(url_path.trim_start_matches('/'));
    if relative.as_os_str().is_empty() || url_path.contains(['%', '\\', ':']) {
        return None;
    }
    if !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return None;
    }
    let file = fs::canonicalize(root.join(relative)).ok()?;
    let root = fs::canonicalize(root).ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("otf") => "font/otf",
        Some("ttf") => "font/ttf",
        Some("woff2") => "font/woff2",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn response(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        // Fonts are fetched in CORS mode from the app origin.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Cow::Owned(body))
        .expect("static response parts are valid")
}

pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let file = pack_root(ctx.app_handle()).and_then(|root| resolve(&root, request.uri().path()));
    match file.map(|path| fs::read(&path).map(|body| (content_type(&path), body))) {
        Some(Ok((mime, body))) => response(StatusCode::OK, mime, body),
        _ => response(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

fn collect(root: &Path, dir: &Path, depth: usize, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && depth < MAX_DEPTH {
            collect(root, &path, depth + 1, files);
        } else if kind.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                let parts: Vec<_> = relative.components().filter_map(|part| part.as_os_str().to_str()).collect();
                files.push(parts.join("/"));
            }
        }
    }
}

fn list_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect(root, root, 1, &mut files);
    files.sort();
    files
}

#[tauri::command]
pub fn list_theme_pack_files(app: AppHandle) -> Vec<String> {
    pack_root(&app).map(|root| list_files(&root)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each test owns its directory because the harness runs tests in parallel.
    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slui-theme-pack-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("fonts/nested/deeper")).unwrap();
        fs::create_dir_all(root.join("sounds")).unwrap();
        fs::write(root.join("fonts/a.otf"), b"font").unwrap();
        fs::write(root.join("fonts/nested/deeper/too-deep.otf"), b"font").unwrap();
        fs::write(root.join("sounds/b.wav"), b"wav").unwrap();
        fs::write(root.parent().unwrap().join("slui-theme-pack-outside.txt"), b"secret").unwrap();
        root
    }

    #[test]
    fn resolves_files_inside_the_pack_only() {
        let root = fixture("resolve");
        assert!(resolve(&root, "/fonts/a.otf").is_some());
        assert!(resolve(&root, "/sounds/b.wav").is_some());
        for hostile in [
            "/",
            "/fonts",
            "/missing.otf",
            "/../slui-theme-pack-outside.txt",
            "/fonts/../../slui-theme-pack-outside.txt",
            "/fonts/%2e%2e/a.otf",
            "/fonts\\a.otf",
            "/C:/Windows/win.ini",
        ] {
            assert!(resolve(&root, hostile).is_none(), "{hostile}");
        }
    }

    #[test]
    fn lists_relative_paths_with_forward_slashes() {
        let root = fixture("list");
        assert_eq!(list_files(&root), ["fonts/a.otf", "sounds/b.wav"]);
        assert!(list_files(&root.join("missing")).is_empty());
    }

    #[test]
    fn maps_pack_media_types() {
        assert_eq!(content_type(Path::new("x.OTF")), "font/otf");
        assert_eq!(content_type(Path::new("x.wav")), "audio/wav");
        assert_eq!(content_type(Path::new("x")), "application/octet-stream");
    }
}
