// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use slui_setup_lib::{
    payload::Session,
    uninstall::{self, Launch},
    webview2, Role, ROLE,
};

fn main() {
    let code = match ROLE {
        Role::Setup => setup(),
        Role::Uninstall => uninstaller(),
    };
    std::process::exit(code);
}

fn setup() -> i32 {
    let session = Session::create();
    if webview2::classic_required() {
        // The classic wizard keeps running from the session directory after this
        // process exits; the next run removes the directory.
        return webview2::run_classic(&session);
    }
    let code = slui_setup_lib::run(session.clone(), false);
    session.cleanup_after_exit();
    code
}

fn uninstaller() -> i32 {
    let command_line = uninstall::own_command_line();
    let launch = uninstall::classify_launch(uninstall::command_line_args(&command_line));
    if let Launch::Forward(args) = launch {
        return uninstall::forward(args);
    }
    if webview2::classic_required() {
        return uninstall::run_classic();
    }
    let relocated = launch == Launch::Relocated;
    let session = Session::create();
    if !relocated && uninstall::running_from_install_dir() {
        // The session directory is not cleaned up: the copy runs from it.
        return match uninstall::relocate(&session) {
            Ok(()) => 0,
            Err(error) => {
                webview2::message_box(&format!("无法启动 SLUI 卸载程序：{error}"));
                1
            }
        };
    }
    let code = slui_setup_lib::run(session.clone(), relocated);
    session.cleanup_after_exit();
    code
}
