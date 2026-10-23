import assert from "node:assert/strict";
import { createClock, createClockSelection, sameItems } from "../src/shared/clock.ts";

// Overlay clock: one interval while anyone listens, a fresh time on start, and the selection cache that
// keeps a reader from re-rendering while its clock-derived value stays the same.

let time = 1_000;
const intervals = new Map();
let nextHandle = 1;
const timers = {
  now: () => time,
  setInterval: (callback, ms) => {
    const handle = nextHandle++;
    intervals.set(handle, { callback, ms });
    return handle;
  },
  clearInterval: (handle) => intervals.delete(handle),
};
const advance = (ms) => {
  time += ms;
  for (const { callback } of [...intervals.values()]) callback();
};

const clock = createClock(timers, 250);
assert.equal(intervals.size, 0, "no interval without a subscriber");
time = 5_000;
const seen = [];
const stopA = clock.subscribe((nowMs) => seen.push(["a", nowMs]));
assert.equal(intervals.size, 1, "the first subscriber starts the interval");
assert.equal([...intervals.values()][0].ms, 250);
assert.equal(clock.now(), 5_000, "starting refreshes the time read before the first tick");
const stopB = clock.subscribe((nowMs) => seen.push(["b", nowMs]));
assert.equal(intervals.size, 1, "one interval for every subscriber");
advance(250);
assert.deepEqual(seen, [["a", 5_250], ["b", 5_250]]);
assert.equal(clock.now(), 5_250);
time += 100;
assert.equal(clock.now(), 5_250, "stable between ticks");
stopA();
stopA();
assert.equal(intervals.size, 1, "a repeated unsubscribe does not stop the others' interval");
stopB();
assert.equal(intervals.size, 0, "the last unsubscribe stops the interval");
time = 9_000;
const stopC = clock.subscribe(() => {});
assert.equal(clock.now(), 9_000, "a restart after idle reads the current time");
stopC();

// Selection: the same selector keeps an equal previous value; a new selector takes the fresh one.
let now = 0;
const select = createClockSelection(() => now);
const byAvailability = (a, b) => a.availability === b.availability;
let calls = 0;
const viewAt = (receivedAtMs) => (nowMs) => {
  calls++;
  return { availability: nowMs - receivedAtMs > 5_000 ? "stale" : "live", items: [] };
};
const fromFirst = viewAt(0);
const first = select(fromFirst, byAvailability);
assert.equal(first.availability, "live");
assert.equal(select(fromFirst, byAvailability), first, "same time and selector: cached");
assert.equal(calls, 1, "no recompute until the clock moves");
now = 4_000;
assert.equal(select(fromFirst, byAvailability), first, "equal on a later tick: the previous value");
now = 6_000;
const stale = select(fromFirst, byAvailability);
assert.notEqual(stale, first);
assert.equal(stale.availability, "stale");
const fromSecond = viewAt(5_000);
const fresh = select(fromSecond, byAvailability);
assert.equal(fresh.availability, "live");
const again = viewAt(5_000);
assert.notEqual(select(again, () => true), fresh, "a new selector never reuses the old value, even if equal");

assert.equal(sameItems([1, 2], [1, 2]), true);
assert.equal(sameItems([1, 2], [1]), false);
assert.equal(sameItems([{ id: "a" }], [{ id: "a" }]), false, "by identity unless a key is given");
assert.equal(sameItems([{ id: "a" }], [{ id: "a" }], (item) => item.id), true);

console.log("clock smoke passed");
