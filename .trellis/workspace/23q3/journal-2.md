# Journal - 23q3 (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-11-25

---



## Session 86: Toolchain checks and silent install guards
<!-- trellis-session: v=2 fp=e7509f333af58801 -->

**Date**: 2026-11-25
**Task**: Toolchain checks and silent install guards
**Branch**: `fix/toolchain-and-silent-install`

### Summary

mock-boundary-check now catches export-from re-exports, side-effect and dynamic imports (self-tested matcher) and resolves its root with fileURLToPath (verified under a path with spaces and CJK). generate-licenses checks every installed version and lists one entry per name+license+text (output unchanged today; extraneous packages skipped). SLUI-Setup /S refuses a downgrade or a /D= beside the installed SLUI (exit 2) and runs the wizard's verify after NSIS exits 0. Installer tests added; not run live (would replace the installed SLUI).

### Git Commits

| Hash | Message |
|------|---------|
| `148f04f` | fix(installer): keep the wizard's guards on silent installs; tighten mock and license checks |

### Status

[OK] **Completed**


## Session 87: Minimap audit: map-blend hue on seams
<!-- trellis-session: v=2 fp=6451ab97c353660b -->

**Date**: 2026-11-25
**Task**: Minimap audit: map-blend hue on seams
**Branch**: `test/minimap-audit-blend-hue`

### Summary

minimap-visual-audit stopped at map-blend a=0 offHue on this PC in pre- and post-#122 builds: one room-seam pixel where the lift layer (own composited group) antialiases at coverage 0.75 vs the base map's 0.91, mixing the map colour into on-off with no blend error. The hue check now judges pixels flat in both shots (asserted >50%, ~80%); edge pixels keep the range check and are reported as edgeOffHue. Full audit passes (76 checks, 172 shots); a deliberately wrong blend colour still fails.

### Git Commits

| Hash | Message |
|------|---------|
| `81e4ef4` | test(minimap): judge the map-blend hue where both renders cover alike |

### Status

[OK] **Completed**
