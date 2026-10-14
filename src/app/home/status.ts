import type { ConnectionStatus, InstanceEndReason } from "../../contracts";
import type { SessionStatusSnapshot } from "../../platform/desktop";

export type Tone = "ok" | "pending" | "warn" | "error" | "muted";

/** `hint` replaces the raw (English) failure detail where the state is expected rather than an error. */
export type ServerStatus = { label: string; tone: Tone; retry: boolean; hint?: string };

export const SERVER_STATUS: Record<ConnectionStatus, ServerStatus> = {
  "live": { label: "已连接", tone: "ok", retry: false },
  "baseline-required": { label: "同步中", tone: "pending", retry: false },
  "connecting": { label: "连接中", tone: "pending", retry: false },
  "route-pending": { label: "查找服务器", tone: "pending", retry: false },
  "discovering": { label: "识别账号", tone: "pending", retry: false },
  "signed-out": { label: "未连接", tone: "muted", retry: true },
  "offline": { label: "未连接", tone: "error", retry: true },
  // Opening the client before joining a server is the normal order; the session keeps polling.
  "not-in-game": { label: "等待中", tone: "pending", retry: false, hint: "等待进入游戏服务器" },
  "stale": { label: "数据过期", tone: "warn", retry: true },
  // Without a reason (older sidecar): a restart is the common case. See ENDED_STATUS for the reasons.
  "ended": { label: "正在重启", tone: "pending", retry: false, hint: "服务器重启后自动重连" },
  "incompatible": { label: "版本不兼容", tone: "error", retry: true },
  "unauthorized": { label: "未授权", tone: "error", retry: true },
};

/** `ended` by the reason in the sidecar's `instance.ended`; the session reroutes by itself in every case. */
export const ENDED_STATUS: Record<InstanceEndReason, ServerStatus> = {
  "round-restart": SERVER_STATUS.ended,
  "server-restart": SERVER_STATUS.ended,
  "server-shutdown": { label: "服务器已关闭", tone: "muted", retry: false, hint: "等待服务器重新上线" },
  "server-stopped": { label: "服务器已停止", tone: "muted", retry: false, hint: "等待服务器重新上线" },
  "plugin-disabled": { label: "SLGO 已停用", tone: "muted", retry: false, hint: "等待服务器重新启用 SLGO" },
  "lost": { label: "服务器失联", tone: "warn", retry: false, hint: "等待服务器恢复连接" },
};

const SERVER_LOADING: ServerStatus = { label: "正在获取…", tone: "muted", retry: false };

export function serverStatus(session: SessionStatusSnapshot | null): ServerStatus {
  if (!session) return SERVER_LOADING;
  if (session.status === "ended" && session.endReason) return ENDED_STATUS[session.endReason];
  return SERVER_STATUS[session.status];
}
