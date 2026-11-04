include!("app-commands.rs");

fn main() {
    println!("cargo:rerun-if-changed=app-commands.rs");
    let manifest = tauri_build::AppManifest::new().commands(APP_COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
