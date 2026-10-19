// Pure view model of the update state: the home window's version tile and the server status
// while an update is required. scripts/update-model-smoke.mjs runs it under node.
import type { SessionStatusSnapshot } from "../platform/desktop.ts";
import type { UpdateFailReason, UpdatePhase, UpdateState } from "../platform/updater.ts";
import { serverStatus, type ServerStatus, type Tone } from "./home/status.ts";

export type UpdateAction = "install" | "retry";

export type UpdateTile = { tone: Tone; value: string; detail: string | null; action: UpdateAction | null };

const FAILURE_TEXT: Record<UpdateFailReason, string> = {
  network: "检查更新失败",
  signature: "更新文件校验失败",
  launch: "无法启动安装程序",
};

const LOADING: UpdateTile = { tone: "muted", value: "正在获取…", detail: null, action: null };

function downloadText(phase: Extract<UpdatePhase, { kind: "downloading" }>): string {
  if (!phase.total) return `正在下载 ${phase.version}`;
  const percent = Math.min(100, Math.floor((phase.received / phase.total) * 100));
  return `正在下载 ${phase.version} · ${percent}%`;
}

/** The detail line and action for phases that read the same whether or not the update is required. */
function progress(phase: UpdatePhase): { detail: string; action: UpdateAction | null } | null {
  switch (phase.kind) {
    case "checking":
      return { detail: "正在检查更新…", action: null };
    case "downloading":
      return { detail: downloadText(phase), action: null };
    case "installing":
      return { detail: "正在启动安装程序…", action: null };
    case "failed":
      return { detail: FAILURE_TEXT[phase.reason], action: "retry" };
    case "idle":
    case "ready":
      return null;
  }
}

export function updateTile(state: UpdateState | null): UpdateTile {
  if (!state) return LOADING;
  const { phase, required } = state;
  if (required) {
    if (phase.kind === "ready") return { tone: "error", value: "需要更新", detail: `${phase.version} 已下载`, action: "install" };
    const running = progress(phase);
    return { tone: "error", value: "需要更新", detail: running?.detail ?? `需要 ${required} 或更高版本`, action: running?.action ?? null };
  }
  switch (phase.kind) {
    case "idle":
      return state.lastChecked === null
        ? { tone: "muted", value: state.current, detail: "尚未检查更新", action: null }
        : { tone: "ok", value: state.current, detail: "已是最新版本", action: null };
    case "ready":
      return { tone: "warn", value: `${phase.version} 可用`, detail: `当前版本 ${state.current}`, action: "install" };
    case "failed": {
      const failed = progress(phase);
      // Quiet: an unreachable update server is not an error the player has to act on.
      return { tone: "muted", value: state.current, detail: failed?.detail ?? null, action: failed?.action ?? null };
    }
    case "checking":
    case "downloading":
    case "installing":
      return { tone: "pending", value: state.current, detail: progress(phase)?.detail ?? null, action: null };
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
