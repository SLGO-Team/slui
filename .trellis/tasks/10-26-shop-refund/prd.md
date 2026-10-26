# Shop purchase refunds in SLUI

## Goal

The plugin now lets a player undo their own purchases of this round inside the buy window and get the
full amount back, as CS2's sellback does (plugin `../SLGO` `6d5482a`, task `10-25-cs2-purchase-refund`).
Its entry points are in-game only: the SSS key 退款 (Backspace, the Hint shop's selected item) and
全部退款 (Delete, works without an open shop). While the SLUI shop is open it holds the foreground, so
neither key reaches the game, and SLUI shows no refund state at all. Bring refunds into the SLUI shop the
way CS2's buy menu has them: an undo button on each refundable card and a "[DEL] 全部退款" navbar button.

## Background (evidence)

- CS2 reference (`../cs2ui/panorama`):
  - `layout/buymenu.xml:22-40`: every `ItemPanel` holds the `BuyButton` and, as a sibling, a
    `SellbackButton` (an `undo.vsvg` image in a `TooltipPanel` with `#BuyMenu_Sellback` = 退款).
  - `layout/buymenu.xml:110-126`: the navbar row is for-teammate label, rebuy, autobuy, then a
    `PopupButton` running `sellbackall` (`#BuyMenu_Sellbackall` = `[{s:bind_sellbackall}] 全部退款`),
    then back.
  - `styles/buymenu.css:824-860`: `.sellback-button` is collapsed unless the card has `.can-sellback`,
    bottom-aligned, wash `rgb(133, 133, 133)`, white on hover; the image is 20 px with margin-left 8 px
    and margin-bottom 5 px.
  - The 08-25 live 1080p baseline navbar reads `[F4]再次购买先前物品 [F3]自动购买 [DEL]全部退款
    [ESCAPE]返回`, so CS2's default sellbackall bind is DEL, the same as the plugin's default. The
    baseline has no refundable card.
- CS2 behaviour (plugin task research `research/cs2-sellback.md`): the client plays
  `UIPanorama.buymenu_purchase` and then sends `sellback <id>`; `sellbackall` plays nothing; there is no
  chat line or notice on success, only the balance and card state change.
- Plugin API (`SLGO/Features/Shop/ShopManager.cs`, `ShopRefundManager.cs`, `ShopRefundResult.cs`):
  - `RefundItem(Player, ShopItem)` refunds the item's latest refundable purchase; for a role this
    includes the upgrades bought on it. `RefundAll(Player)` refunds everything refundable (items, then
    armour, then SCP purchases from the latest back).
  - Both return a `ShopRefundResult`: `None` (success), `Unavailable` (shop gate), `NotRefundable`,
    `InventoryOverflow` (carries the HUD message "退款后背包将超出容量"), `Busy` (a role restore is still
    pending) or `InternalError`. Both settle only: no sound and no HUD message.
  - `GetRefundView(Player)` / `GetRefundableAmount(Player, ShopItem)` / `HasRefundableEntries(Player)`
    answer queries.
  - The plugin task left the SLUI contract (`command.shop.refund*`, snapshot fields) and the SLUI entry
    points to this task.
  - Ledger changes (a purchase recorded, an item fired or used, an SCP hurt or using a skill, a refund,
    a clear) raise no event.
- Plugin sidecar (`SLGO/Features/Sidecar`): shop snapshots are republished on balance changes, on
  `PurchaseRequestsChanged`, and every second while the window is open (`SHOP_SNAPSHOT_REFRESH_SECONDS`,
  deduplicated by signature). The command handler publishes the actor's snapshot before the
  `command.result` (pattern of task `10-22-shop-teammate-requests`).
- SLUI (`src/features/shop`):
  - Cards are `<button>`s.
  - The keyboard handles Escape, R over the hovered card, and 1-9.
  - The navbar shows the for-teammate hint and `[ESCAPE]返回`; CS2's rebuy and autobuy are left out.
  - Every shop command goes through `shopReducer`, keyed by target (`purchase:` / `request:` /
    `fulfill:`). A rejected or failed result with a reason fills the failure banner; one without a
    reason shows nothing.
- Shop sounds are being redesigned by the planned plugin-repo task `10-26-cs2-shop-sfx-alignment`, which
  also owns SLUI `audio.ts`: purchase plays only `radial_menu_buy_03` and the hover and select cues
  change. Its PRD expects this task's single refund to reuse its `purchase` cue.

## Decisions (user, 2026-10-26)

- D1 Single refund: click the CS2 undo button on a refundable card, or press Backspace over the hovered
  card. Backspace matches the in-game 退款 key and works like R for requests. Refund all: the navbar
  `[DEL]全部退款` button or Delete, which is CS2's bind and the plugin's default.
- D2 No refund amount anywhere, as in CS2: a refundable card only gains the undo button.
- D3 Visual baseline: the user captures CS2 in-game 1920x1080 screenshots of the buy menu with a
  refundable card: the undo button idle, the undo button hovered with its tooltip, and the navbar's
  全部退款 hovered if possible. The card and navbar visuals are built from that capture, which wins over
  the Panorama CSS.
- D4 (planning, from the evidence above) Sound mapping stays with `10-26-cs2-shop-sfx-alignment`: this
  task plays the existing `purchase` cue on a single refund and nothing on refund all, and does not edit
  the cue-to-file mapping in `audio.ts`.

## Requirements

- R1 `@slgo/protocol` (v0, additive):
  - Item field `refundable?: boolean`: `command.shop.refund` for this item would refund now.
  - Snapshot field `has_refundable?: boolean`: refund all would refund something now. Plugins with
    refunds always write it. If it is absent (older plugin), SLUI shows no refund UI.
  - Commands `command.shop.refund` (`item_id`) and `command.shop.refund_all`.
  - Result kinds for both commands.
  - Parsers, schemas, README, examples.
- R2 Plugin snapshot: write `refundable` from the refund view, with the same gate the plugin uses for
  refunds, and `has_refundable`. A change in refund state (purchase recorded, item used, SCP used,
  refund, clear) reaches the player's SLUI at once, not only on the 1 s refresh.
- R3 Plugin commands: the two commands run `RefundItem` (item looked up like a SLUI purchase) and
  `RefundAll`. The result maps as follows:
  - success: `accepted`.
  - `InventoryOverflow`: `rejected` with the HUD catalog text, and no HUD message.
  - `NotRefundable`, `Unavailable`, `Busy`: `rejected` with no reason, so SLUI stays silent as the game
    does.
  - an unknown item: `rejected` with `商品不存在`.
  - `InternalError` or an exception: `failed` / `internal-error`.

  The actor's snapshot is published before the result. The plugin plays no sound for these commands.
- R4 slgo-backend relays both commands: IPC schema enum, examples, contract tests, rate-limit check, and
  dev client verbs.
- R5 SLUI model:
  - Commands with targets `refund:<item>` and `refund-all`. A repeat of the same target waits for its
    result.
  - Item views carry `refundable` and `refundPending`. The view model carries `refundsSupported`
    (`has_refundable` present) and `canRefundAll`.
  - Sending needs a live snapshot with the window open: `refundable` for one item, `has_refundable` for
    all.
- R6 SLUI panel:
  - A refundable card shows the undo button in its bottom-left corner, whether or not the card itself is
    purchasable. Clicking the button refunds and never purchases. Backspace over a hovered refundable
    card does the same.
  - Backspace over a card that is not refundable, and refund all with nothing refundable, do nothing.
  - The navbar shows `[DEL]全部退款` in CS2's place (between the for-teammate hint and
    `[ESCAPE]返回`) whenever `refundsSupported`. The button or Delete sends refund all.
  - Sounds: a single refund plays the `purchase` cue when sent; refund all plays nothing.
  - A rejection with a reason shows in the failure banner. Success shows no notice.
  - The geometry and colours come from the D3 capture. The undo icon is a SLUI-drawn file, never copied
    from CS2.
- R7 Mock and debug: a `shopRefunds` debug option with scenes for NTF and SCP refundable cards, plus
  tests at every layer.

## Acceptance Criteria

- [ ] AC1 (R2, R3, R6) With the SLUI shop open, buy an E-11 SR. Its card shows the undo button. Clicking
      the button brings the balance back and removes the gun, with no notice and one purchase sound.
- [ ] AC2 (R6) Backspace over that refundable card refunds it. Backspace over a non-refundable card does
      nothing.
- [ ] AC3 (R2) Fire one shot: the undo button disappears at once (no 1 s wait).
- [ ] AC4 (R3, R6) Delete, or the navbar button, refunds every refundable purchase silently. Delete with
      the SLUI shop closed still works through the game key.
- [ ] AC5 (R3, R6) Heavy armour plus three grenades: the undo button on the armour refuses with the
      plugin's text in the failure banner, and the armour stays.
- [ ] AC6 (R3) As an SCP, refunding a bought role from SLUI returns the previous role, and its upgrades
      are refunded with it.
- [x] AC7 (R1, R5) Against a plugin without refunds (no fields): no undo buttons, no navbar button, and
      Backspace and Delete do nothing.
- [x] AC8 (R1, R4) Example payloads parse in slui (`npm test`), slgo-backend (`bun test`) and the plugin
      tests (`dotnet test`).
- [ ] AC9 (D3, R6) 1080p mock captures sit beside the user's CS2 capture (undo button idle and hovered,
      navbar), then the user approves them. Without refund state the shop matches the previous captures
      pixel for pixel.

Verified 2026-10-26:

- Tests: slui `npm run lint`, `npm test` and `npm run build:local`; slgo-backend `bun test` (493);
  plugin `dotnet test` (2264).
- Mock at 2000x1250, the size of the user's capture: the undo button, the 退款 tooltip and the text
  placement fall within about 2 px of the capture. The default, requester and SCP-079 scenes are
  pixel-identical to `main` at 1920x1080.
- In the browser preview:
  - Backspace over a hovered refundable card sends `command.shop.refund`.
  - Delete and the navbar button send `command.shop.refund_all`.
  - The undo button on a purchasable card refunds and never purchases.
- AC1-AC6 need the deployed plugin and backend (live test). AC9 waits for the user's visual approval.

## Out of Scope

- Showing refund amounts (D2).
- CS2's rebuy and autobuy navbar buttons, and the dropped-weapons panel.
- Shop sound mapping and its theme-pack files (`10-26-cs2-shop-sfx-alignment`, D4).
- Refund count limits, and the slgo-deploy dashboards for refund metrics.
- Changing the in-game Hint shop's refund UI.
