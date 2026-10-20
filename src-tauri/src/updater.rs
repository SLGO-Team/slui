//! Update check, background download and hand-over to the branded installer.
//!
//! Rust owns the update state: it outlives the hidden home window and drives the tray.
//! tauri-plugin-updater checks the control plane's manifest (`GET {url}/v0/update`) and
//! downloads the installer, verifying its minisign signature against the public key in
//! `tauri.conf.json` before any byte is returned. The verified `SLUI-Setup-X.Y.Z.exe` stays in
//! memory until the player installs it; it is then written to a fresh temp directory and
//! started with `--update --after-pid <pid>`, and SLUI exits. The installer waits for this
//! process, installs elevated and starts the new SLUI.
//!
//! Failures are quiet (fail-open): they show in the home window's version tile and the
//! next check retries. Nothing here ever blocks SLUI.

use std::{
    fs,
    hash::BuildHasher,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, Manager, Url, Wry,
};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Notify;

/// Emitted to every window whenever [`UpdateState`] changes.
pub const STATE_EVENT: &str = "slui://update-state";
/// Tray menu item id of 「更新到 X.Y.Z」.
pub const TRAY_ITEM_ID: &str = "install-update";

/// Must match `UPDATE_PATH` / `UPDATE_PLATFORM` in `@slgo/protocol`.
const UPDATE_PATH: &str = "/v0/update";
const UPDATE_PLATFORM: &str = "windows-x86_64";

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Spreads the players' checks (and downloads) over half an hour.
const MAX_JITTER_SECS: u64 = 30 * 60;
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// A download that stops receiving data for this long fails; a slow one keeps going.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

const TEMP_PREFIX: &str = "slui-update-";
const TEMP_SUFFIX_DIGITS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailReason {
    /// Unreachable endpoint, bad response or interrupted download.
    Network,
    /// The installer's signature does not match the built-in key or the announced version.
    Signature,
    /// The verified installer could not be written or started.
    Launch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Checking,
    Downloading { version: String, received: u64, total: Option<u64> },
    /// Downloaded and verified; one click installs it.
    Ready { version: String, notes: Option<String> },
    Installing { version: String },
    Failed { reason: FailReason },
}

/// What the home window renders and the overlay reads `required` from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    /// The running version.
    pub current: String,
    pub phase: Phase,
    /// The manifest's `min_version` while the running version is below it: SLUI must not
    /// connect. Unknown (`None`) until a check succeeds, so a failed check never blocks.
    pub required: Option<String>,
    /// Unix time in ms of the last finished check.
    pub last_checked: Option<u64>,
}

/// A verified installer held in memory.
struct Verified {
    version: String,
    bytes: Arc<Vec<u8>>,
}

/// The state machine; no I/O, so the transitions are unit-tested.
struct Machine {
    state: UpdateState,
    verified: Option<Verified>,
}

impl Machine {
    fn new(current: String) -> Machine {
        Machine {
            state: UpdateState { current, phase: Phase::Idle, required: None, last_checked: None },
            verified: None,
        }
    }

    /// Whether a check may start now; a ready update stays visible while it is re-checked.
    fn begin_check(&mut self) -> bool {
        match self.state.phase {
            Phase::Checking | Phase::Downloading { .. } | Phase::Installing { .. } => false,
            Phase::Ready { .. } => true,
            Phase::Idle | Phase::Failed { .. } => {
                self.state.phase = Phase::Checking;
                true
            }
        }
    }

    /// `204`, or a manifest that is not newer: the manifest's `min_version` is at most its
    /// `version`, so nothing is required either. A withdrawn update is dropped.
    fn no_update(&mut self, now: u64) {
        self.state.phase = Phase::Idle;
        self.state.required = None;
        self.state.last_checked = Some(now);
        self.verified = None;
    }

    /// A newer release; returns whether it still has to be downloaded.
    fn update_found(&mut self, version: &str, notes: Option<String>, min_version: Option<&str>, now: u64) -> bool {
        self.state.required = required_version(&self.state.current, min_version);
        self.state.last_checked = Some(now);
        if self.verified.as_ref().is_some_and(|verified| verified.version == version) {
            self.state.phase = Phase::Ready { version: version.to_owned(), notes };
            return false;
        }
        self.verified = None;
        self.state.phase = Phase::Downloading { version: version.to_owned(), received: 0, total: None };
        true
    }

    fn progress(&mut self, received: u64, total: Option<u64>) {
        if let Phase::Downloading { version, .. } = &self.state.phase {
            self.state.phase = Phase::Downloading { version: version.clone(), received, total };
        }
    }

    fn downloaded(&mut self, version: String, notes: Option<String>, bytes: Vec<u8>) {
        self.state.phase = Phase::Ready { version: version.clone(), notes };
        self.verified = Some(Verified { version, bytes: Arc::new(bytes) });
    }

    /// `required` keeps its last known value. A failed re-check of a ready update keeps it
    /// ready: the verified installer is still valid.
    fn check_failed(&mut self, reason: FailReason, now: u64) {
        self.state.last_checked = Some(now);
        if !matches!(self.state.phase, Phase::Ready { .. }) {
            self.state.phase = Phase::Failed { reason };
        }
    }

    /// Only a ready update installs; returns what to write.
    fn begin_install(&mut self) -> Option<(String, Arc<Vec<u8>>)> {
        let Phase::Ready { version, .. } = &self.state.phase else { return None };
        let verified = self.verified.as_ref().filter(|verified| &verified.version == version)?;
        let install = (verified.version.clone(), verified.bytes.clone());
        self.state.phase = Phase::Installing { version: install.0.clone() };
        Some(install)
    }

    /// The installer did not start; the verified bytes stay, so a retry check makes the
    /// same version ready again without downloading it.
    fn install_failed(&mut self) {
        self.state.phase = Phase::Failed { reason: FailReason::Launch };
    }
}

/// `min_version` when the running version is below it. A missing or malformed value
/// requires nothing (fail-open).
fn required_version(current: &str, min_version: Option<&str>) -> Option<String> {
    let min_version = min_version?;
    let (Ok(current), Ok(min)) = (semver::Version::parse(current), semver::Version::parse(min_version)) else {
        return None;
    };
    (current < min).then(|| min_version.to_owned())
}

pub fn installer_file_name(version: &str) -> String {
    format!("SLUI-Setup-{version}.exe")
}

/// Arguments of the branded installer's unattended update mode (`installer/src-tauri/src/main.rs`).
pub fn installer_args(pid: u32) -> [String; 3] {
    ["--update".into(), "--after-pid".into(), pid.to_string()]
}

fn temp_dir_name(random: u64) -> String {
    format!("{TEMP_PREFIX}{random:0width$x}", width = TEMP_SUFFIX_DIGITS)
}

/// Whether `name` is a directory this module created (`slui-update-<16 hex digits>`).
fn is_temp_dir_name(name: &str) -> bool {
    name.strip_prefix(TEMP_PREFIX)
        .is_some_and(|suffix| suffix.len() == TEMP_SUFFIX_DIGITS && suffix.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// The `file:` field of a `tauri signer sign` signature's trusted comment
/// (`timestamp:<n>\tfile:<name>`). minisign's global signature covers that comment, so once
/// the plugin has verified the download it proves which release the bytes are; the manifest's
/// `version` alone is unsigned and could pair a newer number with an older installer.
fn signed_file_name(signature: &str) -> Option<String> {
    let decoded = base64::engine::general_purpose::STANDARD.decode(signature.trim()).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let comment = text.lines().find_map(|line| line.strip_prefix("trusted comment: "))?;
    comment.split('\t').find_map(|field| field.strip_prefix("file:")).map(str::to_owned)
}

fn random_u64() -> u64 {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
    std::collections::hash_map::RandomState::new().hash_one(nanos)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Managed state: the machine, the wake-up for `updater_check_now` and whether the loop runs.
pub struct Updater {
    machine: Mutex<Machine>,
    wake: Notify,
    started: Mutex<bool>,
}

impl Updater {
    pub fn new(current: String) -> Updater {
        Updater { machine: Mutex::new(Machine::new(current)), wake: Notify::new(), started: Mutex::new(false) }
    }
}

/// 「更新到 X.Y.Z」, in the tray menu only while an update is ready.
pub struct TrayItem {
    menu: Menu<Wry>,
    item: MenuItem<Wry>,
    position: usize,
    shown: Mutex<bool>,
}

impl TrayItem {
    pub fn new(menu: Menu<Wry>, item: MenuItem<Wry>, position: usize) -> TrayItem {
        TrayItem { menu, item, position, shown: Mutex::new(false) }
    }

    fn sync(&self, phase: &Phase) {
        let Ok(mut shown) = self.shown.lock() else { return };
        let result = match phase {
            Phase::Ready { version, .. } => self.item.set_text(format!("更新到 {version}")).and_then(|()| {
                if *shown {
                    return Ok(());
                }
                self.menu.insert(&self.item, self.position).map(|()| *shown = true)
            }),
            _ if *shown => self.menu.remove(&self.item).map(|()| *shown = false),
            _ => Ok(()),
        };
        if let Err(error) = result {
            eprintln!("SLGO: update tray item: {error}");
        }
    }
}

/// Applies `change` and, when the state changed, tells the windows and the tray.
fn transition<T>(app: &AppHandle, change: impl FnOnce(&mut Machine) -> T) -> T {
    let updater = app.state::<Updater>();
    let mut machine = updater.machine.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let before = machine.state.clone();
    let result = change(&mut machine);
    let after = machine.state.clone();
    drop(machine);
    if after != before {
        if before.phase != after.phase {
            if let Some(tray) = app.try_state::<TrayItem>() {
                tray.sync(&after.phase);
            }
        }
        if let Err(error) = app.emit(STATE_EVENT, &after) {
            eprintln!("SLGO: failed to emit update state: {error}");
        }
    }
    result
}

fn state(app: &AppHandle) -> UpdateState {
    let updater = app.state::<Updater>();
    let machine = updater.machine.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    machine.state.clone()
}

fn update_endpoint(control_plane_url: &str) -> Result<Url, String> {
    let base = control_plane_url.trim().trim_end_matches('/');
    let url = Url::parse(&format!("{base}{UPDATE_PATH}")).map_err(|error| format!("Invalid control plane URL: {error}"))?;
    match url.scheme() {
        "https" | "http" => Ok(url),
        scheme => Err(format!("Unsupported control plane URL scheme {scheme}")),
    }
}

/// Starts the check loop against `{control_plane_url}/v0/update`. Called by the home window
/// on startup (never in mock mode); later calls only return the state.
#[tauri::command]
pub fn updater_start(app: AppHandle, control_plane_url: String) -> Result<UpdateState, String> {
    {
        let updater = app.state::<Updater>();
        let mut started = updater.started.lock().map_err(|_| "Update state unavailable")?;
        if *started {
            return Ok(state(&app));
        }
        let endpoint = update_endpoint(&control_plane_url)?;
        let plugin = app
            .updater_builder()
            .target(UPDATE_PLATFORM)
            .endpoints(vec![endpoint.clone()])
            .map_err(|error| format!("Update endpoint rejected: {error}"))?
            .timeout(CHECK_TIMEOUT)
            .configure_client(|client| client.connect_timeout(CONNECT_TIMEOUT).read_timeout(READ_TIMEOUT))
            .build()
            .map_err(|error| format!("Updater unavailable: {error}"))?;
        *started = true;
        eprintln!("SLGO: update checks against {endpoint}");
        let handle = app.clone();
        tauri::async_runtime::spawn(async move { run(handle, plugin).await });
    }
    Ok(state(&app))
}

/// Checks now (the version tile's retry); ignored while a check, download or install runs.
#[tauri::command]
pub fn updater_check_now(app: AppHandle) {
    let busy = matches!(
        state(&app).phase,
        Phase::Checking | Phase::Downloading { .. } | Phase::Installing { .. }
    );
    if !busy {
        app.state::<Updater>().wake.notify_one();
    }
}

#[tauri::command]
pub fn get_update_state(app: AppHandle) -> UpdateState {
    state(&app)
}

#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    install(app).await
}

/// The tray item's action; same path as the home window's button.
pub fn install_from_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = install(app).await {
            eprintln!("SLGO: update install: {error}");
        }
    });
}

async fn install(app: AppHandle) -> Result<(), String> {
    let (version, bytes) = transition(&app, Machine::begin_install).ok_or("No verified update is ready")?;
    let launch = tauri::async_runtime::spawn_blocking(move || launch_installer(&version, &bytes))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    match launch {
        Ok(path) => {
            eprintln!("SLGO: started {} --update; exiting", path.display());
            app.exit(0);
            Ok(())
        }
        Err(error) => {
            eprintln!("SLGO: update installer did not start: {error}");
            transition(&app, Machine::install_failed);
            Err(error)
        }
    }
}

/// Writes the verified installer to a new `%TEMP%\slui-update-<random>\` and starts it in
/// its unattended update mode, as the current user (the installer asks for elevation itself).
fn launch_installer(version: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir();
    let dir = (0..4)
        .map(|_| temp.join(temp_dir_name(random_u64())))
        .find(|dir| fs::create_dir(dir).is_ok())
        .ok_or_else(|| format!("Cannot create a directory in {}", temp.display()))?;
    let path = dir.join(installer_file_name(version));
    fs::write(&path, bytes).map_err(|error| format!("Cannot write {}: {error}", path.display()))?;
    // A working directory inside the install directory would keep NSIS from replacing it.
    Command::new(&path)
        .args(installer_args(std::process::id()))
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Cannot start {}: {error}", path.display()))?;
    Ok(path)
}

/// Best-effort removal of installers left by earlier updates. The installer of the update
/// that just finished may still be running and is skipped; the next start removes it.
pub fn remove_old_installers() {
    remove_old_installers_in(&std::env::temp_dir());
}

fn remove_old_installers_in(temp: &Path) {
    let Ok(entries) = fs::read_dir(temp) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_str().is_some_and(is_temp_dir_name) {
            continue;
        }
        // file_type() does not follow links: only real directories are removed.
        if !entry.file_type().is_ok_and(|kind| kind.is_dir() && !kind.is_symlink()) {
            continue;
        }
        if let Err(error) = fs::remove_dir_all(entry.path()) {
            eprintln!("SLGO: cannot remove {} yet: {error}", entry.path().display());
        }
    }
}

async fn run(app: AppHandle, plugin: tauri_plugin_updater::Updater) {
    let wake = &app.state::<Updater>().inner().wake;
    loop {
        check(&app, &plugin).await;
        let jitter = Duration::from_secs(random_u64() % (MAX_JITTER_SECS + 1));
        tokio::select! {
            () = tokio::time::sleep(CHECK_INTERVAL + jitter) => {}
            () = wake.notified() => {}
        }
    }
}

async fn check(app: &AppHandle, plugin: &tauri_plugin_updater::Updater) {
    if !transition(app, Machine::begin_check) {
        return;
    }
    let update = match plugin.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            transition(app, |machine| machine.no_update(now_ms()));
            return;
        }
        Err(error) => {
            eprintln!("SLGO: update check failed: {error}");
            transition(app, |machine| machine.check_failed(FailReason::Network, now_ms()));
            return;
        }
    };
    let min_version = update.raw_json.get("min_version").and_then(|value| value.as_str());
    let notes = update.body.clone();
    let download = transition(app, |machine| machine.update_found(&update.version, notes.clone(), min_version, now_ms()));
    if !download {
        return;
    }
    let expected = installer_file_name(&update.version);
    if signed_file_name(&update.signature).as_deref() != Some(expected.as_str()) {
        eprintln!("SLGO: update {} is not signed as {expected}", update.version);
        transition(app, |machine| machine.check_failed(FailReason::Signature, now_ms()));
        return;
    }
    eprintln!("SLGO: downloading update {}", update.version);
    let mut received = 0_u64;
    let mut last_report = Instant::now();
    let result = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if last_report.elapsed() >= PROGRESS_INTERVAL {
                    last_report = Instant::now();
                    transition(app, |machine| machine.progress(received, total));
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            eprintln!("SLGO: update {} verified ({} bytes)", update.version, bytes.len());
            transition(app, |machine| machine.downloaded(update.version.clone(), notes, bytes));
        }
        Err(error) => {
            let reason = fail_reason(&error);
            eprintln!("SLGO: update {} download failed ({reason:?}): {error}", update.version);
            transition(app, |machine| machine.check_failed(reason, now_ms()));
        }
    }
}

fn fail_reason(error: &tauri_plugin_updater::Error) -> FailReason {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => FailReason::Signature,
        _ => FailReason::Network,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(machine: &mut Machine, version: &str) {
        assert!(machine.begin_check());
        assert!(machine.update_found(version, None, None, 1));
        machine.downloaded(version.into(), None, vec![1, 2, 3]);
    }

    #[test]
    fn min_version_comes_from_the_raw_manifest() {
        assert_eq!(required_version("0.7.0", Some("0.8.0")), Some("0.8.0".into()));
        assert_eq!(required_version("0.7.0", Some("0.7.0")), None);
        assert_eq!(required_version("0.7.0", Some("0.6.9")), None);
        assert_eq!(required_version("0.7.0", Some("0.10.0")), Some("0.10.0".into()), "numeric, not lexical");
        assert_eq!(required_version("0.7.0", None), None);
        assert_eq!(required_version("0.7.0", Some("soon")), None, "malformed fails open");
        let raw = serde_json::json!({ "version": "0.9.0", "min_version": "0.8.0" });
        let min = raw.get("min_version").and_then(|value| value.as_str());
        assert_eq!(required_version("0.7.0", min), Some("0.8.0".into()));
    }

    #[test]
    fn a_new_release_downloads_then_becomes_ready() {
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_check());
        assert_eq!(machine.state.phase, Phase::Checking);
        assert!(machine.update_found("0.8.0", Some("notes".into()), None, 5));
        assert_eq!(machine.state.phase, Phase::Downloading { version: "0.8.0".into(), received: 0, total: None });
        assert_eq!(machine.state.last_checked, Some(5));
        machine.progress(10, Some(20));
        assert_eq!(machine.state.phase, Phase::Downloading { version: "0.8.0".into(), received: 10, total: Some(20) });
        machine.downloaded("0.8.0".into(), Some("notes".into()), vec![1]);
        assert_eq!(machine.state.phase, Phase::Ready { version: "0.8.0".into(), notes: Some("notes".into()) });
    }

    #[test]
    fn the_same_version_stays_ready_without_a_download() {
        let mut machine = Machine::new("0.7.0".into());
        ready(&mut machine, "0.8.0");
        assert!(machine.begin_check(), "a ready update is re-checked");
        assert!(matches!(machine.state.phase, Phase::Ready { .. }), "and stays visible meanwhile");
        assert!(!machine.update_found("0.8.0", None, None, 2));
        assert!(matches!(machine.state.phase, Phase::Ready { .. }));
        // A newer release replaces it.
        assert!(machine.update_found("0.9.0", None, None, 3));
        assert!(machine.verified.is_none());
    }

    #[test]
    fn failures_keep_required_and_a_ready_update() {
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_check());
        assert!(machine.update_found("0.9.0", None, Some("0.8.0"), 1));
        assert_eq!(machine.state.required.as_deref(), Some("0.8.0"));
        machine.check_failed(FailReason::Signature, 2);
        assert_eq!(machine.state.phase, Phase::Failed { reason: FailReason::Signature });
        assert_eq!(machine.state.required.as_deref(), Some("0.8.0"), "failure keeps required");
        assert!(machine.begin_check());
        machine.check_failed(FailReason::Network, 3);
        assert_eq!(machine.state.required.as_deref(), Some("0.8.0"));
        assert_eq!(machine.state.last_checked, Some(3));

        let mut machine = Machine::new("0.7.0".into());
        ready(&mut machine, "0.8.0");
        assert!(machine.begin_check());
        machine.check_failed(FailReason::Network, 4);
        assert!(matches!(machine.state.phase, Phase::Ready { .. }), "a failed re-check keeps the verified update");
    }

    #[test]
    fn no_update_clears_required_and_drops_a_withdrawn_update() {
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_check());
        assert!(machine.update_found("0.9.0", None, Some("0.8.0"), 1));
        machine.downloaded("0.9.0".into(), None, vec![1]);
        assert!(machine.begin_check());
        machine.no_update(2);
        assert_eq!(machine.state.phase, Phase::Idle);
        assert_eq!(machine.state.required, None);
        assert!(machine.verified.is_none());
        assert!(machine.begin_install().is_none());
    }

    #[test]
    fn only_a_ready_update_installs_and_a_failed_launch_can_retry() {
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_install().is_none());
        ready(&mut machine, "0.8.0");
        let (version, bytes) = machine.begin_install().expect("ready");
        assert_eq!((version.as_str(), bytes.as_slice()), ("0.8.0", [1, 2, 3].as_slice()));
        assert_eq!(machine.state.phase, Phase::Installing { version: "0.8.0".into() });
        assert!(machine.begin_install().is_none(), "one install at a time");
        assert!(!machine.begin_check(), "no checks while installing");
        machine.install_failed();
        assert_eq!(machine.state.phase, Phase::Failed { reason: FailReason::Launch });
        assert!(machine.begin_check());
        assert!(!machine.update_found("0.8.0", None, None, 2), "the verified bytes are reused");
        assert!(machine.begin_install().is_some());
    }

    #[test]
    fn busy_phases_refuse_a_second_check() {
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_check());
        assert!(!machine.begin_check());
        assert!(machine.update_found("0.8.0", None, None, 1));
        assert!(!machine.begin_check());
    }

    #[test]
    fn state_serializes_for_the_frontend() {
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_check());
        assert!(machine.update_found("0.8.0", None, Some("0.8.0"), 7));
        machine.progress(5, Some(9));
        assert_eq!(
            serde_json::to_value(&machine.state).unwrap(),
            serde_json::json!({
                "current": "0.7.0",
                "phase": { "kind": "downloading", "version": "0.8.0", "received": 5, "total": 9 },
                "required": "0.8.0",
                "lastChecked": 7,
            })
        );
        machine.check_failed(FailReason::Network, 8);
        assert_eq!(
            serde_json::to_value(&machine.state.phase).unwrap(),
            serde_json::json!({ "kind": "failed", "reason": "network" })
        );
        assert_eq!(serde_json::to_value(Phase::Idle).unwrap(), serde_json::json!({ "kind": "idle" }));
    }

    #[test]
    fn temp_directories_and_installer_names() {
        assert_eq!(temp_dir_name(0xab), "slui-update-00000000000000ab");
        assert!(is_temp_dir_name(&temp_dir_name(u64::MAX)));
        assert!(is_temp_dir_name(&temp_dir_name(random_u64())));
        assert!(!is_temp_dir_name("slui-update-"));
        assert!(!is_temp_dir_name("slui-update-00000000000000abc"));
        assert!(!is_temp_dir_name("slui-update-00000000000000xy"));
        assert!(!is_temp_dir_name("slui-setup-1234"));
        assert_eq!(installer_file_name("0.8.0"), "SLUI-Setup-0.8.0.exe");
    }

    #[test]
    fn old_installer_directories_are_removed_and_nothing_else() {
        let temp = std::env::temp_dir().join(format!("slui-updater-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        let old = temp.join(temp_dir_name(1));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join(installer_file_name("0.8.0")), b"exe").unwrap();
        let other = temp.join("slui-update-notes");
        fs::create_dir_all(&other).unwrap();
        let file = temp.join(temp_dir_name(2));
        fs::write(&file, b"not a directory").unwrap();
        remove_old_installers_in(&temp);
        assert!(!old.exists());
        assert!(other.exists());
        assert!(file.exists());
        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn the_installer_starts_in_its_update_mode_after_this_process() {
        assert_eq!(installer_args(4242), ["--update", "--after-pid", "4242"]);
    }

    #[test]
    fn the_signed_file_name_comes_from_the_trusted_comment() {
        // `tauri signer sign SLUI-Setup-0.8.0.exe` output shape.
        let text = "untrusted comment: signature from tauri secret key\nRUT=\ntrusted comment: timestamp:1792406090\tfile:SLUI-Setup-0.8.0.exe\nAAAA==\n";
        let signature = base64::engine::general_purpose::STANDARD.encode(text);
        assert_eq!(signed_file_name(&signature).as_deref(), Some("SLUI-Setup-0.8.0.exe"));
        let unnamed = base64::engine::general_purpose::STANDARD.encode("trusted comment: timestamp:1\n");
        assert_eq!(signed_file_name(&unnamed), None);
        assert_eq!(signed_file_name("not base64"), None);
    }

    #[test]
    fn the_endpoint_is_the_control_plane_update_path() {
        assert_eq!(update_endpoint("https://cp.example.test").unwrap().as_str(), "https://cp.example.test/v0/update");
        assert_eq!(update_endpoint("https://cp.example.test/").unwrap().as_str(), "https://cp.example.test/v0/update");
        assert_eq!(update_endpoint("http://127.0.0.1:7800").unwrap().as_str(), "http://127.0.0.1:7800/v0/update");
        assert!(update_endpoint("ftp://cp.example.test").is_err());
        assert!(update_endpoint("not a url").is_err());
    }
}
