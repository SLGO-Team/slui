# Hidden overlay measurements (Windows, 2026-11-03)

Run a second, debuggable SLUI next to an installed one (a separate identifier passes the single-instance check):

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" npx tauri dev \
  --config '{"identifier":"com.slui.desktop.perftest","build":{"beforeDevCommand":"npm run dev:mock"}}'
```

In mock mode the session goes live at once and auto-enables the overlay before settings load, so it would show over a
foreground game: disable it right away (`node cdp.mjs 9333 overlay "window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: false })"`).

| Script | What it measures |
|---|---|
| `cdp.mjs <port> <label\|all> <expr>` | Evaluates an expression in the overlay / home page. |
| `showhide.mjs <port> <pid> <hwnd>` | rAF rate and `visibilityState` hidden, after a native `SWP_SHOWWINDOW`, after `SW_HIDE` (`win.ps1` does the Win32 calls). |
| `hidden-cost.mjs <port> [ms]` | Radar camera writes, backdrop measures / skips per second in the overlay page. |
| `cpu-sample.ps1 -Seconds n` | CPU ms/s of the app and each WebView2 process (`ROOT_PID` env). |
| `e2e-visibility.mjs <port> [s]` | Enables the overlay, lets a stand-in `SCPSL.exe` (`fake-game.cs`) hold the foreground for `s` seconds, records visibility and per-frame work every 500 ms. |

Results (WebView2 156.0.4314.58, 165 Hz):

- The overlay page stays `visible` with rAF at 166/s whether the window was never shown, shown, or hidden with `SW_HIDE`.
- Mock mode, overlay hidden, before the fix: radar camera writes 180/s, backdrop checks 165/s; renderer ~520 ms/s (development
  React), GPU process ~484 ms/s. After: camera writes ~1/s (App re-renders), backdrop 0; renderer ~37 ms/s, GPU process 0.
- End to end: Rust shows the overlay (revision 1) → camera ~180/s and the backdrop loop resume within the 500 ms bucket;
  Rust hides it (revision 2) → both 0.
