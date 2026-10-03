import type { ConnectionStatus } from "../../contracts";
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
  "incompatible": { label: "版本不兼容", tone: "error", retry: true },
  "unauthorized": { label: "未授权", tone: "error", retry: true },
};

const SERVER_LOADING: ServerStatus = { label: "正在获取…", tone: "muted", retry: false };

export const serverStatus = (session: SessionStatusSnapshot | null): ServerStatus => session ? SERVER_STATUS[session.status] : SERVER_LOADING;
