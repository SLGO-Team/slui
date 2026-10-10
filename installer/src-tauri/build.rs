//! The NSIS package is not embedded at compile time: `scripts/build-installer.mjs`
//! appends it, with the installer/uninstaller role, to the compiled exe (see
//! `src/overlay.rs`), so one release build serves as both exes.

fn main() {
    println!("cargo:rerun-if-changed=app.manifest");
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
