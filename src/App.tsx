import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_HUD_KILLFEED, CLIENT_FEATURE_HUD_KILLFEED_MODIFIERS, CLIENT_FEATURE_HUD_MESSAGES, CLIENT_FEATURE_HUD_MONEY, CLIENT_FEATURE_HUD_SPECTATING, CLIENT_FEATURE_HUD_STATUS, CLIENT_FEATURE_REPLAY, CLIENT_FEATURE_SCOREBOARD, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TEAM_SELECT, CLIENT_FEATURE_TOP_HUD, CLIENT_FEATURE_WIN_PANEL, type ConnectionStatus, type MinimapDiagnostic, type ReplayCommand, type ShopCommand, type SlgoEvent, type TeamCommand } from "./contracts";
import { HudTeamCounter } from "./features/hud/HudTeamCounter";
import { HUD_EVENT_TYPES, initialRoundHudState, roundHudReducer, sameRoundHudTime, selectRoundHud, selectRoundHudClock } from "./features/hud/model";
import { ShopPanel } from "./features/shop/ShopPanel";
import { SHOP_COMMAND_TIMEOUT_MS, sameShopTime, selectShop, shopCommandTarget, type ShopViewModel } from "./features/shop/model";
import { shopKeyInputs, type ShopCloseReason, type ShopPanelCloseReason } from "./features/shop/diagnostics";
import { useShopFeature } from "./features/shop/useShopFeature";
import { ChatInput } from "./features/chat/ChatInput";
import { createChatCommand, validateChatBody, type ChatCloseReason } from "./features/chat/model";
import { resolveChatSelf } from "./features/chat/presentation";
import { hudVariantFor, playerObserverNumbers, playerSlotColors, topHudPlayerMetaForHud, type HudPresentationVariant } from "./features/hud/presentation";
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
import { REPLAY_TOO_FAST_TEXT, replayLineAgeMs, selectReplayMode } from "./features/replay/model";
import { useReplayFeature } from "./features/replay/useReplayFeature";
import { useReplayHighlights } from "./features/replay/useReplayHighlights";
import { catalogQuery, replayCatalog, replayCommandLabel, replayLoad, replayPin, replayUnpin } from "./features/replay/commands";
import type { ReplayCatalogFilters } from "./features/replay/model";
import { ReplayController, ReplayHighlightFade } from "./features/replay/ReplayController";
import { ReplayCatalogPanel } from "./features/replay/ReplayCatalogPanel";
import { HudTimeContext, wallDelayUntil } from "./shared/hudTime";
import { createOverlayWindowController, type SlgoConnection } from "./platform";
import type * as DebugHarnessModule from "./mocks/harness";
import type { HudDebugOptions } from "./mocks/hudDebug";
import type { ShopDebugOptions } from "./mocks/shopDebug";
import type { TeamSelectDebugOptions } from "./mocks/teamSelectDebug";
import { HttpControlPlane, MockControlPlane } from "./platform/route";
import { WebSocketSidecarConnection } from "./platform/connection";
import { createTauriSidecarSocket } from "./platform/sidecarSocket";
import { createGameLogProofReader, tauriGameLogSource } from "./platform/gameLog";
import { readBackendConfig } from "./platform/backend";
import { createIdentityProofProvider, LocalSteamIdentity } from "./platform/identity";
import { useClientSession } from "./app/useClientSession";
import { useGameRunning } from "./app/useGameRunning";
import { LiveMinimapRadar } from "./features/minimap/MinimapRadar";
import { useMinimapFeature } from "./features/minimap/useMinimapFeature";
import type { MinimapPreviewOptions } from "./mocks/minimapFixtures";
import { createPreviewGameForegroundSource, foregroundLoss, subscribeGameForeground, type GameForegroundState } from "./platform/gameForeground";
import { DEFAULT_AUDIO_SETTINGS } from "./platform/audioSettings";
import { DEFAULT_OVERLAY_SETTINGS, shouldAutoEnableOverlay } from "./platform/overlaySettings";
import { createSettingsStore, type AppSettings } from "./platform/settings";
import { DEFAULT_HOTKEYS } from "./platform/hotkeys";
import { useWorldBlur } from "./platform/backdrop";
import { useClockSelector } from "./shared/clock";
import type { HudSceneSelf } from "./mocks/hudScenes";
import { DEFAULT_RADAR_PREFERENCES, type RadarPreferences } from "./features/minimap/preferences";
import { createOverlayStateSource, createSessionStatusPublisher, isTauri, tauriInvoke, type OverlayState, type SessionStatusSnapshot } from "./platform/desktop";
import { createUpdateSource } from "./platform/updater";
import { requiredUpdate } from "./app/updateModel";
import { claimedFeatures, nextConditionHint, startConditionHint, withConditionHint, type ConditionHint, type GameConditionKey } from "./app/gameConditionsModel";
import { inputBlockedBy, NO_GAME_CONDITIONS, subscribeGameConditions, type GameConditions } from "./platform/gameConditions";
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
  CLIENT_FEATURE_HUD_KILLFEED_MODIFIERS,
  CLIENT_FEATURE_SCOREBOARD,
  CLIENT_FEATURE_TEAM_SELECT,
  // Demo replay (replay servers only): replay.state / replay.catalog, the replay commands and the omniscient HUD.
  // Not an input feature, so it stays declared while input is blocked (the HUD and the passive bar still work).
  CLIENT_FEATURE_REPLAY,
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
    /** Mock builds only: send replay commands and read the replay state without the console UI. */
    __SLUI_REPLAY_DEBUG__?: {
      send(command: ReplayCommand, seekMs?: number | null): void;
      state(): unknown;
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
  // ?replay=playing|paused|idle|loading|error: the mock stream is a demo replay server's, shown as it arrives (the HUD
  // and shop debug scenes, which pin the HUD to their own fixtures, stay off).
  const [replayMockScenario] = useState(() => MOCK_BACKEND ? harness?.readReplayMockScenario() ?? null : null);
  const debug = HUD_DEBUG_ENABLED ? harness : null;
  const [debugOptions, setDebugOptions] = useState<HudDebugOptions | null>(() => replayMockScenario ? null : debug?.readHudDebugOptions() ?? null);
  const [shopDebugOptions, setShopDebugOptions] = useState<ShopDebugOptions | null>(() => SHOP_DEBUG_ENABLED && !replayMockScenario ? debug?.readShopDebugOptions() ?? null : null);
  const [minimapOptions, setMinimapOptions] = useState<OverlayMinimapOptions>(() => debug?.readMinimapPreviewOptions() ?? DEFAULT_MINIMAP_OPTIONS);
  // ?teamSelect=ntf|scp|forced: the mock plugin opens a menu and the panel lists the captures' rosters.
  const [teamSelectDebug] = useState<TeamSelectDebugOptions | null>(() => debug?.readTeamSelectDebugOptions() ?? null);
  const previewParams = new URLSearchParams(window.location.search);
  const showPreviewBackground = HUD_DEBUG_ENABLED && previewParams.get("background") !== "0";
  const showHudDebugPanel = HUD_DEBUG_ENABLED && previewParams.get("hudDebug") !== "0";
  // Both debug panels are suppressible from the URL so the shop can be captured
  // as it will ship when comparing against the baseline screenshot.
  const showShopDebugPanel = SHOP_DEBUG_ENABLED && previewParams.get("shopDebug") !== "0";
  // Replay previews keep the screenshot background (the HUD debug scene that normally picks it is off there).
  const replayPreviewBackground = replayMockScenario ? previewParams.get("previewBackground") ?? "1" : undefined;
  const previewBackground = showPreviewBackground ? debugOptions?.background ?? replayPreviewBackground : undefined;
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
  const mockConnection = useMemo(() => MOCK_BACKEND && harness ? harness.createMockProvider(previewViewerTeam, previewShopRole, replayMockScenario) : null,
    [harness, previewShopRole, previewViewerTeam, replayMockScenario]);
  const connection = useMemo<SlgoConnection>(() => mockConnection ?? new WebSocketSidecarConnection({
    // Tauri connects from Rust so the TLS handshake carries no SNI; browser previews keep WebSocket.
    createSocket: isTauri() ? createTauriSidecarSocket : undefined,
    endpointOverride: BACKEND.kind === "real" ? BACKEND.sidecarEndpointOverride : null,
    // Only the desktop app can read the game's Player.log for the game-log proof.
    gameLogProof: isTauri() ? createGameLogProofReader(tauriGameLogSource(tauriInvoke)) : null,
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
  const replayFeature = useReplayFeature();
  const previewFocus = useMemo(() => HUD_DEBUG_ENABLED ? createPreviewGameForegroundSource(true) : null, []);
  // The player opens the shop with its hotkey; window_open alone never opens it.
  // Only the debug build honours ?shopOpen=1.
  const [shopOpen, setShopOpen] = useState(() => shopDebugOptions?.open ?? false);
  const [shopVolume, setShopVolume] = useState(DEFAULT_AUDIO_SETTINGS.shopVolume);
  const [overlaySettings, setOverlaySettings] = useState(DEFAULT_OVERLAY_SETTINGS);
  const [chatKeys, setChatKeys] = useState<readonly string[]>(() => [DEFAULT_HOTKEYS.chatGlobal, DEFAULT_HOTKEYS.chatTeam]);
  const shopAvailableRef = useRef(false);
  const connectionLiveRef = useRef(false);
  // The demo replay bar (design 11-07-demo-replay-slui §12, CS2 DemoToggleUI): its key cycles minimal -> full -> hidden
  // on a replay server only. The full bar (the console) takes the mouse and keyboard like the shop.
  const [replayConsoleOpen, setReplayConsoleOpen] = useState(false);
  const replayConsoleOpenRef = useRef(false);
  const [replayBarHidden, setReplayBarHidden] = useState(false);
  const replayBarHiddenRef = useRef(false);
  const [replayCatalogOpen, setReplayCatalogOpen] = useState(false);
  const replayModeRef = useRef(false);
  const replayHeldForegroundRef = useRef(false);
  const chatOpenRef = useRef(false);
  const shopOpenRef = useRef(false);
  const shopVisibleRef = useRef(false);
  // Diagnostics (desktop log): the inputs of a shop key decision, read at the press, and the last logged values.
  const shopViewRef = useRef<ShopViewModel | null>(null);
  const sessionStatusRef = useRef<ConnectionStatus>("signed-out");
  const loggedStatusRef = useRef<ConnectionStatus | null>(null);
  const loggedDetailRef = useRef<string | null>(null);
  // Diagnostics: shop commands sent and not answered yet (label, local send time, whether "no result" was logged).
  const shopCommandLogRef = useRef(new Map<string, { label: string; sentAtMs: number; overdue: boolean }>());
  const loggedShopAvailableRef = useRef<boolean | null>(null);
  const teamSelectShownRef = useRef(false);
  // Whether the overlay is over the game: the game or the overlay itself holds the foreground (native, one sample).
  // A menu the plugin opened takes the input only then, so it never takes the foreground from another application,
  // and taking it from the game keeps it (the game alone loses the foreground at that moment).
  const [overGame, setOverGame] = useState(false);
  // The native foreground sample itself: the shop and chat close when the overlay stops holding it.
  const [foreground, setForeground] = useState<Pick<GameForegroundState, "focused" | "overGame">>({ focused: false, overGame: false });
  const shopHeldForegroundRef = useRef(false);
  const chatHeldForegroundRef = useRef(false);
  // An elevated game (SLUI not elevated) or exclusive fullscreen: SLUI cannot take input over the game, so the shop,
  // chat and team menu go back to the plugin's in-game UI and no panel takes the foreground (native detection).
  const [gameConditions, setGameConditions] = useState<GameConditions>(NO_GAME_CONDITIONS);
  const inputBlocked = inputBlockedBy(gameConditions);
  const inputBlockedRef = useRef(inputBlocked);
  inputBlockedRef.current = inputBlocked;
  useEffect(() => subscribeGameConditions(setGameConditions), []);
  const overlayController = useMemo(() => createOverlayWindowController(), []);
  useWorldBlur(overlaySettings.worldBlur, overlaySettings.worldBlurStrength);
  // Every close of an open shop goes through here, so the log names its reason. The ref follows at once, so a second
  // close before the next render logs nothing.
  const closeShopFor = useCallback((reason: ShopCloseReason, detail?: string) => {
    if (!shopOpenRef.current) return;
    shopOpenRef.current = false;
    overlayController.log(`shop closed: ${reason}${detail ? ` (${detail})` : ""}`);
    setShopOpen(false);
  }, [overlayController]);
  // Every close of the replay console goes through here, so the log names its reason (idempotent, like the shop's).
  const closeReplayConsole = useCallback((reason: string) => {
    if (!replayConsoleOpenRef.current) return;
    replayConsoleOpenRef.current = false;
    overlayController.log(`replay console closed: ${reason}`);
    setReplayConsoleOpen(false);
  }, [overlayController]);

  const handleEvent = useCallback((event: SlgoEvent) => {
    const wallMs = Date.now();
    // The replay feature sees every event first: a replay.state re-anchors the HUD clock before the snapshots the
    // plugin sends right after it, and says whether the recording changed (stale HUD) or the position jumped (chat).
    // HUD frames are stamped with HUD time: the wall clock on a match server, recording time on a replay server.
    const intake = replayFeature.intake(event, wallMs);
    const receivedAtMs = intake.hudMs;
    if (intake.hudReset) {
      overlayController.log("replay: recording changed, previous HUD dropped");
      dispatchHud({ type: "replay-reset" });
      dispatchWinPanel({ type: "replay-reset" });
      dispatchKillfeed({ type: "replay-reset" });
      dispatchScoreboard({ type: "replay-reset" });
    }
    if (intake.jump) chatFeature.clearLines();
    if (intake.result) {
      const { label, status, reason, afterMs } = intake.result;
      overlayController.log(`replay command ${label}: ${status}${reason ? ` (${reason})` : ""} after ${afterMs}ms`);
    }
    // Each reducer gets only the events it reads: useReducer has no eager bailout, so any dispatch
    // re-runs App, and minimap positions (the radar's own store) arrive at 15 Hz.
    const type = event.type;
    if (HUD_EVENT_TYPES.has(type)) dispatchHud({ type: "event", event, receivedAtMs });
    if (WIN_PANEL_EVENT_TYPES.has(type)) dispatchWinPanel({ type: "event", event, receivedAtMs });
    if (HUD_MESSAGES_EVENT_TYPES.has(type)) dispatchHudMessages({ type: "event", event, receivedAtMs });
    if (HUD_STATUS_EVENT_TYPES.has(type)) dispatchHudStatus({ type: "event", event });
    if (KILLFEED_EVENT_TYPES.has(type)) dispatchKillfeed({ type: "event", event, receivedAtMs });
    if (SCOREBOARD_EVENT_TYPES.has(type)) dispatchScoreboard({ type: "event", event, receivedAtMs });
    if (event.type === "command.result") {
      const sent = shopCommandLogRef.current.get(event.payload.command_id);
      if (sent) {
        shopCommandLogRef.current.delete(event.payload.command_id);
        const { status, reason } = event.payload;
        overlayController.log(`shop command ${sent.label}: ${status}${reason ? ` (${reason})` : ""} after ${wallMs - sent.sentAtMs}ms`);
      }
    }
    shopFeature.receiveEvent(event);
    teamSelectFeature.receiveEvent(event, wallMs);
    // A replayed chat line starts its fade as long ago (recording time) as it was said before the publish.
    chatFeature.receiveEvent(event, intake.replay ? receivedAtMs - replayLineAgeMs(event) : receivedAtMs);
    minimapFeature.receiveEvent(event);
  }, [overlayController, replayFeature.intake, shopFeature.receiveEvent, teamSelectFeature.receiveEvent, chatFeature.receiveEvent, chatFeature.clearLines,
    minimapFeature.receiveEvent]);
  const handleDiagnostic = useCallback((diagnostic: MinimapDiagnostic) => {
    minimapFeature.receiveDiagnostic(diagnostic);
  }, [minimapFeature.receiveDiagnostic]);
  const handleStatus = useCallback((status: ConnectionStatus) => {
    if (status !== loggedStatusRef.current) overlayController.log(`session ${status}`);
    loggedStatusRef.current = status;
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
    replayFeature.setConnectionStatus(status);
  }, [overlayController, shopFeature.setConnectionStatus, teamSelectFeature.setConnectionStatus, chatFeature.setConnectionStatus, minimapFeature.setConnectionStatus,
    replayFeature.setConnectionStatus]);
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
  sessionStatusRef.current = session.status;
  // Diagnostics: why the session left `live` (the sidecar's close reason, a rejected stream, a route error).
  useEffect(() => {
    if (session.detail === loggedDetailRef.current) return;
    loggedDetailRef.current = session.detail;
    if (session.detail) overlayController.log(`session detail: ${session.detail}`);
  }, [overlayController, session.detail]);
  // Rust shows an enabled overlay only while the session is live: without the sidecar nothing on it is current. No
  // panel takes input meanwhile (shop, chat, team menu and scoreboard all need a live session), so a hidden overlay
  // never holds the foreground or the right button.
  const sessionLive = session.status === "live";
  useEffect(() => {
    void overlayController.setSessionLive(sessionLive)
      .catch((error: unknown) => console.error("Unable to report the session to the overlay window", error));
  }, [overlayController, sessionLive]);
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
    let loggedHotkeys = "";
    const apply = (settings: AppSettings) => {
      if (!active) return;
      setShopVolume(settings.audio.shopVolume);
      setOverlaySettings(settings.overlay);
      const { shop, scoreboard, chatGlobal, chatTeam, replay } = settings.hotkeys;
      const hotkeys = `shop ${shop}, scoreboard ${scoreboard}, global chat ${chatGlobal}, team chat ${chatTeam}, replay ${replay}`;
      setChatKeys((current) => current[0] === chatGlobal && current[1] === chatTeam ? current : [chatGlobal, chatTeam]);
      void overlayController.setHotkeys(settings.hotkeys)
        .then(() => {
          if (hotkeys !== loggedHotkeys) overlayController.log(`hotkeys ${hotkeys}`);
          loggedHotkeys = hotkeys;
        })
        .catch((error: unknown) => {
          console.error("Unable to apply hotkeys", error);
          overlayController.log(`hotkeys ${hotkeys} not applied: ${error instanceof Error ? error.message : String(error)}`);
        });
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
    closeShopFor("overlay-disabled");
    closeReplayConsole("overlay disabled");
    chatFeature.close("unavailable");
    teamSelectFeature.release();
    setMinimapOptions((current) => current.alternateZoomActive ? { ...current, alternateZoomActive: false } : current);
  }), [overlayState, closeShopFor, closeReplayConsole, chatFeature.close, teamSelectFeature.release]);

  const [overlayEnabled, setOverlayEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = overlayState.subscribe((state: OverlayState) => {
      changed = true;
      setOverlayEnabled(state.enabled);
    });
    void overlayState.get().then((state) => {
      if (active && !changed) setOverlayEnabled(state.enabled);
    }).catch((error: unknown) => console.error("Unable to read overlay state", error));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [overlayState]);

  // While the overlay is enabled it owns the chat and shop keys (Y/U and B by default), so the plugin ignores its own chat-area
  // toggle and no longer opens its in-game shop for this player. A disabled overlay keeps
  // the session live, so it must say so. While input is blocked the overlay hands chat, the
  // shop and the team menu back: the plugin redraws its own on the presence change.
  const clientFeatures = useMemo(() => claimedFeatures(OVERLAY_CLIENT_FEATURES, overlayEnabled, inputBlocked), [inputBlocked, overlayEnabled]);
  const loggedFeaturesRef = useRef<string | null>(null);
  useEffect(() => {
    connection.setFeatures(clientFeatures);
    const logged = clientFeatures.length > 0 ? clientFeatures.join(", ") : "none";
    if (logged !== loggedFeaturesRef.current) {
      const handedBack = overlayEnabled && inputBlocked ? " (input blocked: chat, shop and team menu handed back to the game)" : "";
      overlayController.log(`client features: ${logged}${handedBack}`);
    }
    loggedFeaturesRef.current = logged;
  }, [clientFeatures, connection, inputBlocked, overlayController, overlayEnabled]);

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
      setForeground({ focused: state.focused, overGame: state.overGame });
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
  // the buy window, so typing elsewhere never takes the mouse. The chat keys open chat over the
  // focused game while the session is live, and close the shop. While chat has the
  // keyboard every hooked key is ordinary typing. The hook reports the foreground at
  // the key press itself; the browser preview (null) only sees keys while its tab is
  // focused, so it skips the game check. An open shop holds the foreground in the
  // game's place, so a key pressed while it has focus counts as over the game.
  // Keys pressed into the focused overlay can arrive twice, from the page and from
  // the hook, so both paths must be idempotent: the shop key only opens the shop when
  // the game itself had the foreground, and a second close or chat open is a no-op.
  useEffect(() => overlayController.subscribeShortcut((shortcut, gameForeground) => {
    // Handed back to the game: the plugin's own shop key and chat area take these keys.
    if (inputBlockedRef.current) {
      overlayController.log(`${shortcut} ignored: input blocked (the game's own UI handles it)`);
      return;
    }
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
    // The replay bar key: only on a replay server (R18); cycles minimal -> full (over the focused game) -> hidden ->
    // minimal like CS2's Shift+F2. A press while a text field has the focus is typing (the hook cannot tell).
    if (shortcut === "replay") {
      if (!replayModeRef.current) {
        overlayController.log("replay key ignored: not on a replay server");
        return;
      }
      if (replayConsoleOpenRef.current) {
        const typing = document.activeElement instanceof HTMLElement && document.activeElement.closest("input, textarea, select, [contenteditable]") !== null;
        if (typing) return;
        closeReplayConsole("replay key");
        overlayController.log("replay bar hidden");
        replayBarHiddenRef.current = true;
        setReplayBarHidden(true);
        return;
      }
      if (replayBarHiddenRef.current) {
        overlayController.log("replay bar minimal");
        replayBarHiddenRef.current = false;
        setReplayBarHidden(false);
        return;
      }
      if (!(gameForeground ?? true) || !connectionLiveRef.current) {
        overlayController.log(`replay key ignored: game foreground ${gameForeground}, session live ${connectionLiveRef.current}`);
        return;
      }
      closeShopFor("replay-key");
      overlayController.log("replay console opened");
      replayConsoleOpenRef.current = true;
      setReplayConsoleOpen(true);
      return;
    }
    // Replay servers replay the recorded chat and refuse chat.send: the chat keys open nothing there.
    if (replayModeRef.current && shortcut !== "shop") {
      overlayController.log(`${shortcut} ignored: chat is read-only on a replay server`);
      return;
    }
    const gameFocused = (gameForeground ?? true) || (shopVisibleRef.current && document.hasFocus());
    if (shortcut === "shop") {
      if (shopOpenRef.current) {
        closeShopFor("shop-key");
        return;
      }
      const opens = (gameForeground ?? true) && shopAvailableRef.current;
      const view = shopViewRef.current;
      const inputs = view ? shopKeyInputs(sessionStatusRef.current, view, Date.now()) : `session ${sessionStatusRef.current}, no shop view`;
      overlayController.log(opens ? `shop key: open (${inputs})` : `shop key: not opened (game foreground ${gameForeground}, ${inputs})`);
      if (!opens) return;
      shopOpenRef.current = true;
      setShopOpen(true);
      return;
    }
    if (!gameFocused || !connectionLiveRef.current) {
      overlayController.log(`${shortcut} ignored: game foreground ${gameFocused}, session live ${connectionLiveRef.current}`);
      return;
    }
    closeShopFor("chat-key");
    chatFeature.open(shortcut === "chat-team" ? "team" : "global");
  }), [overlayController, closeShopFor, closeReplayConsole, chatFeature.close, chatFeature.open]);

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
  // HUD state is stamped with HUD time (recording time on a replay server), so every HUD selector reads it too.
  const hudTimeAtWall = replayFeature.hudTimeAtWall;
  const hudTime = replayFeature.hudTime;
  const selectLiveHud = useCallback((nowMs: number) => selectRoundHud(hudState, hudTimeAtWall(nowMs), session.endReason),
    [hudState, hudTimeAtWall, session.endReason]);
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
    : selectRoundHudClock(hudState, hudTimeAtWall(nowMs)), [debugHudFrame, hudState, hudTimeAtWall]);
  const shopCountdownAt = useCallback((nowMs: number) => hudClockAt(nowMs)?.phaseClockSeconds ?? null, [hudClockAt]);
  const displayedShop = debugShop ?? shop;
  const shopAvailable = sessionLive && displayedShop.hasSnapshot && displayedShop.windowOpen;
  shopAvailableRef.current = shopAvailable;
  shopOpenRef.current = shopOpen;
  shopViewRef.current = displayedShop;
  // Diagnostics: the shop key opens the shop exactly while it is available; each change is logged with its inputs.
  useEffect(() => {
    if (loggedShopAvailableRef.current === shopAvailable) return;
    loggedShopAvailableRef.current = shopAvailable;
    overlayController.log(`shop ${shopAvailable ? "available" : "unavailable"} (${shopKeyInputs(session.status, displayedShop, Date.now())})`);
  }, [displayedShop, overlayController, session.status, shopAvailable]);
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
  const scoreboardElapsedAt = useCallback((nowMs: number) => scoreboardFrame ? scoreboardElapsedText(scoreboardFrame, hudTimeAtWall(nowMs)) : "",
    [hudTimeAtWall, scoreboardFrame]);
  // The plugin's team menu session over the match rosters (the debug scene lists the captures' rosters instead). It is
  // modal, as in CS2: while it is on screen the other panels are not drawn and the shop, chat and scoreboard stay shut.
  const teamSelectTeams = useMemo(() => debug && teamSelectDebug ? debug.teamSelectDebugTeams(teamSelectDebug)
    : scoreboardHud.hasSnapshot ? scoreboardHud.teams : null, [debug, scoreboardHud, teamSelectDebug]);
  const teamSelect = useMemo(() => selectTeamSelect(teamSelectFeature.state, teamSelectTeams), [teamSelectFeature.state, teamSelectTeams]);
  // Drawn while the session is open; the overlay window itself is shown only over the game, so a menu that stays open
  // while the player is in another application is not seen and does not replay its opening fade on return. Never while
  // input is blocked: the plugin draws its own menu then.
  const teamSelectShown = teamSelect !== null && !inputBlocked;
  teamSelectShownRef.current = teamSelectShown;
  // Shown while its key is held over the game, never under the shop, chat or team menu, never without data (an old
  // plugin keeps its hint board). Right-click in passive mode turns the cursor on until the key goes up; while input is
  // blocked it stays passive and the right button stays the game's.
  const scoreboardMode: ScoreboardMode = !sessionLive || !scoreboardHeld || scoreboard === null || (shopOpen && shopAvailable) || chatOpen
    || teamSelectShown ? "hidden" : scoreboardCursor && !inputBlocked ? "cursor" : "passive";
  scoreboardModeRef.current = scoreboardMode;
  // No panel takes the foreground while input is blocked, even one left open for a moment: an exclusive-fullscreen game
  // minimizes as soon as it loses it.
  // Replay mode (R18's one switch): this connection received a replay.state. Nothing replay-specific exists without it.
  const replayMode = selectReplayMode(replayFeature.state);
  replayModeRef.current = replayMode;
  const replayConsoleShown = replayMode && replayConsoleOpen && sessionLive && !inputBlocked;
  // What the bar shows (null: none, the match-server overlay); the root's data-replay-bar lifts the bottom HUD.
  const replayBarMode = !replayMode || !sessionLive || replayBarHidden ? null : replayConsoleShown ? "full" as const : "minimal" as const;
  const overlayInteractive = sessionLive && !inputBlocked
    && ((shopOpen && shopAvailable) || chatOpen || scoreboardMode === "cursor" || (teamSelectShown && overGame) || replayConsoleShown);
  const wasChatOpenRef = useRef(false);
  // Diagnostics: every close, including a send and a session change.
  useEffect(() => {
    if (wasChatOpenRef.current && !chatOpen) overlayController.log("chat state closed");
    wasChatOpenRef.current = chatOpen;
  }, [chatOpen, overlayController]);
  // Right-click goes to the scoreboard only while the passive panel is on screen.
  useEffect(() => {
    void overlayController.setScoreboardCapture(scoreboardMode === "passive" && !inputBlocked)
      .catch((error: unknown) => console.error("Unable to switch scoreboard capture", error));
  }, [inputBlocked, overlayController, scoreboardMode]);
  useEffect(() => overlayController.subscribeScoreboard({
    held(held) {
      setScoreboardHeld(held);
      if (!held) setScoreboardCursor(false);
    },
    cursor() {
      if (scoreboardModeRef.current === "passive" && !inputBlockedRef.current) setScoreboardCursor(true);
    },
  }), [overlayController]);
  // The shop or chat opening over the scoreboard, or the session dropping, ends cursor mode, so it never comes back
  // holding the mouse. A scoreboard that only lost its data (a waiting state) keeps it while the key stays down. Input
  // being blocked ends it too.
  const scoreboardCovered = !sessionLive || (shopOpen && shopAvailable) || chatOpen || teamSelectShown || inputBlocked;
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
    if (shopOpen && !shopAvailable) closeShopFor("unavailable", shopKeyInputs(session.status, displayedShop, Date.now()));
  }, [closeShopFor, displayedShop, session.status, shopAvailable, shopOpen]);

  // The team menu opening (the plugin's M key, or a join without a team) closes the shop and chat, like the
  // plugin's own menu does for the in-game shop and chat area.
  useEffect(() => {
    if (!teamSelectShown) return;
    closeShopFor("team-select");
    if (chatOpenRef.current) chatFeature.close("unavailable");
  }, [chatFeature.close, closeShopFor, teamSelectShown]);

  // The keyboard is taken after the mouse and handed back before it; the queue keeps
  // quick open/close sequences in order.
  useEffect(() => {
    const interactive = overlayInteractive;
    if (sentInteractiveRef.current === interactive) return;
    sentInteractiveRef.current = interactive;
    inputQueueRef.current = inputQueueRef.current.then(async () => {
      const startedAt = performance.now();
      if (interactive) {
        await overlayController.setInteractive(true);
        await overlayController.setKeyboardFocus(true);
      } else {
        await overlayController.setKeyboardFocus(false);
        await overlayController.setInteractive(false);
      }
      // Diagnostics: the switch's outcome next to the panels' window focus and blur lines.
      overlayController.log(`overlay input ${interactive ? "on" : "off"} in ${Math.round(performance.now() - startedAt)}ms (page focused: ${document.hasFocus()})`);
    }).catch((error: unknown) => {
      console.error("Unable to switch overlay input", error);
      // The UI stays open without the foreground: the mouse is the overlay's, so a
      // click focuses it, and the hotkey or a chat key in game closes it (see the shortcut handler).
      overlayController.log(`overlay input switch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [overlayController, overlayInteractive]);
  const handleChatClose = useCallback((reason: ChatCloseReason, detail?: string) => {
    overlayController.log(`chat closed: ${reason}${detail ? ` (${detail})` : ""}`);
    chatFeature.close(reason);
  }, [chatFeature.close, overlayController]);
  // Input being blocked closes every panel that takes the foreground; the plugin's own UI takes over (see the features).
  useEffect(() => {
    if (!inputBlocked) return;
    closeShopFor("input-blocked");
    if (chatOpenRef.current) handleChatClose("unavailable", "input blocked");
    teamSelectFeature.release();
  }, [closeShopFor, handleChatClose, inputBlocked, teamSelectFeature.release]);
  // The replay console closes with replay mode, the session or input (blocked: RA `demo` remains for admins).
  useEffect(() => {
    if (!replayConsoleOpen) return;
    if (!replayMode) closeReplayConsole("left replay mode");
    else if (!sessionLive) closeReplayConsole("session not live");
    else if (inputBlocked) closeReplayConsole("input blocked");
  }, [closeReplayConsole, inputBlocked, replayConsoleOpen, replayMode, sessionLive]);
  // Entering replay mode closes an open chat: replay servers take no chat input. Leaving it forgets the hidden bar.
  useEffect(() => {
    if (replayMode && chatOpenRef.current) handleChatClose("unavailable", "replay server");
    if (!replayMode && replayBarHiddenRef.current) {
      replayBarHiddenRef.current = false;
      setReplayBarHidden(false);
    }
  }, [handleChatClose, replayMode]);
  // The catalog lives in the console: it closes with it, and opens with it while nothing is loaded.
  useEffect(() => {
    if (!replayConsoleShown && replayCatalogOpen) setReplayCatalogOpen(false);
  }, [replayCatalogOpen, replayConsoleShown]);
  const replayIdle = replayMode && replayFeature.state.current?.state.demo === null;
  useEffect(() => {
    if (replayConsoleShown && replayIdle) setReplayCatalogOpen(true);
  }, [replayConsoleShown, replayIdle]);
  // A team.menu that arrived before the plugin saw the smaller feature list is dropped too, so reclaiming the feature
  // never shows a stale session: the plugin sends the current one when `team-select` is declared again.
  const teamMenuHeld = teamSelectFeature.state.menu !== null;
  useEffect(() => {
    if (inputBlocked && teamMenuHeld) teamSelectFeature.release();
  }, [inputBlocked, teamMenuHeld, teamSelectFeature.release]);
  // The shop and chat hold the foreground and close once it leaves the overlay (Alt+Tab, another window, the game
  // taking it back): the game locks its cursor again. Read from the native foreground, never the page's blur: another
  // application's overlay showing its own window (NVIDIA's Alt+R statistics) bounces focus inside the overlay window
  // while the overlay keeps the foreground. Until the overlay first holds it, the switch is under way (or was refused).
  useEffect(() => {
    if (!shopOpen) {
      shopHeldForegroundRef.current = false;
      return;
    }
    const { held, lost, toGame } = foregroundLoss(shopHeldForegroundRef.current, foreground);
    shopHeldForegroundRef.current = held;
    if (lost) closeShopFor("foreground", toGame ? "game" : "another window");
  }, [closeShopFor, foreground, shopOpen]);
  useEffect(() => {
    if (!replayConsoleOpen) {
      replayHeldForegroundRef.current = false;
      return;
    }
    const { held, lost, toGame } = foregroundLoss(replayHeldForegroundRef.current, foreground);
    replayHeldForegroundRef.current = held;
    if (lost) closeReplayConsole(`foreground (${toGame ? "game" : "another window"})`);
  }, [closeReplayConsole, foreground, replayConsoleOpen]);
  useEffect(() => {
    if (!chatOpen) {
      chatHeldForegroundRef.current = false;
      return;
    }
    const { held, lost, toGame } = foregroundLoss(chatHeldForegroundRef.current, foreground);
    chatHeldForegroundRef.current = held;
    if (lost) handleChatClose("foreground", toGame ? "game" : "another window");
  }, [chatOpen, foreground, handleChatClose]);
  const hud = debugHud ?? liveHud;
  // Equipment comes from the snapshot loadout (viewer team only), for the mock stream too.
  const playerMeta = useMemo(() => topHudPlayerMetaForHud(hud), [hud]);
  const shopRole = HUD_DEBUG_ENABLED && previewShopRole === "scp079"
    ? "scp"
    : hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer")?.role ?? "scp" : "scp";
  const toggleShop = useCallback(() => setShopOpen((current) => !current), []);
  const closeShop = useCallback((reason: ShopPanelCloseReason) => closeShopFor(reason), [closeShopFor]);
  const localSteamId = session.identity?.steamId ?? null;
  const hudVariant = pinnedHudVariant ?? hudVariantFor(hud, localSteamId);
  // The MVP avatar comes from the displayed roster (the debug HUD's in the mock build).
  const winPanelRoster = useMemo(() => winPanelRosterFromHud(hud), [hud]);
  const winPanelAt = useCallback((nowMs: number) => selectWinPanel(winPanelState, hudTimeAtWall(nowMs), winPanelRoster),
    [hudTimeAtWall, winPanelRoster, winPanelState]);
  const hudSceneStill = debugOptions !== null && debugOptions.hudSceneAt !== null;
  // The in-game hint of a game condition: once per condition per SLUI run, started the first time the overlay shows over
  // the game while the plugin's own high hint is empty (that slot is read on the overlay clock only while one waits).
  const [conditionHint, setConditionHint] = useState<ConditionHint | null>(null);
  const [shownConditionHints, setShownConditionHints] = useState<ReadonlySet<GameConditionKey>>(() => new Set());
  const pendingConditionHint = conditionHint === null ? nextConditionHint(gameConditions, shownConditionHints) : null;
  const selectHintSlotFree = useCallback((nowMs: number) => pendingConditionHint === null
    || selectMessageZone(hudMessagesState, hudTimeAtWall(nowMs)).hintHigh === null, [hudMessagesState, hudTimeAtWall, pendingConditionHint]);
  const hintSlotFree = useClockSelector(selectHintSlotFree);
  const overlayShown = overlayEnabled && sessionLive && overGame;
  useEffect(() => {
    if (pendingConditionHint === null || !overlayShown || !hintSlotFree) return;
    // On HUD time like the plugin's messages in the same slot (a paused replay holds it too).
    setConditionHint(startConditionHint(pendingConditionHint, hudTime.now()));
    setShownConditionHints((shown) => new Set(shown).add(pendingConditionHint));
    overlayController.log(`game condition hint shown: ${pendingConditionHint}`);
  }, [hintSlotFree, hudTime, overlayController, overlayShown, pendingConditionHint]);
  useEffect(() => {
    if (conditionHint === null) return undefined;
    const delay = wallDelayUntil(hudTime, conditionHint.expiresAtMs);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => setConditionHint(null), delay);
    return () => window.clearTimeout(timer);
  }, [conditionHint, hudTime]);
  const messageZoneAt = useCallback((nowMs: number) => {
    const hudMs = hudTimeAtWall(nowMs);
    return withConditionHint(selectMessageZone(hudMessagesState, hudMs), conditionHint, hudMs);
  }, [conditionHint, hudMessagesState, hudTimeAtWall]);
  const killfeedAt = useCallback((nowMs: number) => selectKillfeed(killfeedState, hudTimeAtWall(nowMs)), [hudTimeAtWall, killfeedState]);
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
  // CS2 observer numbers for the radar; the radar shows them only to a team-less observer.
  const playerNumbers = useMemo(() => hud.hasSnapshot ? playerObserverNumbers(hud.teams) : {}, [hud]);
  // The viewer's team colour for the radar frame, as the bottom HUD uses; null for a team-less observer.
  const viewerRole = hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer")?.role ?? null : null;
  const chatSelf = useMemo(() => resolveChatSelf(
    hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer") ?? null : null, localSteamId,
  ), [hud, localSteamId]);
  const handleShopCommand = useCallback((command: ShopCommand) => {
    // Diagnostics: the command's round trip (sent, result with latency, no result within the timeout, send failure).
    const label = shopCommandTarget(command);
    const sentAtMs = Date.now();
    // Only a command the model accepted goes out: one it refuses (stale data, closed buy window, a repeat still in
    // flight) would otherwise reach the plugin with no record here to resolve its result.
    if (!shopFeature.beginCommand(command, sentAtMs)) {
      overlayController.log(`shop command ${label} not sent: refused by the shop model (${shopFeature.availability()})`);
      return;
    }
    const pending = shopCommandLogRef.current;
    // Commands the sidecar never answered (an older one drops unknown kinds) are forgotten after a minute.
    for (const [id, entry] of pending) if (sentAtMs - entry.sentAtMs > 60_000) pending.delete(id);
    pending.set(command.command_id, { label, sentAtMs, overdue: false });
    overlayController.log(`shop command ${label} sent`);
    window.setTimeout(() => {
      const entry = pending.get(command.command_id);
      if (!entry || entry.overdue) return;
      entry.overdue = true;
      overlayController.log(`shop command ${label}: no result after ${SHOP_COMMAND_TIMEOUT_MS}ms`);
    }, SHOP_COMMAND_TIMEOUT_MS);
    void connection.send(command).catch((error: unknown) => {
      console.error("Unable to send shop command", error);
      const reason = error instanceof Error ? error.message : "Send failed";
      pending.delete(command.command_id);
      overlayController.log(`shop command ${label} not sent: ${reason}`);
      shopFeature.resolveCommand({ command_id: command.command_id, command_kind: command.kind, status: "failed", reason });
    });
  }, [connection, overlayController, shopFeature.beginCommand, shopFeature.resolveCommand, shopFeature.availability]);
  // Replay commands: within the command budget (the sidecar's per-player limit, design 11-17 §2; over it the command
  // is held back with a notice), recorded as pending (busy buttons, timeout, the seek target on the playhead), then
  // sent; a send that fails resolves at once. Diagnostics: every command and its result go to the desktop log.
  const replayBudget = replayFeature.budget;
  const handleReplayCommand = useCallback((command: ReplayCommand, seekMs: number | null = null): boolean => {
    if (!replayBudget.take()) {
      overlayController.log(`replay command ${replayCommandLabel(command)} held back: over the command budget`);
      replayFeature.notify(REPLAY_TOO_FAST_TEXT);
      return false;
    }
    replayFeature.beginCommand(command, seekMs);
    overlayController.log(`replay command ${replayCommandLabel(command)} sent`);
    void connection.send(command).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : "send-failed";
      overlayController.log(`replay command ${replayCommandLabel(command)} not sent: ${reason}`);
      replayFeature.sendFailed(command.command_id, reason);
    });
    return true;
  }, [connection, overlayController, replayBudget, replayFeature.beginCommand, replayFeature.notify, replayFeature.sendFailed]);
  const replayCommandWaitMs = useCallback(() => replayBudget.waitMs(), [replayBudget]);
  // Highlights mode (CS2's film button): App drives it, so it keeps playing the intervals while the bar is hidden.
  const replayHighlights = useReplayHighlights(replayFeature.state, handleReplayCommand);
  // The recordings list: the first open queries page 1; an accepted pin or unpin re-queries the page shown.
  const queryReplayCatalog = useCallback((page: number, filters: ReplayCatalogFilters): string | null => {
    const built = catalogQuery(filters, page);
    if (!built.ok) return built.error;
    handleReplayCommand(replayCatalog(built.query));
    return null;
  }, [handleReplayCommand]);
  const replayCatalogState = replayFeature.state.catalog;
  const replayCatalogStateRef = useRef(replayCatalogState);
  replayCatalogStateRef.current = replayCatalogState;
  useEffect(() => {
    const catalog = replayCatalogStateRef.current;
    if (replayCatalogOpen && catalog.page === null && catalog.commandId === null) queryReplayCatalog(1, catalog.filters);
  }, [queryReplayCatalog, replayCatalogOpen]);
  const catalogRevision = replayCatalogState.revision;
  useEffect(() => {
    const catalog = replayCatalogStateRef.current;
    if (catalogRevision > 0 && catalog.page !== null) queryReplayCatalog(catalog.page.page, catalog.filters);
  }, [catalogRevision, queryReplayCatalog]);
  const toggleReplayCatalog = useCallback(() => setReplayCatalogOpen((open) => !open), []);
  const closeReplayCatalog = useCallback(() => setReplayCatalogOpen(false), []);
  const leaveReplayConsole = useCallback(() => closeReplayConsole("escape"), [closeReplayConsole]);
  const loadReplay = useCallback((matchId: string) => handleReplayCommand(replayLoad(matchId)), [handleReplayCommand]);
  const pinReplay = useCallback((matchId: string, reason: string) => handleReplayCommand(replayPin(matchId, reason)), [handleReplayCommand]);
  const unpinReplay = useCallback((matchId: string) => handleReplayCommand(replayUnpin(matchId)), [handleReplayCommand]);
  const replayStateRef = useRef(replayFeature.state);
  replayStateRef.current = replayFeature.state;
  useEffect(() => {
    if (!MOCK_BACKEND) return undefined;
    const control: NonNullable<Window["__SLUI_REPLAY_DEBUG__"]> = { send: handleReplayCommand, state: () => replayStateRef.current };
    window.__SLUI_REPLAY_DEBUG__ = control;
    return () => {
      if (window.__SLUI_REPLAY_DEBUG__ === control) delete window.__SLUI_REPLAY_DEBUG__;
    };
  }, [handleReplayCommand]);
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
    <HudTimeContext.Provider value={hudTime}>
    <main id="SlgoOverlayRoot" data-preview-background={previewBackground} data-replay-bar={replayBarMode ?? undefined}>
      {teamSelectShown && teamSelect !== null ? (
        <TeamSelect view={teamSelect} onCommand={handleTeamCommand} initialHover={teamSelectHover}
          still={teamSelectDebug !== null && !teamSelectDebug.fade} />
      ) : <>
        {replayMode ? <ReplayHighlightFade replay={replayFeature.state} highlights={replayHighlights} /> : null}
        {/* An idle replay server has no match to show: the bar says nothing is loaded instead of "NO MATCH DATA". */}
        {replayIdle ? null : <HudTeamCounter
          hud={hud}
          clockAt={hudClockAt}
          playerMeta={playerMeta}
          variant={hudVariant}
        />}
        <WinPanel panelAt={winPanelAt} still={hudSceneStill} />
        <BottomHud view={bottomHud} still={hudSceneStill} />
        <ProgressCard card={progressCard} still={hudSceneStill} />
        <MessageZone zoneAt={messageZoneAt} still={hudSceneStill} role={viewerRole} />
        <KillFeed noticesAt={killfeedAt} still={hudSceneStill} />
        {scoreboard !== null && scoreboardMode !== "hidden" ? <Scoreboard view={scoreboard} elapsedAt={scoreboardElapsedAt} mode={scoreboardMode}
          onSort={handleScoreboardSort} onCyclePage={handleScoreboardPage} onToggleSide={handleScoreboardSide} /> : null}
        <LiveMinimapRadar store={minimapFeature.store} preferences={minimapOptions}
          controls={minimapControls}
          playerColors={playerColors} playerNumbers={playerNumbers} role={viewerRole}
          generatorActive={hud.hasSnapshot && hud.clockMode === "generator"} />
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
          onDiagnostic={overlayController.log}
        />
        <ChatInput
          chat={chatFeature.state}
          self={chatSelf}
          onDraft={chatFeature.setDraft}
          onToggleScope={chatFeature.toggleScope}
          onSubmit={handleChatSubmit}
          onClose={handleChatClose}
          openingKeys={chatKeys}
          onDiagnostic={overlayController.log}
        />
        {replayBarMode !== null ? (
          <ReplayController mode={replayBarMode} replay={replayFeature.state} hud={hud} catalogOpen={replayCatalogOpen}
            highlights={replayHighlights} commandWaitMs={replayCommandWaitMs} onCommand={handleReplayCommand} onToggleCatalog={toggleReplayCatalog} onLeaveFull={leaveReplayConsole} />
        ) : null}
        {replayBarMode === "full" && replayCatalogOpen ? (
          <ReplayCatalogPanel catalog={replayCatalogState} pending={replayFeature.state.pending}
            playingMatchId={replayFeature.state.current?.state.demo?.match_id ?? null}
            onFilters={replayFeature.setFilters} onQuery={queryReplayCatalog} onLoad={loadReplay} onPin={pinReplay} onUnpin={unpinReplay}
            onClose={closeReplayCatalog} />
        ) : null}
      </>}
      {showShopDebugPanel && debug && shopDebugOptions ? <debug.ShopDebugPanel options={shopDebugOptions} shopVisible={shopOpen} onChange={setShopDebugOptions} onToggleShop={toggleShop} /> : null}
      {showHudDebugPanel && debug && debugOptions ? (
        <debug.HudDebugPanel options={debugOptions} onChange={setDebugOptions} />
      ) : null}
    </main>
    </HudTimeContext.Provider>
  );
}

export default App;
