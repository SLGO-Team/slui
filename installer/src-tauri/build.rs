//! Payload embedding. `scripts/build-installer.mjs` builds the SLUI NSIS package and
//! passes it in through the environment:
//!
//! - `SLUI_SETUP_PAYLOAD`: absolute path of `SLUI_<version>_x64-setup.exe`
//! - `SLUI_SETUP_VERSION`: the SLUI version inside that package
//! - `SLUI_SETUP_REQUIRED_BYTES`: disk space the installed app needs
//!
//! The package is embedded as the Win32 resource `SLUI_PAYLOAD` (RCDATA) through the
//! resource script tauri-build compiles, not with `include_bytes!`: a ~100 MB byte
//! constant makes LLVM run out of memory in release builds. `payload.rs` reads it back
//! with FindResourceW and checks its size against `SLUI_SETUP_PAYLOAD_BYTES`.
//!
//! Without a payload, debug builds (UI development) compile with
//! `cfg(slui_setup_no_payload)` and installing returns a `no_payload` failure;
//! release builds refuse to compile.

use std::{env, fs, path::PathBuf};

/// Placeholder disk requirement for payload-less UI development builds.
const DEV_REQUIRED_BYTES: u64 = 128 * 1024 * 1024;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(slui_setup_no_payload)");
    for name in ["SLUI_SETUP_PAYLOAD", "SLUI_SETUP_VERSION", "SLUI_SETUP_REQUIRED_BYTES"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-changed=app.manifest");

    let payload = env::var("SLUI_SETUP_PAYLOAD").ok().filter(|path| !path.trim().is_empty());
    let mut windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    match payload {
        Some(path) => windows = windows.append_rc_content(embed_payload(PathBuf::from(path))),
        None => no_payload(),
    }

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}

/// Validates the payload and returns the resource script line that embeds it.
fn embed_payload(path: PathBuf) -> String {
    let version = env::var("SLUI_SETUP_VERSION")
        .ok()
        .filter(|version| !version.trim().is_empty())
        .unwrap_or_else(|| fail("SLUI_SETUP_PAYLOAD is set but SLUI_SETUP_VERSION is not"));
    let required: u64 = env::var("SLUI_SETUP_REQUIRED_BYTES")
        .ok()
        .and_then(|bytes| bytes.trim().parse().ok())
        .filter(|bytes| *bytes > 0)
        .unwrap_or_else(|| fail("SLUI_SETUP_REQUIRED_BYTES must be a positive byte count"));
    let path = fs::canonicalize(&path)
        .unwrap_or_else(|error| fail(&format!("payload {} not found: {error}", path.display())));
    if !path.is_file() {
        fail(&format!("payload {} is not a file", path.display()));
    }
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    if !file_name.contains(&format!("_{version}_")) {
        fail(&format!(
            "payload {file_name} does not match SLUI_SETUP_VERSION {version}; rebuild with npm run installer:build:local"
        ));
    }
    println!("cargo:rerun-if-changed={}", path.display());
    let bytes = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
    if bytes == 0 {
        fail(&format!("payload {} is empty", path.display()));
    }
    println!("cargo:rustc-env=SLUI_SETUP_VERSION={version}");
    println!("cargo:rustc-env=SLUI_SETUP_REQUIRED_BYTES={required}");
    println!("cargo:rustc-env=SLUI_SETUP_PAYLOAD_BYTES={bytes}");
    // rc.exe needs a plain path (canonicalize() returns \\?\...) with escaped backslashes.
    let plain = path.display().to_string();
    let plain = plain.strip_prefix(r"\\?\").unwrap_or(&plain);
    if plain.contains('"') {
        fail("payload path must not contain quotes");
    }
    format!("SLUI_PAYLOAD RCDATA \"{}\"", plain.replace('\\', "\\\\"))
}

fn no_payload() {
    if env::var("PROFILE").as_deref() == Ok("release") {
        fail("release builds must embed the SLUI NSIS package; run `npm run installer:build:local` (or `npm run installer:build`) instead of building installer/ directly");
    }
    // UI development: show the version of the SLUI app in this checkout.
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let config = manifest_dir.join("../../src-tauri/tauri.conf.json");
    println!("cargo:rerun-if-changed={}", config.display());
    let text = fs::read_to_string(&config)
        .unwrap_or_else(|error| fail(&format!("cannot read {}: {error}", config.display())));
    let json: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| fail(&format!("cannot parse {}: {error}", config.display())));
    let version = json["version"]
        .as_str()
        .unwrap_or_else(|| fail("src-tauri/tauri.conf.json has no version"));
    println!("cargo:rustc-cfg=slui_setup_no_payload");
    println!("cargo:rustc-env=SLUI_SETUP_VERSION={version}");
    println!("cargo:rustc-env=SLUI_SETUP_REQUIRED_BYTES={DEV_REQUIRED_BYTES}");
    println!("cargo:rustc-env=SLUI_SETUP_PAYLOAD_BYTES=0");
}

fn fail(message: &str) -> ! {
    eprintln!("slui-setup build: {message}");
    panic!("slui-setup build: {message}");
}
