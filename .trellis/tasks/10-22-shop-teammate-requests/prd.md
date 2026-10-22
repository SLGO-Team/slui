# Shop teammate purchase requests (SCP request area)

## Goal

The plugin now lets an SCP player request a shop item from teammates, and lets a teammate pay for it
(plugin `689f426`, `c926230`). Its UI so far is the in-game Hint shop only: SLUI users (whose B key opens
the SLUI shop) can neither request nor fulfil. SLUI adapts the feature by bringing back CS2's buy-menu
"dropped weapons" area (`buymenu__ground-weapons`, left out of the 08-25 shop) as the SCP side's
"teammate requests" area.

## Background (evidence)

- CS2 reference: `../cs2ui/panorama/layout/buymenu.xml:39-48,88-97`, `styles/buymenu.css:966-1081`
  (area, title watermark, per-category listers, `ground-weapon-entry`), `:65-79` (`buymenu__for-teammate`
  navbar label), `:120-130` (`.donate` banner), `:485-502` (`promoted-label` corner tag).
- Live 1080p baseline from the 08-25 shop research (`research/buymenu-live-1920x1080.png`, kept out of this
  repo): the area is expanded with one dropped AK-47 under the rifles column. Measured: item plate y 226..777 (551 px), area y 787..1003 (216 px),
  10 px gap, area bottom 19 px above the navbar border (y 1022); the watermark "掉落的武器" sits under the
  entries; the navbar shows the grey "按住[左 CTRL 键]购买并投掷" label (CS2's buy-for-teammate).
- SLUI shop (`src/features/shop`): content shifted down 40 px (`--shop-content-top`) because the detailed
  team counter reaches y 196; item plate `min-height: 590px` (y 266..856), navbar y 1022..1080.
- Plugin (`../SLGO`): `Features/Shop/ShopRequestManager.cs` (toggle / visible requests / proxy purchase
  transaction), `ShopRequestRules.cs`, `ShopRequestView.cs`; SLUI wiring in `Features/Sidecar`
  (`SidecarShopSnapshotBuilder/Rules/Publisher`, `SidecarCommandHandler`). Request visibility and
  fulfilment currently also require the in-game shop to be open (`CanView(..., viewerShopOpen)`), which a
  SLUI user never has.
- Plugin requirements this task must keep (plugin task `08-13-teammate-purchase-requests`): one request
  per requester (same item cancels, other item replaces); requester balance never matters; visible only to
  same-team teammates who may use the shop, never to the requester; payer pays the requester's current
  effective price, requester receives; at most one fulfilment per request; first version SCP path only.

## Decisions (user, 2026-10-22)

- D1 The CS2 dropped-weapons area returns as the SCP side's teammate-request area.
- D2 The requester requests / cancels by pressing R over a card or right-clicking it.
- D3 Geometry from the live baseline (the user pointed to the earlier research screenshot): keep the 40 px
  shift; while the area is shown the item plate takes CS2's measured 551 px (cards do not move) and the
  area ends at CS2's y 1003, 10 px under the plate.
- D4 Known limitation, not solved here: if SLGO later adds picking up dropped weapons and enables NTF
  requests, both would want this one area.

## Requirements

- R1 Plugin: `shop.snapshot` carries, per viewer, which items they may request, which item they have
  requested, and the teammates' requests they may fulfil (requester, item, the requester's effective price,
  whether the viewer can pay now and why not). Request changes reach every affected SLUI at once.
- R2 Plugin: two SLUI commands, request toggle (item) and fulfil (request id), run the same rules and
  transaction as the in-game shop, with the SLUI shop counting as an open shop. The actor's refusal reason
  comes back in `command.result`; success notices and the other party's notices stay HUD messages.
- R3 slgo-backend relays both commands (IPC contract, examples, tests, dev client).
- R4 `@slgo/protocol`: optional snapshot fields, the two commands and their results; schemas, README,
  examples. Older SLUI keeps working (additive fields).
- R5 SLUI: the request area under the item plate (shown only while requests exist), one lister per
  category column, entries in the CS2 ground-weapon style with the requester's name and price; click to
  fulfil; unavailable entries refuse with the reason in the failure banner.
- R6 SLUI: R / right-click toggles a request on a requestable card; the requested card carries a corner
  tag; the navbar shows the request hint in CS2's grey for-teammate style while requesting is possible.
- R7 Mock / debug scenes for requester and payer views, and tests at every layer.

## Acceptance Criteria

- [ ] AC1 (R2, R6) SCP in SLUI: R or right-click on a role card creates the request (HUD notice, corner
      tag); again on the same card cancels it; on another card replaces it. Out-of-scope items show the
      refusal in the failure banner.
- [ ] AC2 (R1, R5) A teammate's SLUI shows the request under the item's column at once; the requester's
      own SLUI never lists it; NTF and opponents never see it.
- [ ] AC3 (R2, R5) Clicking the entry buys it for the requester at the requester's price, paid by the
      viewer; the entry disappears for all teammates; both sides get their notices.
- [ ] AC4 (R5) Unaffordable entry: drawn unavailable; clicking refuses with the reason; the request stays.
- [ ] AC5 (R2) Two teammates fulfilling the same request: one succeeds, the other gets the refusal reason.
- [x] AC6 (D3) 1080p capture: area 176 px, bottom at y 1003, plate 551 px while shown; without requests the
      shop is unchanged.
- [x] AC7 (R3, R4) Example payloads parse in slui (`npm test`), slgo-backend (`bun test`) and plugin tests.
- [ ] AC8 Visual: mock captures beside the CS2 baseline, then the user's approval (and in game).

Verified 2026-10-22: slui `npm run lint`, `npm test`, `npm run build:local`; slgo-backend `bun test` (465);
plugin `dotnet test` (2061). 1080p mock captures (`shopRequests=payer|requester|crowded|none`): plate
266..817 and area 827..1003 while shown, entries from y 834, navbar at 1022; R / right-click send
`command.shop.request`, an entry click `command.shop.fulfill`, an unaffordable entry refuses with 资金不足.
AC1-AC5 need the deployed plugin and backend (live test).

## Out of Scope

- NTF requests, picking up dropped weapons, the D4 conflict.
- Choosing a specific teammate, request history, cross-round requests.
- Changing the in-game Hint shop's request UI.
