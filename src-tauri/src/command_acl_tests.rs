// Keeps the command manifest (app-commands.rs), the invoke handler (lib.rs) and the window
// capabilities (capabilities/*.json) in step. A command missing from the manifest or from every
// capability fails closed at runtime ("not allowed by ACL"); these tests make that a build error
// and pin which window may call the privileged commands.

use std::collections::{BTreeMap, BTreeSet};

include!("../app-commands.rs");

const CAPABILITIES: [&str; 3] = [
    include_str!("../capabilities/shared.json"),
    include_str!("../capabilities/home.json"),
    include_str!("../capabilities/overlay.json"),
];

// Only home may relaunch elevated, update, save settings or open the log folder.
const HOME_ONLY: [&str; 6] = [
    "relaunch_elevated",
    "updater_start",
    "updater_check_now",
    "updater_install",
    "save_settings",
    "reveal_log_file",
];

fn handler_commands() -> BTreeSet<String> {
    let source = include_str!("lib.rs");
    let start = source
        .find("tauri::generate_handler![")
        .expect("lib.rs registers its commands with generate_handler!");
    let body = &source[start + "tauri::generate_handler![".len()..];
    let body = &body[..body.find(']').expect("generate_handler! is closed")];
    body.split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.rsplit("::").next().unwrap().to_owned())
        .collect()
}

/// Window label -> app commands its capabilities allow.
fn granted() -> BTreeMap<String, BTreeSet<String>> {
    let mut granted: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for text in CAPABILITIES {
        let capability: serde_json::Value = serde_json::from_str(text).unwrap();
        let commands: Vec<String> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|permission| permission.as_str())
            .filter_map(|permission| permission.strip_prefix("allow-"))
            .map(|command| command.replace('-', "_"))
            .collect();
        for window in capability["windows"].as_array().unwrap() {
            granted
                .entry(window.as_str().unwrap().to_owned())
                .or_default()
                .extend(commands.iter().cloned());
        }
    }
    granted
}

#[test]
fn the_manifest_lists_exactly_the_registered_commands() {
    let manifest: BTreeSet<String> = APP_COMMANDS.iter().map(|&command| command.to_owned()).collect();
    assert_eq!(manifest.len(), APP_COMMANDS.len(), "no duplicates");
    assert_eq!(manifest, handler_commands());
}

#[test]
fn every_command_is_granted_to_a_window_and_privileged_ones_to_home_only() {
    let granted = granted();
    assert_eq!(
        granted.keys().map(String::as_str).collect::<Vec<_>>(),
        ["home", "overlay"]
    );
    for command in APP_COMMANDS {
        assert!(
            granted.values().any(|commands| commands.contains(*command)),
            "{command} is granted to no window"
        );
    }
    for command in granted.values().flatten() {
        assert!(APP_COMMANDS.contains(&command.as_str()), "{command} is not a command");
    }
    for command in HOME_ONLY {
        assert!(granted["home"].contains(command), "home needs {command}");
        assert!(!granted["overlay"].contains(command), "the overlay must not get {command}");
    }
}
