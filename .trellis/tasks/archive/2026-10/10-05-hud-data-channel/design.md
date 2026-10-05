# Design: HUD data channel

Authoritative wire shapes and publisher rules: parent `design.md` sections
2-4. This file records only placement decisions.

- Protocol: types and parsers in `packages/protocol/src/index.ts` next to the
  chat payloads; schemas `hud-messages.schema.json` / `round-result.schema.json`
  plus `.example.json` files in `packages/protocol/v0`; README message table.
  `HUD_TONES` exported as a readonly tuple so the plugin test and renderers
  share the list.
- Text limit 256 chars, key pattern `^[A-Za-z0-9_]{1,96}$`, ms values are
  integers in `0..86_400_000`.
- Backend: `apps/sidecar/src/ipc/messages.ts` enums; replay age adjustment in
  `hub.ts` build path, alongside the existing per-build avatar fill, using
  the cache entry's receive time from a monotonic clock. Only the two new
  types are adjusted.
- Plugin: payload classes in `Features/Sidecar/Ipc/IpcPayloads.cs`, rules
  (pure, testable) in `Features/Sidecar/SidecarHudRules.cs`, wiring in
  `SidecarIpcManager` (subscribe/unsubscribe pairs in Initialize/Shutdown,
  event handlers only mark dirty per player; publishing happens in the pump).
  Title text from `HudMessageRules.ResultTitleFor` + catalog; outcome mapping:
  participant same team -> won, other team -> lost, observer -> observer,
  null winner -> draw.
- Mock: `src/mocks/provider.ts` gains a scripted HUD state machine selectable
  from the debug panel (`hudScene=` URL parameter) with one fixture per
  captured state from the parent research file.
