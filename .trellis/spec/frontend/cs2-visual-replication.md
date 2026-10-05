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
- Other 16:9 viewports scale the complete 1920x1080 overlay uniformly.
- Individual HUD regions must not independently reflow or use viewport-driven
  font sizing.

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
- Missing or failed avatars reveal a stable side-specific fallback.
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
| Timer mode `pause` | Yellow m:ss with a small 「暂停」 label |
| Timer mode `round` | Phase clock; warning red at 10 s or less unless paused |
| Dead teammate loadout | Money only; offline teammates show no equipment |
| Non-positive viewport dimension | Use a stable scale of 1 |
| 16:9 viewport below baseline | Uniformly scale the whole overlay |
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
  `public/assets/fonts/notosanssc-*.ttf` are CS2's own copies (SIL OFL). Do not
  fall back to Windows fonts such as Microsoft YaHei.
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
