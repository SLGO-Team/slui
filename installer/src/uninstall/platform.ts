// The only uninstaller module that talks to Tauri. Outside Tauri (browser preview, opened
// with `?role=uninstall`) it returns a mock chosen by
// `&state=installed|theme|none|fail|cancel|datafail` (add `&running=1` for the
// running-app notice); the mock is never reachable inside the Tauri window.
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Stage, UninstallDetect, UninstallOutcome, UninstallRequest } from "./model.ts";

export type UninstallPlatform = {
  detect(): Promise<UninstallDetect>;
  uninstall(request: UninstallRequest, onStage: (stage: Stage) => void): Promise<UninstallOutcome>;
  startDragging(): void;
  minimize(): void;
  close(): void;
};

function tauriPlatform(): UninstallPlatform {
  const window = getCurrentWindow();
  return {
    detect: () => invoke<UninstallDetect>("uninstall_detect"),
    async uninstall(request, onStage) {
      const channel = new Channel<Stage>();
      channel.onmessage = onStage;
      try {
        return await invoke<UninstallOutcome>("uninstall", { req: request, onStage: channel });
      } catch (error) {
        console.error("slui-uninstall: uninstall command failed", error);
        return { kind: "failed", code: null, reason: "internal", detail: String(error) };
      }
    },
    startDragging: () => void window.startDragging().catch((error) => console.error("slui-uninstall: drag failed", error)),
    minimize: () => void window.minimize().catch((error) => console.error("slui-uninstall: minimize failed", error)),
    close: () => void window.close().catch((error) => console.error("slui-uninstall: close failed", error)),
  };
}

type MockState = "installed" | "theme" | "none" | "fail" | "cancel" | "datafail";

const MOCK_STATES: MockState[] = ["installed", "theme", "none", "fail", "cancel", "datafail"];
const MOCK_DIR = "D:\\Games\\SLUI";

function mockPlatform(params: URLSearchParams): UninstallPlatform {
  const raw = params.get("state");
  const state = MOCK_STATES.find((item) => item === raw) ?? "theme";
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    detect: async () => {
      await wait(250);
      return {
        installed: state === "none" ? null : { version: "0.2.2", dir: MOCK_DIR },
        themePack: state !== "installed",
        userData: true,
        appRunning: params.get("running") === "1",
      };
    },
    async uninstall(request, onStage) {
      onStage("preparing");
      await wait(500);
      onStage("elevating");
      await wait(900);
      if (state === "cancel") return { kind: "cancelled" };
      onStage("uninstalling");
      await wait(1800);
      if (state === "fail") return { kind: "failed", code: 2, reason: "exit_code", detail: null };
      if (request.userData) {
        onStage("cleaning");
        await wait(600);
      }
      return {
        kind: "ok",
        dir: MOCK_DIR,
        themePackKept: state !== "installed" && !request.themePack,
        userDataError: state === "datafail" && request.userData
          ? "%LOCALAPPDATA%\\com.slui.desktop：另一个程序正在使用此文件，进程无法访问。 (os error 32)"
          : null,
      };
    },
    startDragging: () => {},
    minimize: () => console.info("slui-uninstall mock: minimize"),
    close: () => console.info("slui-uninstall mock: close"),
  };
}

export const uninstallPlatform: UninstallPlatform = isTauri()
  ? tauriPlatform()
  : mockPlatform(new URLSearchParams(location.search));
