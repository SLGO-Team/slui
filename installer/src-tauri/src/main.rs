// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use slui_setup_lib::{
    payload::Session,
    uninstall::{self, Launch},
    webview2, Role,
};

fn main() {
    let code = match slui_setup_lib::role() {
        Some(Role::Setup) => setup(),
        Some(Role::Uninstall) => uninstaller(),
        None => {
            webview2::message_box("此安装程序文件不完整，请重新下载 SLUI 安装程序。");
            1
        }
    };
    std::process::exit(code);
}

fn setup() -> i32 {
    let session = Session::create();
    let command_line = uninstall::own_command_line();
    if let Some(args) = slui_setup_lib::silent_install_args(uninstall::command_line_args(&command_line)) {
        let installed = slui_setup_lib::detect::read_installed().map(|installed| installed.dir);
        let args = slui_setup_lib::silent_install_command(args, installed.as_deref());
        let code = slui_setup_lib::install::install_silently(&session, &args);
        session.cleanup_after_exit();
        return code;
    }
    if webview2::classic_required() {
        // The classic wizard keeps running from the session directory after this
        // process exits; the next run removes the directory.
        return webview2::run_classic(&session);
    }
    let unattended = slui_setup_lib::parse_unattended(std::env::args().skip(1));
    let code = slui_setup_lib::run(Role::Setup, session.clone(), false, unattended);
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
    let code = slui_setup_lib::run(Role::Uninstall, session.clone(), relocated, None);
    session.cleanup_after_exit();
    code
}
