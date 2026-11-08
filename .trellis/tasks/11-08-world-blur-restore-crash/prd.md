# World blur crash when the game window restores

## Goal

Never copy outside the captured frame's texture when the game window restores from minimized.

## Background

A 0.12.0 player's SLUI exited about 1 s after closing the shop, at `game window restored`, with no `panic:` line
(twice in three logs). SL's display mode 「无边窗口化 - 后台时隐藏窗口」 minimizes the game whenever it loses the
foreground, so opening the shop minimizes it while the world blur capture keeps running.

A Windows.Graphics.Capture probe (minimize, restore, grow a window, recreating the pool on every ContentSize change,
like `on_frame`) showed:

- minimized: frame ContentSize 334x48 while its texture is still the previous size; the pool is recreated at 334x48;
- restored / grown: the first frame reports the new, larger ContentSize while its texture is still the old pool's size
  (334x48, or 1178x889 before a grow).

`on_frame` passes ContentSize to `render` as the frame size, so `source_box` lets `CopySubresourceRegion` read a box
outside the texture (undefined in D3D11). Repeating that copy in the probe removed the D3D device
(`DXGI_ERROR_DEVICE_REMOVED`) in 2 of 3 runs on the dev PC; on the player's driver the process dies.

## Requirements

- The frame size used for the source boxes is bounded by the frame texture's real size (its `D3D11_TEXTURE2D_DESC`),
  intersected with ContentSize (the texture may be larger than the content while the window shrinks).
- No change to when the capture starts, stops or recreates its pool.

## Acceptance Criteria

- [x] `render` never receives a frame size larger than the frame texture.
- [x] Unit test for the frame-size rule (content larger, texture larger, equal).
- [x] CI clippy (`-D warnings`) and the workspace tests pass.
- [x] Spec (`system-boundaries.md`, World blur) records the rule.

## Out of scope

- Recovering the engine after a device removal.
- Logging native crashes (exception code / module) to `slui.log`.
