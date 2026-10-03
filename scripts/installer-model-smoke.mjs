import assert from "node:assert/strict";
import {
  CANCELLED_NOTICE,
  classify,
  formatBytes,
  initialState,
  optionsGate,
  optionsVisible,
  reduce,
  welcomeModes,
} from "../installer/src/model.ts";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const detect = (installed = null, extra = {}) => ({
  payloadVersion: "0.1.1",
  requiredBytes: 112 * MB,
  defaultDir: "C:\\Program Files\\SLUI",
  installed,
  appRunning: false,
  ...extra,
});
const installedAt = (relation, version = "0.1.0") => ({ version, dir: "D:\\Games\\SLUI", relation });
const apply = (state, ...actions) => actions.reduce(reduce, state);
const checked = (dir, normalized = dir, freeBytes = GB, error = null) => [
  { type: "dirChanged", dir },
  { type: "dirChecked", input: dir, result: { normalized, freeBytes, error } },
];
const request = (run) => ({
  dir: run.dir,
  mode: run.mode,
  startMenuShortcut: run.startMenuShortcut,
  desktopShortcut: run.desktopShortcut,
});

// Classification follows the Rust semver relation; no install entry is a fresh install.
assert.equal(classify(detect()), "fresh");
assert.equal(classify(detect(installedAt("older"))), "update");
assert.equal(classify(detect(installedAt("same", "0.1.1"))), "same");
assert.equal(classify(detect(installedAt("newer", "0.2.0"))), "newerInstalled");
assert.deepEqual(welcomeModes("newerInstalled"), [], "a newer install offers no install mode");

// Fresh: the options are on the welcome screen, start from the default dir with both shortcuts.
let state = apply(initialState, { type: "detected", detect: detect() });
assert.equal(state.screen, "welcome");
assert.equal(optionsVisible(state), true, "fresh install shows the options in place");
assert.equal(state.dir, "C:\\Program Files\\SLUI");
assert.equal(state.startMenuShortcut, true);
assert.equal(state.desktopShortcut, true);
assert.deepEqual(optionsGate(state), { ok: false, reason: null }, "pending until checked");
assert.equal(reduce(state, { type: "start", mode: "fresh" }), state, "no install while the dir check is pending");
state = apply(state, ...checked("C:\\Program Files\\SLUI"));
state = reduce(state, { type: "start", mode: "fresh" });
assert.equal(state.screen, "progress");
assert.equal(optionsVisible(state), false, "options are hidden while installing");
assert.deepEqual(request(state.run),
  { dir: "C:\\Program Files\\SLUI", mode: "fresh", startMenuShortcut: true, desktopShortcut: true });
const freshRun = state.run.id;
assert.equal(reduce(state, { type: "start", mode: "fresh" }), state, "no second run while installing");
state = reduce(state, { type: "stage", runId: freshRun, stage: "elevating" });
assert.equal(state.stage, "elevating");
assert.equal(reduce(state, { type: "stage", runId: freshRun + 7, stage: "installing" }), state, "stale run ignored");
state = reduce(state, { type: "finished", runId: freshRun, outcome: { kind: "ok", dir: "C:\\Program Files\\SLUI" } });
assert.equal(state.screen, "done");

// The two shortcuts are independent.
const fresh = apply(initialState, { type: "detected", detect: detect() }, ...checked("D:\\SLUI"));
for (const [startMenu, desktop] of [[true, false], [false, true], [false, false]]) {
  const run = apply(fresh,
    { type: "shortcutChanged", shortcut: "startMenu", value: startMenu },
    { type: "shortcutChanged", shortcut: "desktop", value: desktop },
    { type: "start", mode: "fresh" }).run;
  assert.equal(run.startMenuShortcut, startMenu);
  assert.equal(run.desktopShortcut, desktop);
}

// Update: no options, installs into the existing dir without waiting for a dir check.
state = apply(initialState, { type: "detected", detect: detect(installedAt("older")) });
assert.equal(optionsVisible(state), false, "update has no install options");
assert.equal(reduce(state, { type: "openReinstall" }), state, "update cannot open the reinstall options");
assert.equal(reduce(state, { type: "start", mode: "fresh" }), state, "update offers only update");
state = reduce(state, { type: "start", mode: "update" });
assert.equal(state.run.mode, "update");
assert.equal(state.run.dir, "D:\\Games\\SLUI");

// Same version: launch first; reinstall opens the options in place, prefilled with the installed dir.
state = apply(initialState, { type: "detected", detect: detect(installedAt("same", "0.1.1")) });
assert.equal(optionsVisible(state), false);
assert.equal(state.dir, "D:\\Games\\SLUI");
assert.equal(reduce(state, { type: "start", mode: "reinstall" }), state, "reinstall needs the options open");
const reinstalling = reduce(state, { type: "openReinstall" });
assert.equal(reinstalling.screen, "welcome");
assert.equal(optionsVisible(reinstalling), true);
assert.equal(optionsVisible(reduce(reinstalling, { type: "closeReinstall" })), false, "cancel hides the options again");
const reinstalled = apply(reinstalling, ...checked("D:\\Games\\SLUI"), { type: "start", mode: "reinstall" });
assert.equal(reinstalled.run.mode, "reinstall");
assert.equal(reinstalled.run.dir, "D:\\Games\\SLUI");
assert.equal(apply(reinstalling, ...checked("D:\\Games\\SLUI"), { type: "start", mode: "fresh" }).screen, "welcome",
  "same version never starts a fresh install");

// Downgrade: nothing can start.
state = apply(initialState, { type: "detected", detect: detect(installedAt("newer", "0.2.0")) });
for (const mode of ["fresh", "update", "reinstall"]) {
  assert.equal(reduce(state, { type: "start", mode }), state, `downgrade refuses ${mode}`);
}
assert.equal(reduce(state, { type: "openReinstall" }), state);

// Options gate: invalid, insufficient space, then ok with the normalized dir.
state = apply(initialState, { type: "detected", detect: detect() },
  ...checked("Program Files", "Program Files", null, "not_absolute"));
assert.equal(optionsGate(state).ok, false);
assert.match(optionsGate(state).reason, /完整路径/);
state = apply(state, ...checked("E:\\SLUI", "E:\\SLUI", 40 * MB));
assert.equal(optionsGate(state).ok, false, "free < required");
assert.match(optionsGate(state).reason, /空间不足/);
assert.equal(reduce(state, { type: "start", mode: "fresh" }), state, "no install without space");
// A late check result for an older input is dropped.
assert.equal(reduce(state, { type: "dirChecked", input: "C:\\Old", result: { normalized: "C:\\Old", freeBytes: GB, error: null } }), state);
state = apply(state,
  ...checked("d:/Program Files/SLUI/", "D:\\Program Files\\SLUI", 112 * MB),
  { type: "shortcutChanged", shortcut: "desktop", value: false });
assert.deepEqual(optionsGate(state), { ok: true }, "free == required is enough");
const located = reduce(state, { type: "start", mode: "fresh" });
assert.equal(located.screen, "progress");
assert.equal(located.run.dir, "D:\\Program Files\\SLUI", "installs the normalized dir");
assert.equal(located.run.startMenuShortcut, true);
assert.equal(located.run.desktopShortcut, false);
// Unknown free space (null) does not block.
assert.deepEqual(optionsGate(apply(state, ...checked("F:\\SLUI", "F:\\SLUI", null))), { ok: true });

// UAC declined: back to the welcome screen with the options and the notice kept.
const cancelled = reduce(located, { type: "finished", runId: located.run.id, outcome: { kind: "cancelled" } });
assert.equal(cancelled.screen, "welcome");
assert.equal(cancelled.notice, CANCELLED_NOTICE);
assert.equal(cancelled.dir, "d:/Program Files/SLUI/");
assert.equal(cancelled.desktopShortcut, false);
const cancelledReinstall = reduce(reinstalled, { type: "finished", runId: reinstalled.run.id, outcome: { kind: "cancelled" } });
assert.equal(optionsVisible(cancelledReinstall), true, "a declined reinstall keeps its options open");
assert.equal(reduce(cancelledReinstall, { type: "closeReinstall" }).notice, null, "navigation clears the notice");

// Failure keeps the exit code; retry starts a new run with the same request.
const failure = { kind: "failed", code: 2, reason: "exit_code", detail: null };
const failed = reduce(located, { type: "finished", runId: located.run.id, outcome: failure });
assert.equal(failed.screen, "error");
assert.deepEqual(failed.outcome, failure);
const retried = reduce(failed, { type: "retry" });
assert.equal(retried.screen, "progress");
assert.notEqual(retried.run.id, located.run.id);
assert.deepEqual(request(retried.run), request(located.run));
assert.equal(reduce(retried, { type: "finished", runId: located.run.id, outcome: { kind: "ok", dir: "x" } }), retried,
  "the old run's result is ignored");

// Disconnected / failed detection is visible, not a silent fresh install.
const detectFailed = reduce(initialState, { type: "detectFailed", message: "boom" });
assert.equal(detectFailed.detect, null);
assert.equal(detectFailed.detectError, "boom");
assert.equal(optionsVisible(detectFailed), false);
assert.equal(reduce(detectFailed, { type: "start", mode: "fresh" }), detectFailed);

assert.equal(formatBytes(112 * MB), "112 MB");
assert.equal(formatBytes(108_921_856), "104 MB");
assert.equal(formatBytes(186.4 * GB), "186.4 GB");
assert.equal(formatBytes(0), "0 MB");

console.log("installer model smoke: classify, inline options, shortcuts, reinstall, gate, cancel, failure/retry ok");
