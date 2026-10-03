import { EMPTY_THEME_PACK, type ThemePack } from "../shared/themePack.ts";
import { isTauri } from "./desktop.ts";

// Must match theme_pack::SCHEME in src-tauri/src/theme_pack.rs. WebView2 exposes
// custom schemes as http://<scheme>.localhost/.
const TAURI_BASE_URL = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
  ? "http://theme.localhost/"
  : "theme://localhost/";
// Served by scripts/vite-theme-pack.mjs during development only.
const DEV_BASE_URL = "/theme-pack/";

function parseFileList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((file) => typeof file === "string") ? value : null;
}

async function readFileList(): Promise<{ files: unknown; baseUrl: string } | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return { files: await invoke<unknown>("list_theme_pack_files"), baseUrl: TAURI_BASE_URL };
  }
  // `?themePack=0` previews the bundled fallbacks without moving the local pack.
  if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("themePack") === "0") return null;
  const response = await fetch(`${DEV_BASE_URL}index.json`);
  return response.ok ? { files: await response.json(), baseUrl: DEV_BASE_URL } : null;
}

/** Never rejects: a missing or unreadable pack means bundled assets only. */
export async function loadThemePack(): Promise<ThemePack> {
  try {
    const listing = await readFileList();
    if (!listing) return EMPTY_THEME_PACK;
    const files = parseFileList(listing.files);
    if (!files) throw new Error("theme pack file list is not a string array");
    return { files: new Set(files), baseUrl: listing.baseUrl };
  } catch (error) {
    console.warn("Theme pack unavailable; using bundled assets", error);
    return EMPTY_THEME_PACK;
  }
}
