// Text formatting for the replay console and catalog (no layout: the components come from the CS2 captures).

/** `m:ss`, or `m:ss.d` with tenths (the drag label); hours roll into minutes like CS2's demo time label. */
export function formatReplayTime(ms: number, tenths = false): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalTenths = Math.floor(safe / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const base = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  return tenths ? `${base}.${totalTenths % 10}` : base;
}

/** `0.25×`, `1×`, `4×`. */
export function formatReplaySpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/** The first 8 characters of a match id (status lines: "正在加载 01a1e2db…"). */
export const shortMatchId = (matchId: string) => matchId.slice(0, 8);

const pad = (value: number) => value.toString().padStart(2, "0");

/** A match start in local time, `YYYY-MM-DD HH:mm`; the raw text when unparseable. */
export function formatCatalogStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A catalog duration (`null` = no footer yet). */
export const formatCatalogDuration = (ms: number | null) => ms === null ? "—" : formatReplayTime(ms);

/** "第 x / y 页，共 n 条". */
export const formatCatalogPage = (page: number, pageCount: number, total: number) => `第 ${page} / ${pageCount} 页，共 ${total} 条`;

/** The round label of the control row: the round number, or 热身 before the first round. */
export const formatReplayRound = (round: number | null, warmup: boolean) => round !== null ? `第 ${round} 回合` : warmup ? "热身" : "—";

/** CS2's time label (`TicksToTimeText`): whole seconds, both parts two digits ("00:42 / 21:01"). */
export function formatDemoTime(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1_000);
  const minutes = Math.floor(total / 60);
  return `${minutes.toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * The speed slider's stops (CS2 `speedStops` [0, 0.1, 0.25, 0.5, 1, 2, 4] without 0.1, below the protocol's 0.25):
 * stop 0 is pause.
 */
export const REPLAY_SPEED_STOPS = [0, 0.25, 0.5, 1, 2, 4] as const;
export const REPLAY_SPEED_STOP_NORMAL = REPLAY_SPEED_STOPS.indexOf(1);

/** CS2 `TimeScaleToSpeedStop`: the nearest stop of a running speed (never the pause stop). */
export function speedStopFor(speed: number): number {
  let best = 1;
  for (let index = 2; index < REPLAY_SPEED_STOPS.length; index += 1) {
    if (Math.abs(REPLAY_SPEED_STOPS[index] - speed) < Math.abs(REPLAY_SPEED_STOPS[best] - speed)) best = index;
  }
  return best;
}

/** CS2 `SpeedToText`: 「已暂停」 at 0, else "1x", "0.25x". */
export const formatSpeedLabel = (speed: number) => speed === 0 ? REPLAY_TEXT.paused : `${parseFloat(speed.toFixed(4))}x`;

/** CS2's current Simplified Chinese strings (`CSGO_Demo_*`, `tooltip_demo_*`); the step is SLGO's 10 s (PRD R12). */
export const REPLAY_TEXT = {
  paused: "已暂停",
  timeLabel: "时间：",
  round: "回合：",
  roundStart: "回合开始",
  actionStart: "动作开始",
  playerNone: "无玩家",
  cameraFirstPerson: "第一人称",
  cameraFree: "自由视角",
  quit: "退出",
  quitConfirm: "确认退出？",
  minusSeconds: (seconds: number) => `-${seconds}秒`,
  plusSeconds: (seconds: number) => `+${seconds}秒`,
  tooltip: {
    play: "以1倍速恢复播放",
    pause: "暂停播放",
    stepBackward: (seconds: number) => `快退 ${seconds} 秒`,
    stepForward: (seconds: number) => `快进 ${seconds} 秒`,
    roundPrev: "快退至上一回合",
    roundNext: "快进至下一回合",
    playerList: "选择要观战的玩家",
    playerPrev: "上一名玩家",
    playerNext: "下一名玩家",
    nextEvent: "跳转到任意玩家的下一次击杀",
    cameraMode: "切换镜头模式",
    endPlayback: "结束回放",
    // SLGO's own (CS2's highlights button takes this place).
    catalog: "录像列表",
    endPlaybackAll: "结束回放（所有观众）",
  },
  // SLGO's own status lines (CS2 has none).
  noDemo: "未加载录像",
  loading: (matchId: string) => `正在加载 ${shortMatchId(matchId)}…`,
  loadFailed: (matchId: string, reason: string) => `加载 ${shortMatchId(matchId)} 失败：${reason}`,
  recording: "录制中快照",
  testMatch: "测试局",
} as const;
