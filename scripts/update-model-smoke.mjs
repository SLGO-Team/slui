import assert from "node:assert/strict";
import { homeServerStatus, requiredUpdate, updateRequiredDetail, updateTile } from "../src/app/updateModel.ts";
import { createUpdateSource, parseUpdateState, UPDATE_STATE_EVENT } from "../src/platform/updater.ts";
import { readUpdatePreview, UPDATE_PREVIEWS } from "../src/mocks/updatePreview.ts";

const state = (phase, extra = {}) => ({ current: "0.7.0", phase, required: null, lastChecked: 1, ...extra });

// The Rust state (serde, camelCase) parses; anything malformed is dropped rather than half-read.
const fromRust = {
  current: "0.7.0",
  phase: { kind: "downloading", version: "0.8.0", received: 5, total: null },
  required: "0.8.0",
  lastChecked: 7,
};
assert.deepEqual(parseUpdateState(fromRust), fromRust);
for (const phase of [{ kind: "idle" }, { kind: "checking" }, { kind: "ready", version: "0.8.0", notes: "text" },
  { kind: "ready", version: "0.8.0", notes: null }, { kind: "installing", version: "0.8.0" },
  { kind: "failed", reason: "network" }, { kind: "failed", reason: "signature" }, { kind: "failed", reason: "launch" }]) {
  assert.deepEqual(parseUpdateState(state(phase)).phase, phase);
}
for (const bad of [null, "x", { ...fromRust, current: 7 }, { ...fromRust, required: 8 }, { ...fromRust, lastChecked: "1" },
  { ...fromRust, phase: { kind: "failed", reason: "disk" } }, { ...fromRust, phase: { kind: "downloading", version: "0.8.0" } },
  { ...fromRust, phase: { kind: "ready" } }, { ...fromRust, phase: { kind: "later" } }, { ...fromRust, phase: undefined }]) {
  assert.equal(parseUpdateState(bad), null, JSON.stringify(bad));
}

// Version tile.
assert.deepEqual(updateTile(null), { tone: "muted", value: "正在获取…", detail: null, action: null });
assert.deepEqual(updateTile(state({ kind: "idle" }, { lastChecked: null })),
  { tone: "muted", value: "0.7.0", detail: "尚未检查更新", action: null });
assert.deepEqual(updateTile(state({ kind: "idle" })), { tone: "ok", value: "0.7.0", detail: "已是最新版本", action: null });
assert.deepEqual(updateTile(state({ kind: "checking" })), { tone: "pending", value: "0.7.0", detail: "正在检查更新…", action: null });
assert.equal(updateTile(state({ kind: "downloading", version: "0.8.0", received: 15_300_000, total: 34_000_000 })).detail,
  "正在下载 0.8.0 · 45%");
assert.equal(updateTile(state({ kind: "downloading", version: "0.8.0", received: 5, total: null })).detail, "正在下载 0.8.0",
  "no percentage without a length");
assert.equal(updateTile(state({ kind: "downloading", version: "0.8.0", received: 9, total: 3 })).detail, "正在下载 0.8.0 · 100%");
assert.deepEqual(updateTile(state({ kind: "ready", version: "0.8.0", notes: null })),
  { tone: "warn", value: "0.8.0 可用", detail: "当前版本 0.7.0", action: "install" });
assert.deepEqual(updateTile(state({ kind: "installing", version: "0.8.0" })),
  { tone: "pending", value: "0.7.0", detail: "正在启动安装程序…", action: null });
// Failures stay quiet (muted) and offer a retry.
assert.deepEqual(updateTile(state({ kind: "failed", reason: "network" })),
  { tone: "muted", value: "0.7.0", detail: "检查更新失败", action: "retry" });
assert.equal(updateTile(state({ kind: "failed", reason: "signature" })).detail, "更新文件校验失败");
assert.equal(updateTile(state({ kind: "failed", reason: "launch" })).detail, "无法启动安装程序");

// Required: an error tone in every phase; the install action as soon as the update is ready.
const required = (phase) => updateTile(state(phase, { required: "0.8.0" }));
assert.deepEqual(required({ kind: "ready", version: "0.9.0", notes: null }),
  { tone: "error", value: "需要更新", detail: "0.9.0 已下载", action: "install" });
assert.deepEqual(required({ kind: "downloading", version: "0.9.0", received: 1, total: 4 }),
  { tone: "error", value: "需要更新", detail: "正在下载 0.9.0 · 25%", action: null });
assert.deepEqual(required({ kind: "failed", reason: "network" }),
  { tone: "error", value: "需要更新", detail: "检查更新失败", action: "retry" });
assert.deepEqual(required({ kind: "idle" }), { tone: "error", value: "需要更新", detail: "需要 0.8.0 或更高版本", action: null });

// The home server tile: a required update replaces the session status; otherwise the session's own.
const live = { status: "live", steamId: "76561198000000000", detail: null, endReason: null };
assert.equal(homeServerStatus(live, null).label, "已连接");
assert.equal(homeServerStatus(live, state({ kind: "idle" })).label, "已连接");
assert.deepEqual(homeServerStatus({ ...live, status: "incompatible" }, state({ kind: "idle" }, { required: "0.8.0" })),
  { label: "需要更新", tone: "error", retry: false, hint: "更新后才能连接" });
assert.equal(homeServerStatus(null, null).label, "正在获取…");
assert.equal(requiredUpdate(null), null, "unknown is not required (fail-open)");
assert.equal(requiredUpdate(state({ kind: "failed", reason: "network" }, { required: "0.8.0" })), "0.8.0");
assert.match(updateRequiredDetail("0.8.0"), /0\.8\.0/);

// Adapter: Tauri commands and the Rust event; the browser preview reports its fixed state.
const calls = [];
const listeners = new Map();
const bus = { emit() {}, listen(event, listener) { listeners.set(event, listener); return () => listeners.delete(event); } };
const invoke = async (command, args) => {
  calls.push([command, args]);
  return command === "updater_start" || command === "get_update_state" ? fromRust : undefined;
};
const source = createUpdateSource(bus, invoke);
assert.deepEqual(await source.start("https://cp.example.test"), fromRust);
assert.deepEqual(await source.get(), fromRust);
await source.checkNow();
await source.install();
assert.deepEqual(calls, [["updater_start", { controlPlaneUrl: "https://cp.example.test" }], ["get_update_state", undefined],
  ["updater_check_now", undefined], ["updater_install", undefined]]);
const received = [];
const unsubscribe = source.subscribe((value) => received.push(value));
listeners.get(UPDATE_STATE_EVENT)({ bad: true });
listeners.get(UPDATE_STATE_EVENT)(fromRust);
assert.deepEqual(received, [fromRust], "malformed events are dropped");
unsubscribe();
assert.equal(listeners.has(UPDATE_STATE_EVENT), false);
const preview = createUpdateSource(bus, null, UPDATE_PREVIEWS.ready);
assert.equal(await preview.start("https://cp.example.test"), UPDATE_PREVIEWS.ready);
assert.equal(await createUpdateSource(bus, null).get(), null);

// Preview fixtures are valid states.
for (const [name, fixture] of Object.entries(UPDATE_PREVIEWS)) {
  assert.deepEqual(parseUpdateState(fixture), fixture, name);
  assert.equal(readUpdatePreview(`?update=${name}`), fixture);
}
assert.equal(readUpdatePreview("?update=toString"), null);
assert.equal(readUpdatePreview(""), null);

console.log("update model smoke: state parsing, version tile, required gating, adapter ok");
