import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RadarPreferences } from "../../features/minimap/preferences";
import {
  createGameProcessSource, createOverlayStateSource, createSessionStatusSubscriber, createWindowControls, DISABLED_OVERLAY,
  type OverlayState, type SessionStatusSnapshot,
} from "../../platform/desktop";
import type { AudioSettings as Audio } from "../../platform/audioSettings";
import type { HotkeySettings as Hotkeys } from "../../platform/hotkeys";
import type { OverlaySettings as Overlay } from "../../platform/overlaySettings";
import { createSettingsStore, DEFAULT_APP_SETTINGS, type AppSettings } from "../../platform/settings";
import { readBackendConfig } from "../../platform/backend";
import { createUpdateSource, type UpdateState } from "../../platform/updater";
import { readUpdatePreview } from "../../mocks/updatePreview";
import { homeServerStatus, type UpdateAction } from "../updateModel";
import { AudioSettings } from "./AudioSettings";
import { HotkeySettings } from "./HotkeySettings";
import { KeyHints } from "./KeyHints";
import { NavRail, type HomePage } from "./NavRail";
import { SystemSettings } from "./SystemSettings";
import { OverlaySwitch } from "./OverlaySwitch";
import { RadarSettings } from "./RadarSettings";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import "./home.css";

// Mock mode has no control plane, so no update checks.
const BACKEND = readBackendConfig(import.meta.env);

// Slider drags are merged into one write; the overlay applies each saved value.
const SAVE_DEBOUNCE_MS = 150;

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

const SETTINGS_GROUPS = [
  { id: "home-settings-system", label: "系统" },
  { id: "home-settings-radar", label: "雷达" },
  { id: "home-settings-hotkeys", label: "快捷键" },
  { id: "home-settings-audio", label: "声音" },
] as const;

export function HomeApp() {
  const settingsStore = useMemo(() => createSettingsStore(), []);
  const overlaySource = useMemo(() => createOverlayStateSource(), []);
  const gameSource = useMemo(() => createGameProcessSource(), []);
  const sessionSource = useMemo(() => createSessionStatusSubscriber(), []);
  const windowControls = useMemo(() => createWindowControls(), []);
  const updateSource = useMemo(() => createUpdateSource(undefined, undefined,
    import.meta.env.DEV ? readUpdatePreview(window.location.search) : null), []);

  const [page, setPage] = useState<HomePage>("home");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayState>(DISABLED_OVERLAY);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [gameRunning, setGameRunning] = useState<boolean | null>(null);
  const [session, setSession] = useState<SessionStatusSnapshot | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const saveTimer = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let active = true;
    void settingsStore.load().then((loaded) => { if (active) setSettings(loaded); })
      .catch((error: unknown) => { if (active) setSaveError(errorText(error)); });
    return () => { active = false; };
  }, [settingsStore]);

  useEffect(() => {
    let active = true;
    const unsubscribe = overlaySource.subscribe(setOverlay);
    void overlaySource.get().then((state) => { if (active) setOverlay(state); })
      .catch((error: unknown) => { if (active) setOverlayError(errorText(error)); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [overlaySource]);

  useEffect(() => {
    let active = true;
    const unsubscribe = gameSource.subscribe(setGameRunning);
    void gameSource.get().then((running) => { if (active) setGameRunning(running); })
      .catch(() => { if (active) setGameRunning(false); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [gameSource]);

  // Ask the overlay for a fresh snapshot on load and whenever home is shown again.
  useEffect(() => {
    const unsubscribe = sessionSource.subscribe(setSession);
    sessionSource.requestSnapshot();
    const onVisible = () => { if (document.visibilityState === "visible") sessionSource.requestSnapshot(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionSource]);

  // Both windows start together; if the overlay was not listening yet, the first request is lost.
  useEffect(() => {
    if (session) return undefined;
    const timer = window.setInterval(sessionSource.requestSnapshot, 2_000);
    return () => window.clearInterval(timer);
  }, [session, sessionSource]);

  // The home window starts the update checks (Rust keeps them running while it is hidden).
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = updateSource.subscribe((state) => {
      changed = true;
      setUpdate(state);
    });
    const initial = BACKEND.kind === "real" ? updateSource.start(BACKEND.controlPlaneUrl) : updateSource.get();
    void initial.catch((error: unknown) => {
      console.error("Unable to start update checks", error);
      return updateSource.get();
    }).then((state) => {
      if (active && !changed && state) setUpdate(state);
    }).catch((error: unknown) => console.error("Unable to read the update state", error));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [updateSource]);
  const updateAction = useCallback((action: UpdateAction) => {
    const run = action === "install" ? updateSource.install() : updateSource.checkNow();
    void run.catch((error: unknown) => console.error(`Update ${action} failed`, error));
  }, [updateSource]);
  useEffect(() => () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); }, []);

  // Each section edits its own block; the whole file is saved so blocks never drop each other.
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void settingsStore.save(next).then(() => setSaveError(null))
        .catch((error: unknown) => setSaveError(errorText(error)));
    }, SAVE_DEBOUNCE_MS);
  }, [settingsStore]);
  const updateOverlay = useCallback((overlay: Overlay) => updateSettings({ overlay }), [updateSettings]);
  const updateRadar = useCallback((radar: RadarPreferences) => updateSettings({ radar }), [updateSettings]);
  const updateHotkeys = useCallback((hotkeys: Hotkeys) => updateSettings({ hotkeys }), [updateSettings]);
  const updateAudio = useCallback((audio: Audio) => updateSettings({ audio }), [updateSettings]);

  const toggleOverlay = useCallback(() => {
    setOverlayBusy(true);
    setOverlayError(null);
    void overlaySource.setEnabled(!overlay.enabled).then(setOverlay)
      .catch((error: unknown) => setOverlayError(`无法切换 UI：${errorText(error)}`))
      .finally(() => setOverlayBusy(false));
  }, [overlay.enabled, overlaySource]);

  return <div className="home">
    <TitleBar controls={windowControls} />
    <NavRail page={page} onNavigate={setPage} overlay={overlay} server={homeServerStatus(session, update)} />
    <main className={page === "home" ? "home-main" : "home-main home-main--split"} key={page}>
      {page === "home" ? <div className="home-page">
        <OverlaySwitch state={overlay} busy={overlayBusy} error={overlayError} onToggle={toggleOverlay} />
        <StatusBar session={session} gameRunning={gameRunning} update={update} onRetry={sessionSource.retry}
          onUpdateAction={updateAction} />
        <KeyHints shopKey={settings.hotkeys.shop} />
      </div> : <>
        <header className="home-page__header">
          <div className="home-page__header-inner">
            <div>
              <h1 className="home-page__title">设置</h1>
              <p className="home-page__subtitle">修改即时保存，并立即应用到游戏内 UI。</p>
            </div>
            <div className="home-jump" role="group" aria-label="跳转到分组">
              {SETTINGS_GROUPS.map(({ id, label }) => <button key={id} type="button" className="home-jump__item"
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{label}</button>)}
            </div>
          </div>
        </header>
        <div className="home-main__scroll">
          <div className="home-page home-page--below-header">
            <SystemSettings id="home-settings-system" value={settings.overlay} onChange={updateOverlay}
              onReset={() => updateOverlay(DEFAULT_APP_SETTINGS.overlay)} />
            <RadarSettings id="home-settings-radar" value={settings.radar} saveError={saveError} onChange={updateRadar}
              onReset={() => updateRadar(DEFAULT_APP_SETTINGS.radar)} />
            <HotkeySettings id="home-settings-hotkeys" value={settings.hotkeys} onChange={updateHotkeys}
              onReset={() => updateHotkeys(DEFAULT_APP_SETTINGS.hotkeys)} />
            <AudioSettings id="home-settings-audio" value={settings.audio} onChange={updateAudio}
              onReset={() => updateAudio(DEFAULT_APP_SETTINGS.audio)} />
          </div>
        </div>
      </>}
    </main>
  </div>;
}
