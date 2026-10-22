# Design: shop teammate purchase requests

## 1. Boundaries

| Repo | Owns |
| --- | --- |
| `../SLGO` (plugin) | Every request rule and the proxy-purchase transaction (unchanged); which requests a viewer sees, what they may request, the payer's affordability; the actor's result text. |
| `../slgo-backend` (sidecar) | Relaying the two new commands (authenticated player id, rate limit), contract fixtures, dev client. |
| `slui` `packages/protocol` | Wire contract: optional snapshot fields, two commands, result kinds; parsers, schemas, README, examples. |
| `slui` app | Input (R / right-click, entry click), pending state, the request area and card tag, banners, sounds. |

## 2. Contract

### 2.1 `shop.snapshot` (additive, all optional)

```json
{ "items": [ { "item_id": "Scp173", "...": "...", "requestable": true, "requested": true } ],
  "requests": [
    { "request_id": "17", "requester_player_id": "76561198000000007", "requester_name": "Nova",
      "item_id": "Scp939", "name": "SCP-939", "description": "...", "icon_url": null,
      "category_id": "scp-mid", "price": 2900, "purchasable": false, "unavailable_reason": "余额不足" } ] }
```

- `requestable` (item): the viewer may send a request for this item now as far as the mode and scope go
  (`ShopRequestRules.EvaluateCreate == None`). Requester state (owned, ineligible, buy zone) is not folded
  in: the toggle answers with the plugin's reason, as the in-game R key does.
- `requested` (item): the viewer's own pending request is this item (`GetOwnRequestedItem`).
- `requests`: what the viewer may fulfil now, in the plugin's roster order (`GetVisibleRequests` with the
  SLUI shop counted as open). Never the viewer's own request. `request_id` is the plugin's stable id as a
  decimal string (1-32 chars); `requester_name` non-blank, at most 64 UTF-16 units (`MAX_HUD_TEXT_LENGTH`
  family); `price` is the requester's effective price; `category_id` is the item's column in the
  viewer's own catalog variant (null -> SLUI uses the last column, like unassigned items);
  `purchasable` / `unavailable_reason` follow the item rule order for the payer: access reason, then
  insufficient funds (`SHOP_REASON_INSUFFICIENT_FUNDS`). Rejecting unknown keys inside a request entry is
  safe (new structure), item / top-level unknown keys stay tolerated as today.
- Older SLUI ignores all three (the parser copies only known top-level fields and items untouched).

### 2.2 Commands

```json
{ "kind": "command.shop.request", "command_id": "request-abc", "item_id": "Scp173" }
{ "kind": "command.shop.fulfill", "command_id": "fulfill-abc", "request_id": "17" }
```

- `command.shop.request`: toggle (create / cancel / replace) exactly like the in-game R key.
- `command.shop.fulfill`: the proxy purchase transaction for that request id.
- `command.result.command_kind` gains both. `accepted` = done; `rejected` + `reason` = the plugin's text
  for the actor (the HUD catalog text the in-game path would have shown, `HudMessageCatalog.Format`);
  `failed` / `internal-error` for exceptions.

## 3. Plugin

- `ShopRequestManager`: `ToggleRequest` and `ConfirmProxyPurchase` return a `ShopRequestActionResult`
  (succeeded, actor `HudMessage`) instead of showing the actor's message themselves; a `remote` flag makes
  the SLUI shop count as open (`CanView` / `CanPay`) and skips the in-game purchase sound. The in-game
  callers (`ShopManager.RequestSelectedItem`, the request column's Enter) show the actor message exactly as
  before. Messages to the other party (requester's "X 为你购买了 Y") are unchanged.
  `GetVisibleRequests(viewer, bool remote)` (remote = shop counted as open).
- `ShopManager`: `PurchaseRequestsChanged` event (forwards `RequestsChanged`), `ToggleRequestRemote(player,
  itemId)` (item lookup as `TryPurchaseRemote`: visible catalog by `SidecarShopCatalog.ItemId`),
  `FulfillRequestRemote(player, requestId)`, `IsRequestable(player, item)`.
- Remote result mapping: success -> actor HUD message shown (Low notice, as in game) + `accepted`;
  refusal -> `rejected` with `HudMessageCatalog.Format(message)` and no actor HUD (the SLUI banner shows it).
- Sidecar: `SidecarShopItemFacts` gains requestable / requested; `SidecarShopRequestFacts` (request view +
  viewer category) -> `ShopSnapshotRequest` DTO; `SidecarShopRules.Build` maps them (pure, tested);
  `ShopSnapshotPayload.WriteTo` writes `requestable` / `requested` / `requests` only when the request path
  is open for the viewer's team (keeps NTF payloads byte-identical). `SidecarIpcManager` subscribes to
  `PurchaseRequestsChanged` -> `shopDirty` (next pump frame republishes the team's snapshots).
- `CommandMessage` reads `request_id`; validity: request needs `item_id`, fulfill needs `request_id`
  (numeric string). `SidecarCommandHandler` dispatches both, force-publishes the actor's snapshot first,
  then the result (same order as purchase).

## 4. slgo-backend

- `protocol/ipc/v1/command.schema.json` kind enum + `command-shop-request.example.json`,
  `command-shop-fulfill.example.json`; contract tests run every example through `parseCommand`.
- Command parsing comes from `@slgo/protocol` (junction), so the hub accepts the new kinds with no code
  beyond its rate limit (check it counts shop commands by kind family) and the dev client verbs
  `request <item_id>` / `fulfill <request_id>`.

## 5. SLUI

### 5.1 Model (`src/features/shop/model.ts`)

- `ShopCommand = ShopPurchaseCommand | ShopRequestCommand | ShopFulfillCommand`; the pending map keeps
  `target` = `item:<id>` or `request:<id>`; `ShopAction "command"` replaces `"purchase"` (purchase keeps
  `canPurchase`; request needs the item; fulfill needs the request in the snapshot). Results resolve by
  command id for all kinds (existing path); rejected / failed set `failureReason`.
- `ShopViewModel.requests: ShopRequestView[]` (entry + commandState / unavailable / disabled, as items);
  `canRequest` = any item requestable; items keep `requestable` / `requested`.

### 5.2 Panel

- Request area under `.shop-body` inside `.shop-left`, CS2 `buymenu__ground-weapons`: `rgb(0 0 0 / 62%)`
  plate (same fill and dot grid as the body), height 0 / opacity 0 -> shown with a 0.2 s height+opacity
  transition while `requests.length > 0`. Watermark "队友请求" (90px Stratum2 Medium Condensed black,
  10px letter-spacing, centred, under the listers; colour measured from the baseline).
- D3 geometry: shown -> `.shop-body` height 551 px (CS2 measured), area 176 px (y 827..1003), 10 px gap.
- Listers: one per column, same widths as `groupShopItems` (border-box, 0 15px padding, 7px top margin,
  vertical scroll). Entry: 30 px, `#30303080`, radius 5, padding 4px 6px, 4 px gap; icon 20 px tall left
  (team wash mask); right-aligned requester name (ellipsis) + price, 14 px Stratum2 medium, wash colour.
  Hover brightness 2.2 / 0.2 s; unavailable entries take the card's cant-buy greys.
- Entry hover: select / unavailable sound, preview image, details card (`{requester} 请求购买 {item}` +
  description). Click: blocked -> deny (+ banner reason when unavailable); else purchase cue + fulfill.
- Requester: R (keydown, no repeat, no modifiers) over a hovered card or right-click on a card sends
  `command.shop.request` when `canRequest`; the requested card shows "已请求" in its free bottom-left corner
  (key's 40% white; a CS2 nux-style ribbon was rejected as too loud); the navbar shows the grey for-teammate label `按[R]或右键请求队友购买` left of `[ESCAPE]返回`.
- App: `onPurchase` becomes `onCommand(ShopCommand)`; `beginCommand` replaces `beginPurchase`.

### 5.3 Mock

- `shopRequests` debug option: `none` / `payer` (three requests over two columns, one unaffordable) /
  `requester` (role items requestable, one requested); debug panel select; scenes reachable by URL.

## 6. Compatibility and rollout

Plugin, backend and SLUI ship together for the live test (plugin + backend deploy, SLUI build). Older SLUI
with the new plugin: fields ignored, no request UI (as today). New SLUI with an older plugin: no
`requests` / `requestable` -> nothing drawn, no hint.
