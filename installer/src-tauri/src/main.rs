// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use slui_setup_lib::{payload::Session, webview2};

fn main() {
    let session = Session::create();
    if webview2::classic_required() {
        // The classic wizard keeps running from the session directory after this
        // process exits; the next run removes the directory.
        std::process::exit(webview2::run_classic(&session));
    }
    let code = slui_setup_lib::run(session.clone());
    session.cleanup_after_exit();
    std::process::exit(code);
}
