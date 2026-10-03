import assert from "node:assert/strict";
import {
  createNativeGameForegroundSource,
  createPreviewGameForegroundSource,
  subscribeGameForeground,
} from "../src/platform/gameForeground.ts";

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
  const source = createNativeGameForegroundSource({
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

const race = nativeFixture();
const observed = [];
const stop = race.source.subscribeGameForeground((state) => observed.push(state));
assert.deepEqual(observed, [{ focused: false, revision: 0 }]);
assert.equal(race.snapshotCount, 0, "snapshot waits for listener registration");
race.register();
await flush();
race.emit({ focused: true, revision: 3 });
race.snapshot.resolve({ focused: false, revision: 2 });
await flush();
assert.deepEqual(observed.at(-1), { focused: true, revision: 3 }, "late snapshot cannot revert focus");
race.emit({ focused: false, revision: 3 });
race.emit({ focused: false, revision: 1 });
assert.equal(observed.length, 2, "duplicate and old revisions are ignored");
race.emit({ focused: false, revision: 4 });
assert.deepEqual(observed.at(-1), { focused: false, revision: 4 });
stop();
stop();
race.emit({ focused: true, revision: 5 });
assert.equal(race.cleanupCount, 1);
assert.equal(observed.length, 3, "no delivery after disposal");

const initial = nativeFixture();
const initialStates = [];
const stopInitial = initial.source.subscribeGameForeground((state) => initialStates.push(state));
initial.register();
await flush();
initial.snapshot.resolve({ focused: true, revision: 1 });
await flush();
assert.deepEqual(initialStates, [{ focused: false, revision: 0 }, { focused: true, revision: 1 }]);
stopInitial();

const cancelled = nativeFixture();
const cancelledStates = [];
const cancel = cancelled.source.subscribeGameForeground((state) => cancelledStates.push(state));
cancel();
cancelled.register();
await flush();
assert.equal(cancelled.cleanupCount, 1, "late asynchronous registration is cleaned up");
assert.equal(cancelled.snapshotCount, 0, "disposed registration never queries native state");
assert.equal(cancelledStates.length, 1);

const queryCancelled = nativeFixture();
const queryCancelledStates = [];
const cancelQuery = queryCancelled.source.subscribeGameForeground((state) => queryCancelledStates.push(state));
queryCancelled.register();
await flush();
cancelQuery();
queryCancelled.snapshot.resolve({ focused: true, revision: 9 });
await flush();
assert.equal(queryCancelledStates.length, 1, "pending snapshot cannot update a disposed consumer");
assert.equal(queryCancelled.cleanupCount, 1);

const warnings = [];
const originalError = console.error;
console.error = (...args) => warnings.push(args);
try {
  const failed = nativeFixture();
  const failedStates = [];
  failed.source.subscribeGameForeground((state) => failedStates.push(state));
  failed.register();
  await flush();
  failed.emit({ focused: true, revision: 2 });
  failed.snapshot.reject(new Error("native query failed"));
  await flush();
  assert.deepEqual(failedStates.at(-1), { focused: false, revision: 3 });
  assert.equal(failed.cleanupCount, 1);
  failed.emit({ focused: true, revision: 4 });
  assert.equal(failedStates.at(-1).focused, false, "failed setup stays closed");

  const malformed = nativeFixture();
  const malformedStates = [];
  malformed.source.subscribeGameForeground((state) => malformedStates.push(state));
  malformed.emit({ focused: true, revision: Number.NaN });
  malformed.register();
  await flush();
  assert.equal(malformedStates.at(-1).focused, false);
  assert.equal(malformed.cleanupCount, 1, "malformed early event still cleans asynchronous registration");
  assert.equal(warnings.length, 2, "failures are diagnosed");
} finally {
  console.error = originalError;
}

const browserStates = [];
subscribeGameForeground((state) => browserStates.push(state))();
assert.deepEqual(browserStates, [{ focused: false, revision: 0 }], "preview must explicitly inject fake focus");

const preview = createPreviewGameForegroundSource(true);
const previewStates = [];
const stopPreview = preview.subscribeGameForeground((state) => previewStates.push(state));
preview.setFocused(false);
preview.setFocused(false);
preview.setFocused(true);
assert.deepEqual(previewStates, [
  { focused: true, revision: 1 },
  { focused: false, revision: 2 },
  { focused: true, revision: 3 },
]);
stopPreview();
preview.setFocused(false);
assert.equal(previewStates.length, 3);
console.log("Game foreground subscription smoke checks passed.");
