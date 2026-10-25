# CS2 Visual Replication Contracts

## 1. Scope / Trigger

These rules apply whenever a SLGO screen manually recreates a selected CS2 UI
screen or state in React.

The goal is high visual similarity and correct SLGO behavior. Building a
Panorama parser, generated DOM/CSS, compatibility runtime, or Source 2 renderer
is forbidden unless a future task explicitly changes this product decision.

## 2. Signatures

Feature components consume typed view models:

```typescript
type HudTeamCounterProps = {
  hud: RoundHudViewModel;
};

function hudScaleForViewport(width: number, height: number): number;
function avatarSource(player: HudPlayerView, side: "ct" | "t"): string;
function hudPlayerState(player: HudPlayerView): "alive" | "dead" | "offline";
```

The data flow remains:

```text
SLGO event -> contract parser -> selector/view model -> React component
```

Leaf components must not parse protocol payloads, call Tauri, or interpret
Panorama XML at runtime.

## 3. Contracts

### Visual authority

1. A fixed-viewport CS2 in-game screenshot defines the rendered result.
2. Panorama XML/CSS provide measurements and implementation evidence
   (reference only).
3. SLGO requirements define data, text, roles, and interactions.

When static source and observed output disagree, the in-game screenshot wins.

### Viewport

- The first baseline is 1920x1080.
- Every overlay follows Panorama's layout space: one uniform scale `height / 1080`
  (`overlayScaleForViewport`) and a design canvas 1080 units tall and
  `min(1920, 1080 * width / height)` units wide, centred. CS2's
  `endofmatch-characters.js` shows the rule (`1080 * (w / h) * 0.5 - 720` centres a
  1440 band). 16:10 gives a 1728-wide canvas, 4:3 a 1440-wide one; wider than 16:9
  keeps the 1920 canvas centred (ultrawide spreading is not replicated).
- Each canvas rule computes its width in CSS from the panel's scale variable:
  `width: min(1920px, 100vw / var(--<panel>-scale))` with
  `margin-left: calc(<same> / -2)`. No viewport is special-cased in JS.
- Panels keep their Panorama horizontal anchor on that canvas. A centred box is
  `left: calc(50% - <half width>px)`, never a 1920-based pixel offset; left and
  right anchors use `left` / `right` edge offsets. Children inside a positioned box
  keep box-relative offsets.
- Individual HUD regions must not independently reflow or use viewport-driven
  font sizing.

### World blur

- CS2 blurs the world under every panel whose Panorama style has `world-blur:
  hudWorldBlur` (scoreboard, alerts, hints, progress bar, killfeed rows, win panel
  result, bottom HUD centre circle and kill cards, radar, team counter equipment) and
  under the buy menu (`HudBlur` in `hud.xml`). `hud-blur-bg-color` is only a fill
  colour, not the blur. List: task research `cs2-world-blur-sources.md`.
- Such a panel puts `ref={useBackdropRef()}` on the element that draws its fill (SLUI's
  own world blur, system-boundaries 3.1) and keeps two fills: the dense stand-in as the
  default (no blur: setting off, Windows 10, capture failure) and the CS2 fill under
  `[data-world-blur="on"]`. A fill that was read from captures over CS2's blur and never
  made denser (killfeed, win panel, bottom HUD circle and cards, equipment, radar) is the
  same in both. The box, turn (kill cards), corner radius, opacity and an `inset()` clip
  (equipment reveal) are read from the element as drawn, so the blur follows the panel's
  shape, motion and fades; a vertical CSS mask is passed as `fade` samples
  (`sampleFade`, the equipment panel's `fade-mask.svg`). Every panel in the list is
  registered; the radar only while its "模糊背景" preference is on.
- Page `backdrop-filter` never blurs the game. It is allowed only (a) where SLUI's own
  panels must blur under another panel (the shop mask over the HUD) and (b) as the
  mock preview's stand-in for the world blur (`src/platform/backdrop.ts`, mock mode
  only), so reviews over the preview background compare like with like.

### Assets, fonts and avatars

- **No text shadows on new UI.** Do not add `text-shadow` (or a `drop-shadow`
  filter on text) to a new panel, even when the Panorama CSS declares one:
  Panorama's shadows do not read as shadows in game, and the browser version
  looks wrong. The user rejected this on every new panel (2026-10-05, win
  panel); add one only if the user asks for it.
- **Animations come from observed motion.** Static screenshots and Panorama CSS
  are not enough to recreate an animated panel (3D particle backgrounds,
  transitions whose Panorama transform order differs from CSS). Capture a
  short in-game recording and step through it frame by frame before building
  or accepting the motion.
- Player slots render typed Steam `avatar_url` values.
- Missing or failed avatars reveal a stable side-specific fallback (`hud/avatar-terrorist.png` for NTF, `hud/avatar-ct.svg`
  for SCP). Each fallback image is opaque on its own side colour, so no panel needs a background behind it.
- Mock fixtures must not use CS2 tournament-player photographs.
- The repository and official releases contain no files extracted from CS2
  (images, fonts, sounds, or their direct derivatives); Panorama sources and
  in-game screenshots are reference material only. Every CS2-style image is a
  SLUI-drawn file under `public/assets/<feature>`. Self-taken game screenshots
  may stay.
- The whole repository is public, `.trellis/` included. Task artifacts are text
  only: no screenshots, captures or other media (renders of CS2-era builds embed
  CS2 assets), no machine-specific absolute paths (refer to sibling checkouts as
  `../<repo>`), and only placeholder SteamIDs `76561198000000000`-`…999`.
  `scripts/public-content-check.mjs` (part of `npm test`) enforces these rules
  and the CS2 asset file rules above.
- Stratum2 fonts and CS2 shop sounds are never bundled. The app can load them
  from an optional external theme pack the user supplies
  (`<install>/theme-pack/fonts|sounds/<original file name>`, read via
  the `theme` URI scheme in Tauri and `/theme-pack/*` in Vite dev). Missing
  files fall back one by one to bundled OFL fonts and synthesized sounds.
- Register every Stratum2 (theme-pack) face in `src/shared/fonts.ts`, never in
  CSS `@font-face`; bundle-only OFL faces (Noto Sans SC, Chakra Petch) may stay in CSS.
  Each face carries metrics for both sources: Stratum2 keeps its calibrated
  `ascent-override` / `descent-override` (Panorama cap-height centering, no
  `padding-top` hacks); the fallback is scaled to Stratum2's cap height with
  `size-adjust`, whose factor Chromium also applies to the overrides, and uses
  `"tnum"` where Stratum2 has TF/Mono/Monodigit cuts.
- A theme-pack change must keep the with-pack 1920x1080 captures pixel-identical
  to the previous baseline; verify the no-pack state with `?themePack=0`.
- Glyph ink may leave the em box with one source but not the other (Stratum2's
  "$" ends 1px below it at 42px). Anything that stacks glyphs in 1em rows behind a
  window (odometer strips) clips every row itself (`overflow: hidden` per symbol),
  or the neighbour row bleeds in; measure ink with canvas `measureText`
  (`actualBoundingBox*`) under both sources.

### Migration

A manual replacement must pass its visual and behavioral gates before the old
implementation is deleted. Once accepted, build and test scripts must no longer
execute the discarded generator.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| HUD snapshot unavailable | Render no live round HUD |
| Steam avatar URL absent or fails | Show side-specific fallback without layout shift |
| Player offline | Render offline treatment and no health fill |
| Player dead | Render death treatment and no health fill |
| Health outside 0..100 | Clamp presentation to 0..100 |
| Timer mode `hidden` (Idle, WaitingForPlayers, RoundEnd) | Keep the 84x32 timer box empty; scores and counts do not move |
| Timer mode `generator` | No digits: only `KeycardNTFCommander.svg`, centered in the 84x32 box, masked to CS2 `.bomb_planted` red `#b80000` and blinking with the `bombDet` keyframes (opacity 0.5 -> 1 -> 0.5, ease-in-out); period 0.8 / 0.5 / 0.3 s (`BombPlantedPulse__Slow/Medium/Fast`) for interpolated `generator_remaining_ms` > 20 s / 10-20 s / <= 10 s (`generatorPulseTier`; CS2's native thresholds unverified); the animation restarts only when the tier changes; no expanding lines layer |
| Timer mode `pause` | No digits and no label: `❚❚` (U+275A x2) in the warning red, like CS2's client timer, which sets that text plus `teamcounter_red_timer` while `m_bMatchWaitingForResume` is set during freeze time (a tactical timeout sets it). The timeout countdown belongs to the alert slot only |
| Timer mode `round` | Phase clock; warning red at 10 s or less unless paused. The warning red is CS2's `teamcounter_red_timer` `color: red` (pure `#ff0000`), shared with the pause glyph |
| Dead teammate loadout | Money only; offline teammates show no equipment |
| Non-positive viewport dimension | Use a stable scale of 1 |
| 16:9 viewport below baseline | Uniformly scale the whole overlay |
| 16:10 / 4:3 / 5:4 viewport | Scale by height; canvas narrows to `1080 * aspect`; anchors hold (bottom HUD 16 px above the bottom, killfeed 10 px from the right) |
| Raw Panorama token or generated node appears | Fail the visual/layout audit |

## 5. Good / Base / Bad Cases

- Good: ten players render with Steam avatars, side-colored frames, health,
  scores, clock, alive counts, and deliberate dead/offline states.
- Base: missing avatars render stable side defaults while geometry remains
  unchanged.
- Bad: a generated Panorama component passes a bounding-box test while exposing
  raw tokens, engine placeholders, or unresolved material behavior.

## 6. Tests Required

- Pure presentation tests cover side resolution, viewport scale, avatar
  fallback, health clamping, and alive/dead/offline state.
- A 1920x1080 layout audit asserts the centered total width, player-slot size,
  central score width, player/state counts, zero generated nodes, zero unrelated
  bomb nodes, and no raw binding text.
- At least one smaller 16:9 audit proves proportional scaling without reflow.
- Capture and inspect a fixed-background screenshot for every accepted visual
  state.
- Run `npm test`, `npm run lint`, `npm run build:local`, and
  `npm run tauri:check`.

## 7. Wrong vs Correct

### Wrong

```tsx
// Reintroduces the discarded runtime/generator route.
return <HudTeamCounterGenerated bindings={translatedBindings} />;
```

### Correct

```tsx
// A normal React component consumes the typed feature view model.
return hud ? <HudTeamCounter hud={hud} /> : null;
```

## 8. Shop-specific replication rules

The shop is a hand-built React feature under `src/features/shop`; it does not
use Panorama translation or generated nodes.

- Panorama `flow-children: none` must become a `position: relative` parent with
  absolutely positioned card sub-elements. In particular, shop cards place the
  key, name, icon, and price in four corners/center rather than in a flex row.
- Panorama `width: 100%` plus horizontal padding is a `border-box` Web layout.
  Keep the five-column measured widths inside the 950px design canvas and do
  not let content-box sizing introduce an extra 30px per column.
- CS2 `wash-color` is represented with an SVG mask and a CSS variable carrying
  the player role color (`#d94652` for SCP and `rgb(150, 200, 250)` for NTF).
  Do not recolor the white source SVGs with filter chains.
- Shop and HUD item icons live in `public/assets/slui-svg/`, copied from the
  maintained `slui-svg/svg` source set. Do not add hand-drawn or CS2-only
  replacement icons for SCP:SL roles or items. A product requirement may
  explicitly use a CS2-style affordance when it has no SCP:SL equivalent, drawn
  by SLUI rather than copied: the generator-panel destruction upgrade and the
  HUD defuser slot use `public/assets/icons/wire-cutters.svg`. Missing `icon_url` values resolve
  to a stable icon from this source set without changing card geometry. Fonts
  come from the `src/shared/fonts.ts` registry.
- The shop uses the shared `overlayScaleForViewport` value and an independent
  1920x1080 design canvas. Run `npm run shop-layout-audit` and
  `npm run shop-visual-audit` against a CDP-enabled preview before accepting a
  visual change; the layout audit must report zero generated nodes and raw
  Panorama binding text.
- The teammate-request area is CS2's `buymenu__ground-weapons` (SLGO has no
  dropped weapons; user decision 2026-10-22): one lister per item column with
  the column widths, CS2 ground-weapon entries (requester name and price on the
  right), the 90px watermark title, CS2's 0.2s height/opacity growth while
  requests exist. The live baseline puts the area 10px under the plate with its
  bottom at y 1003 and the plate at 551px; under SLUI's 40px content shift the
  plate takes 551px only while the area is shown and the area keeps CS2's
  bottom edge (176px). If SLGO later adds dropped-weapon pickup and NTF
  requests, both want this one area: decide then, do not stack a second area.
  The viewer's own request is a quiet 已请求 in the card's free bottom-left
  corner (the key's 40% white, the price's baseline); a black CS2 nux-style
  ribbon there was rejected as too loud (user, 2026-10-22);
  the navbar's request hint is CS2's BuyForTeammateLabel (wash x 0.63).

## 9. Chat-specific replication rules

The chat panel is a hand-built React feature under `src/features/chat`
(`ChatInput.tsx` / `ChatInput.css`), recreating `layout/hud/hudchat.xml` and
`styles/hud/hudchat.css`. Class names follow the Panorama ids
(`chat-container`, `chat-main`, `chat-fg`, `chat-history`, `chat-text-entry`,
`chat-text-entry-box`, `chat-send-button`).

- `CSGOHudChat` is a C++ panel: placeholder and button text, the row format and
  the closed-state behaviour are not in the Panorama sources. They were read
  from Chinese-client screenshots and live in one place,
  `src/features/chat/presentation.ts` (placeholders 全局聊天 / 队内聊天, button
  发送, `[ALL]` tag, side name colours). Change them there, never inline.
- Geometry at 1080p: container padding `0 10px 72px` anchored to the screen's
  bottom-left corner; `ChatMain` = `ChatFG` 553px + 8px margins (569x399);
  history 327px; entry 48px with an 8px top margin; entry box 450x36 at 15px;
  send button 75px. Panorama margins never collapse, so `chat-main` is a
  `flow-root`. Only `#ChatBGPanel` (black, 0.75) is recreated: stacking the
  `.ChatTextBG` layers as the XML suggests makes the panel far darker than the
  game. The history and the entry row each add `#00000099` over it (0.9), a
  shade darker than the 8px frame, as in the screenshots.
- Fonts follow CS2's `panorama/fonts/fonts.conf`: Stratum2 falls back to the
  bundled Noto Sans SC for CJK and scales it by 0.9. The chat declares
  `Noto Sans SC Chat` (light for the Stratum2 Light entry, bold for rows and the
  button) with `size-adjust: 90%` and a CJK `unicode-range`. The files in
  `public/assets/fonts/notosanssc-*.woff2` are CS2's own copies (SIL OFL),
  re-encoded losslessly as WOFF2 with every glyph kept. Do
  not fall back to Windows fonts such as Microsoft YaHei.
- Rows: `[ALL] ● Name:  body` / `[TEAM] ● Name: body`; the body and notices
  are white; 18px bold, 22.8px apart (19px at 1600x900). Rows start at the top
  of the open history. SLGO shows its role tag (`[NTF]`, `[SCP]`) where CS2
  shows `[T]` / `[CT]`, and colours the tag and name with the SLGO team colours
  (`ROLE_COLORS` in `src/shared/roleColors.ts`, shared with the shop wash)
  where CS2 uses side colours. The dot is a drawn 7px circle in the player's
  `PLAYER_COLORS` slot colour, not a "●" glyph (no chat font has a CS2-sized one).
- Every player row uses that format, the local player's and others' alike
  (`resolveChatSender` / `resolveChatSelf` in `presentation.ts`): tag and name
  in `ROLE_COLORS[message.role]` (white without a role, `[TEAM]` as team tag),
  the dot in the sender's `PLAYER_COLORS` slot, i.e. their index in their team
  in the latest `match.snapshot` (white when not found). The sender and slot are
  frozen when the row arrives, like CS2's text rows: a later side swap does not
  recolour old rows. The only exception is the local echo (below), a placeholder
  drawn with the current local-player style until the server's copy replaces it.
- Plugin notices (`chat.notice`) are one row of coloured segments without tag
  or dot; tones map through `CHAT_NOTICE_TONE_COLORS` (the plugin's own
  message-area colours: white, money `#4CAF50`, muted `#A9A9A9`).
- History contract (`model.ts`): rows in arrival (= sequence) order, de-duplicated
  by `message_id` / `notice_id`; a baseline of another server/instance clears the
  history, a reconnect to the same instance keeps it. The local echo of an
  accepted send and the server's `chat.message` with the same `command_id` share
  one row: whichever arrives first shows, the server's copy replaces the echo in
  place (keeping its fade clock).
- Closed: no panel and no text shadow; rows stack upward from 10px left / 118px
  above the screen bottom, stay `CHAT_LINE_VISIBLE_MS`, then fade over
  `CHAT_LINE_FADE_MS` with a CSS animation whose delay is fixed when the row
  mounts. Never drive the fade from the 250ms UI clock: it steps visibly.
- The send button is always shown enabled, as in CS2.
- Run `npm run chat-layout-audit` (CDP on port 9223, preview at
  `CHAT_PREVIEW_URL`, default `http://localhost:1430/...`; Vite may not listen
  on 127.0.0.1) at 1920x1080 and a smaller 16:9 size before accepting a
  visual change.

## 10. Win-panel-specific replication rules

The win panel is a hand-built React feature under `src/features/winpanel`
(`model.ts`, `presentation.ts`, `WinPanel.tsx` / `WinPanel.css`), recreating
`layout/hud/hudwinpanel.xml` and `styles/hud/hudwinpanel.css` for `round.result`.

- Data: `winPanelReducer` keeps the latest panel of the baseline's instance
  with its local receive time; `selectWinPanel(state, nowMs, roster)` hides it
  when the interpolated `visible_remaining_ms` reaches 0. `panel: null` hides
  it at once. A result that ended (null frame, local expiry or replaced by a
  newer result) never comes back from a late replay; a replay of the showing result only refreshes its
  hold time and keeps `shownAtMs`, and the component is keyed by `resultId`,
  so a replay never re-runs the enter animation. A baseline of another server
  or instance clears the panel; a reconnect to the same instance keeps it.
- Title, subtitle and MVP texts are the plugin's (`title.text`,
  `subtitle_text`, `reason_text`, `music_kit_name`); SLUI never derives a
  title from `winner_team`.
- Colours live in `presentation.ts` (`winPanelColors`) and reach the DOM only
  as CSS variables on `.winpanel` (`--winpanel-accent`, `--winpanel-fill`,
  `--winpanel-mvp-accent`, `--winpanel-mvp-fill`). `won` / `observer`: the
  winner's `ROLE_COLORS` and a dark team-tinted translucent fill; `lost`: CS2
  `negativeColor` `#DB4437` on a neutral grey fill; `draw`: neutral. The MVP
  strip (chip, name, kit row, checker squares, base) always follows the winner,
  as CS2's `--Win--T/CT` classes do. An SCP win and loss differ by text and fill
  only (SCP red and the loss red are nearly equal; user decision 2026-10-05).
- Geometry at 1080p, verified against the captures: title box 400x80 at
  x 760 / y 190 with 4px side bars and radius 3px; title 44.4px (CJK 40px after
  the 0.9 Noto scaling), letter-spacing 8px with an equal left padding so the
  text stays centred, CJK ink y 206-241; chevrons 14x16 SLUI SVG 12px inside
  the bars at y 215, left one mirrored; subtitle 12px bold white, ink y 255-264;
  MVP strip 640x90 at y 286, ends faded by a CSS gradient mask (transparent to
  30px, opaque from 85px); avatar 72px with an 8px gap; details column of chip
  (21px, 18px black text, padding 0 6px), name (250x38, 28px condensed) and kit
  row (300x16, 12px bold + SLUI note icon). The avatar + details block is
  centred as one piece and the details box keeps 300x75 without a music kit:
  CS2 only drops the kit row (user, 2026-10-06), so the avatar stays at x 770
  and the chip at y 294 either way. The title shrinks its font to fit (Panorama `text-overflow:
  shrink`), as do the subtitle and kit name; chip and name use ellipsis.
- The Panorama `brightness` boosts on the name and kit text do not show in the
  captures and are not applied. The CS2 3D banner scene, glitch clip and
  music-kit artwork are replaced by SLUI drawings: the checker canvas
  (`checker.ts`), `title-glitch.svg` (procedural 10-image sprite used as a
  mask in a light tint of the accent) and `music-note.svg`.
- Motion is measured frame by frame from an in-game recording (numbers in the
  parent task's `research/cs2-reference-capture.md`, "Win panel motion
  (recording)"); keep the timeline at the top of `WinPanel.css` in sync. CSS
  animations start at mount and are never driven by the 250 ms UI clock:
  title box opens from its centre (0-230ms) under a white wash that clears by
  410ms, glitch sprite 320-653ms (`steps(10)`), chevrons slide inwards 19px
  from behind the side bars at brightness 1.5 (560-730ms), subtitle fades in
  and the MVP strip opens as a white bar at 990ms (white clears 1260-1430ms).
  No title scale-in, no root fade.
- Checker: `checker.ts` is a pure model (17px squares, 19.32px pitch, 5 rows;
  a wave climbs one row per 468ms, 2.34s per pass; ~60 % of the squares light
  per pass at random levels, brighter near the ends; rise 350ms, hold to 1s,
  fade to 1.95s; stops 9s after the strip entrance). `MvpChecker` draws it on
  a canvas with `requestAnimationFrame` and reads its clock from the strip's
  `winpanel-open` CSS animation, so canvas and CSS stay in step; the pattern is
  seeded by `resultId`. Stills (`hudSceneAt`) draw it at 3.3s.
- Exit (`.winpanel--leaving`, `WIN_PANEL_EXIT_MS` 240): the title box turns
  white and collapses in 200ms; the strip band (`.winpanel-mvp__band` + white)
  jumps to scaleX 1.85 with a still lit checker, whitens and collapses by
  220ms, while the avatar and texts only fade (never stretched).
- Fonts: `Stratum2 WinPanel Title` (condensed bold, cap-centred), `Stratum2
  WinPanel` (bold) and `Stratum2 WinPanel Condensed` (medium) in
  `src/shared/fonts.ts`; CJK falls back to `Noto Sans SC WinPanel` declared in
  `WinPanel.css` (light for medium labels, bold otherwise, `size-adjust: 90%`).
- Layering: `.winpanel-overlay` is its own fixed layer at z-index 5 (above the
  top HUD, below shop and chat) on a 1920x1080 canvas scaled by
  `useOverlayScale`; the team counter never moves.
- Mock preview: `npm run dev:mock`, `?hudScene=<scene>&viewerTeam=team-a|team-b`;
  add `&hudSceneAt=<ms>` to pin the scene at that moment (the provider re-sends
  it every second and the panel draws without animation) for captures and for
  `npm run winpanel-layout-audit` (CDP on port 9223, preview at
  `WINPANEL_PREVIEW_URL`, default `http://localhost:1430/`; viewport from
  `WINPANEL_VIEWPORT_WIDTH/HEIGHT`). Run it at 1920x1080 and a smaller 16:9
  size before accepting a visual change.

## 11. Message-zone-specific replication rules

The bottom-centre message zone is a hand-built React feature under `src/features/hudmessages`
(`model.ts`, `MessageZone.tsx` / `MessageZone.css`), recreating `CSGOHudAlerts` and the two
`CSGOHudHintText` panels (`hudalerts.css`, `hudhinttext.css`, `hud.css` `.HudBottomCenter--float`)
for the `alert`, `hint_high` and `hint_low` slots of `hud.messages`. The `progress` slot shares the
reducer and has its own card.

- Data: `hudMessagesReducer` keeps the latest message per slot of the baseline's instance with its
  local receive time. A slot appears when it goes from empty (or locally expired) to showing and keeps
  that appearance across replacements: CS2 swaps the text in place, so a new key in a showing slot never
  re-runs the enter animation (recording). `selectMessageZone(state, nowMs)` hides a message once its
  interpolated `visible_remaining_ms` runs out, even before the clearing frame, and draws
  `{time_remaining}` as `m:ss` and `{seconds_remaining}` as whole seconds, both rounded up (`formatHudCountdown` / `formatHudSeconds`, same rule as the plugin's
  `HudMessageCatalog.FormatTimeRemaining`); a countdown at 0 stays `0:00` until the plugin clears it.
  The `message_id` that last left a slot never comes back from a late replay. A baseline of another
  server or instance clears the board; a reconnect to the same instance keeps it.
- Texts are the plugin's; tones only select behaviour (`match_point` / `final_round` alerts flash),
  never colour: every capture shows white text.
- Geometry at 1080p (captures win over Panorama, whose float offsets land 2px high): every box
  x 810-1109 (300 wide), radius 3px; alert y 750, high hint y 802, low hint y 868; one line 40px, two
  lines 60px (hint text panel max-height 60px); lines 21px apart. Text 18px `Stratum2 Messages`
  (stratum-medium-tf) with CJK in `Noto Sans SC Messages` (light, `size-adjust: 90%`), white, no text
  shadow; padding 7.5 / 10.5px instead of Panorama's 8 / 8px because the CJK fallback sits ~1.75px
  below the cap-centred Latin baseline (CJK ink then matches the captures to the pixel).
- Colours (captures): side bars 2px at both ends; alert and low hint in the viewer's team colour
  (`hud-colorize-wash`; the T-side captures' gold is the T colour), the alert's at 0.5 (its bars are
  additive in Panorama), high hint `rgb(255, 24, 0)`. Fill: in game the captures read grey ~65 at ~0.33
  (alert, low hint) and black ~0.52 (high hint) on Panorama's world blur: those are the fills over SLUI's
  world blur (`rgba(65, 65, 65, 0.33)`, `rgba(0, 0, 0, 0.52)`). Without a blur the fills are denser with
  about the same mean to suppress the scene detail the blur removes (user review 2026-10-06):
  `rgba(62, 62, 62, 0.6)` and `rgba(16, 16, 16, 0.7)`. The dot texture is not recreated.
- Motion (recording, numbers in the parent task's research file, "Message zone motion"): enter for all
  three, box opens from its centre in 233ms (`cubic-bezier(0.3, 0.05, 0.65, 0.9)`) under 0.92 white
  that clears 250-470ms, text fades in from 233ms, a 30 fps glitch (`message-glitch.svg`, SLUI-drawn,
  used as a mask in a light tint of the bar colour; red for the high hint) 300-633ms. Alert exit
  (`HUD_ALERT_EXIT_MS` 750): text fades 0-250ms, box turns white 250-400ms, collapses 500-750ms. Hint
  exit (`HUD_HINT_EXIT_MS` 200): collapses and fades (ease-in), text gone in 100ms, no white.
  `match_point` / `final_round` alerts play CS2's `FlashAnim` around the plugin's lifetime: opacity
  0.85 -> 0.65 over 2.1s, then a flash to 1 and a fade to 0 ending at the expiry (518ms, delay fixed
  from the flash start, never re-timed by the UI clock); their exit skips the text fade and shows the
  white box after 250ms. A message starts its exit at its own expiry time (a timer), not on the next
  250ms tick.
- Layering: `.hudmsg-overlay` is a fixed layer at z-index 4 on a 1920x1080 canvas scaled by
  `useOverlayScale`; slots are fixed and never stack.
- Mock preview: the `hudScene` scenes `warmup`, `match-point`, `final-round`, `pause-high-hint`,
  `timeout`, `hint-low-keycard`, `hint-low-dropped`, `generator-started` (the two-line high hint for 6 s,
  then the standing 「离过载还剩 N 秒」 countdown in the same slot; `hudSceneAt=8000` pins the countdown) and
  `all-slots`; `hudSceneAt` pins them without animation. Run `npm run hudmessages-layout-audit` (CDP on
  port 9223, preview at `HUDMESSAGES_PREVIEW_URL`, viewport from `HUDMESSAGES_VIEWPORT_WIDTH/HEIGHT`)
  at 1920x1080 and a smaller 16:9 size before accepting a visual change.

## 12. Progress-card-specific replication rules

The generator progress card is `src/features/hudmessages/ProgressCard.tsx` / `ProgressCard.css`,
recreating `CSGOHudProgressBar` (`hudprogressbar.xml` / `hudprogressbar.css`, CS2's defuse card) for the
`progress` slot of `hud.messages`, for both starting and shutting down a generator (CS2 has no plant
card).

- Data: the shared reducer keeps a `progressAnchor` (local end time, total, key, revision). A time-only
  re-sync within `HUD_PROGRESS_RESYNC_MS` (250) keeps it; a larger drift, another key or total, or a new
  appearance re-anchors it. `selectProgressCard(state, viewer)` returns the card with `endsAtMs`,
  `animationKey` (changes on re-anchor) and the icon: `KeycardNTFCommander.svg` for a start, and for a
  shutdown the SLUI `wire-cutters.svg` when the local player's `match.snapshot` loadout has the generator
  upgrade (CS2 defuse kit), the keycard otherwise. `progressViewerFromHud` finds the local player in the
  viewer team (the debug build falls back to that team's first player, since the mock identity is a
  team-a player). The card has no local expiry: at 0 it shows `00:00.000` until the plugin clears it.
- Geometry at 1080p (recording, +-1px): card 500x120 at x 710 / y 630, radius 10px, fill
  black 0.43 over SLUI's world blur (as recorded on CS2's), `rgba(34, 34, 34, 0.72)` without a blur
  (denser, see section 11);
  4px side bars; the layout row (ring, info) is centred horizontally, so the ring moves with the title
  width, but top-aligned: ring 95px 10px under the card top (centre y 687.5), 8px track
  `rgba(128,128,128,.25)`, 82% inner border 2px `#00000049`, icon 50x50 centred; info 96px high with
  margins 0 10px, title 18px bold (CJK in `Noto Sans SC Progress` bold at `size-adjust: 84%`, measured
  14.4px per glyph; ink y 647-661), margin-right 8px; countdown `mm:ss.mmm` plus Panorama's trailing space,
  `Stratum2 Progress Monodigit` 18px white at 0.86, right-aligned, digits ink y 716-727.
- Progress motion: one CSS timeline per anchor (duration = total, negative delay = elapsed at mount),
  never driven by the UI clock: registered custom properties (`@property`) `--hudprogress-p` (linear)
  drive the ring arc (a conic mask growing from the bottom both ways, linear in progress) and the side
  glow; `--hudprogress-side/ring/glow-color` run red -> yellow -> green with ease-in-out in each half
  (recorded results: bars `rgb(255,102,73)` / `rgb(253,244,65)` / `rgb(84,174,68)`, ring
  `rgb(252,112,92)` / `rgb(254,236,80)` / `rgb(100,168,80)`). The glow from each side is the side colour
  at 0.2 with a gaussian falloff exp(-(x / L)^2), L = 400px x progress (a flat wash past ~70 %), drawn as
  a 250px gaussian mask scaled by 4 x progress. The countdown text is written every animation frame.
- Icon pulse (0.8s loop): keycard between `rgb(243,194,128)` and near white, 5% larger at 90%;
  wire cutters in the viewer's `ROLE_COLORS` at brightness 1 -> 1.5, 0.95 -> 1 scale and 2px offset.
- Enter: none (the card shows at once). Exit: when the slot clears with the countdown within 250ms of
  zero, CS2's success zoom (scale 1 -> 1.3 and brightness 2 over 400ms ease-in, fading out in 250ms);
  otherwise a 400ms fade (Panorama's `--visible` transition). CS2's cancel shake is not recreated (never
  observed).
- Mock preview: `hudScene=generator-start-progress` / `generator-shutdown-progress` (`viewerTeam=team-b`
  for the wire cutters) and `all-slots`; `npm run hudmessages-layout-audit` covers the card too.

## 13. Bottom-HUD-specific replication rules

The bottom HUD is a hand-built React feature under `src/features/bottomhud` (`model.ts`, `presentation.ts`,
`BottomHud.tsx` / `BottomHud.css`), recreating CS2's `hudhealthammocenter` for SLGO: the balance takes the
health/armor slot (CS2's separate bottom-left money panel is not drawn), the round's kill cards fan above the
centre emblem, and the right block shows the clip and the reserve rounds (SLGO counts rounds, CS2 magazines).
Measurements and motion are in the task research file `cs2-bottom-hud-motion.md` (archived with
`10-07-cs2-bottom-hud`); keep the timeline at the top of `BottomHud.css` in sync.

- Data: `selectBottomHud({ hud, status, spectating, scoreboard, localPlayerId })` draws the local player while
  they are alive on the viewer team (null without a loadout): balance = `loadout.money`, ammo and kills from
  `hud.status`. Otherwise (dead, or a team-less observer) it draws the player `hud.spectating` names, in that
  player's team colour, with the spectator panel; null when it names nobody or someone outside the roster (user
  decision 2026-10-21, reversing 2026-10-07's "no spectator panel"). The row is keyed by `subjectId`, so a target
  switch shows the new player without a kill burst or a balance roll. The debug build uses the same local player
  as the progress card; the `bottom-*` scenes may override its balance and life
  (`RealtimeMockProvider.hudSceneSelf`), and `bottom-spectating` / `bottom-spectating-enemy` play a dead player
  watching a teammate (with a target switch) and an SCP opponent.
- Spectator panel (CS2 `HudSpecplayer__Bg` in `hudhealthammocenter.xml`, user reference capture 2026-10-21):
  the alive layout stays (user decision: balance left, ammo right, no health / armour); a 460 x 72 panel
  (`spec-width`) at x 730-1190, radius 5, the circle's 0.5 fill over the world blur, 2px washed bars on both
  edges, sits between them; the strokes go and the watched player's avatar (57px round, side default on
  failure) covers the emblem inside the ring. Left block 14px in, 190 wide, centred: an empty 17px clan line
  (SLGO has no clan tags), the name 20px washed at 0.753, then `伤/局` 13px (washed title, white mono value).
  Right block 14px in from the right: the item label 18px medium, right-aligned, above the centre like CS2's
  two-line weapon / finish label. The key hints under the panel are not drawn (user decision 2026-10-21).
- Colour: every washed element (numbers, strokes, ring, emblem, card art) uses `ROLE_COLORS[role]` through
  `--bhud-wash` (user decision 2026-10-07, like the win panel), never CS2's T gold / CT blue. White SLUI art
  is drawn through a CSS mask in that colour.
- Geometry at 1080p (recording, Panorama for proportions): row 800 x 72 at x 560 / y 992, circle 64px centred
  at (960, 1028) with a 2px ring and a `rgba(0,0,0,0.5)` fill (`hud-blur-bg-color` as it reads in game, the
  killfeed capture of the same colour; with or without the world blur); strokes
  1px, 184px each from the circle outwards; numbers `Stratum2 HUD Timer` 42px; balance right edge at x 710 in
  at least six odometer cells (CS2 pads to "$16000"); clip label 70px from x 1192 with a 65 x 2 bar at y 1047-1048
  over a faint track (Panorama's 1px black border and 4px height do not show in game, user review 2026-10-08); reserve 32px then a 26px reserve icon (user review 2026-10-07: 18px read
  too small for the slim round).
- Kill cards: every card is a 48 x 126 canvas drawn 152px high centred on the circle centre, so the Panorama
  fan (`KILL_FAN`, exact `translate3d` + `rotateZ` per count, 0.2 s transition) turns about the circle. Kills
  1-5 fan out (the fifth is the ace card: spade and skull, no number), from 6 one counter card shows the count.
  Only the top card shows its number (an upper card hides the others in game); the card layer has a hole over
  the circle. Pips: `default` skull, `grenade` burst, `shock` bolt (user decision: only these three).
- Motion (CSS animations started on mount, WAAPI and one canvas on data changes, never the 250 ms UI clock):
  Panorama `on-kill` (brightness 6 for 30 % of 0.7 s) on the row and the new card; the circle fill whitens.
- Kill effect = CS2's own particle systems, ported (`particles/`; user asked for a pixel-level match, and five
  rounds of shapes fitted by eye were rejected in review 2026-10-08): `systems.ts` restates each
  `particles/ui/ammohealthcenter/ui_hud_kill_streaks_*.vpcf` child in the parent's order per kill level
  (decompiled from the game for reference only, never committed), `engine.ts` simulates them with Source 2
  semantics, `render.ts` adds the occluders, `gl.ts` draws, `textures.ts` holds SLUI stand-ins for the textures
  (analytic models fitted to profiles measured on the game's textures; no game asset is copied). Contracts:
  - Panel: CS2's `ParticleScenePanel` 900 x 500 at (510, 580), camera `0 600 127` -> `0 0 127`, fov 41 taken as
    horizontal (2.006 px per unit; a vertical fov halves everything), line z 28 = y 448. One canvas per kill.
  - Semantics come from the vpcf plus ValveResourceFormat's reverse-engineered renderer
    (`particle_spritecard.frag/vert.slang`, `Renderers/RenderTrails.cs`, `ParticleTextureLayer.cs`); look there
    before guessing. A field the vpcf leaves out takes the class default from the game's schema (s2v.app
    SchemaExplorer's `cs2.json`, `MGetKV3ClassDefaults`), not a guess: e.g. renderers gamma-correct vertex
    colours and `C_OP_ColorInterpolate` eases in and out unless told otherwise. Every texture input counts: a second input multiplies (default blend mode), an empty one is
    the renderer's default texture (trails: `base_trail`); `m_flFinalTextureScaleU/V` zoom in (card UV divided).
    Per-renderer fields stay per renderer (e.g. killid's beam fades its length in over 0.1 s, its ray layer
    over 0.5 s). Trails are never wider than long. Continuous emitters are exact and end-exclusive (k-th
    particle at k / rate while < duration). Masks are opaque black alpha blends that hide only what was drawn
    before them and die at 2.0 s; a depth offset (`PositionOffset` 0 4 0 on the motion rope) is drawn with
    perspective (600 / (600 - depth)). `m_flCameraBias` only biases depth (no screen offset).
  - Colour: textures are sRGB-decoded and some are warm (basic_flare, yellowflare: that is the beam's orange
    halo); particle colour attributes are /255 and the renderer decodes them from sRGB when it draws
    (`m_bGammaCorrectVertexColors`, default on: without it kill 5's starbursts by the line were 1.4x too bright).
    Light adds in an RGBA16F panel, then per channel `1 - exp(-1.5 x light)`, times the team wash, composited
    "over" with the strongest channel as alpha (a saturated pixel is the wash whatever is behind).
  - Recording-fitted, documented in code: killid's ray layer multiplies `base_trail`'s colour only (VRF's
    reading leaves the halo 4-15x too dim); the beam's fade along its length.
  - React StrictMode runs the effect twice: each run creates and removes its own canvas, since disposing loses
    the WebGL context and Chromium paints a lost canvas white.
  - Validate offline against the 60 fps recording (side-by-side and cross-beam profiles over the pre-kill
    frame), then in the real app; tone and size errors hide in eyeballing.
- Other motion: at kill 6 the fan collapses behind the circle and the counter rises with a halo. Shot: the remounted clip label pops for 3 frames
  (scale 1.15 up-left and paler, then 4px down), drawn with colour, not a brightness filter (a filter turns the
  team colour white and blurs the digits). Reload: the reserve icon drops and returns (300 ms); weapon change:
  0.75 -> 1 in 100 ms; balance: each character rolls on its strip to the new symbol (`ODOMETER_SYMBOLS`, ~520 ms,
  `cubic-bezier(0.2, 0.15, 0.6, 1)`, measured). A first view or a shrinking kill list (new round) never animates.
- Low clip (<= 20 % of `clip_max`, recording 6/30 red, 7/30 normal): the number keeps the team colour over a
  soft orange-red halo (two blurred stroked copies, 4px/4px and 8px/9px, after Panorama's 9px strength-2.5
  shadow; a tight rim reads as an outline and was rejected), the bar fill turns red.
- Assets (`public/assets/bottomhud/`, SLUI-drawn): `kill-card(-ace).svg`, `kill-pip-*.svg`,
  `reserve-bullet|shotgun-shell|revolver-loader.svg` (traced to the in-game look; shotgun and revolver get their
  own icon, other firearms the pre-magazine CS2 single round), `emblem-ntf|scp.svg` (new drawings; the SCP
  emblem is three claw scratches, ragged at the top and tapering to a point, generated as polygons; plain
  curved lines read as scribbles).
- Layering: `.bhud-overlay` is a fixed layer at z-index 3 on the scaled 1920x1080 canvas.
- Mock preview: `hudScene=bottom-kills` (kills 1-14 with all three pips), `bottom-fire` (a magazine to red and
  a reload), `bottom-balance` (balance rolls), `bottom-dead` (hidden); `viewerTeam=team-b` shows the SCP side
  (no firearm). Run `npm run bottomhud-layout-audit` (CDP on port 9223, preview at `BOTTOMHUD_PREVIEW_URL`,
  viewport from `BOTTOMHUD_VIEWPORT_WIDTH/HEIGHT`) at 1920x1080 and a smaller 16:9 size before accepting a
  visual change.

## 14. Killfeed-specific replication rules

The killfeed is a hand-built React feature under `src/features/killfeed` (`model.ts`, `presentation.ts`,
`KillFeed.tsx` / `KillFeed.css`), recreating CS2's `CSGOHudDeathNotice` (`huddeathnotice.xml` /
`huddeathnotice.css`) from `hud.killfeed` (packages/protocol/v0 README "HUD killfeed"; plugin task
`10-18-killfeed` in the SLGO repository). Checked against the user's 1080p captures of 2026-10-05 (Steam
screenshots kept locally: the viewer's headshot kills, a bot's suicide, the viewer's suicide); the first build
from Panorama alone was rejected in review (2026-10-18: "not like CS2 at all") for SLGO colours, too dark
backgrounds and the wrong suicide and headshot marks.

- Data: every `hud.killfeed` is the recipient's whole feed, oldest first. An entry keeps its first-seen time
  across copies (a replay never slides in again) and starts fading at receive time + `visible_remaining_ms`
  (the plugin already applied CS2's 1.5x for the viewer's own kill or death). An entry the next copy leaves out
  disappears at once (a new round clears the feed) unless it is already fading, which it finishes. Another
  instance's baseline or an ended session clears the feed; a reconnect to the same instance keeps it.
- Content order (CS2): killer, `+` and the assister, weapon icon, headshot icon, victim. A suicide
  (`suicide`, CS2 `DeathNoticeSuicide`) draws the skull and crossbones instead of the weapon; a self-kill keeps
  the killer, so it reads "name skull name" as in the capture, and a death without an attacker is "skull name".
- Colour: NTF names in CS2's killfeed blue `#6f9ce6` (`CTColor`, capture; NTF's blue everywhere else too),
  SCP names in the SLGO red `ROLE_COLORS.scp` (user decision 2026-10-18, not CS2's `TColor` gold); `#888888`
  (`FadedColor`) without a side. Icons are white.
- Geometry at 1080p (Panorama): column at top 72px, right 10px, notices 3px apart, padding 6px 10px 3px 10px,
  radius 3px; names `Stratum2 Killfeed` (stratum2-bold) 16px, margins 0 2px 2px, at most 160px with an
  ellipsis, CJK in Noto Sans SC bold at 0.9; icons 24px high, margin -2px 2px 0 2px. Capture: rows 31px with
  the border, 3px apart, the first at y 75, right edge at x 1910. Backgrounds as measured (every Panorama alpha
  shows at about 0.79 of its value; the same with SLUI's world blur under each notice and without it): plain
  `rgba(0,0,0,0.5)`, the viewer's
  kill `rgba(0,0,0,0.72)` with a 2px `#e10000` border drawn inset (no size change; the capture's border
  luminance matches #e10000, JPEG dulls the red) and labels 15px with 0.5px tracking, the viewer's death
  (their own suicide included) `rgba(99,6,6,0.65)`. No text shadow (section 3), although Panorama declares one.
- Icons (`presentation.ts`): firearms, Micro-HID, HE grenade and the SCPs reuse `public/assets/slui-svg/`
  (muzzles point right, towards the victim, as in CS2). Weapons the shop does not sell have no art (user
  decision 2026-10-18) and draw the plain skull (`hud/skull.svg`, never the suicide mark); adding art later only
  touches `KILLFEED_WEAPON_ICONS`. `public/assets/killfeed/suicide.svg` (skull and crossbones) and `headshot.svg`
  (a head facing right, entry hole upper left, the round leaving right with speed lines) are SLUI drawings
  after the capture.
- Motion (CSS animations fixed at mount, never the 250 ms UI clock): a new notice fades in over 0.2 s
  (Panorama `.Available`); at its fade time it fades out over 1 s ease-out (`DeathNoticeFadeOutTime`), the
  delay is `fadeAtMs - mountedAtMs` (negative when mounted part-way). A notice mounted more than 0.2 s after
  its first copy (overlay re-enabled) just shows.
- Layering: `.killfeed-overlay` is a fixed layer at z-index 4 on the scaled 1920x1080 canvas; nothing else
  sits in the top-right corner.
- Mock preview: `hudScene=killfeed` plays an enemy kill, the viewer's headshot with an assist, a self-kill, a
  weapon without art (fallback skull), a long name, a death without an attacker and the viewer's death;
  `hudSceneAt=7100` pins the moment six rows are on screen. Compare a full-resolution capture of it (e.g. headless
  Edge `--screenshot --window-size=1920,1080`) with a CS2 capture cropped to the same region. A hidden preview pane renders no frames, so CSS animations stand still there;
  check motion in a visible pane or by setting `getAnimations()` times.

## 15. Scoreboard-specific replication rules

The scoreboard is a hand-built React feature under `src/features/scoreboard` (`model.ts`, `presentation.ts`,
`Scoreboard.tsx` / `Scoreboard.css`), recreating CS2's competitive scoreboard (`scoreboard.xml` / `scoreboard.css` /
`scoreboard.js`) from `scoreboard.snapshot` joined with `match.snapshot`. Measured against the user's captures of
2026-10-19 (page 1 passive, page 2 cursor, page 2 passive; kept locally); every number is in the task research
`cs2-scoreboard-layout.md` (archived with `10-19-scoreboard`).

- Input (system-boundaries 3.1): shown while the scoreboard key is held over the game (`passive`); right-click turns
  the cursor on (`cursor`, CS2 `.mouse-active`: buttons visible, mouse hint hidden, headers clickable) until the key
  goes up. Hidden in Idle / WaitingForPlayers, under the shop or chat, and without a `scoreboard.snapshot`.
- Template (CS2 `scoreboard.js`): modes with halftime use the competitive template (half-time scores, round
  timeline, loss-bonus pips); modes without halftime use the casual one, a 24px spacer. SLGO keeps the competitive
  columns in every mode.
- Blocks: CS2 fixes CT on top; SLGO's SCP is CT (`hudSideForRole`), so the SCP team is the top block
  (`SCOREBOARD_TOP_ROLE`). Team tint = `ROLE_COLORS` (names, stats, emblem digit, timeline), as in the bottom HUD.
  The emblem disc follows the side: CT a dark disc with a thin ring, T a dim filled disc; the SLUI emblem
  (`bottomhud/emblem-*.svg`, 64px) fills it behind the digit, lighter than the CT ring (tint 0.3) and a dark cut-out
  of the T disc (black 0.45). The 70px digit's cap height is centred on the disc (capture ink y 416-461 in 399-478).
- Geometry at 1080p (capture): panel 960 wide, centred, its centre at y 570; padding 20 20 0; meta 75 (row 1 38 with
  the divider, buttons 26 wide 10 apart ending at x 1360, top y 350, clipped to 19 visible pixels); labels row 26;
  rows 24 high, 26 apart, 770 wide from x 590 (status 24, ping 37, flair 32.4, avatar 24, name fill, page 1 money 66 /
  K / D / A 50 / hit rate 64 (CS2's HS% cell), page 2 MVPs / utility / flashed / KDR / ADR 50, damage 50); team block at least 134 high
  (emblem 80 + two 25px labels); timeline 103 + 2/2 margins with rounds 20 wide (first at x 659, divider 10/2/10),
  ticks 18x2 at y 584; spectator gap 40; footer 48 with the hint 10px from the right. 5v5 competitive = 584 high (y
  278-861); casual 10v10 grows and stays centred.
- Colours (capture, not Panorama): the capture reads 0.33 of the blurred world inside the panel, neutral in tone. Over
  SLUI's world blur the fill is black 0.6 (the look the user accepted in game on 2026-10-21); without it, a denser dark
  grey `rgba(14,16,19,0.84)` (same mean over dark and bright scenes, 0.16 of the scene detail instead of a third) with Panorama's dot texture (`hud/dot-grid.png` at 360px, opacity
  0.085: neutral dots every ~3.4px, high-pass amplitude 5.1-6.5 grey levels over a flat backdrop, as captured);
  存活 n/N the tint at 0.45 (Panorama 0.2); cell fills white 0.06, the sorted column 0.15; local row team tint at 0.2 (Panorama says 0.07; the capture
  reads 0.2); dead rows `brightness(0.6)` without fills; offline rows `#ccc`; footer hint white 0.4; timeline result
  icons team tint 0.8, played ticks 0.7, the current tick white 0.78, trophy white 0.7, past-clinch rounds 0.1.
- Fonts: `Stratum2 Scoreboard` (names, medium), `... Condensed` (labels, side names, phase and tick labels), `... Mono`
  (stats, ping, time, score) in `src/shared/fonts.ts`; CJK in `Noto Sans SC Scoreboard` at `size-adjust: 84%`
  (measured: 战败补偿 59px and 杀敌数 44px of ink at 18px; the chat's 0.9 overflows the 50px cells). No text shadow.
- Behaviour (`presentation.ts`): sort = online first, then the clicked stat, then damage, kills, MVPs, assists
  (descending), deaths (ascending), roster order (CS2 `sortOrder_tmm`); no direction toggle; blanks sort last; re-sort
  pauses while the pointer is over the rows. 命% (hit rate, in CS2's HS% column) = shots hit / shots fired: SLGO's headshots only count for NTF
  shooting SCP-049-2, so HS% would read 0 (user decision 2026-10-20). KDR = kills / max(deaths, 1) (2 decimals),
  ADR = damage / rounds played. Money only for the viewer's own team in the current view. Rows showing SCP-side
  stats blank 命% / utility / flashed. Page, side and sort persist for the session (CS2 `_CycleStats`). The side
  switch exists only in the second half of a halftime mode; the other view shows each player's first-half bucket and
  a 上半场 marker where CS2 has the server line (D6: no map or server line). CS2's mode icon slot shows the SLGO badge
  (`slgo-logo.svg`, the brand logo without its wordmark) in every mode (user decision 2026-10-20). Timeline: winner icon by the team's block,
  coloured by the side it won with; SLGO reasons map to CS2's icons (elimination skull, generator activated = the
  HUD's keycard, deactivated = wire cutters, time = SLUI timer); a trophy where the earlier team would clinch.
- Motion: rows move 0.25 s ease-in-out on re-sort; the panel shows and hides at once (no recording yet).
- Mock preview: `hudScene=scoreboard-competitive` (round 15 of 24, mixed alive / dead / offline) and
  `scoreboard-casual` (10v10); pin with `scoreboard=passive|cursor`, `scoreboardPage=2`, `scoreboardSide=other`; in an
  unpinned preview CapsLock and right-click drive it. Run `npm run scoreboard-layout-audit` (CDP on port 9223, preview
  at `SCOREBOARD_PREVIEW_URL`, viewport from `SCOREBOARD_VIEWPORT_WIDTH/HEIGHT`) at 1920x1080, 1728x1080 and 1440x1080
  before accepting a visual change.

## 16. Team-select-specific replication rules

The team select menu is a hand-built React feature under `src/features/teamselect` (`model.ts`, `presentation.ts`,
`TeamSelect.tsx` / `TeamSelect.css`, `useTeamSelectFeature.ts`), recreating CS2's team menu (`teamselectmenu.xml` /
`.js` / `.css`, the action bar from `mainmenu.css` and `csgostyles.css` `.PopupButton`). Measured against the user's
captures of 2026-10-24 (hover T, hover CT, first join; kept locally); numbers are in the task research
`cs2-team-select.md` (task `10-24-team-select`).

- Session (system-boundaries 3): drawn while the plugin's `team.menu` session is open, the stream is live and a
  roster is known; the overlay window itself shows only over the game, so the menu stays mounted across an alt-tab
  and its opening fade plays once per session. It is modal: the other panels are not rendered (CS2 hides its HUD),
  the shop, chat and scoreboard stay shut and their keys are ignored, and the overlay takes the input while it is
  over the game (`overGame`, never the game's own `focused`: taking the foreground drops that, see
  system-boundaries). A close or an accepted choice hides it at once; a refusal keeps it with the error banner.
- Background (task decision D1): SLUI's world blur over the live game instead of CS2's 3D team scene; the
  full-window backdrop registers `useBackdropRef`; blur on = black 0.3 over it (Panorama's fallback
  `brightness .7`), blur off = `rgba(10,11,13,0.62)`. The bottom band is `.mainmenu-content`'s 50% black from 91.5%.
- Illustrations in place of the team models (user's request 2026-10-25; provenance in
  `public/assets/teamselect/SOURCES.md`): NTF the squad painting (`ntf-squad.webp`), SCP the five classic SCPs' class
  portraits (173, 049, 096, 106, 939) grouped in one image (`scp-group.webp`) over a CSS ground shadow. They sit
  under the bottom band like the models (the band darkens their feet), centred under the columns, heads below a full
  five-row roster (y 488 / 495), 582 / 499 px tall. The hovered side gets CS2's model outline: `drop-shadow` in its
  colour mixed 40% with white (CS2's pale outline), 1 px plus a 4 px glow at 0.6, 0.25 s. Anything soft and
  semi-transparent (a ground shadow) stays out of the outlined image, or the glow turns it into a coloured haze.
- Halves: 50% of the window and 90% tall each; the side's dark gradient over the top 30%, 40% while hovered. Not
  Panorama's linear fade: the captures (seam where one wall crosses both halves) read opacity 0.93 at the top, 0.57
  at y 32, 0.27 at y 110, 0.2 at y 160, 0.1 at y 210, 0.05 at y 270; a linear fade was about twice as heavy and the
  user called it too strong. Side colours are SLGO's (`ROLE_COLORS`), NTF left / SCP right (NTF plays T): NTF takes
  CS2's CT gradient `rgb(37 75 105)` (its colour is CS2's `ct-color`), SCP the T gradient's darkening of `#d94652`,
  `rgb(85 27 32)`.
- Columns 800 wide hug the seam on the 1080 canvas; content centred 400 from it. Disc 78 px from y 42 (capture; the
  labels still start at y 140), side colour 78% with a 45% rim and the emblem cut-out at 22%, `brightness(0.6)`,
  1 while hovered (the captures' 102 -> 170). Title 50px `Stratum2 TeamSelect Condensed` bold (cap top y 152),
  subtitle "{n} 玩家" 20px bold (SLGO has no bots, so CS2's bot count is dropped).
- Rows: 200 x 41 on a 47.5 px pitch from y 238 (capture; Panorama's 40 + margin 4); avatar 41 then a 4 px black status
  bar and the name 8 px after it, 17px bold with 0.35px tracking (CJK names in the regular cut, as captured). Online
  players get CS2's human row (side colour, black name), offline seats CS2's bot row (`#303030`, white name). Opacity
  0.8, 1 for human rows of the hovered side; bot rows stay 0.8 (CS2's `#Teammate.bot` outranks the hover).
- Action bar: 96 tall, padding 0 64px, right-aligned 取消 (hidden in a forced session) / 观察 / 自动选择; SLUI-drawn
  28px icons (`public/assets/teamselect`), 24px condensed medium labels with margins 10 12 8, hover white 0.05.
- Error banner: centred, `rgba(0,0,0,0.5)`, padding 16, radius 2, warning icon and 20px bold label in `#b1af2d`,
  5 s, 0.25 s fades. Opening fade: black, after 0.5 s a 0.5 s fade out (`_ShowPanel`).
- Input: click a half or 1 / 2 to join NTF / SCP; clicking or pressing the side the player is on only closes (CS2
  `_SelectTeam`); Escape / M / 取消 close unless forced; one command at a time.
- No text shadow. No timer: the auto-join countdown is out (task decision D3).
- Mock preview: `teamSelect=ntf|scp|forced` (the captures' rosters; `forced` = empty teams without Cancel),
  `teamSelectHover=ntf|scp` (starts with that side highlighted for captures; the mouse still moves it),
  `teamSelectReject=ntf|scp` (the mock plugin refuses that side with CS2's "...队伍人数已满。"),
  `teamSelectFade=1` keeps the opening fade. The mock reopens the menu 1.5 s after a choice.
