import assert from "node:assert/strict";
import { cornerRadius, insetClip, quantizeRegion, sameRegions, sampleFade } from "../src/platform/backdrop.ts";

// Regions are sent in whole px with two-decimal opacity, so sub-pixel layout jitter never re-sends.
const region = quantizeRegion({ x: 480.4, y: 277.6, w: 959.5, h: 584.49, radius: 7.404, alpha: 0.996 });
assert.deepEqual(region, { x: 480, y: 278, w: 960, h: 584, radius: 7.4, alpha: 1 });
assert.equal(sameRegions([region], [quantizeRegion({ ...region, x: 480.2 })]), true, "jitter is not a change");
assert.equal(sameRegions([region], [{ ...region, alpha: 0.5 }]), false, "a fade is a change");
assert.equal(sameRegions([region], [{ ...region, radius: 3 }]), false, "a corner is a change");
assert.equal(sameRegions([region], []), false, "a panel leaving is a change");
assert.equal(sameRegions([], []), true);

// A turn is sent in thousandths of a radian; an upright box sends none.
const card = quantizeRegion({ x: 10, y: 20, w: 32, h: 44, radius: 4.6, alpha: 1, angle: 0.41887902 });
assert.equal(card.angle, 0.419);
assert.equal("angle" in quantizeRegion({ ...card, angle: 0.0002 }), false, "a near-zero turn is upright");
assert.equal(sameRegions([card], [{ ...card, angle: 0.42 }]), false, "a turn is a change");
assert.equal(sameRegions([quantizeRegion({ ...card, angle: 0 })], [{ ...card, angle: undefined }]), true, "no turn equals 0");

// A fade compares by span and samples.
const fade = { offset: -0.04, length: 204.02, stops: [1, 0.5004, 0] };
const faded = quantizeRegion({ ...region, fade });
assert.deepEqual(faded.fade, { offset: -0, length: 204, stops: [1, 0.5, 0] });
assert.equal(sameRegions([faded], [quantizeRegion({ ...region, fade })]), true);
assert.equal(sameRegions([faded], [{ ...faded, fade: { ...faded.fade, offset: -10 } }]), false, "a moved fade is a change");
assert.equal(sameRegions([faded], [region]), false, "a fade appearing is a change");

// Corner radius from computed CSS: px, a percentage of the width (circles), the first of an elliptical pair.
assert.equal(cornerRadius("5px", 960), 5);
assert.equal(cornerRadius("50%", 64), 32);
assert.equal(cornerRadius("4px 6px", 100), 4);
assert.equal(cornerRadius("0px", 100), 0);
assert.equal(cornerRadius("", 100), 0);

// clip-path inset() as computed: shorthand values, percentages of the box, calc() mid-transition; other clips are null.
assert.deepEqual(insetClip("inset(0px)", 54, 204), { top: 0, right: 0, bottom: 0, left: 0 });
assert.deepEqual(insetClip("inset(0px 0px 100%)", 54, 200), { top: 0, right: 0, bottom: 200, left: 0 });
assert.deepEqual(insetClip("inset(10% 4px 50% 2px round 3px)", 50, 200), { top: 20, right: 4, bottom: 100, left: 2 });
assert.deepEqual(insetClip("inset(0px 0px calc(37.5% + 2px) 0px)", 54, 200), { top: 0, right: 0, bottom: 77, left: 0 });
assert.deepEqual(insetClip("inset(0px 0px calc(50% - 4px))", 54, 200), { top: 0, right: 0, bottom: 96, left: 0 });
assert.equal(insetClip("none", 54, 200), null);
assert.equal(insetClip("circle(50%)", 54, 200), null);

// A mask gradient as evenly spaced samples, linear between its stops and held beyond them.
assert.deepEqual(sampleFade([[0, 1], [0.5, 0.5], [1, 0]], 5), [1, 0.75, 0.5, 0.25, 0]);
assert.deepEqual(sampleFade([[0.25, 1], [0.75, 0]], 5), [1, 1, 0.5, 0, 0]);
assert.equal(sampleFade([[0, 1], [1, 0]]).length, 16);

console.log("backdrop smoke passed");
