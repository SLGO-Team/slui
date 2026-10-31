# Design: measure backdrop panels only when something can have changed

## Current loop (`src/platform/backdrop.ts`)

`registerBackdrop` adds the element to `registry` and starts a `requestAnimationFrame` loop. Every frame
`tick` → `send()` measures every registered element (`measure`: `getComputedStyle` on the element and every
ancestor, `getBoundingClientRect`, `offsetWidth/Height`, clip and corner radius), quantizes, and calls the sink
only when `sameRegions` says the list changed. Unregistering queues a microtask `flush` that measures at once.

Measured in the default mock overlay (production React, `research/build-mock-profile.mjs`): 7 registered
panels, 60 measurements/s at ~190 µs each, 0 region updates/s while idle; skipping the measurement drops main
thread Script from 44–49 to 33–35 ms/s (Layout and RecalcStyle unchanged, so the forced layout is not extra
work, the JS and style reads are).

## What can change a region

`measure` reads, for the element E: its layout box and on-screen rect, and for E and each ancestor: `display`,
`visibility` (E only), `opacity`, `transform`, plus E's `clip-path` and `border-top-left-radius`. A region can
change only if one of these changes:

| Source | Signal used |
|---|---|
| E or an ancestor gets a new class, style or other attribute (React commits, `--*-scale` variables) | `MutationObserver`, `attributes: true`, on E and each ancestor (no subtree) |
| A CSS transition or animation on E or an ancestor (fades, `clip-path` openings, `height .2s`) | `document.getAnimations()` has an animation whose `KeyframeEffect.target` is E or contains E |
| E moves or resizes because of content, siblings, fonts, images, the window | E's `getBoundingClientRect()` / `offsetWidth` / `offsetHeight` differ from the last measured frame |
| A panel registers or unregisters | existing paths: register starts the loop with a measuring frame, unregister flushes |
| Anything else (a rule keyed on `:hover`, a sibling combinator or `:has()` that changes one of the read properties) | a full measurement at least every 500 ms |

Descendant changes inside E (the radar's per-frame marker writes) produce no signal unless they change E's box.
Today no `:hover`/`:has()` rule changes a property `measure` reads (`:has()` in HudTeamCounter.css only sets
`z-index`); the 500 ms measurement bounds a future one to half a second of lag instead of a stuck blur.

## Per-frame decision

```ts
function tick(now) {
  frame = null;
  if (needsMeasure(now)) send(now); else skipped(now);
  if (registry.size > 0) frame = requestAnimationFrame(tick);
}
// needsMeasure: observer.takeRecords() non-empty or a relevant animation → dirtyFrames = 2;
//   now - lastMeasureMs >= 500 → true; dirtyFrames > 0 → dirtyFrames--, true;
//   any element's box differs from the cached one → true; else false.
```

`dirtyFrames = 2` measures the signalled frame and the next one, so the end state of a transition (the first frame
with no running animation) is still measured. `send()` refreshes the box cache and `lastMeasureMs`; `flush()` keeps
measuring unconditionally. The observer is rebuilt (disconnect + observe every chain) whenever the registry changes;
it is created lazily, so the module still imports in Node (`backdrop-smoke`).

If `document.getAnimations` is missing, every frame counts as animating (today's behaviour).

## Self-check in the mock preview

In the mock mode only (`MOCK_STANDIN`, a build-time constant that drops the code from packages),
`window.__SLUI_BACKDROP_DEBUG__ = { measured, skipped, stale, check }`. With `check` set to `true` (from a test page),
every skipped frame is measured anyway and compared with the last sent list; `stale` counts the frames whose skipped
measurement would have changed the regions. That is the equivalence criterion: an audit run with `stale === 0`
sent the same region updates the per-frame loop would have.

## Compatibility and rollback

- `registerBackdrop`, `useBackdropRef`, `measure`, quantization, sinks and the Rust command are unchanged.
- One commit; reverting it restores the per-frame loop.
