// Pure view model of the update state: the title bar's update button, the settings page's
// 关于 row, the home banner while an update is required, and the server status meanwhile.
// scripts/update-model-smoke.mjs runs it under node.
import type { SessionStatusSnapshot } from "../platform/desktop.ts";
import type { UpdateFailReason, UpdatePhase, UpdateState } from "../platform/updater.ts";
import { serverStatus, type ServerStatus, type Tone } from "./home/status.ts";

/** `install` runs a ready update; `check` checks now (also the retry after a failure). */
export type UpdateAction = "install" | "check";

const FAILURE_TEXT: Record<UpdateFailReason, string> = {
  network: "检查更新失败",
  signature: "更新文件校验失败",
  launch: "无法启动安装程序",
};

function downloadText(phase: Extract<UpdatePhase, { kind: "downloading" }>): string {
  if (!phase.total) return `正在下载 ${phase.version}`;
  const percent = Math.min(100, Math.floor((phase.received / phase.total) * 100));
  return `正在下载 ${phase.version} · ${percent}%`;
}

/** Title bar button: shown only once an update can be installed (or is starting). */
export type TitleBarUpdate = { label: string; busy: boolean };

export function titleBarUpdate(state: UpdateState | null): TitleBarUpdate | null {
  switch (state?.phase.kind) {
    case "ready":
      return { label: `更新到 ${state.phase.version}`, busy: false };
    case "installing":
      return { label: "正在启动更新…", busy: true };
    default:
      return null;
  }
}

/** The 关于 row in settings: running version, update status and its one action. */
export type AboutUpdate = { version: string; tone: Tone; status: string; action: UpdateAction; busy: boolean };

export function aboutUpdate(state: UpdateState | null): AboutUpdate {
  if (!state) return { version: "…", tone: "muted", status: "正在获取…", action: "check", busy: true };
  const row = (tone: Tone, status: string, action: UpdateAction = "check", busy = false): AboutUpdate =>
    ({ version: state.current, tone, status, action, busy });
  const { phase } = state;
  switch (phase.kind) {
    case "idle":
      return state.lastChecked === null ? row("muted", "尚未检查更新") : row("ok", "已是最新版本");
    case "checking":
      return row("pending", "正在检查更新…", "check", true);
    case "downloading":
      return row("pending", downloadText(phase), "check", true);
    case "ready":
      return row("warn", `${phase.version} 已下载，重启后完成更新`, "install");
    case "installing":
      return row("pending", "正在启动安装程序…", "install", true);
    case "failed":
      // Quiet: an unreachable update server is not an error the player has to act on.
      return row("muted", FAILURE_TEXT[phase.reason]);
  }
}

/** Home banner while the running version is below the manifest's min_version. */
export type RequiredBanner = { title: string; detail: string | null; action: UpdateAction | null; busy: boolean };

export function requiredBanner(state: UpdateState | null): RequiredBanner | null {
  if (!state?.required) return null;
  const title = `需要更新到 ${state.required} 才能连接服务器`;
  const { phase } = state;
  switch (phase.kind) {
    case "ready":
      return { title, detail: `${phase.version} 已下载`, action: "install", busy: false };
    case "installing":
      return { title, detail: "正在启动安装程序…", action: "install", busy: true };
    case "downloading":
      return { title, detail: downloadText(phase), action: null, busy: false };
    case "checking":
      return { title, detail: "正在检查更新…", action: null, busy: false };
    case "failed":
      return { title, detail: FAILURE_TEXT[phase.reason], action: "check", busy: false };
    case "idle":
      return { title, detail: null, action: null, busy: false };
  }
}

/** The SLUI version that must be installed before connecting, if any. */
export function requiredUpdate(state: UpdateState | null): string | null {
  return state?.required ?? null;
}

/** The server status shown in the home window; a required update replaces the session's own. */
export function homeServerStatus(session: SessionStatusSnapshot | null, update: UpdateState | null): ServerStatus {
  const required = requiredUpdate(update);
  if (required) return { label: "需要更新", tone: "error", retry: false, hint: "更新后才能连接" };
  return serverStatus(session);
}

/** Session detail while the overlay holds the session back for a required update. */
export function updateRequiredDetail(required: string): string {
  return `SLUI ${required} or newer is required`;
}
