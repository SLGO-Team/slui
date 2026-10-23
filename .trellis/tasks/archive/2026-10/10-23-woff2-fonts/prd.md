# Ship bundled fonts as WOFF2

## Goal

`slui.exe` embeds the frontend assets; the two Noto Sans SC TTFs alone are 16.9 MB of a 33 MB
binary and of every update download. Ship every font SLUI bundles itself as WOFF2 instead.

## Requirements

- Convert `public/assets/fonts/**/*.ttf` (Noto Sans SC light/bold, Barlow, Chakra Petch, the Barlow /
  Saira fallbacks) to WOFF2 losslessly: same glyph set (full CJK coverage for player names and chat),
  same metrics. No subsetting.
- All `@font-face` rules (overlay panels, home, installer) and the `FontFace` fallbacks in
  `src/shared/fonts.ts` point at the WOFF2 files with `format("woff2")`.
- Theme-pack fonts (Stratum2, not ours) are untouched.
- `THIRD_PARTY_NOTICES.md` names the shipped files.

## Acceptance Criteria

- [x] No `.ttf` left under `public/assets/fonts`; no reference to one in `src`, `installer`, notices.
- [x] Every converted font has the same glyph count and the same `head` / `hhea` / `OS/2` metrics as
      its TTF (glyph order, cmap, head/hhea/OS/2 checked at conversion).
- [x] Layout audits that passed before still pass (pixel geometry unchanged).
- [x] `npm run lint`, `npm test`, `npm run build:local` pass; dist font size reported before / after.

## Result

- Files: 17.87 MB -> 12.74 MB (Noto Sans SC bold 8.62 -> 6.46, light 8.30 -> 5.94).
- In `slui.exe`: Tauri release builds brotli-compress embedded assets (quality 9), so the TTFs were
  already stored at ~14.0 MB; the WOFF2 set stores at 12.7 MB. The exe shrinks by ~1.3 MB, not by
  the file-size difference. A real cut needs dropping glyphs (a GB2312 subset is 1.55 MB per
  weight), which the visual-replication spec currently rules out (no Microsoft YaHei fallback).
