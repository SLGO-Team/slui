import assert from "node:assert/strict";
import { createNativeOverlayVisibilitySource, overlayShown, subscribeOverlayVisible } from "../src/platform/overlayVisibility.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeFixture() {
  const registration = deferred();
  const snapshot = deferred();
  let callback;
  let cleanupCount = 0;
  let snapshotCount = 0;
  const source = createNativeOverlayVisibilitySource({
    listen(listener) { callback = listener; return registration.promise; },
    getSnapshot() { snapshotCount += 1; return snapshot.promise; },
  });
  return {
    source, snapshot,
    register: () => registration.resolve(() => { cleanupCount += 1; }),
    emit: (state) => callback(state),
    get cleanupCount() { return cleanupCount; },
    get snapshotCount() { return snapshotCount; },
  };
}
const visibility = (visible, revision) => ({ visible, revision });

// ---- Shown until told otherwise; listen first, then query; the created-hidden revision 0 counts ----
{
  const start = nativeFixture();
  const observed = [];
  start.source.subscribeOverlayVisible((value) => observed.push(value));
  assert.deepEqual(observed, [true], "shown before the native state arrives");
  assert.equal(start.snapshotCount, 0, "snapshot waits for listener registration");
  start.register();
  await flush();
  start.snapshot.resolve(visibility(false, 0));
  await flush();
  assert.deepEqual(observed, [true, false], "the window is created hidden (revision 0)");
}
{
  const race = nativeFixture();
  const observed = [];
  const stop = race.source.subscribeOverlayVisible((value) => observed.push(value));
  race.register();
  await flush();
  race.emit(visibility(true, 3));
  race.snapshot.resolve(visibility(false, 2));
  await flush();
  assert.equal(observed.at(-1), true, "a late snapshot cannot revert a newer event");
  race.emit(visibility(false, 3));
  race.emit(visibility(false, 1));
  assert.equal(observed.length, 2, "duplicate and old revisions are ignored");
  race.emit(visibility(false, 4));
  assert.equal(observed.at(-1), false);
  stop();
  stop();
  race.emit(visibility(true, 5));
  assert.equal(race.cleanupCount, 1);
  assert.equal(observed.length, 3, "no delivery after disposal");
}

// ---- A failed or malformed source falls back to shown, as before the native state existed ----
{
  const warnings = [];
  const originalError = console.error;
  console.error = (...args) => warnings.push(args);
  try {
    const malformed = nativeFixture();
    const states = [];
    malformed.source.subscribeOverlayVisible((value) => states.push(value));
    malformed.register();
    await flush();
    malformed.emit(visibility(false, 2));
    malformed.emit({ visible: false, revision: 3, extra: 1 });
    assert.equal(states.at(-1), true, "a malformed frame falls back to shown");
    malformed.emit(visibility(false, 9));
    assert.equal(states.at(-1), true, "a failed source stays shown");
    assert.equal(malformed.cleanupCount, 1);

    const failed = nativeFixture();
    const failedStates = [];
    failed.source.subscribeOverlayVisible((value) => failedStates.push(value));
    failed.register();
    await flush();
    failed.emit(visibility(false, 1));
    failed.snapshot.reject(new Error("native query failed"));
    await flush();
    assert.deepEqual(failedStates, [true, false, true]);
    assert.equal(warnings.length, 2, "failures are diagnosed");
  } finally {
    console.error = originalError;
  }
}

// ---- A browser preview has no overlay window: always shown, no native subscription ----
{
  const browser = [];
  const stop = subscribeOverlayVisible((value) => browser.push(value));
  assert.equal(overlayShown(), true);
  stop();
  assert.deepEqual(browser, [], "listeners hear changes only");
}

console.log("overlay visibility smoke passed");
