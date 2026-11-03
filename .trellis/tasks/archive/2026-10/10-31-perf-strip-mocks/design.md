# Design: strip mocks from production, lazy map template

## 1. Mock harness boundary

New module `src/mocks/overlayHarness.ts` gathers every mock/debug value `App.tsx` uses today:

```ts
export const overlayHarness = {
  createMockProvider, mockShopSnapshotFor,                       // ./provider
  HudDebugPanel, readHudDebugOptions, replaceHudDebugUrl, createHudDebugState,   // ./HudDebugPanel, ./hudDebug
  ShopDebugPanel, readShopDebugOptions, replaceShopDebugUrl, createShopDebugState, // ./ShopDebugPanel, ./shopDebug
  readMinimapPreviewOptions,                                     // ./minimapFixtures
} as const;
export type OverlayHarness = typeof overlayHarness;
```

`src/main.tsx` (overlay root only):

```ts
const harness = import.meta.env.MODE === "mock" && label !== "home"
  ? (await import("./mocks/overlayHarness")).overlayHarness : null;
render(<Root harness={harness} />)   // HomeApp keeps its current props
```

Vite replaces `import.meta.env.MODE` with a string literal, so in every non-mock build the
condition is `"production" === "mock"` / `"development" === "mock"`; Rollup folds it and drops
the dynamic import, so no harness chunk is emitted. `vite.config.ts` already forbids building
the `mock` mode, so a packaged build can never contain the harness.

`App` becomes `App({ harness }: { harness: OverlayHarness | null })`. Module constants stay,
but every debug flag also requires the harness:

```ts
const MOCK_BACKEND = BACKEND.kind === "mock";             // unchanged meaning
// inside App: const debug = HUD_DEBUG_ENABLED && harness ? harness : null;
```

TypeScript narrowing on `debug` / `harness` replaces the bare flags at each use site:

| Today | After |
|---|---|
| `useState(readHudDebugOptions)` | `useState(() => debug?.readHudDebugOptions() ?? null)` |
| `useState(readShopDebugOptions)` | same pattern |
| `useState(() => HUD_DEBUG_ENABLED ? readMinimapPreviewOptions() : defaultMinimapPreviewOptions)` | `useState<RadarOverlayOptions>(() => debug?.readMinimapPreviewOptions() ?? DEFAULT_RADAR_OVERLAY_OPTIONS)` |
| `createMockProvider(...)` when `MOCK_BACKEND` | `harness?.createMockProvider(...) ?? null` (mock backend ⇔ harness) |
| `useState(() => SHOP_DEBUG_ENABLED && readShopDebugOptions().open)` | `debug?.readShopDebugOptions().open ?? false` |
| ungated `mockShopSnapshotFor` / `createShopDebugState` / `createHudDebugState` memos | computed only when `debug`; otherwise `null` and `displayedShop = shop`, `hud = liveHud` |
| `<ShopDebugPanel>` / `<HudDebugPanel>` | `debug.ShopDebugPanel` / `debug.HudDebugPanel` |

`DEFAULT_RADAR_OVERLAY_OPTIONS` (`{ ...DEFAULT_RADAR_PREFERENCES, alternateZoomActive: false }`)
lives in `src/features/minimap/preferences.ts` with type
`RadarOverlayOptions = RadarPreferences & { alternateZoomActive: boolean }`.
`MinimapPreviewOptions` extends that shape, so the mock path keeps its extra preview fields;
`mockConnection.configureMinimap` receives the state narrowed with a commented cast, because
in mock mode the state was initialised from `readMinimapPreviewOptions()` and the setters
only spread over it.

Mismatch guard: if the backend says mock but no harness was loaded (should be impossible),
`App` throws at render with a clear message instead of silently connecting nowhere.

## 2. Lazy map template

Split `src/features/minimap/resolver.ts`:

- New `src/features/minimap/mapGeometry.ts` (no JSON, no generator): types `WorldPoint`,
  `MapBounds`, `MapRoom`, `MapConnection`, `MapGeometry`; values `mapDescriptorKey`,
  `assertSupportedMap`, and

  ```ts
  export async function resolveMinimap(init: MinimapInit): Promise<MapGeometry> {
    const { resolveMinimapSync } = await import("./resolver.ts");
    return resolveMinimapSync(init);
  }
  ```

- `resolver.ts` keeps the template/generator imports and `resolveMinimapSync` with its cache,
  imports the moved names from `mapGeometry.ts` and re-exports all of them
  (`export * from "./mapGeometry.ts"`), so every existing importer of `resolver.ts`
  (mocks, smoke scripts, `room-artwork.ts` type import) is unchanged.
- `model.ts` and `useMinimapFeature.ts` switch their value imports to `mapGeometry.ts`.
  `camera.ts`, `dynamicZoom.ts`, `room-artwork.ts` may keep type-only imports from
  `resolver.ts` (erased) or move to `mapGeometry.ts` for clarity.
- The dynamic import is circular at runtime only (`resolver.ts` → `mapGeometry.ts` static,
  `mapGeometry.ts` → `resolver.ts` dynamic), which ES modules and Rollup handle.
- Explicit `.ts` extensions on value imports, as required by the Node strip-types smoke path.

Effect: production `App-*.js` no longer holds template + generator + room-artwork manifest;
they load from a separate chunk the first time `resolveMinimap` runs (the existing async
`useEffect` in `useMinimapFeature` already handles the promise, its cancellation and errors).
In mock mode the fixtures import `resolver.ts` statically, so the harness chunk carries it.

## 3. Compatibility and risk

- Wire protocol, reducers, selectors: untouched.
- Error path: a failed chunk load rejects `resolveMinimap`; `useMinimapFeature` already maps
  any rejection to `resolve-error` → `incompatible`, the same state a generator error gives.
- Rollback: the two parts are independent commits (harness, lazy template); either reverts
  cleanly.
