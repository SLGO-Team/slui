# Implement: shop purchase refunds in SLUI

Branches:

- slui: `feat/shop-refund`. This is a visual PR, so auto-merge stays off until the user approves the
  visuals.
- Plugin and backend: `feat/slui-shop-refund`, cut from their `main`. After their tests pass, each is
  merged into its local `main` (`--no-ff`). Deploying stays with the user.

Work in the plugin's main checkout only after checking `git worktree list`. Another session plans
`10-26-cs2-shop-sfx-alignment` in a plugin worktree; it touches `ShopAudioManager` and the SLUI audio,
not the files below.

## Checklist

1. [x] Protocol (`packages/protocol`):
       - types;
       - `parseShopSnapshot` (`refundable`, `has_refundable`);
       - `parseCommand` (`command.shop.refund`, `command.shop.refund_all`);
       - `COMMAND_KINDS`;
       - v0 schemas, examples and README "Shop refunds";
       - `scripts/contract-smoke.mjs`.
2. [x] Plugin:
       - the `ShopRefundManager.RefundsChanged` event, fired on transitions only, and its forward in
         `ShopManager`;
       - the sidecar facts, rules, DTO and writer;
       - `CommandMessage` parsing;
       - `SidecarCommandHandler` with `SidecarCommandRules.ForShopRefund`;
       - the `SidecarIpcManager` dirty hook;
       - `Slgo.Tests` coverage for the rules, the parsing, the writer, the mapping and the event
         transitions;
       - `Features/Sidecar/CLAUDE.md` and `Features/Shop/CLAUDE.md`.
3. [x] Backend:
       - the IPC schema enum;
       - examples and contract tests;
       - the hub rate-limit check;
       - the dev client verbs `refund <item_id>` and `refund-all`.
4. [x] SLUI model:
       - the refund commands and targets;
       - `refundPending`, `refundsSupported` and `canRefundAll`;
       - `canSendShopCommand`;
       - `scripts/shop-model-smoke.mjs` cases for send gating, pending, a silent rejection and a
         rejection with a reason.
5. [x] SLUI input and logic, without new visuals:
       - the card wrapper with a sibling undo button;
       - Backspace and Delete in the key handler;
       - the navbar button;
       - the sound triggers;
       - App wiring (no change expected beyond `onCommand`).

       Check that without refund state the 1080p captures stay pixel-identical to `main`.
6. [x] **Gate (D3): the user's CS2 capture.** Take it at 1920x1080 in an offline practice match with
       bots, during buy time, after buying a rifle and a grenade, with the buy menu open:
       - (a) nothing hovered;
       - (b) the mouse over the undo button on a card, with its tooltip;
       - (c) the mouse over `[DEL]全部退款`, if possible.

       Measure the button geometry, colours and tooltip from it. For the icon's shape, extract `undo.vsvg`
       from the local CS2 VPK with the existing local tools as a reference only; it is never committed.
7. [x] SLUI visuals:
       - `public/assets/icons/undo.svg`, drawn by SLUI;
       - the undo button CSS (idle and hover) and the tooltip, if the capture shows one;
       - the navbar button.

       Mock: the `shopRefunds` debug option, the panel select and the URL parameter. Then take 1080p
       captures beside the user's capture.
8. [x] Checks:
       - slui: `npm run lint && npm test && npm run build`, then 1080p headless-Edge captures of the
         mock, with the local capture tooling used in task `10-22-shop-teammate-requests`. The
         `shop-layout-audit` and `shop-visual-audit` scripts that spec §8 names no longer exist in
         `package.json`; fix that sentence in step 9;
       - backend: `bun test`;
       - plugin: `dotnet test`.
9. [x] Spec updates:
       - `system-boundaries.md` shop bullets: refundability is plugin-owned, the keys, silent refusals,
         capability by `has_refundable`;
       - `cs2-visual-replication.md` §8: undo button geometry from the capture, the card wrapper.

       Then commit and open the PR without auto-merge, and hand the user the preview URLs and captures.
10. [ ] Live test with the user, after the plugin and backend are deployed or on the local server. Covers
        AC1-AC6 (and AC7 against an older plugin, if one is at hand).

## Validation commands

- slui: `npm run lint && npm test && npm run build`
- slgo-backend: `bun test`
- plugin: `dotnet test` (solution path in the plugin's AGENTS / CLAUDE)

## Rollback

Each repo's change is one branch, so revert the merge or the PR. The protocol change is additive, and
SLUI hides the refund UI without the plugin fields.
