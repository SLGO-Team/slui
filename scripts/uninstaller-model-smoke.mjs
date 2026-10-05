import assert from "node:assert/strict";
import {
  CANCELLED_NOTICE,
  failureSummary,
  initialState,
  offered,
  reduce,
  request,
  stages,
} from "../installer/src/uninstall/model.ts";

const detect = (extra = {}) => ({
  installed: { version: "0.2.2", dir: "D:\\Games\\SLUI" },
  themePack: true,
  userData: true,
  appRunning: false,
  ...extra,
});
const apply = (state, ...actions) => actions.reduce(reduce, state);
const toggle = (option, value = true) => ({ type: "optionChanged", option, value });
const ok = (extra = {}) => ({ kind: "ok", dir: "D:\\Games\\SLUI", themePackKept: false, userDataError: null, ...extra });

// Both toggles start off: the theme pack and the user's data are kept unless asked.
const detected = apply(initialState, { type: "detected", detect: detect() });
assert.equal(detected.screen, "confirm");
assert.deepEqual(request(detected), { themePack: false, userData: false });

// Toggles are only offered, and only applied, for something that is there.
assert.equal(offered(detect(), "themePack"), true);
assert.equal(offered(detect({ themePack: false }), "themePack"), false);
assert.equal(offered(detect({ userData: false }), "userData"), false);
const bothOn = apply(detected, toggle("themePack"), toggle("userData"));
assert.deepEqual(request(bothOn), { themePack: true, userData: true });
const nothingThere = apply(initialState, { type: "detected", detect: detect({ themePack: false, userData: false }) },
  toggle("themePack"), toggle("userData"));
assert.deepEqual(request(nothingThere), { themePack: false, userData: false });
assert.deepEqual(request(apply(bothOn, toggle("themePack", false))), { themePack: false, userData: true });

// Nothing to uninstall: start is a no-op.
const missing = apply(initialState, { type: "detected", detect: detect({ installed: null }) });
assert.equal(request(missing), null);
assert.equal(apply(missing, { type: "start" }).screen, "confirm");
assert.equal(apply(initialState, { type: "start" }).screen, "confirm", "start before detection");

// A run carries the request; stages include cleaning only when the user data goes.
const started = apply(bothOn, { type: "start" });
assert.equal(started.screen, "progress");
assert.deepEqual(started.run, { themePack: true, userData: true, id: 1 });
assert.deepEqual(stages(started.run), ["preparing", "elevating", "uninstalling", "cleaning"]);
assert.deepEqual(stages({ themePack: true, userData: false }), ["preparing", "elevating", "uninstalling"]);
assert.equal(apply(started, toggle("themePack", false)).run.themePack, true, "toggles are frozen while running");
assert.equal(apply(started, { type: "start" }), started, "no second run while one is going");

// Stage and finish only apply to the current run.
const staged = apply(started, { type: "stage", runId: 1, stage: "elevating" }, { type: "stage", runId: 9, stage: "cleaning" });
assert.equal(staged.stage, "elevating");
assert.equal(apply(staged, { type: "finished", runId: 9, outcome: ok() }).screen, "progress");
const done = apply(staged, { type: "finished", runId: 1, outcome: ok({ themePackKept: false }) });
assert.equal(done.screen, "done");
assert.equal(done.outcome.kind, "ok");

// UAC declined: back to confirm with the notice, toggles kept; the next start clears it.
const cancelled = apply(started, { type: "finished", runId: 1, outcome: { kind: "cancelled" } });
assert.equal(cancelled.screen, "confirm");
assert.equal(cancelled.notice, CANCELLED_NOTICE);
assert.deepEqual(request(cancelled), { themePack: true, userData: true });
const again = apply(cancelled, { type: "start" });
assert.equal(again.notice, null);
assert.equal(again.run.id, 2);

// Failure and retry with the same request under a new run id.
const failure = { kind: "failed", code: 2, reason: "exit_code", detail: null };
const failed = apply(started, { type: "finished", runId: 1, outcome: failure });
assert.equal(failed.screen, "error");
const retried = apply(failed, { type: "retry" });
assert.equal(retried.screen, "progress");
assert.deepEqual(retried.run, { themePack: true, userData: true, id: 2 });
assert.equal(apply(done, { type: "retry" }), done, "retry only from the error screen");

for (const reason of ["not_installed", "copy_failed", "launch_failed", "exit_code", "verify_failed", "busy", "internal"]) {
  assert.ok(failureSummary({ kind: "failed", code: null, reason, detail: null }).length > 0, reason);
}

console.log("uninstaller model smoke: defaults, offered toggles, runs, stages, cancel, failure/retry ok");
