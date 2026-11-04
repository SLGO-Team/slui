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
//! The manifest address is fixed by the build: `controlPlaneUrl` of the embedded
//! `slui-build.json`, which the Vite build that produced this frontend writes from
//! VITE_CONTROL_PLANE_URL (scripts/vite-build-info.mjs). `tauri dev` embeds no frontend and reads
//! `dist/` instead, so it checks whatever the last `vite build` was built for.
//!
//! Failures are quiet (fail-open): they show in the home window's version tile and the
//! next check retries. Nothing here ever blocks SLUI. A newer release that fails to download or
//! verify leaves an already verified older one installable.

use std::{
    fs,
    hash::BuildHasher,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
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
/// The whole installer is held in memory until its signature is checked; a download past this
/// size (the installer is about 30 MB) is aborted rather than read to the end.
const MAX_INSTALLER_BYTES: u64 = 150 * 1024 * 1024;

/// Written by the Vite build next to index.html and embedded with it (scripts/vite-build-info.mjs).
const BUILD_INFO_FILE: &str = "slui-build.json";

const TEMP_PREFIX: &str = "slui-update-";
const TEMP_SUFFIX_DIGITS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailReason {
    /// Unreachable endpoint, bad response or interrupted download.
    Network,
    /// The installer's signature does not match the built-in key or the announced version, or
    /// the download is larger than any installer (MAX_INSTALLER_BYTES).
    Signature,
    /// The verified installer could not be written or started.
    Launch,
    /// Update checks could not start: this build has no valid control-plane address.
    Unavailable,
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
    notes: Option<String>,
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

    /// Whether the installer is being started. A re-check of a ready update runs alongside
    /// the install button, so its result can arrive after the click; it must then change
    /// nothing, or it would re-enable the button (a second installer) or hide a failed launch.
    fn installing(&self) -> bool {
        matches!(self.state.phase, Phase::Installing { .. })
    }

    /// `204`, or a manifest that is not newer: the manifest's `min_version` is at most its
    /// `version`, so nothing is required either. A withdrawn update is dropped.
    fn no_update(&mut self, now: u64) {
        if self.installing() {
            return;
        }
        self.state.phase = Phase::Idle;
        self.state.required = None;
        self.state.last_checked = Some(now);
        self.verified = None;
    }

    /// A newer release; returns whether it still has to be downloaded. An older verified
    /// installer stays until the new one is verified, so a failed download can fall back to it;
    /// one at least as new as the announced release was withdrawn and is dropped.
    fn update_found(&mut self, version: &str, notes: Option<String>, min_version: Option<&str>, now: u64) -> bool {
        if self.installing() {
            return false;
        }
        self.state.required = required_version(&self.state.current, min_version);
        self.state.last_checked = Some(now);
        if self.verified.as_ref().is_some_and(|verified| verified.version == version) {
            self.state.phase = Phase::Ready { version: version.to_owned(), notes };
            return false;
        }
        if self.verified.as_ref().is_some_and(|verified| !is_older(&verified.version, version)) {
            self.verified = None;
        }
        self.state.phase = Phase::Downloading { version: version.to_owned(), received: 0, total: None };
        true
    }

    fn progress(&mut self, received: u64, total: Option<u64>) {
        if let Phase::Downloading { version, .. } = &self.state.phase {
            self.state.phase = Phase::Downloading { version: version.clone(), received, total };
        }
    }

    fn downloaded(&mut self, version: String, notes: Option<String>, bytes: Vec<u8>) {
        self.state.phase = Phase::Ready { version: version.clone(), notes: notes.clone() };
        self.verified = Some(Verified { version, notes, bytes: Arc::new(bytes) });
    }

    /// `required` keeps its last known value. A verified installer stays installable: a failed
    /// re-check keeps it ready, and a newer release that fails to download falls back to it.
    fn check_failed(&mut self, reason: FailReason, now: u64) {
        if self.installing() {
            return;
        }
        self.state.last_checked = Some(now);
        if matches!(self.state.phase, Phase::Ready { .. }) {
            return;
        }
        self.state.phase = match &self.verified {
            Some(verified) => Phase::Ready { version: verified.version.clone(), notes: verified.notes.clone() },
            None => Phase::Failed { reason },
        };
    }

    /// The check loop could not start (see `updater_start`).
    fn unavailable(&mut self) {
        if !self.installing() {
            self.state.phase = Phase::Failed { reason: FailReason::Unavailable };
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

    /// The installer did not start. The failure shows (a ready button would hide it); the
    /// verified bytes stay, so the retry check makes the same version ready again without
    /// downloading it, or falls back to it when that check fails.
    fn install_failed(&mut self) {
        self.state.phase = Phase::Failed { reason: FailReason::Launch };
    }
}

/// Whether `version` is a lower release than `than`; unparsable versions are never older.
fn is_older(version: &str, than: &str) -> bool {
    matches!(
        (semver::Version::parse(version), semver::Version::parse(than)),
        (Ok(version), Ok(than)) if version < than
    )
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
///
/// The comment is read only where minisign-verify's `Signature::decode` reads it: the third
/// line. The first line is the untrusted comment, outside the signature and never checked for
/// its prefix, so a `trusted comment: ` there would let an old signed installer claim any name.
fn signed_file_name(signature: &str) -> Option<String> {
    let decoded = base64::engine::general_purpose::STANDARD.decode(signature.trim()).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let comment = text.lines().nth(2)?.strip_prefix("trusted comment: ")?;
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
            diag!("SLGO: update tray item: {error}");
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
            diag!("SLGO: failed to emit update state: {error}");
        }
    }
    result
}

fn state(app: &AppHandle) -> UpdateState {
    let updater = app.state::<Updater>();
    let machine = updater.machine.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    machine.state.clone()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    control_plane_url: String,
}

/// `controlPlaneUrl` of slui-build.json. A missing file resolves to index.html, which fails here too.
fn parse_build_info(bytes: &[u8]) -> Result<String, String> {
    serde_json::from_slice::<BuildInfo>(bytes)
        .map(|info| info.control_plane_url)
        .map_err(|error| format!("{BUILD_INFO_FILE} is missing or unreadable: {error}"))
}

/// `{control_plane_url}/v0/update`, under the client's own rule (src/platform/backend.ts): https,
/// or plain http only on this machine.
fn update_endpoint(control_plane_url: &str) -> Result<Url, String> {
    let base = control_plane_url.trim().trim_end_matches('/');
    let url = Url::parse(&format!("{base}{UPDATE_PATH}")).map_err(|error| format!("Invalid control plane URL: {error}"))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => Ok(url),
        "http" if loopback => Ok(url),
        "http" => Err("A plain http control plane URL must be on this machine".into()),
        scheme => Err(format!("Unsupported control plane URL scheme {scheme}")),
    }
}

fn build_updater(app: &AppHandle) -> Result<(tauri_plugin_updater::Updater, Url), String> {
    let asset = app
        .asset_resolver()
        .get(BUILD_INFO_FILE.into())
        .ok_or_else(|| format!("{BUILD_INFO_FILE} is not in this build"))?;
    let endpoint = update_endpoint(&parse_build_info(&asset.bytes)?)?;
    let plugin = app
        .updater_builder()
        .target(UPDATE_PLATFORM)
        .endpoints(vec![endpoint.clone()])
        .map_err(|error| format!("Update endpoint rejected: {error}"))?
        .timeout(CHECK_TIMEOUT)
        .configure_client(|client| client.connect_timeout(CONNECT_TIMEOUT).read_timeout(READ_TIMEOUT))
        .build()
        .map_err(|error| format!("Updater unavailable: {error}"))?;
    Ok((plugin, endpoint))
}

/// Starts the check loop against this build's control plane (see the module comment). Called by
/// the home window on startup (never in mock mode); later calls only return the state. A failure
/// is logged and shows as `Failed { Unavailable }`; the next call tries again.
#[tauri::command]
pub fn updater_start(app: AppHandle) -> Result<UpdateState, String> {
    {
        let updater = app.state::<Updater>();
        let mut started = updater.started.lock().map_err(|_| "Update state unavailable")?;
        if *started {
            return Ok(state(&app));
        }
        match build_updater(&app) {
            Ok((plugin, endpoint)) => {
                *started = true;
                diag!("SLGO: update checks against {endpoint}");
                let handle = app.clone();
                tauri::async_runtime::spawn(async move { run(handle, plugin).await });
            }
            Err(error) => {
                drop(started);
                diag!("SLGO: update checks not started: {error}");
                transition(&app, Machine::unavailable);
                return Err(error);
            }
        }
    }
    Ok(state(&app))
}

/// Checks now (the version tile's retry); ignored while a check, download or install runs.
/// Refused when the checks never started, which the version tile already shows.
#[tauri::command]
pub fn updater_check_now(app: AppHandle) -> Result<(), String> {
    let updater = app.state::<Updater>();
    if !updater.started.lock().is_ok_and(|started| *started) {
        diag!("SLGO: update check requested, but update checks are not running");
        return Err("Update checks are not running".into());
    }
    let busy = matches!(
        state(&app).phase,
        Phase::Checking | Phase::Downloading { .. } | Phase::Installing { .. }
    );
    if !busy {
        updater.wake.notify_one();
    }
    Ok(())
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
            diag!("SLGO: update install: {error}");
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
            diag!("SLGO: started {} --update; exiting", path.display());
            app.exit(0);
            Ok(())
        }
        Err(error) => {
            diag!("SLGO: update installer did not start: {error}");
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
            diag!("SLGO: cannot remove {} yet: {error}", entry.path().display());
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
            diag!("SLGO: update check failed: {error}");
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
        diag!("SLGO: update {} is not signed as {expected}", update.version);
        transition(app, |machine| machine.check_failed(FailReason::Signature, now_ms()));
        return;
    }
    diag!("SLGO: downloading update {}", update.version);
    let mut received = 0_u64;
    let mut last_report = Instant::now();
    // The plugin collects the whole body before verifying it; dropping its future ends the request.
    let too_large = Notify::new();
    let download = update.download(
        |chunk, total| {
            received += chunk as u64;
            if exceeds_installer_limit(received, total) {
                too_large.notify_one();
            } else if last_report.elapsed() >= PROGRESS_INTERVAL {
                last_report = Instant::now();
                transition(app, |machine| machine.progress(received, total));
            }
        },
        || {},
    );
    let result = tokio::select! {
        result = download => result,
        () = too_large.notified() => {
            diag!("SLGO: update {} is larger than {MAX_INSTALLER_BYTES} bytes; download aborted", update.version);
            transition(app, |machine| machine.check_failed(FailReason::Signature, now_ms()));
            return;
        }
    };
    match result {
        Ok(bytes) => {
            diag!("SLGO: update {} verified ({} bytes)", update.version, bytes.len());
            transition(app, |machine| machine.downloaded(update.version.clone(), notes, bytes));
        }
        Err(error) => {
            let reason = fail_reason(&error);
            diag!("SLGO: update {} download failed ({reason:?}): {error}", update.version);
            transition(app, |machine| machine.check_failed(reason, now_ms()));
        }
    }
}

/// Whether a download has passed MAX_INSTALLER_BYTES, or announces that it will.
fn exceeds_installer_limit(received: u64, total: Option<u64>) -> bool {
    received > MAX_INSTALLER_BYTES || total.is_some_and(|total| total > MAX_INSTALLER_BYTES)
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
        // A newer release is downloaded; the verified one stays until it is replaced.
        assert!(machine.update_found("0.9.0", None, None, 3));
        machine.downloaded("0.9.0".into(), None, vec![9]);
        assert_eq!(machine.verified.as_ref().map(|verified| verified.version.as_str()), Some("0.9.0"));
    }

    #[test]
    fn a_failed_newer_release_falls_back_to_the_verified_one() {
        // 0.7.0 must update to 0.8.0, which is ready; 0.9.0 is announced but never verifies.
        let mut machine = Machine::new("0.7.0".into());
        assert!(machine.begin_check());
        assert!(machine.update_found("0.8.0", Some("eight".into()), Some("0.8.0"), 1));
        machine.downloaded("0.8.0".into(), Some("eight".into()), vec![8]);
        for reason in [FailReason::Network, FailReason::Signature] {
            assert!(machine.begin_check());
            assert!(machine.update_found("0.9.0", None, Some("0.8.0"), 2), "0.9.0 is downloaded");
            assert_eq!(machine.state.phase, Phase::Downloading { version: "0.9.0".into(), received: 0, total: None });
            machine.check_failed(reason, 3);
            assert_eq!(machine.state.phase, Phase::Ready { version: "0.8.0".into(), notes: Some("eight".into()) });
            assert_eq!(machine.state.required.as_deref(), Some("0.8.0"));
            let (version, bytes) = machine.begin_install().expect("0.8.0 still installs");
            assert_eq!((version.as_str(), bytes.as_slice()), ("0.8.0", [8].as_slice()));
            machine.install_failed();
        }
        // After a failed launch, a failing re-check also comes back to it.
        assert!(machine.begin_check());
        machine.check_failed(FailReason::Network, 4);
        assert!(matches!(&machine.state.phase, Phase::Ready { version, .. } if version == "0.8.0"));
    }

    #[test]
    fn an_announced_release_older_than_the_verified_one_drops_it() {
        let mut machine = Machine::new("0.7.0".into());
        ready(&mut machine, "0.9.0");
        assert!(machine.begin_check());
        assert!(machine.update_found("0.8.0", None, None, 2), "0.9.0 was withdrawn for 0.8.0");
        assert!(machine.verified.is_none());
        machine.check_failed(FailReason::Network, 3);
        assert_eq!(machine.state.phase, Phase::Failed { reason: FailReason::Network });
    }

    #[test]
    fn checks_that_cannot_start_show_as_unavailable() {
        let mut machine = Machine::new("0.7.0".into());
        machine.unavailable();
        assert_eq!(machine.state.phase, Phase::Failed { reason: FailReason::Unavailable });
        assert_eq!(serde_json::to_value(&machine.state.phase).unwrap(), serde_json::json!({ "kind": "failed", "reason": "unavailable" }));
    }

    #[test]
    fn the_control_plane_comes_from_the_build_info() {
        assert_eq!(parse_build_info(br#"{"controlPlaneUrl":"https://cp.example.test"}"#).unwrap(), "https://cp.example.test");
        // A build without the file resolves to index.html.
        assert!(parse_build_info(b"<!doctype html><html></html>").is_err());
        assert!(parse_build_info(br#"{"controlPlaneUrl":null}"#).is_err());
    }

    #[test]
    fn downloads_past_the_installer_limit_are_refused() {
        assert!(!exceeds_installer_limit(30 << 20, Some(30 << 20)));
        assert!(!exceeds_installer_limit(MAX_INSTALLER_BYTES, None));
        assert!(exceeds_installer_limit(MAX_INSTALLER_BYTES + 1, None), "without a Content-Length");
        assert!(exceeds_installer_limit(1, Some(MAX_INSTALLER_BYTES + 1)), "announced up front");
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
    fn a_late_check_result_keeps_installing() {
        let installing = |machine: &mut Machine| {
            ready(machine, "0.8.0");
            assert!(machine.begin_check(), "the periodic re-check starts while ready");
            assert!(machine.begin_install().is_some(), "and the player clicks install meanwhile");
        };
        let expected = UpdateState {
            current: "0.7.0".into(),
            phase: Phase::Installing { version: "0.8.0".into() },
            required: None,
            last_checked: Some(1),
        };

        let mut machine = Machine::new("0.7.0".into());
        installing(&mut machine);
        assert!(!machine.update_found("0.8.0", None, Some("0.8.0"), 2), "nothing to download");
        assert_eq!(machine.state, expected);
        assert!(!machine.update_found("0.9.0", None, None, 3), "not even a newer release");
        assert_eq!(machine.state, expected);
        assert!(machine.begin_install().is_none(), "no second installer");

        let mut machine = Machine::new("0.7.0".into());
        installing(&mut machine);
        machine.no_update(2);
        assert_eq!(machine.state, expected);
        assert!(machine.verified.is_some());

        let mut machine = Machine::new("0.7.0".into());
        installing(&mut machine);
        machine.check_failed(FailReason::Network, 2);
        assert_eq!(machine.state, expected);
        // A failed launch still shows, and later results apply again: a failed check falls back
        // to the verified installer.
        machine.install_failed();
        assert_eq!(machine.state.phase, Phase::Failed { reason: FailReason::Launch });
        machine.check_failed(FailReason::Network, 3);
        assert_eq!(machine.state.phase, Phase::Ready { version: "0.8.0".into(), notes: None });
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
        let unnamed = "untrusted comment: signature from tauri secret key\nRUT=\ntrusted comment: timestamp:1\nAAAA==\n";
        let unnamed = base64::engine::general_purpose::STANDARD.encode(unnamed);
        assert_eq!(signed_file_name(&unnamed), None);
        let misplaced = "trusted comment: timestamp:1\tfile:SLUI-Setup-0.8.0.exe\n";
        let misplaced = base64::engine::general_purpose::STANDARD.encode(misplaced);
        assert_eq!(signed_file_name(&misplaced), None, "only the third line is the trusted comment");
        assert_eq!(signed_file_name("not base64"), None);
    }

    #[test]
    fn a_forged_first_line_does_not_rename_a_signed_installer() {
        // A real 0.7.0 signature whose unsigned first line was rewritten to claim 9.9.9.
        let text = "trusted comment: timestamp:0\tfile:SLUI-Setup-9.9.9.exe\nRUT=\ntrusted comment: timestamp:1792406090\tfile:SLUI-Setup-0.7.0.exe\nAAAA==\n";
        let signature = base64::engine::general_purpose::STANDARD.encode(text);
        assert_eq!(signed_file_name(&signature).as_deref(), Some("SLUI-Setup-0.7.0.exe"));
        // Without its prefix the third line is no trusted comment (minisign rejects it too).
        let text = "trusted comment: timestamp:0\tfile:SLUI-Setup-9.9.9.exe\nRUT=\nfile:SLUI-Setup-9.9.9.exe\nAAAA==\n";
        let signature = base64::engine::general_purpose::STANDARD.encode(text);
        assert_eq!(signed_file_name(&signature), None);
    }

    #[test]
    fn the_endpoint_is_the_control_plane_update_path() {
        assert_eq!(update_endpoint("https://cp.example.test").unwrap().as_str(), "https://cp.example.test/v0/update");
        assert_eq!(update_endpoint("https://cp.example.test/").unwrap().as_str(), "https://cp.example.test/v0/update");
        assert_eq!(update_endpoint("http://127.0.0.1:7800").unwrap().as_str(), "http://127.0.0.1:7800/v0/update");
        assert_eq!(update_endpoint("http://localhost:7800").unwrap().as_str(), "http://localhost:7800/v0/update");
        assert_eq!(update_endpoint("http://[::1]:7800").unwrap().as_str(), "http://[::1]:7800/v0/update");
        assert!(update_endpoint("http://cp.example.test").is_err(), "plain http only on this machine");
        assert!(update_endpoint("http://192.0.2.1:7800").is_err());
        assert!(update_endpoint("ftp://cp.example.test").is_err());
        assert!(update_endpoint("not a url").is_err());
    }
}
