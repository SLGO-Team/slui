// Everything the overlay takes from the mocks: main.tsx imports this module only in the `mock` mode, so a
// package (which vite.config.ts never builds in that mode) carries none of it, nor the debug panels' CSS
// and preview art. The overlay imports types from src/mocks and values only through this module.
export { createMockProvider, mockShopSnapshotFor } from "./provider";
export { HudDebugPanel } from "./HudDebugPanel";
export { ShopDebugPanel } from "./ShopDebugPanel";
export { readScoreboardDebugPins } from "./scoreboardScenes";
export { createShopDebugState, readShopDebugOptions, replaceShopDebugUrl } from "./shopDebug";
export { createHudDebugState, readHudDebugOptions, replaceHudDebugUrl } from "./hudDebug";
export { readMinimapPreviewOptions } from "./minimapFixtures";
