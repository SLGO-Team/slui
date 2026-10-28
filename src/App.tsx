import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_HUD_KILLFEED, CLIENT_FEATURE_HUD_MESSAGES, CLIENT_FEATURE_HUD_MONEY, CLIENT_FEATURE_HUD_SPECTATING, CLIENT_FEATURE_HUD_STATUS, CLIENT_FEATURE_SCOREBOARD, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TEAM_SELECT, CLIENT_FEATURE_TOP_HUD, CLIENT_FEATURE_WIN_PANEL, type ConnectionStatus, type MinimapDiagnostic, type ShopCommand, type SlgoEvent, type TeamCommand } from "./contracts";
import { HudTeamCounter } from "./features/hud/HudTeamCounter";
import { HUD_EVENT_TYPES, initialRoundHudState, roundHudReducer, sameRoundHudTime, selectRoundHud, selectRoundHudClock } from "./features/hud/model";
import { ShopPanel } from "./features/shop/ShopPanel";
import { sameShopTime, selectShop } from "./features/shop/model";
import { useShopFeature } from "./features/shop/useShopFeature";
import { ChatInput } from "./features/chat/ChatInput";
import { createChatCommand, validateChatBody, type ChatCloseReason } from "./features/chat/model";
import { resolveChatSelf } from "./features/chat/presentation";
import { hudVariantFor, playerSlotColors, topHudPlayerMetaForHud, type HudPresentationVariant } from "./features/hud/presentation";
import { useChatFeature } from "./features/chat/useChatFeature";
import { MessageZone } from "./features/hudmessages/MessageZone";
import { HUD_MESSAGES_EVENT_TYPES, hudMessagesReducer, initialHudMessagesState, selectMessageZone, selectProgressCard } from "./features/hudmessages/model";
import { progressViewerFromHud } from "./features/hudmessages/presentation";
import { ProgressCard } from "./features/hudmessages/ProgressCard";
import { WinPanel } from "./features/winpanel/WinPanel";
import { BottomHud } from "./features/bottomhud/BottomHud";
import { HUD_STATUS_EVENT_TYPES, hudStatusReducer, initialHudStatusState, selectBottomHud, selectWatchedHud } from "./features/bottomhud/model";
import { initialWinPanelState, selectWinPanel, WIN_PANEL_EVENT_TYPES, winPanelReducer } from "./features/winpanel/model";
import { KillFeed } from "./features/killfeed/KillFeed";
import { initialKillfeedState, KILLFEED_EVENT_TYPES, killfeedReducer, selectKillfeed } from "./features/killfeed/model";
import { Scoreboard } from "./features/scoreboard/Scoreboard";
import { initialScoreboardState, initialScoreboardViewState, SCOREBOARD_EVENT_TYPES, scoreboardReducer, type ScoreboardMode, type ScoreboardStat } from "./features/scoreboard/model";
import { scoreboardElapsedText, selectScoreboard } from "./features/scoreboard/presentation";
import { winPanelRosterFromHud } from "./features/winpanel/presentation";
import { TeamSelect } from "./features/teamselect/TeamSelect";
import { selectTeamSelect } from "./features/teamselect/presentation";
import { useTeamSelectFeature } from "./features/teamselect/useTeamSelectFeature";
import { createOverlayWindowController, type SlgoConnection } from "./platform";
import type * as DebugHarnessModule from "./mocks/harness";
import type { HudDebugOptions } from "./mocks/hudDebug";
import type { ShopDebugOptions } from "./mocks/shopDebug";
import type { TeamSelectDebugOptions } from "./mocks/teamSelectDebug";
import { HttpControlPlane, MockControlPlane } from "./platform/route";
import { WebSocketSidecarConnection } from "./platform/connection";
import { createTauriSidecarSocket } from "./platform/sidecarSocket";
import { readBackendConfig } from "./platform/backend";
import { createIdentityProofProvider, LocalSteamIdentity } from "./platform/identity";
import { useClientSession } from "./app/useClientSession";
import { useGameRunning } from "./app/useGameRunning";
import { LiveMinimapRadar } from "./features/minimap/MinimapRadar";
import { useMinimapFeature } from "./features/minimap/useMinimapFeature";
import type { MinimapPreviewOptions } from "./mocks/minimapFixtures";
import { createPreviewGameForegroundSource, subscribeGameForeground } from "./platform/gameForeground";
import { DEFAULT_AUDIO_SETTINGS } from "./platform/audioSettings";
import { DEFAULT_OVERLAY_SETTINGS, shouldAutoEnableOverlay } from "./platform/overlaySettings";
import { createSettingsStore, type AppSettings } from "./platform/settings";
import { useWorldBlur } from "./platform/backdrop";
import { useClockSelector } from "./shared/clock";
import type { HudSceneSelf } from "./mocks/hudScenes";
import { DEFAULT_RADAR_PREFERENCES, type RadarPreferences } from "./features/minimap/preferences";
import { createOverlayStateSource, createSessionStatusPublisher, isTauri, type OverlayState, type SessionStatusSnapshot } from "./platform/desktop";
import { createUpdateSource } from "./platform/updater";
import { requiredUpdate } from "./app/updateModel";
import "./App.css";

/** Plugin features the enabled overlay takes over (reported via client.features). */
const OVERLAY_CLIENT_FEATURES = [
  CLIENT_FEATURE_CHAT_INPUT,
  CLIENT_FEATURE_SHOP_MENU,
  CLIENT_FEATURE_TOP_HUD,
  CLIENT_FEATURE_WIN_PANEL,
  CLIENT_FEATURE_HUD_MESSAGES,
  CLIENT_FEATURE_HUD_MONEY,
  CLIENT_FEATURE_HUD_STATUS,
  CLIENT_FEATURE_HUD_SPECTATING,
  CLIENT_FEATURE_HUD_KILLFEED,
  CLIENT_FEATURE_SCOREBOARD,
  CLIENT_FEATURE_TEAM_SELECT,
] as const;

// Mocks only in the explicit `mock` mode (npm run dev:mock), which vite.config.ts never builds; their code
// arrives as the `harness` prop (src/mocks/harness.ts, imported by main.tsx in that mode only), so a
// package carries none of it. readBackendConfig returns `mock` exactly in this mode.
const BACKEND = readBackendConfig(import.meta.env);
const MOCK_BACKEND = import.meta.env.MODE === "mock";
// Debug surfaces drive the mock stream; they never overlay real backend data.
const HUD_DEBUG_ENABLED = import.meta.env.DEV && MOCK_BACKEND
  && import.meta.env.VITE_ENABLE_MOCK_VERIFIED_PROOF === "true";
const SHOP_DEBUG_ENABLED = HUD_DEBUG_ENABLED;
// Visual audits pin radar preferences through minimap* URL parameters; saved settings must not override them.
const MINIMAP_URL_OVERRIDE = HUD_DEBUG_ENABLED
  && [...new URLSearchParams(window.location.search).keys()].some((key) => key.startsWith("minimap"));

declare global {
  interface Window {
    __SLUI_MINIMAP_DEBUG__?: {
      configure(options: Partial<MinimapPreviewOptions>): void;
      setFocused(focused: boolean): void;
      rebuild(layout?: number): void;
      invalidate(kind: "invalid" | "incompatible"): void;
      disconnect(): Promise<void>;
      reconnect(): void;
    };
  }
}

function sameSceneSelf(a: HudSceneSelf | null, b: HudSceneSelf | null): boolean {
  return a === null || b === null ? a === b : a.alive === b.alive && a.money === b.money;
}

/** Radar preferences and the held alternate zoom; the debug build keeps its full preview options here. */
type OverlayMinimapOptions = RadarPreferences & { alternateZoomActive: boolean };
const DEFAULT_MINIMAP_OPTIONS: OverlayMinimapOptions = { ...DEFAULT_RADAR_PREFERENCES, alternateZoomActive: false };

type DebugHarness = typeof DebugHarnessModule;

export type AppProps = {
  /** The mocks in the `mock` mode, else null (see MOCK_BACKEND). */
  harness: DebugHarness | null;
};

function App({ harness }: AppProps) {
  const debug = HUD_DEBUG_ENABLED ? harness : null;
  const [debugOptions, setDebugOptions] = useState<HudDebugOptions | null>(() => debug?.readHudDebugOptions() ?? null);
  const [shopDebugOptions, setShopDebugOptions] = useState<ShopDebugOptions | null>(() => SHOP_DEBUG_ENABLED ? debug?.readShopDebugOptions() ?? null : null);
  const [minimapOptions, setMinimapOptions] = useState<OverlayMinimapOptions>(() => debug?.readMinimapPreviewOptions() ?? DEFAULT_MINIMAP_OPTIONS);
  // ?teamSelect=ntf|scp|forced: the mock plugin opens a menu and the panel lists the captures' rosters.
  const [teamSelectDebug] = useState<TeamSelectDebugOptions | null>(() => debug?.readTeamSelectDebugOptions() ?? null);
  const previewParams = new URLSearchParams(window.location.search);
  const showPreviewBackground = HUD_DEBUG_ENABLED && previewParams.get("background") !== "0";
  const showHudDebugPanel = HUD_DEBUG_ENABLED && previewParams.get("hudDebug") !== "0";
  // Both debug panels are suppressible from the URL so the shop can be captured
  // as it will ship when comparing against the baseline screenshot.
  const showShopDebugPanel = SHOP_DEBUG_ENABLED && previewParams.get("shopDebug") !== "0";
  const previewBackground = showPreviewBackground ? debugOptions?.background : undefined;
  const previewViewerTeam = debugOptions?.viewerTeam === "team-b" ? "team-b" : "team-a";
  const previewShopRole = shopDebugOptions?.role === "scp079" ? "scp079" : "scp";
  // A 079 debug scenario always needs the SCP-side fixture, even when the HUD
  // preview is still showing Team A or spectator data.
  const debugShopViewerTeam = previewShopRole === "scp079" ? "team-b" : previewViewerTeam;
  // The debug harness and a dev `hudVariant` URL parameter pin the variant for visual audits.
  const urlHudVariant = import.meta.env.DEV ? previewParams.get("hudVariant") : null;
  const pinnedHudVariant: HudPresentationVariant | null = debugOptions
    ? debugOptions.variant
    : urlHudVariant === "compact" || urlHudVariant === "detailed" ? urlHudVariant : null;
  const mockConnection = useMemo(() => MOCK_BACKEND && harness ? harness.createMockProvider(previewViewerTeam, previewShopRole) : null, [harness, previewShopRole, previewViewerTeam]);
  const connection = useMemo<SlgoConnection>(() => mockConnection ?? new WebSocketSidecarConnection({
    // Tauri connects from Rust so the TLS handshake carries no SNI; browser previews keep WebSocket.
    createSocket: isTauri() ? createTauriSidecarSocket : undefined,
    endpointOverride: BACKEND.kind === "real" ? BACKEND.sidecarEndpointOverride : null,
  }), [mockConnection]);
  const controlPlane = useMemo(() => BACKEND.kind === "real" ? new HttpControlPlane(BACKEND.controlPlaneUrl) : new MockControlPlane(), []);
  const identity = useMemo(() => new LocalSteamIdentity(), []);
  // The real control plane accepts only the local-steamid claim.
  const proof = useMemo(() => createIdentityProofProvider(MOCK_BACKEND && import.meta.env.VITE_ENABLE_MOCK_VERIFIED_PROOF === "true"), []);
  const [hudState, dispatchHud] = useReducer(roundHudReducer, initialRoundHudState);
  const [winPanelState, dispatchWinPanel] = useReducer(winPanelReducer, initialWinPanelState);
  const [hudMessagesState, dispatchHudMessages] = useReducer(hudMessagesReducer, initialHudMessagesState);
  const [hudStatusState, dispatchHudStatus] = useReducer(hudStatusReducer, initialHudStatusState);
  const [killfeedState, dispatchKillfeed] = useReducer(killfeedReducer, initialKillfeedState);
  const [scoreboardState, dispatchScoreboard] = useReducer(scoreboardReducer, initialScoreboardState);
  // Page, side and sort persist for the session; held and cursor follow the scoreboard key.
  // The debug build pins held / cursor / page / side from the URL (?scoreboard=passive|cursor) for captures.
  const [scoreboardPins] = useState(() => debug?.readScoreboardDebugPins() ?? null);
  const [scoreboardViewState, setScoreboardViewState] = useState(() => scoreboardPins
    ? { ...initialScoreboardViewState, page: scoreboardPins.page, side: scoreboardPins.side } : initialScoreboardViewState);
  const [scoreboardHeld, setScoreboardHeld] = useState(() => scoreboardPins?.mode != null);
  const [scoreboardCursor, setScoreboardCursor] = useState(() => scoreboardPins?.mode === "cursor");
  const scoreboardModeRef = useRef<ScoreboardMode>("hidden");
  const shopFeature = useShopFeature();
  const teamSelectFeature = useTeamSelectFeature();
  const chatFeature = useChatFeature();
  const minimapFeature = useMinimapFeature();
  const previewFocus = useMemo(() => HUD_DEBUG_ENABLED ? createPreviewGameForegroundSource(true) : null, []);
  // The player opens the shop with its hotkey; window_open alone never opens it.
  // Only the debug build honours ?shopOpen=1.
  const [shopOpen, setShopOpen] = useState(() => shopDebugOptions?.open ?? false);
  const [shopVolume, setShopVolume] = useState(DEFAULT_AUDIO_SETTINGS.shopVolume);
  const [overlaySettings, setOverlaySettings] = useState(DEFAULT_OVERLAY_SETTINGS);
  const shopAvailableRef = useRef(false);
  const connectionLiveRef = useRef(false);
  const chatOpenRef = useRef(false);
  const shopVisibleRef = useRef(false);
  const teamSelectShownRef = useRef(false);
  // Whether the overlay is over the game: the game or the overlay itself holds the foreground (native, one sample).
  // A menu the plugin opened takes the input only then, so it never takes the foreground from another application,
  // and taking it from the game keeps it (the game alone loses the foreground at that moment).
  const [overGame, setOverGame] = useState(false);
  const overlayController = useMemo(() => createOverlayWindowController(), []);
  useWorldBlur(overlaySettings.worldBlur, overlaySettings.worldBlurStrength);

  const handleEvent = useCallback((event: SlgoEvent) => {
    const receivedAtMs = Date.now();
    // Each reducer gets only the events it reads: useReducer has no eager bailout, so any dispatch
    // re-runs App, and minimap positions (the radar's own store) arrive at 15 Hz.
    const type = event.type;
    if (HUD_EVENT_TYPES.has(type)) dispatchHud({ type: "event", event, receivedAtMs });
    if (WIN_PANEL_EVENT_TYPES.has(type)) dispatchWinPanel({ type: "event", event, receivedAtMs });
    if (HUD_MESSAGES_EVENT_TYPES.has(type)) dispatchHudMessages({ type: "event", event, receivedAtMs });
    if (HUD_STATUS_EVENT_TYPES.has(type)) dispatchHudStatus({ type: "event", event });
    if (KILLFEED_EVENT_TYPES.has(type)) dispatchKillfeed({ type: "event", event, receivedAtMs });
    if (SCOREBOARD_EVENT_TYPES.has(type)) dispatchScoreboard({ type: "event", event, receivedAtMs });
    shopFeature.receiveEvent(event);
    teamSelectFeature.receiveEvent(event, receivedAtMs);
    chatFeature.receiveEvent(event);
    minimapFeature.receiveEvent(event);
  }, [shopFeature.receiveEvent, teamSelectFeature.receiveEvent, chatFeature.receiveEvent, minimapFeature.receiveEvent]);
  const handleDiagnostic = useCallback((diagnostic: MinimapDiagnostic) => {
    minimapFeature.receiveDiagnostic(diagnostic);
  }, [minimapFeature.receiveDiagnostic]);
  const handleStatus = useCallback((status: ConnectionStatus) => {
    if ((status === "live") !== connectionLiveRef.current) overlayController.log(`session ${status}`);
    dispatchHud({ type: "connection", status });
    dispatchWinPanel({ type: "connection", status });
    dispatchHudMessages({ type: "connection", status });
    dispatchHudStatus({ type: "connection", status });
    dispatchKillfeed({ type: "connection", status });
    dispatchScoreboard({ type: "connection", status });
    shopFeature.setConnectionStatus(status);
    teamSelectFeature.setConnectionStatus(status);
    connectionLiveRef.current = status === "live";
    chatFeature.setConnectionStatus(status);
    minimapFeature.setConnectionStatus(status);
  }, [overlayController, shopFeature.setConnectionStatus, teamSelectFeature.setConnectionStatus, chatFeature.setConnectionStatus, minimapFeature.setConnectionStatus]);
  const dependencies = useMemo(() => ({ identity, proof, controlPlane, connection }), [connection, controlPlane, identity, proof]);
  // A required update (manifest `min_version` above this version) keeps the session from connecting.
  // Unknown until a check succeeds, so a failing update server never blocks play. No update UI here.
  const updateSource = useMemo(() => createUpdateSource(), []);
  const [updateRequired, setUpdateRequired] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = updateSource.subscribe((state) => {
      changed = true;
      setUpdateRequired(requiredUpdate(state));
    });
    void updateSource.get().then((state) => {
      if (active && !changed) setUpdateRequired(requiredUpdate(state));
    }).catch((error: unknown) => console.error("Unable to read the update state", error));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [updateSource]);
  // The game's exit ends the session (status `game-not-running`, every feature drops its match); its start begins one.
  const gameRunning = useGameRunning();
  const session = useClientSession(dependencies, handleEvent, handleDiagnostic, handleStatus, updateRequired, gameRunning);
  const settingsStore = useMemo(() => createSettingsStore(), []);
  const overlayState = useMemo(() => createOverlayStateSource(), []);
  const sessionPublisher = useMemo(() => createSessionStatusPublisher(), []);

  useEffect(() => {
    if (MINIMAP_URL_OVERRIDE) return undefined;
    let active = true;
    const apply = (radar: RadarPreferences) => {
      if (active) setMinimapOptions((current) => ({ ...current, ...radar }));
    };
    void settingsStore.load().then((settings) => apply(settings.radar))
      .catch((error: unknown) => console.error("Unable to load settings", error));
    const unsubscribe = settingsStore.subscribe((settings) => apply(settings.radar));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [settingsStore]);

  // Hotkeys and sound apply even when minimap URL parameters pin the radar preferences.
  useEffect(() => {
    let active = true;
    const apply = (settings: AppSettings) => {
      if (!active) return;
      setShopVolume(settings.audio.shopVolume);
      setOverlaySettings(settings.overlay);
      void overlayController.setHotkeys(settings.hotkeys)
        .catch((error: unknown) => console.error("Unable to apply hotkeys", error));
    };
    void settingsStore.load().then(apply).catch((error: unknown) => console.error("Unable to load settings", error));
    const unsubscribe = settingsStore.subscribe(apply);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [overlayController, settingsStore]);

  // Disabling the overlay must not leave an open shop, chat or team menu (and so interaction) or a held zoom behind.
  // Rust drops the interaction itself; a panel left open here would come back on enabling without asking for it.
  useEffect(() => overlayState.subscribe((state) => {
    if (state.enabled) return;
    setShopOpen(false);
    chatFeature.close("unavailable");
    teamSelectFeature.release();
    setMinimapOptions((current) => current.alternateZoomActive ? { ...current, alternateZoomActive: false } : current);
  }), [overlayState, chatFeature.close, teamSelectFeature.release]);

  // While the overlay is enabled it owns Y/U and B, so the plugin ignores its own chat-area
  // toggle and no longer opens its in-game shop for this player. A disabled overlay keeps
  // the session live, so it must say so.
  useEffect(() => {
    let active = true;
    let changed = false;
    const apply = (state: OverlayState) => connection.setFeatures(state.enabled ? OVERLAY_CLIENT_FEATURES : []);
    const unsubscribe = overlayState.subscribe((state) => {
      changed = true;
      apply(state);
    });
    void overlayState.get().then((state) => {
      if (active && !changed) apply(state);
    }).catch((error: unknown) => console.error("Unable to read overlay state", error));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [connection, overlayState]);

  // Auto-enable: once per connection (session attempt) when it reaches live. Settings may load after the
  // session is live, so the setting is state and a late load still enables this connection.
  const autoEnabledAttemptRef = useRef<number | null>(null);
  useEffect(() => {
    if (!shouldAutoEnableOverlay(overlaySettings, session.status, session.attempt, autoEnabledAttemptRef.current)) return;
    autoEnabledAttemptRef.current = session.attempt;
    void overlayState.get()
      .then((state) => state.enabled ? state : overlayState.setEnabled(true))
      .catch((error: unknown) => console.error("Unable to auto-enable the overlay", error));
  }, [overlaySettings, overlayState, session.attempt, session.status]);

  // The session runs here, in the overlay window; home only displays it.
  const sessionSnapshot = useMemo<SessionStatusSnapshot>(() => ({
    status: session.status, steamId: session.identity?.steamId ?? null, detail: session.detail, endReason: session.endReason,
  }), [session.detail, session.endReason, session.identity?.steamId, session.status]);
  const sessionSnapshotRef = useRef(sessionSnapshot);
  sessionSnapshotRef.current = sessionSnapshot;
  useEffect(() => sessionPublisher.publish(sessionSnapshot), [sessionPublisher, sessionSnapshot]);
  useEffect(() => {
    const stopRequests = sessionPublisher.onRequest(() => sessionPublisher.publish(sessionSnapshotRef.current));
    const stopRetries = sessionPublisher.onRetry(session.retry);
    return () => {
      stopRequests();
      stopRetries();
    };
  }, [session.retry, sessionPublisher]);

  useEffect(() => {
    const subscribe = previewFocus && !("__TAURI_INTERNALS__" in window)
      ? previewFocus.subscribeGameForeground : subscribeGameForeground;
    return subscribe((state) => {
      minimapFeature.setGameForeground(state);
      setOverGame(state.overGame);
    });
  }, [previewFocus, minimapFeature.setGameForeground]);

  useEffect(() => {
    // The debug build seeds the state with its full preview options (readMinimapPreviewOptions).
    if (HUD_DEBUG_ENABLED) mockConnection?.configureMinimap(minimapOptions as MinimapPreviewOptions);
  }, [mockConnection, minimapOptions]);

  useEffect(() => {
    if (debugOptions) mockConnection?.configureHudScene(debugOptions.hudScene, debugOptions.hudSceneAt);
  }, [mockConnection, debugOptions?.hudScene, debugOptions?.hudSceneAt]);

  useEffect(() => {
    if (debug && teamSelectDebug) mockConnection?.configureTeamMenu(debug.teamMenuOptionsFor(teamSelectDebug));
  }, [debug, mockConnection, teamSelectDebug]);

  useEffect(() => {
    if (!HUD_DEBUG_ENABLED || !mockConnection || !previewFocus) return;
    const control: NonNullable<Window["__SLUI_MINIMAP_DEBUG__"]> = {
      configure: (options) => setMinimapOptions((current) => ({ ...current, ...options })),
      setFocused: previewFocus.setFocused,
      rebuild: (layout) => mockConnection.rebuildMinimap(layout),
      invalidate: (kind) => mockConnection.invalidateMinimap(kind),
      disconnect: () => mockConnection.disconnect(),
      reconnect: session.retry,
    };
    window.__SLUI_MINIMAP_DEBUG__ = control;
    return () => {
      if (window.__SLUI_MINIMAP_DEBUG__ === control) delete window.__SLUI_MINIMAP_DEBUG__;
    };
  }, [mockConnection, previewFocus, session.retry]);

  // The shop hotkey always closes the shop, but only opens it over the focused game during
  // the buy window, so typing elsewhere never takes the mouse. Y/U open chat over the
  // focused game while the session is live, and close the shop. While chat has the
  // keyboard every hooked key is ordinary typing. The hook reports the foreground at
  // the key press itself; the browser preview (null) only sees keys while its tab is
  // focused, so it skips the game check. An open shop holds the foreground in the
  // game's place, so a key pressed while it has focus counts as over the game.
  // Keys pressed into the focused overlay can arrive twice, from the page and from
  // the hook, so both paths must be idempotent: the shop key only opens the shop when
  // the game itself had the foreground, and a second close or chat open is a no-op.
  useEffect(() => overlayController.subscribeShortcut((shortcut, gameForeground) => {
    // The team select menu is modal, as in CS2: the shop and chat keys wait until it closes.
    if (teamSelectShownRef.current) {
      overlayController.log(`${shortcut} ignored: team select open`);
      return;
    }
    if (chatOpenRef.current) {
      overlayController.log(`${shortcut} key while chat open (page focused: ${document.hasFocus()})`);
      // With the keyboard in the overlay these are keys typed into chat. A hook key
      // while the overlay window is unfocused means the keyboard never arrived, so
      // the key closes chat instead of leaving it stuck open over the game.
      if (!document.hasFocus()) {
        overlayController.log(`chat closed: ${shortcut} pressed without keyboard`);
        chatFeature.close("unavailable");
      }
      return;
    }
    const gameFocused = (gameForeground ?? true) || (shopVisibleRef.current && document.hasFocus());
    if (shortcut === "shop") {
      setShopOpen((current) => current ? false : (gameForeground ?? true) && shopAvailableRef.current);
      return;
    }
    if (!gameFocused || !connectionLiveRef.current) {
      overlayController.log(`${shortcut} ignored: game foreground ${gameFocused}, session live ${connectionLiveRef.current}`);
      return;
    }
    setShopOpen(false);
    chatFeature.open(shortcut === "chat-team" ? "team" : "global");
  }), [overlayController, chatFeature.close, chatFeature.open]);

  useEffect(() => {
    if (!debug || !debugOptions) return undefined;
    debug.replaceHudDebugUrl(debugOptions);
    const handlePopState = () => setDebugOptions(debug.readHudDebugOptions());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [debug, debugOptions]);

  useEffect(() => {
    if (!debug || !shopDebugOptions) return undefined;
    debug.replaceShopDebugUrl({ ...shopDebugOptions, open: shopOpen });
    const handlePopState = () => setShopDebugOptions(debug.readShopDebugOptions());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [debug, shopDebugOptions, shopOpen]);

  // The overlay clock never re-renders App on its own: these views are re-selected on it and kept while
  // their time-dependent part (availability) is unchanged. Panels select their own clocks and expiry.
  const selectLiveHud = useCallback((nowMs: number) => selectRoundHud(hudState, nowMs, session.endReason), [hudState, session.endReason]);
  const liveHud = useClockSelector(selectLiveHud, sameRoundHudTime);
  const selectLiveShop = useCallback((nowMs: number) => selectShop(shopFeature.state, nowMs), [shopFeature.state]);
  const shop = useClockSelector(selectLiveShop, sameShopTime);
  // Debug frames are built once per option change and read at that moment, so they stay live with still
  // clocks without a clock in App.
  const debugShop = useMemo(() => {
    if (!debug || !shopDebugOptions) return null;
    const builtAtMs = Date.now();
    return selectShop(debug.createShopDebugState(shopDebugOptions, builtAtMs, debug.mockShopSnapshotFor(debugShopViewerTeam, previewShopRole)), builtAtMs);
  }, [debug, debugShopViewerTeam, previewShopRole, shopDebugOptions]);
  const debugHudFrame = useMemo(() => {
    if (!debug || !debugOptions) return null;
    const builtAtMs = Date.now();
    return { state: debug.createHudDebugState(debugOptions, builtAtMs), builtAtMs };
  }, [debug, debugOptions]);
  const debugHud = useMemo(() => debugHudFrame && selectRoundHud(debugHudFrame.state, debugHudFrame.builtAtMs), [debugHudFrame]);
  const hudClockAt = useCallback((nowMs: number) => debugHudFrame
    ? selectRoundHudClock(debugHudFrame.state, debugHudFrame.builtAtMs)
    : selectRoundHudClock(hudState, nowMs), [debugHudFrame, hudState]);
  const shopCountdownAt = useCallback((nowMs: number) => hudClockAt(nowMs)?.phaseClockSeconds ?? null, [hudClockAt]);
  const displayedShop = debugShop ?? shop;
  const shopAvailable = displayedShop.hasSnapshot && displayedShop.windowOpen;
  shopAvailableRef.current = shopAvailable;
  const chatOpen = chatFeature.state.open;
  chatOpenRef.current = chatOpen;
  shopVisibleRef.current = shopOpen && shopAvailable;
  // Interaction follows the open UI: it is on exactly while the shop or chat is on
  // screen, and it always takes the foreground too. A foreground game keeps its
  // cursor locked to the centre and turns the camera with the mouse, so the mouse
  // alone is not enough even for the shop.
  const localSteamIdForScoreboard = session.identity?.steamId ?? null;
  const scoreboardHud = debugHud ?? liveHud;
  const scoreboard = useMemo(() => selectScoreboard({
    hud: scoreboardHud, frame: scoreboardState.frame, view: scoreboardViewState, localPlayerId: localSteamIdForScoreboard,
  }), [localSteamIdForScoreboard, scoreboardHud, scoreboardState.frame, scoreboardViewState]);
  const scoreboardFrame = scoreboardState.frame;
  const scoreboardElapsedAt = useCallback((nowMs: number) => scoreboardFrame ? scoreboardElapsedText(scoreboardFrame, nowMs) : "", [scoreboardFrame]);
  // The plugin's team menu session over the match rosters (the debug scene lists the captures' rosters instead). It is
  // modal, as in CS2: while it is on screen the other panels are not drawn and the shop, chat and scoreboard stay shut.
  const teamSelectTeams = useMemo(() => debug && teamSelectDebug ? debug.teamSelectDebugTeams(teamSelectDebug)
    : scoreboardHud.hasSnapshot ? scoreboardHud.teams : null, [debug, scoreboardHud, teamSelectDebug]);
  const teamSelect = useMemo(() => selectTeamSelect(teamSelectFeature.state, teamSelectTeams), [teamSelectFeature.state, teamSelectTeams]);
  // Drawn while the session is open; the overlay window itself is shown only over the game, so a menu that stays open
  // while the player is in another application is not seen and does not replay its opening fade on return.
  const teamSelectShown = teamSelect !== null;
  teamSelectShownRef.current = teamSelectShown;
  // Shown while its key is held over the game, never under the shop, chat or team menu, never without data (an old
  // plugin keeps its hint board). Right-click in passive mode turns the cursor on until the key goes up.
  const scoreboardMode: ScoreboardMode = !scoreboardHeld || scoreboard === null || (shopOpen && shopAvailable) || chatOpen || teamSelectShown
    ? "hidden" : scoreboardCursor ? "cursor" : "passive";
  scoreboardModeRef.current = scoreboardMode;
  const overlayInteractive = (shopOpen && shopAvailable) || chatOpen || scoreboardMode === "cursor" || (teamSelectShown && overGame);
  const wasChatOpenRef = useRef(false);
  // Diagnostics: every close, including a send and a session change.
  useEffect(() => {
    if (wasChatOpenRef.current && !chatOpen) overlayController.log("chat state closed");
    wasChatOpenRef.current = chatOpen;
  }, [chatOpen, overlayController]);
  // Right-click goes to the scoreboard only while the passive panel is on screen.
  useEffect(() => {
    void overlayController.setScoreboardCapture(scoreboardMode === "passive")
      .catch((error: unknown) => console.error("Unable to switch scoreboard capture", error));
  }, [overlayController, scoreboardMode]);
  useEffect(() => overlayController.subscribeScoreboard({
    held(held) {
      setScoreboardHeld(held);
      if (!held) setScoreboardCursor(false);
    },
    cursor() {
      if (scoreboardModeRef.current === "passive") setScoreboardCursor(true);
    },
  }), [overlayController]);
  // The shop or chat opening over the scoreboard drops cursor mode, so it never comes back holding the mouse. A
  // scoreboard that only lost its data (a waiting state) keeps it while the key stays down.
  const scoreboardCovered = (shopOpen && shopAvailable) || chatOpen || teamSelectShown;
  useEffect(() => {
    if (scoreboardCovered && scoreboardCursor) setScoreboardCursor(false);
  }, [scoreboardCovered, scoreboardCursor]);
  useEffect(() => {
    minimapFeature.setLocalScoreboard(scoreboardMode !== "hidden");
  }, [minimapFeature.setLocalScoreboard, scoreboardMode]);
  const handleScoreboardSort = useCallback((sortStat: ScoreboardStat) => setScoreboardViewState((current) => ({ ...current, sortStat })), []);
  const handleScoreboardPage = useCallback(() => setScoreboardViewState((current) => ({ ...current, page: current.page === 1 ? 2 : 1 })), []);
  const handleScoreboardSide = useCallback(() => setScoreboardViewState((current) => ({ ...current, side: current.side === "current" ? "other" : "current" })), []);
  const sentInteractiveRef = useRef(false);
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve());

  // The buy window closing also closes the shop, so it does not reopen next round.
  useEffect(() => {
    if (shopOpen && !shopAvailable) setShopOpen(false);
  }, [shopAvailable, shopOpen]);

  // The team menu opening (the plugin's M key, or a join without a team) closes the shop and chat, like the
  // plugin's own menu does for the in-game shop and chat area.
  useEffect(() => {
    if (!teamSelectShown) return;
    setShopOpen(false);
    if (chatOpenRef.current) chatFeature.close("unavailable");
  }, [chatFeature.close, teamSelectShown]);

  // The keyboard is taken after the mouse and handed back before it; the queue keeps
  // quick open/close sequences in order.
  useEffect(() => {
    const interactive = overlayInteractive;
    if (sentInteractiveRef.current === interactive) return;
    sentInteractiveRef.current = interactive;
    inputQueueRef.current = inputQueueRef.current.then(async () => {
      if (interactive) {
        await overlayController.setInteractive(true);
        await overlayController.setKeyboardFocus(true);
      } else {
        await overlayController.setKeyboardFocus(false);
        await overlayController.setInteractive(false);
      }
    }).catch((error: unknown) => {
      console.error("Unable to switch overlay input", error);
      // The UI stays open without the foreground: the mouse is the overlay's, so a
      // click focuses it, and the hotkey or Y/U in game closes it (see the shortcut handler).
      overlayController.log(`overlay input switch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [overlayController, overlayInteractive]);
  const handleChatClose = useCallback((reason: ChatCloseReason) => {
    overlayController.log(`chat closed: ${reason}`);
    chatFeature.close(reason);
  }, [chatFeature.close, overlayController]);
  const hud = debugHud ?? liveHud;
  // Equipment comes from the snapshot loadout (viewer team only), for the mock stream too.
  const playerMeta = useMemo(() => topHudPlayerMetaForHud(hud), [hud]);
  const shopRole = HUD_DEBUG_ENABLED && previewShopRole === "scp079"
    ? "scp"
    : hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer")?.role ?? "scp" : "scp";
  const toggleShop = useCallback(() => setShopOpen((current) => !current), []);
  const closeShop = useCallback(() => setShopOpen(false), []);
  const localSteamId = session.identity?.steamId ?? null;
  const hudVariant = pinnedHudVariant ?? hudVariantFor(hud, localSteamId);
  // The MVP avatar comes from the displayed roster (the debug HUD's in the mock build).
  const winPanelRoster = useMemo(() => winPanelRosterFromHud(hud), [hud]);
  const winPanelAt = useCallback((nowMs: number) => selectWinPanel(winPanelState, nowMs, winPanelRoster), [winPanelRoster, winPanelState]);
  const hudSceneStill = debugOptions !== null && debugOptions.hudSceneAt !== null;
  const messageZoneAt = useCallback((nowMs: number) => selectMessageZone(hudMessagesState, nowMs), [hudMessagesState]);
  const killfeedAt = useCallback((nowMs: number) => selectKillfeed(killfeedState, nowMs), [killfeedState]);
  // The mock identity is a team-a player; the debug build reads team-b's loadout from its first player.
  const progressPlayerId = HUD_DEBUG_ENABLED && hud.hasSnapshot
    && !hud.teams.some((team) => team.relation === "viewer" && team.players.some((player) => player.player_id === localSteamId))
    ? hud.teams.find((team) => team.relation === "viewer")?.players[0]?.player_id ?? localSteamId
    : localSteamId;
  const progressViewer = useMemo(() => progressViewerFromHud(hud, progressPlayerId), [hud, progressPlayerId]);
  const progressCard = useMemo(() => selectProgressCard(hudMessagesState, progressViewer), [hudMessagesState, progressViewer]);
  // The bottom HUD is the same local player; a debug scene may override their balance and life (a dead one watches
  // whom the scene's hud.spectating names).
  const scoreboardSnapshot = scoreboardState.frame?.snapshot ?? null;
  const bottomHudBase = useMemo(() => selectBottomHud({
    hud, status: hudStatusState.status, spectating: hudStatusState.spectating, scoreboard: scoreboardSnapshot, localPlayerId: progressPlayerId,
  }), [hud, hudStatusState.spectating, hudStatusState.status, progressPlayerId, scoreboardSnapshot]);
  // The playing debug scene's own balance and life, read on the overlay clock (null outside the debug build).
  const selectSceneSelf = useCallback(() => HUD_DEBUG_ENABLED ? mockConnection?.hudSceneSelf() ?? null : null, [mockConnection]);
  const sceneSelf = useClockSelector(selectSceneSelf, sameSceneSelf);
  const bottomHud = useMemo(() => bottomHudBase === null || bottomHudBase.spectator !== null || sceneSelf === null ? bottomHudBase
    : !sceneSelf.alive ? selectWatchedHud(hud, hudStatusState.spectating, scoreboardSnapshot)
      : sceneSelf.money === null || sceneSelf.money === bottomHudBase.balance ? bottomHudBase : { ...bottomHudBase, balance: sceneSelf.money },
  [bottomHudBase, hud, hudStatusState.spectating, sceneSelf, scoreboardSnapshot]);
  // One slot colour per player across the HUD: radar markers and the shop's teammate-inventory pips.
  const playerColors = useMemo(() => hud.hasSnapshot ? playerSlotColors(hud.teams) : {}, [hud]);
  // The viewer's team colour for the radar frame, as the bottom HUD uses; null for a team-less observer.
  const viewerRole = hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer")?.role ?? null : null;
  const chatSelf = useMemo(() => resolveChatSelf(
    hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer") ?? null : null, localSteamId,
  ), [hud, localSteamId]);
  const handleShopCommand = useCallback((command: ShopCommand) => {
    shopFeature.beginCommand(command);
    void connection.send(command).catch((error: unknown) => {
      console.error("Unable to send shop command", error);
      shopFeature.resolveCommand({ command_id: command.command_id, command_kind: command.kind, status: "failed", reason: error instanceof Error ? error.message : "Send failed" });
    });
  }, [connection, shopFeature.beginCommand, shopFeature.resolveCommand]);
  const handleTeamCommand = useCallback((command: TeamCommand) => {
    teamSelectFeature.beginCommand(command);
    void connection.send(command).catch((error: unknown) => {
      console.error("Unable to send team command", error);
      teamSelectFeature.resolveCommand({ command_id: command.command_id, command_kind: command.kind, status: "failed" });
    });
  }, [connection, teamSelectFeature.beginCommand, teamSelectFeature.resolveCommand]);
  const teamSelectHover = debug && teamSelectDebug ? debug.teamSelectDebugHover(teamSelectDebug) : null;
  const chatScope = chatFeature.state.scope;
  const handleChatSubmit = useCallback((body: string) => {
    // Empty or over-long input keeps the entry open; the counter shows why.
    if (validateChatBody(body)) return;
    const command = createChatCommand(body, chatScope);
    chatFeature.submit(command);
    void connection.send(command).catch((error: unknown) => {
      console.error("Unable to send chat message", error);
      chatFeature.failCommand(command, error instanceof Error ? error.message : "send-failed");
    });
  }, [chatFeature.failCommand, chatFeature.submit, chatScope, connection]);
  const minimapControls = useMemo(() => ({ alternateZoomActive: minimapOptions.alternateZoomActive }), [minimapOptions.alternateZoomActive]);
  return (
    <main id="SlgoOverlayRoot" data-preview-background={previewBackground}>
      {teamSelectShown && teamSelect !== null ? (
        <TeamSelect view={teamSelect} onCommand={handleTeamCommand} initialHover={teamSelectHover}
          still={teamSelectDebug !== null && !teamSelectDebug.fade} />
      ) : <>
        <HudTeamCounter
          hud={hud}
          clockAt={hudClockAt}
          playerMeta={playerMeta}
          variant={hudVariant}
        />
        <WinPanel panelAt={winPanelAt} still={hudSceneStill} />
        <BottomHud view={bottomHud} still={hudSceneStill} />
        <ProgressCard card={progressCard} still={hudSceneStill} />
        <MessageZone zoneAt={messageZoneAt} still={hudSceneStill} role={viewerRole} />
        <KillFeed noticesAt={killfeedAt} still={hudSceneStill} />
        {scoreboard !== null && scoreboardMode !== "hidden" ? <Scoreboard view={scoreboard} elapsedAt={scoreboardElapsedAt} mode={scoreboardMode}
          onSort={handleScoreboardSort} onCyclePage={handleScoreboardPage} onToggleSide={handleScoreboardSide} /> : null}
        <LiveMinimapRadar store={minimapFeature.store} preferences={minimapOptions}
          controls={minimapControls}
          playerColors={playerColors} role={viewerRole} />
        <ShopPanel
          shop={displayedShop}
          role={shopRole}
          playerColors={playerColors}
          localPlayerId={progressPlayerId}
          open={shopOpen}
          volume={shopVolume}
          countdownAt={shopCountdownAt}
          onCommand={handleShopCommand}
          onClose={closeShop}
        />
        <ChatInput
          chat={chatFeature.state}
          self={chatSelf}
          onDraft={chatFeature.setDraft}
          onToggleScope={chatFeature.toggleScope}
          onSubmit={handleChatSubmit}
          onClose={handleChatClose}
          onDiagnostic={overlayController.log}
        />
      </>}
      {showShopDebugPanel && debug && shopDebugOptions ? <debug.ShopDebugPanel options={shopDebugOptions} shopVisible={shopOpen} onChange={setShopDebugOptions} onToggleShop={toggleShop} /> : null}
      {showHudDebugPanel && debug && debugOptions ? (
        <debug.HudDebugPanel options={debugOptions} onChange={setDebugOptions} />
      ) : null}
    </main>
  );
}

export default App;
