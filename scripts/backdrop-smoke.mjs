import assert from "node:assert/strict";
import { quantizeRegion, sameRegions } from "../src/platform/backdrop.ts";

// Regions are sent in whole px with two-decimal opacity, so sub-pixel layout jitter never re-sends.
const region = quantizeRegion({ x: 480.4, y: 277.6, w: 959.5, h: 584.49, corner: "small", alpha: 0.996 });
assert.deepEqual(region, { x: 480, y: 278, w: 960, h: 584, corner: "small", alpha: 1 });
assert.equal(sameRegions([region], [quantizeRegion({ ...region, x: 480.2 })]), true, "jitter is not a change");
assert.equal(sameRegions([region], [{ ...region, alpha: 0.5 }]), false, "a fade is a change");
assert.equal(sameRegions([region], [{ ...region, corner: "round" }]), false, "a corner is a change");
assert.equal(sameRegions([region], []), false, "a panel leaving is a change");
assert.equal(sameRegions([], []), true);

console.log("backdrop smoke passed");
