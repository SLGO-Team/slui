# Design: shop purchase refunds in SLUI

## 1. Boundaries

| Repo | Owns |
| --- | --- |
| `../SLGO` (plugin) | Every refund rule and the refund transaction (already shipped in `6d5482a`, unchanged). This task adds what the viewer may refund now as snapshot fields, an immediate republish when the refund state changes, the two command handlers, and the result mapping. |
| `../slgo-backend` (sidecar) | Relaying the two new commands (authenticated player id, rate limit), contract fixtures, dev client. |
| `slui` `packages/protocol` | Wire contract: two optional snapshot fields, two commands, result kinds; parsers, schemas, README, examples. |
| `slui` app | Input (undo button, Backspace, navbar button, Delete), pending state, the undo button and navbar visuals, banner, sound trigger. |

SLUI never decides refundability: it shows the undo button only where the plugin says `refundable`, and the
plugin rechecks every command.

## 2. Contract

### 2.1 `shop.snapshot` (additive, optional)

```json
{ "balance": 3100, "window_open": true, "has_refundable": true,
  "items": [ { "item_id": "GunE11SR", "...": "...", "purchasable": false,
               "unavailable_reason": "你已经拥有 E-11 SR", "refundable": true } ] }
```

- `refundable` (item): `ShopRefundView.AmountFor(item) != null`, meaning `command.shop.refund` for this item
  would refund now. The view already folds in the shop gate (`ShopRefundManager.GetView` returns `None`
  unless `EvaluateAccess == Ok`), so a closed window never shows a button. The plugin writes the field
  only when it is true, to keep the payload small, and SLUI treats it as absent = false. The parser
  rejects a non-boolean value.
- `has_refundable` (top level): `ShopRefundView.HasAny`. Plugins with refunds always write it, true or
  false. Its presence is the capability signal: without it SLUI draws no refund UI and ignores
  Backspace and Delete.
- No amount is sent (D2). `GetRefundableAmount` stays plugin-internal for the in-game Hint shop.
- Older SLUI ignores both fields: the parser copies only known top-level fields and leaves items
  untouched.

### 2.2 Commands

```json
{ "kind": "command.shop.refund", "command_id": "refund-abc", "item_id": "GunE11SR" }
{ "kind": "command.shop.refund_all", "command_id": "refund_all-abc" }
```

- `command.shop.refund`: `ShopManager.RefundItem` for the item. The item is looked up as
  `TryPurchaseRemote` does: in the visible catalog, by `SidecarShopCatalog.ItemId`.
- `command.shop.refund_all`: `ShopManager.RefundAll`.
- `command.result.command_kind` gains both kinds. Results map as follows:

| Plugin outcome | `status` | `reason` |
| --- | --- | --- |
| `None` (success) | `accepted` | — |
| `InventoryOverflow` | `rejected` | `HudMessageCatalog` text of `result.Notice` ("退款后背包将超出容量"); no HUD message is shown |
| `NotRefundable`, `Unavailable`, `Busy` | `rejected` | none: silent, like the in-game keys and CS2's absent button |
| unknown `item_id` | `rejected` | `商品不存在` (same text as a purchase) |
| `InternalError`, exception | `failed` | `internal-error` |

## 3. Plugin (`../SLGO`)

- `ShopRefundManager` gets `event Action RefundsChanged`, raised through `SafeEvent` whenever the ledger's
  observable state changes:
  - a receipt is recorded;
  - an entry first becomes used. The ledger's mark is idempotent, and the event fires only on the false
    → true transition, never once per shot;
  - entries are removed by a refund;
  - entries are cleared (a phase change, a reset, a team change, a death, the player leaving).

  `ShopManager` forwards it as `RefundsChanged`.
- `SidecarIpcManager` subscribes: `RefundsChanged` sets `shopDirty`, so the next pump frame checks every
  snapshot, deduplicated by signature as for requests. Inventory-only changes, such as dropping a refundable
  gun and picking it back up, stay on the existing 1 s refresh while the window is open.
- Sidecar mapping:
  - `SidecarShopItemFacts` gains `Refundable`.
  - The rules input gains `HasRefundable`, computed from one `GetRefundView(player)` per snapshot build,
    not one per item.
  - `SidecarShopRules.Build` maps both (pure, tested).
  - `ShopSnapshotPayload.WriteTo` writes `refundable: true` on refundable items and always writes
    `has_refundable`.
- Commands:
  - `CommandMessage` (`Ipc/IpcIncomingMessages.cs`) accepts `command.shop.refund`, which needs `item_id`,
    and `command.shop.refund_all`, which needs no extra field.
  - `SidecarCommandHandler` dispatches both and force-publishes the actor's snapshot before the result,
    as for purchases.
  - `SidecarCommandRules.ForShopRefund(ShopRefundResult)` does the mapping in §2.2 and is pure and tested.
  - The remote path plays no plugin sound and shows no HUD message: `RefundItem` and `RefundAll` are
    already settle-only, and the handler never shows `result.Notice`.
- Docs: `Features/Sidecar/CLAUDE.md` (snapshot fields, commands), `Features/Shop/CLAUDE.md` (the
  event), and the plugin spec where it lists the sidecar commands. Tests in `Slgo.Tests` cover the rules,
  the command parsing, the writer, and the event-transition rule in the ledger.

## 4. slgo-backend (`../slgo-backend`)

- `protocol/ipc/v1/command.schema.json`: the kind enum gains both kinds. New examples
  `command-shop-refund.example.json` and `command-shop-refund-all.example.json`; the contract tests run
  every example through `parseCommand`.
- The hub's command parsing comes from `@slgo/protocol` (junction). Check that its rate limit counts the
  new kinds in the shop family. The dev client gains the verbs `refund <item_id>` and `refund-all`.

## 5. SLUI

### 5.1 Protocol (`packages/protocol`)

- `ShopItem.refundable?: boolean`, `ShopSnapshot.has_refundable?: boolean`.
- `ShopRefundCommand` and `ShopRefundAllCommand` join `ShopCommand` and `COMMAND_KINDS`.
- `parseShopSnapshot` validates both fields as booleans when present. `parseCommand` handles both kinds,
  and refund needs a non-empty `item_id`.
- v0 schemas, README section "Shop refunds", examples, and `scripts/contract-smoke.mjs`.

### 5.2 Model (`src/features/shop/model.ts`)

- `createRefundCommand(itemId)` and `createRefundAllCommand()`. `shopCommandTarget` gives `refund:<item>`
  and `refund-all`.
- `canSendShopCommand` requires `window_open`. Refund also needs the item's `refundable === true`; refund
  all needs `has_refundable === true`.
- `ShopItemView.refundPending`: a `refund:<item>` command is in flight.
- `ShopViewModel.refundsSupported`: the snapshot has `has_refundable`. `ShopViewModel.canRefundAll`:
  the shop is live, the window is open and `has_refundable` is true.
- Results resolve through the existing `command-result` path. A rejection without a reason leaves the
  banner empty (existing behaviour), which is how the silent refusals stay silent.

### 5.3 Panel (`ShopPanel.tsx`, `ShopPanel.css`)

- Card structure follows CS2's `button-container`: a wrapper holds the existing card `<button>` and,
  as a sibling, the undo `<button>`, since buttons cannot nest. The wrapper takes the card's 90px
  height, its margin and its flex shrink (min-height 0), because the card used to shrink so that a
  six-item column fits its 500px. With that, the layout without refund state stays pixel-identical
  (checked against `main` captures).
- Undo button:
  - Rendered only when the card is `refundable`, independent of `purchasable`. An owned, unpurchasable
    card still offers its refund, drawn in its own wash rather than the card's disabled greys.
  - Placed in the bottom-left corner. The icon is a mask of a SLUI-drawn `public/assets/icons/undo.svg`,
    traced from the CS2 `undo.vsvg` shape as a local reference that is never committed.
  - The user's capture (2026-10-26, 2000x1250) agrees with Panorama: 20 px, 8 px left, 5 px bottom,
    `rgb(133,133,133)`, white on hover.
  - Hovering it takes the hover from the card (the capture shows no details card then). The card keeps
    its own pointer handlers, and the button only drives the tooltip.
  - The 退款 tooltip is CSGOTooltipManager's TooltipText at the capture's geometry: 81x52, the label
    16 px in, centred on the button 19 px to its right. It is drawn on the design canvas from the
    button's box, so the scroll boxes never clip it, and hidden once the card stops being refundable.
  - If a card is both `requested` and `refundable` (not expected: the requester owns the role), the undo
    button takes the corner and 已请求 is hidden.
- Single refund, by clicking the undo button (with `stopPropagation`, so the card never purchases) or by
  pressing Backspace (`event.code === "Backspace"`) over the hovered card:
  - a refundable card with no refund in flight: play `purchase`, clear the denial, send
    `command.shop.refund`;
  - anything else: nothing.
- Refund all: the navbar button `[DEL]全部退款` sits in CS2's order, after the for-teammate hint and
  before `[ESCAPE]返回`, and shows whenever `refundsSupported`. Clicking it or pressing Delete
  (`event.code === "Delete"`) sends `command.shop.refund_all` when `canRefundAll` and no refund all is in
  flight; otherwise nothing happens. It plays no sound. The key handler skips repeats and modified keys
  like the existing ones, and calls `preventDefault` for both keys while the shop is visible.
- Success needs no UI of its own: the actor's snapshot arrives first (balance, cards), then the result.

### 5.4 Mock

- Debug option `shopRefunds` (`src/mocks/shopDebug.ts`) with the values `none`, `some` and `rejected`,
  plus a debug panel select and a URL parameter, like `shopRequests`:
  - `some` sets `has_refundable` and marks items `refundable` in the current debug snapshot. On the SCP
    snapshot that is a role and an upgrade; where the debug snapshot carries NTF items, a rifle that is
    owned and unpurchasable, a grenade that is still purchasable, and armour.
  - `none` leaves the snapshot without the field (a plugin without refunds), so the default scenes keep
    their earlier captures.
  - `rejected` adds a refund command answered with the overflow text, to capture the banner.
- The scenes are static, as the existing debug states are. Command plumbing is covered by
  `scripts/shop-model-smoke.mjs`.

## 6. Compatibility and rollout

| Plugin \ SLUI | Old SLUI | New SLUI |
| --- | --- | --- |
| Old plugin | as today | no fields → no refund UI; Backspace and Delete do nothing |
| New plugin | fields ignored; Delete works only while the SLUI shop is closed (game key) | full refund UI |

The plugin and backend ship together for the live test (deploy stays with the user). The SLUI change
ships in the next release PR. The protocol change is additive.

Ordering with `10-26-cs2-shop-sfx-alignment`: both edit `ShopPanel.tsx`. Whichever PR opens second rebases
onto the first, and the two never run `finish-work` on parallel open PRs (journal conflict). This task
only calls `audio.play("purchase")`. When that task changes what `purchase` plays, the single refund
follows without further change.

## 7. Rollback

Each repo's change is one branch or PR, so revert the merge. Without the plugin fields SLUI hides
everything, so reverting the plugin alone is safe.
