import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TOP_HUD, type ConnectionStatus, type MinimapDiagnostic, type SlgoEvent } from "./contracts";
import { HudTeamCounter } from "./features/hud/HudTeamCounter";
import { initialRoundHudState, roundHudReducer, selectRoundHud } from "./features/hud/model";
import {
  createMockProvider,
  mockShopSnapshotFor,
} from "./mocks/provider";
import { HudDebugPanel } from "./mocks/HudDebugPanel";
import { ShopPanel } from "./features/shop/ShopPanel";
import { createPurchaseCommand, selectShop } from "./features/shop/model";
import { useShopFeature } from "./features/shop/useShopFeature";
import { ChatInput } from "./features/chat/ChatInput";
import { createChatCommand, validateChatBody, type ChatCloseReason } from "./features/chat/model";
import { resolveChatSelf } from "./features/chat/presentation";
import { hudVariantFor, playerSlotColors, topHudPlayerMetaForHud, type HudPresentationVariant } from "./features/hud/presentation";
import { useChatFeature } from "./features/chat/useChatFeature";
import { createOverlayWindowController, type SlgoConnection } from "./platform";
import { ShopDebugPanel } from "./mocks/ShopDebugPanel";
import { createShopDebugState, readShopDebugOptions, replaceShopDebugUrl } from "./mocks/shopDebug";
import {
  createHudDebugState,
  readHudDebugOptions,
  replaceHudDebugUrl,
} from "./mocks/hudDebug";
import { HttpControlPlane, MockControlPlane } from "./platform/route";
import { WebSocketSidecarConnection } from "./platform/connection";
import { readBackendConfig } from "./platform/backend";
import { createIdentityProofProvider, LocalSteamIdentity } from "./platform/identity";
import { useClientSession } from "./app/useClientSession";
import { LiveMinimapRadar } from "./features/minimap/MinimapRadar";
import { useMinimapFeature } from "./features/minimap/useMinimapFeature";
import { defaultMinimapPreviewOptions, readMinimapPreviewOptions, type MinimapPreviewOptions } from "./mocks/minimapFixtures";
import { createPreviewGameForegroundSource, subscribeGameForeground } from "./platform/gameForeground";
import { DEFAULT_AUDIO_SETTINGS } from "./platform/audioSettings";
import { DEFAULT_OVERLAY_SETTINGS, shouldAutoEnableOverlay } from "./platform/overlaySettings";
import { createSettingsStore, type AppSettings } from "./platform/settings";
import type { RadarPreferences } from "./features/minimap/preferences";
import { createOverlayStateSource, createSessionStatusPublisher, type OverlayState, type SessionStatusSnapshot } from "./platform/desktop";
import "./App.css";

/** Plugin features the enabled overlay takes over (reported via client.features). */
const OVERLAY_CLIENT_FEATURES = [CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TOP_HUD] as const;

// Mocks only in the explicit `mock` mode (npm run dev:mock).
const BACKEND = readBackendConfig(import.meta.env);
const MOCK_BACKEND = BACKEND.kind === "mock";
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
      rebuild(seed?: number): void;
      invalidate(kind: "invalid" | "incompatible"): void;
      disconnect(): Promise<void>;
      reconnect(): void;
    };
  }
}

function App() {
  const [debugOptions, setDebugOptions] = useState(readHudDebugOptions);
  const [shopDebugOptions, setShopDebugOptions] = useState(readShopDebugOptions);
  const [minimapOptions, setMinimapOptions] = useState(() => HUD_DEBUG_ENABLED ? readMinimapPreviewOptions() : defaultMinimapPreviewOptions);
  const previewParams = new URLSearchParams(window.location.search);
  const showPreviewBackground = HUD_DEBUG_ENABLED && previewParams.get("background") !== "0";
  const showHudDebugPanel = HUD_DEBUG_ENABLED && previewParams.get("hudDebug") !== "0";
  // Both debug panels are suppressible from the URL so the shop can be captured
  // as it will ship when comparing against the baseline screenshot.
  const showShopDebugPanel = SHOP_DEBUG_ENABLED && previewParams.get("shopDebug") !== "0";
  const previewBackground = showPreviewBackground ? debugOptions.background : undefined;
  const previewViewerTeam = HUD_DEBUG_ENABLED && debugOptions.viewerTeam === "team-b" ? "team-b" : "team-a";
  const previewShopRole = HUD_DEBUG_ENABLED && shopDebugOptions.role === "scp079" ? "scp079" : "scp";
  // A 079 debug scenario always needs the SCP-side fixture, even when the HUD
  // preview is still showing Team A or spectator data.
  const debugShopViewerTeam = previewShopRole === "scp079" ? "team-b" : previewViewerTeam;
  // The debug harness and a dev `hudVariant` URL parameter pin the variant for visual audits.
  const urlHudVariant = import.meta.env.DEV ? previewParams.get("hudVariant") : null;
  const pinnedHudVariant: HudPresentationVariant | null = HUD_DEBUG_ENABLED
    ? debugOptions.variant
    : urlHudVariant === "compact" || urlHudVariant === "detailed" ? urlHudVariant : null;
  const mockConnection = useMemo(() => MOCK_BACKEND ? createMockProvider(previewViewerTeam, previewShopRole) : null, [previewShopRole, previewViewerTeam]);
  const connection = useMemo<SlgoConnection>(() => mockConnection ?? new WebSocketSidecarConnection({
    endpointOverride: BACKEND.kind === "real" ? BACKEND.sidecarEndpointOverride : null,
  }), [mockConnection]);
  const controlPlane = useMemo(() => BACKEND.kind === "real" ? new HttpControlPlane(BACKEND.controlPlaneUrl) : new MockControlPlane(), []);
  const identity = useMemo(() => new LocalSteamIdentity(), []);
  // The real control plane accepts only the local-steamid claim.
  const proof = useMemo(() => createIdentityProofProvider(MOCK_BACKEND && import.meta.env.VITE_ENABLE_MOCK_VERIFIED_PROOF === "true"), []);
  const [hudState, dispatchHud] = useReducer(roundHudReducer, initialRoundHudState);
  const shopFeature = useShopFeature();
  const chatFeature = useChatFeature();
  const minimapFeature = useMinimapFeature();
  const previewFocus = useMemo(() => createPreviewGameForegroundSource(true), []);
  const [nowMs, setNowMs] = useState(Date.now);
  // The player opens the shop with its hotkey; window_open alone never opens it.
  // Only the debug build honours ?shopOpen=1.
  const [shopOpen, setShopOpen] = useState(() => SHOP_DEBUG_ENABLED && readShopDebugOptions().open);
  const [shopVolume, setShopVolume] = useState(DEFAULT_AUDIO_SETTINGS.shopVolume);
  const [overlaySettings, setOverlaySettings] = useState(DEFAULT_OVERLAY_SETTINGS);
  const shopAvailableRef = useRef(false);
  const connectionLiveRef = useRef(false);
  const chatOpenRef = useRef(false);
  const shopVisibleRef = useRef(false);
  const overlayController = useMemo(() => createOverlayWindowController(), []);

  const handleEvent = useCallback((event: SlgoEvent) => {
    dispatchHud({ type: "event", event, receivedAtMs: Date.now() });
    shopFeature.receiveEvent(event);
    chatFeature.receiveEvent(event);
    minimapFeature.receiveEvent(event);
  }, [shopFeature.receiveEvent, chatFeature.receiveEvent, minimapFeature.receiveEvent]);
  const handleDiagnostic = useCallback((diagnostic: MinimapDiagnostic) => {
    minimapFeature.receiveDiagnostic(diagnostic);
  }, [minimapFeature.receiveDiagnostic]);
  const handleStatus = useCallback((status: ConnectionStatus) => {
    if ((status === "live") !== connectionLiveRef.current) overlayController.log(`session ${status}`);
    dispatchHud({ type: "connection", status });
    shopFeature.setConnectionStatus(status);
    connectionLiveRef.current = status === "live";
    chatFeature.setConnectionStatus(status);
    minimapFeature.setConnectionStatus(status);
  }, [overlayController, shopFeature.setConnectionStatus, chatFeature.setConnectionStatus, minimapFeature.setConnectionStatus]);
  const dependencies = useMemo(() => ({ identity, proof, controlPlane, connection }), [connection, controlPlane, identity, proof]);
  const session = useClientSession(dependencies, handleEvent, handleDiagnostic, handleStatus);
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
      void overlayController.setShopHotkey(settings.hotkeys.shop)
        .catch((error: unknown) => console.error("Unable to apply shop hotkey", error));
    };
    void settingsStore.load().then(apply).catch((error: unknown) => console.error("Unable to load settings", error));
    const unsubscribe = settingsStore.subscribe(apply);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [overlayController, settingsStore]);

  // Disabling the overlay must not leave an open shop or chat (and so interaction) or a held zoom behind.
  useEffect(() => overlayState.subscribe((state) => {
    if (state.enabled) return;
    setShopOpen(false);
    chatFeature.close("unavailable");
    setMinimapOptions((current) => current.alternateZoomActive ? { ...current, alternateZoomActive: false } : current);
  }), [overlayState, chatFeature.close]);

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
    status: session.status, steamId: session.identity?.steamId ?? null, detail: session.detail,
  }), [session.detail, session.identity?.steamId, session.status]);
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
    const subscribe = HUD_DEBUG_ENABLED && !("__TAURI_INTERNALS__" in window)
      ? previewFocus.subscribeGameForeground : subscribeGameForeground;
    return subscribe((state) => {
      minimapFeature.setGameForeground(state);
    });
  }, [previewFocus, minimapFeature.setGameForeground]);

  useEffect(() => {
    if (HUD_DEBUG_ENABLED) mockConnection?.configureMinimap(minimapOptions);
  }, [mockConnection, minimapOptions]);

  useEffect(() => {
    if (HUD_DEBUG_ENABLED) mockConnection?.configureHudScene(debugOptions.hudScene);
  }, [mockConnection, debugOptions.hudScene]);

  useEffect(() => {
    if (!HUD_DEBUG_ENABLED || !mockConnection) return;
    const control: NonNullable<Window["__SLUI_MINIMAP_DEBUG__"]> = {
      configure: (options) => setMinimapOptions((current) => ({ ...current, ...options })),
      setFocused: previewFocus.setFocused,
      rebuild: (seed) => mockConnection.rebuildMinimap(seed),
      invalidate: (kind) => mockConnection.invalidateMinimap(kind),
      disconnect: () => mockConnection.disconnect(),
      reconnect: session.retry,
    };
    window.__SLUI_MINIMAP_DEBUG__ = control;
    return () => {
      if (window.__SLUI_MINIMAP_DEBUG__ === control) delete window.__SLUI_MINIMAP_DEBUG__;
    };
  }, [mockConnection, previewFocus, session.retry]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNowMs(nextNow);
      shopFeature.tick(nextNow);
      chatFeature.tick(nextNow);
    }, 250);
    return () => window.clearInterval(timer);
  }, [shopFeature.tick, chatFeature.tick]);

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
    if (!HUD_DEBUG_ENABLED) return undefined;
    replaceHudDebugUrl(debugOptions);
    const handlePopState = () => setDebugOptions(readHudDebugOptions());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [debugOptions]);

  useEffect(() => {
    if (!SHOP_DEBUG_ENABLED) return undefined;
    replaceShopDebugUrl({ ...shopDebugOptions, open: shopOpen });
    const handlePopState = () => setShopDebugOptions(readShopDebugOptions());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [shopDebugOptions, shopOpen]);

  const liveHud = useMemo(() => selectRoundHud(hudState, nowMs), [hudState, nowMs]);
  const shop = useMemo(() => selectShop(shopFeature.state, nowMs), [shopFeature.state, nowMs]);
  const debugShopSnapshot = mockShopSnapshotFor(debugShopViewerTeam, previewShopRole);
  const debugShop = useMemo(() => selectShop(createShopDebugState(shopDebugOptions, nowMs, debugShopSnapshot), nowMs), [debugShopSnapshot, nowMs, shopDebugOptions]);
  const debugHudState = useMemo(
    () => createHudDebugState(debugOptions, nowMs),
    [debugOptions, nowMs],
  );
  const debugHud = useMemo(() => selectRoundHud(debugHudState, nowMs), [debugHudState, nowMs]);
  const displayedShop = SHOP_DEBUG_ENABLED ? debugShop : shop;
  const shopAvailable = displayedShop.hasSnapshot && displayedShop.windowOpen;
  shopAvailableRef.current = shopAvailable;
  const chatOpen = chatFeature.state.open;
  chatOpenRef.current = chatOpen;
  shopVisibleRef.current = shopOpen && shopAvailable;
  // Interaction follows the open UI: it is on exactly while the shop or chat is on
  // screen, and it always takes the foreground too. A foreground game keeps its
  // cursor locked to the centre and turns the camera with the mouse, so the mouse
  // alone is not enough even for the shop.
  const overlayInteractive = (shopOpen && shopAvailable) || chatOpen;
  const wasChatOpenRef = useRef(false);
  // Diagnostics: every close, including a send and a session change.
  useEffect(() => {
    if (wasChatOpenRef.current && !chatOpen) overlayController.log("chat state closed");
    wasChatOpenRef.current = chatOpen;
  }, [chatOpen, overlayController]);
  const sentInteractiveRef = useRef(false);
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve());

  // The buy window closing also closes the shop, so it does not reopen next round.
  useEffect(() => {
    if (shopOpen && !shopAvailable) setShopOpen(false);
  }, [shopAvailable, shopOpen]);

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
  const hud = HUD_DEBUG_ENABLED ? debugHud : liveHud;
  // Equipment comes from the snapshot loadout (viewer team only), for the mock stream too.
  const playerMeta = useMemo(() => topHudPlayerMetaForHud(hud), [hud]);
  const shopRole = HUD_DEBUG_ENABLED && previewShopRole === "scp079"
    ? "scp"
    : hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer")?.role ?? "scp" : "scp";
  const toggleShop = useCallback(() => setShopOpen((current) => !current), []);
  const closeShop = useCallback(() => setShopOpen(false), []);
  const localSteamId = session.identity?.steamId ?? null;
  const hudVariant = pinnedHudVariant ?? hudVariantFor(hud, localSteamId);
  const minimapPlayerColors = useMemo(() => hud.hasSnapshot ? playerSlotColors(hud.teams) : {}, [hud]);
  const chatSelf = useMemo(() => resolveChatSelf(
    hud.hasSnapshot ? hud.teams.find((team) => team.relation === "viewer") ?? null : null, localSteamId,
  ), [hud, localSteamId]);
  const handlePurchase = useCallback((command: ReturnType<typeof createPurchaseCommand>) => {
    shopFeature.beginPurchase(command);
    void connection.send(command).catch((error: unknown) => {
      console.error("Unable to send shop purchase", error);
      shopFeature.resolveCommand({ command_id: command.command_id, command_kind: command.kind, status: "failed", reason: error instanceof Error ? error.message : "Send failed" });
    });
  }, [connection, shopFeature.beginPurchase, shopFeature.resolveCommand]);
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
  return (
    <main id="SlgoOverlayRoot" data-preview-background={previewBackground}>
      <HudTeamCounter
        hud={hud}
        playerMeta={playerMeta}
        variant={hudVariant}
      />
      <LiveMinimapRadar store={minimapFeature.store} preferences={minimapOptions}
        controls={{ alternateZoomActive: minimapOptions.alternateZoomActive }}
        renderCapabilities={{ pageBackdrop: (previewBackground === "1" || previewBackground === "2")
          && !("__TAURI_INTERNALS__" in window) }}
        playerColors={minimapPlayerColors} />
      <ShopPanel
        shop={displayedShop}
        role={shopRole}
        open={shopOpen}
        volume={shopVolume}
        countdownSeconds={hud.hasSnapshot ? hud.phaseClockSeconds : null}
        countdownPaused={hud.hasSnapshot ? hud.paused : false}
        onPurchase={handlePurchase}
        onClose={closeShop}
      />
      <ChatInput
        chat={chatFeature.state}
        nowMs={nowMs}
        self={chatSelf}
        onDraft={chatFeature.setDraft}
        onToggleScope={chatFeature.toggleScope}
        onSubmit={handleChatSubmit}
        onClose={handleChatClose}
        onDiagnostic={overlayController.log}
      />
      {showShopDebugPanel ? <ShopDebugPanel options={shopDebugOptions} shopVisible={shopOpen} onChange={setShopDebugOptions} onToggleShop={toggleShop} /> : null}
      {showHudDebugPanel ? (
        <HudDebugPanel options={debugOptions} onChange={setDebugOptions} />
      ) : null}
    </main>
  );
}

export default App;
