import React from "react";
import ReactDOM from "react-dom/client";
import { suppressPageContextMenu } from "./platform/contextMenu";
import { currentWindowLabel, isTauri } from "./platform/desktop";
import { installPageErrorLog } from "./platform/pageErrors";
import { loadThemePack } from "./platform/themePack";
import { registerFontFaces } from "./shared/fonts";
import { setThemePack } from "./shared/themePack";

// React's development build records a performance.measure (with a props diff) for
// re-renders with changed props; the User Timing buffer never drops them, so an
// animating overlay grows by ~1 KB per entry for as long as it runs. SLUI uses no
// User Timing itself, and DevTools recordings keep entries captured before a clear.
if (import.meta.env.DEV && typeof performance.clearMeasures === "function") {
  window.setInterval(() => performance.clearMeasures(), 10_000);
}

// Uncaught errors reach slui.log from the first line on; the window label joins them once known.
let windowLabel = "page";
const rootErrorOptions = installPageErrorLog(() => windowLabel);

// One bundle serves both windows; the Tauri window label (or ?window=home in a
// browser) selects the root. Each root is loaded on demand so the overlay's
// transparent page CSS never reaches the home window.
void Promise.all([currentWindowLabel(), loadThemePack()]).then(async ([label, themePack]) => {
  windowLabel = label;
  // Theme-pack fonts and sounds must be resolved before any feature mounts.
  setThemePack(themePack);
  registerFontFaces(themePack);
  // The browser preview keeps its menu for DevTools.
  if (isTauri()) suppressPageContextMenu(label);
  let root: React.ReactNode;
  if (label === "home") {
    const { HomeApp } = await import("./app/home/HomeApp");
    root = <HomeApp />;
  } else {
    // The mocks load only in the `mock` mode; Vite replaces MODE at build time, so packages never include them.
    const harness = import.meta.env.MODE === "mock" ? await import("./mocks/harness") : null;
    const { default: App } = await import("./App");
    root = <App harness={harness} />;
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement, rootErrorOptions).render(
    <React.StrictMode>
      {root}
    </React.StrictMode>,
  );
});
