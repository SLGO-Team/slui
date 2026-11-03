# Radar colour-wash structure on WebView2's GPU path (Windows, 2026-11-03)

Setup as in `../hidden-pause/README.md` (debuggable dev SLUI in mock mode, overlay disabled between runs). Each run of
`zone-filter-bench.mjs <port> <slui pid> <label> <fixed|heading-up>` enables the overlay, lets the stand-in `SCPSL.exe`
(1280x720 logical = 1920x1080 at 150 %) hold the foreground so Rust shows the overlay over it, and records 8 s with
`gpu-sample.ps1`: the WebView2 GPU process's GPU engine utilization (sum of its `GPU Engine` counters) and CPU, and the
renderer's CPU (development React). Variants are the patches in `../../10-31-perf-radar-zone-filters/research/`
(A = `variant-a-zone-groups.diff`, B = `variant-b-viewport-region.diff`), applied to the working tree; Vite hot-reloads them.

`runs.jsonl` holds every run. Two runs did not have the variant on the page yet (`filtered` 70 under label A or B) and
are excluded from the PRD table; the rest ran interleaved (current, A, B per round).

`radar-shot.mjs` captures the radar crop from the shown overlay. Compared at the densest difference, the seams between
rooms come out fainter with A (max 15/255). In the visual audit's 1080p radar crop (headless software raster) the current
per-room filters draw diagonal hairlines along each room's filter region across a turned map; A draws one, along its zone
group's region (max 60/255). The comparison images are not kept: the repository allows no media under `.trellis/`.
