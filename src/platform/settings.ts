import { DEFAULT_RADAR_PREFERENCES, normalizeRadarPreferences, type RadarPreferences } from "../features/minimap/preferences.ts";
import { DEFAULT_AUDIO_SETTINGS, normalizeAudioSettings, type AudioSettings } from "./audioSettings.ts";
import { DEFAULT_HOTKEYS, normalizeHotkeys, type HotkeySettings } from "./hotkeys.ts";
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings, type OverlaySettings } from "./overlaySettings.ts";

export const SETTINGS_VERSION = 1;

export type AppSettings = Readonly<{ overlay: OverlaySettings; radar: RadarPreferences; hotkeys: HotkeySettings; audio: AudioSettings }>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  overlay: { ...DEFAULT_OVERLAY_SETTINGS },
  radar: { ...DEFAULT_RADAR_PREFERENCES }, hotkeys: { ...DEFAULT_HOTKEYS }, audio: { ...DEFAULT_AUDIO_SETTINGS },
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Anything unreadable falls back to defaults; the radar contract owns ranges and defaults.
// Blocks added within a version (hotkeys, audio, overlay) fall back per block, so older files stay valid.
export function parseSettings(value: unknown): AppSettings {
  const record = asRecord(value);
  if (!record || record.version !== SETTINGS_VERSION) return DEFAULT_APP_SETTINGS;
  return {
    overlay: normalizeOverlaySettings(asRecord(record.overlay)),
    radar: normalizeRadarPreferences(asRecord(record.radar) as Partial<RadarPreferences> | null),
    hotkeys: normalizeHotkeys(asRecord(record.hotkeys)),
    audio: normalizeAudioSettings(asRecord(record.audio)),
  };
}

export function parseSettingsText(text: string | null | undefined): AppSettings {
  if (!text) return DEFAULT_APP_SETTINGS;
  try {
    return parseSettings(JSON.parse(text));
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify({
    version: SETTINGS_VERSION,
    overlay: normalizeOverlaySettings(settings.overlay),
    radar: normalizeRadarPreferences(settings.radar),
    hotkeys: normalizeHotkeys(settings.hotkeys),
    audio: normalizeAudioSettings(settings.audio),
  }, null, 2);
}

export interface SettingsStore {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
  subscribe(listener: (settings: AppSettings) => void): () => void;
}

const BROWSER_SETTINGS_KEY = "slui.settings";

function createTauriSettingsStore(): SettingsStore {
  return {
    async load() {
      const { invoke } = await import("@tauri-apps/api/core");
      return parseSettingsText(await invoke<string | null>("load_settings"));
    },
    async save(settings) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_settings", { contents: serializeSettings(settings) });
    },
    subscribe(listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("slgo-settings-changed", ({ payload }) => {
        if (!disposed) listener(parseSettingsText(payload));
      })).then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      }).catch((error: unknown) => console.error("Unable to subscribe to settings", error));
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}

// Browser preview: localStorage plus the `storage` event keeps a home tab and an overlay tab in sync.
function createBrowserSettingsStore(): SettingsStore {
  const read = (): string | null => {
    try {
      return window.localStorage.getItem(BROWSER_SETTINGS_KEY);
    } catch {
      return null;
    }
  };
  const listeners = new Set<(settings: AppSettings) => void>();
  return {
    async load() {
      return parseSettingsText(read());
    },
    async save(settings) {
      const text = serializeSettings(settings);
      window.localStorage.setItem(BROWSER_SETTINGS_KEY, text);
      const parsed = parseSettingsText(text);
      for (const listener of listeners) listener(parsed);
    },
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === BROWSER_SETTINGS_KEY) listener(parseSettingsText(event.newValue));
      };
      listeners.add(listener);
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

export function createSettingsStore(): SettingsStore {
  return "__TAURI_INTERNALS__" in window ? createTauriSettingsStore() : createBrowserSettingsStore();
}
