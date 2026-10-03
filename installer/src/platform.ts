// The only module that talks to Tauri. Outside Tauri (browser preview) it returns a mock
// chosen by `?state=fresh|update|same|newer|fail|cancel` (add `&running=1` for the
// running-app notice); the mock is never reachable inside the Tauri window.
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Detect, DirCheck, InstallOutcome, InstallRequest, Stage } from "./model.ts";

export type Platform = {
  detect(): Promise<Detect>;
  checkDir(dir: string): Promise<DirCheck>;
  pickDir(current: string): Promise<string | null>;
  install(request: InstallRequest, onStage: (stage: Stage) => void): Promise<InstallOutcome>;
  /** Starts the installed SLUI and closes the installer. */
  launch(): Promise<void>;
  startDragging(): void;
  minimize(): void;
  close(): void;
};

function tauriPlatform(): Platform {
  const window = getCurrentWindow();
  return {
    detect: () => invoke<Detect>("detect"),
    checkDir: (dir) => invoke<DirCheck>("check_dir", { dir }),
    pickDir: (current) => invoke<string | null>("pick_dir", { current }),
    async install(request, onStage) {
      const channel = new Channel<Stage>();
      channel.onmessage = onStage;
      try {
        return await invoke<InstallOutcome>("install", { req: request, onStage: channel });
      } catch (error) {
        console.error("slui-setup: install command failed", error);
        return { kind: "failed", code: null, reason: "internal", detail: String(error) };
      }
    },
    launch: () => invoke<void>("launch"),
    startDragging: () => void window.startDragging().catch((error) => console.error("slui-setup: drag failed", error)),
    minimize: () => void window.minimize().catch((error) => console.error("slui-setup: minimize failed", error)),
    close: () => void window.close().catch((error) => console.error("slui-setup: close failed", error)),
  };
}

type MockState = "fresh" | "update" | "same" | "newer" | "fail" | "cancel";

const MOCK_VERSION = "0.1.1";
const MOCK_DEFAULT_DIR = "C:\\Program Files\\SLUI";
const GB = 1024 * 1024 * 1024;

function mockPlatform(params: URLSearchParams): Platform {
  const raw = params.get("state");
  const state: MockState = raw === "update" || raw === "same" || raw === "newer" || raw === "fail" || raw === "cancel"
    ? raw
    : "fresh";
  const installedVersion = { update: "0.1.0", same: MOCK_VERSION, newer: "0.2.0" } as const;
  const relation = { update: "older", same: "same", newer: "newer" } as const;
  const installed = state === "update" || state === "same" || state === "newer"
    ? { version: installedVersion[state], dir: "D:\\Games\\SLUI", relation: relation[state] }
    : null;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    detect: async () => {
      await wait(250);
      return {
        payloadVersion: MOCK_VERSION,
        requiredBytes: 112 * 1024 * 1024,
        defaultDir: MOCK_DEFAULT_DIR,
        installed,
        appRunning: params.get("running") === "1",
      };
    },
    // Rough stand-in for the Rust check: the E: drive is nearly full, Z: is a network drive.
    async checkDir(dir) {
      await wait(80);
      const normalized = dir.trim().replace(/\//g, "\\").replace(/\\+$/, "");
      if (!/^[a-zA-Z]:\\/.test(normalized + "\\")) return { normalized, freeBytes: null, error: "not_absolute" };
      if (/^[a-zA-Z]:$/.test(normalized)) return { normalized, freeBytes: null, error: "drive_root" };
      if (/[<>"|?*]/.test(normalized.slice(2)) || normalized.slice(2).includes(":")) {
        return { normalized, freeBytes: null, error: "invalid_chars" };
      }
      const drive = normalized[0].toUpperCase();
      if (drive === "Z") return { normalized, freeBytes: null, error: "not_local" };
      return { normalized, freeBytes: drive === "E" ? 40 * 1024 * 1024 : 186.4 * GB, error: null };
    },
    pickDir: async () => "D:\\Program Files\\SLUI",
    async install(request, onStage) {
      onStage("extracting");
      await wait(700);
      onStage("elevating");
      await wait(900);
      if (state === "cancel") return { kind: "cancelled" };
      onStage("installing");
      await wait(2200);
      if (state === "fail") return { kind: "failed", code: 2, reason: "exit_code", detail: null };
      return { kind: "ok", dir: request.dir };
    },
    launch: async () => console.info("slui-setup mock: launch"),
    startDragging: () => {},
    minimize: () => console.info("slui-setup mock: minimize"),
    close: () => console.info("slui-setup mock: close"),
  };
}

export const platform: Platform = isTauri() ? tauriPlatform() : mockPlatform(new URLSearchParams(location.search));
