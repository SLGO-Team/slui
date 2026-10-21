import assert from "node:assert/strict";
import { cornerRadius, quantizeRegion, sameRegions } from "../src/platform/backdrop.ts";

// Regions are sent in whole px with two-decimal opacity, so sub-pixel layout jitter never re-sends.
const region = quantizeRegion({ x: 480.4, y: 277.6, w: 959.5, h: 584.49, radius: 7.404, alpha: 0.996 });
assert.deepEqual(region, { x: 480, y: 278, w: 960, h: 584, radius: 7.4, alpha: 1 });
assert.equal(sameRegions([region], [quantizeRegion({ ...region, x: 480.2 })]), true, "jitter is not a change");
assert.equal(sameRegions([region], [{ ...region, alpha: 0.5 }]), false, "a fade is a change");
assert.equal(sameRegions([region], [{ ...region, radius: 3 }]), false, "a corner is a change");
assert.equal(sameRegions([region], []), false, "a panel leaving is a change");
assert.equal(sameRegions([], []), true);

// Corner radius from computed CSS: px, a percentage of the width (circles), the first of an elliptical pair.
assert.equal(cornerRadius("5px", 960), 5);
assert.equal(cornerRadius("50%", 64), 32);
assert.equal(cornerRadius("4px 6px", 100), 4);
assert.equal(cornerRadius("0px", 100), 0);
assert.equal(cornerRadius("", 100), 0);

console.log("backdrop smoke passed");
