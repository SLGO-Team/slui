import type {
  HudMessagesSnapshot,
  HudProgressMessage,
  HudSlotMessage,
  HudTone,
  Role,
  RoundResultMvp,
  RoundResultOutcome,
  RoundResultPanel,
  RoundResultSnapshot,
} from "../contracts/index.ts";

/**
 * Scripted `hud.messages` / `round.result` states for the mock provider, one per state captured from CS2
 * (`.trellis/tasks/10-05-cs2-hud-panels/research/cs2-reference-capture.md`). Texts are what the plugin's
 * `HudMessageCatalog` resolves (SLGO nouns: NTF / SCP / 发电机); keys and tones follow `HudMessages`.
 * Selected with the `hudScene=` URL parameter in the HUD debug build only.
 */
export const HUD_SCENES = [
  "none",
  "win-mvp-kills",
  "win-mvp-ace",
  "win-no-mvp",
  "lost",
  "match-won",
  "match-draw",
  "observer",
  "warmup",
  "match-point",
  "final-round",
  "pause-high-hint",
  "timeout",
  "hint-low-keycard",
  "hint-low-dropped",
  "generator-started",
  "generator-start-progress",
  "generator-shutdown-progress",
  "all-slots",
] as const;
export type HudScene = typeof HUD_SCENES[number];

export const HUD_SCENE_LABELS: Readonly<Record<HudScene, string>> = {
  none: "无",
  "win-mvp-kills": "胜利 + 最多击杀 MVP",
  "win-mvp-ace": "胜利 + 王牌 MVP",
  "win-no-mvp": "胜利 无 MVP",
  lost: "败北",
  "match-won": "比赛胜利",
  "match-draw": "比赛平局",
  observer: "观察者",
  warmup: "热身倒计时",
  "match-point": "赛点",
  "final-round": "最终局",
  "pause-high-hint": "暂停 + 高优先级",
  timeout: "暂停倒计时",
  "hint-low-keycard": "低优先级 钥匙卡",
  "hint-low-dropped": "低优先级 丢弃",
  "generator-started": "发电机已启动 + 过载倒计时",
  "generator-start-progress": "启动发电机进度",
  "generator-shutdown-progress": "关闭发电机进度",
  "all-slots": "四槽同时",
};

export function readHudScene(value: string | null): HudScene {
  return value !== null && (HUD_SCENES as readonly string[]).includes(value) ? value as HudScene : "none";
}

/** Plugin `UIConstants.RoundResultAnim.HoldDuration`. */
const RESULT_HOLD_MS = 7_000;
/** Plugin `HintHigh` / `HintLow` lifetimes. */
const HINT_HIGH_MS = 3_000;
const HINT_LOW_MS = 6_000;
/** Plugin generator-started hint lifetime and overload delay. */
const GENERATOR_STARTED_MS = 6_000;
const GENERATOR_OVERLOAD_MS = 40_000;
/** Pause before a finished scene starts over, so previews keep showing it. */
const LOOP_GAP_MS = 1_500;

type SlotName = keyof HudMessagesSnapshot;

/** A message from `startMs` (default 0) into the scene; its times count down from there. */
type ScriptedMessage = {
  startMs?: number;
  key: string;
  text: string;
  tone: HudTone;
  visibleMs: number | null;
  countdownMs?: number;
  progress?: { remainingMs: number; totalMs: number };
};

type ScriptedPanel = {
  winner: "viewer" | "opponent" | "ntf" | null;
  isMatchEnd: boolean;
  title: string;
  outcome: RoundResultOutcome;
  subtitle: string | null;
  mvp: "viewer-team" | "winner" | null;
  mvpReason?: string;
  musicKit?: string | null;
};

/** One message, or messages that follow each other in the slot (each from its `startMs`). */
type SlotScript = ScriptedMessage | readonly ScriptedMessage[];

type SceneScript = {
  messages?: Partial<Record<SlotName, SlotScript>>;
  panel?: ScriptedPanel;
};

const otherRole = (role: Role): Role => role === "ntf" ? "scp" : "ntf";
const sideName = (role: Role) => role === "ntf" ? "NTF" : "SCP";

/** Mock roster players (see provider.ts) that the avatar lookup in match.snapshot can find. */
const MVP_BY_ROLE: Readonly<Record<Role, { player_id: string; display_name: string }>> = {
  ntf: { player_id: "76561198000000001", display_name: "Nova" },
  scp: { player_id: "76561198000000006", display_name: "Rook" },
};

const generatorEndReason = (winner: Role) => winner === "ntf" ? "发电机已过载" : "发电机已被关闭";

function sceneScript(scene: HudScene, viewerRole: Role): SceneScript {
  const opponent = otherRole(viewerRole);
  switch (scene) {
    case "none": return {};
    case "win-mvp-kills": return { panel: { winner: "viewer", isMatchEnd: false, title: "回合胜利", outcome: "won", subtitle: generatorEndReason(viewerRole), mvp: "winner", mvpReason: "最多击杀MVP（3杀）", musicKit: "收容失效" } };
    case "win-mvp-ace": return { panel: { winner: "viewer", isMatchEnd: false, title: "回合胜利", outcome: "won", subtitle: `${sideName(opponent)}已被消灭`, mvp: "winner", mvpReason: "回合王牌MVP", musicKit: null } };
    case "win-no-mvp": return { panel: { winner: "viewer", isMatchEnd: false, title: "回合胜利", outcome: "won", subtitle: generatorEndReason(viewerRole), mvp: null } };
    // The CS2 capture of a lost round shows no MVP strip.
    case "lost": return { panel: { winner: "opponent", isMatchEnd: false, title: "回合败北", outcome: "lost", subtitle: generatorEndReason(opponent), mvp: null } };
    case "match-won": return { panel: { winner: "viewer", isMatchEnd: true, title: "比赛胜利", outcome: "won", subtitle: "比赛结束", mvp: "winner", mvpReason: "最多击杀MVP（4杀）", musicKit: "收容失效" } };
    case "match-draw": return { panel: { winner: null, isMatchEnd: true, title: "平局", outcome: "draw", subtitle: "比赛结束", mvp: null } };
    case "observer": return { panel: { winner: "ntf", isMatchEnd: false, title: "NTF获胜", outcome: "observer", subtitle: "SCP已被消灭", mvp: "winner", mvpReason: "最多击杀MVP（3杀）", musicKit: null } };
    case "warmup": return { messages: { alert: { key: "CSGO_Notice_Alert_Warmup_Period", text: "热身时间 {time_remaining}", tone: "default", visibleMs: null, countdownMs: 45_000 } } };
    case "match-point": return { messages: { alert: { key: "SFUI_Notice_Alert_Match_Point", text: "赛点", tone: "match_point", visibleMs: 5_000 } } };
    case "final-round": return { messages: { alert: { key: "SFUI_Notice_Alert_Final_Round", text: "最终局", tone: "final_round", visibleMs: 5_000 } } };
    case "pause-high-hint": return { messages: {
      alert: { key: "CSGO_Notice_Alert_Timeout", text: `${sideName(viewerRole)} 队暂停还剩 {time_remaining}`, tone: "info", visibleMs: null, countdownMs: 30_000 },
      hint_high: { key: "SLGO_BuyMenu_Unavailable", text: "当前无法购买", tone: "warning", visibleMs: HINT_HIGH_MS },
    } };
    case "timeout": return { messages: { alert: { key: "CSGO_Notice_Alert_Timeout", text: `${sideName(opponent)} 队暂停还剩 {time_remaining}`, tone: "info", visibleMs: null, countdownMs: 58_000 } } };
    case "hint-low-keycard": return { messages: { hint_low: { key: "SLGO_Notice_Got_Commander_Keycard", text: "你捡起了指挥官钥匙卡。", tone: "gold", visibleMs: HINT_LOW_MS } } };
    case "hint-low-dropped": return { messages: { hint_low: { key: "SFUI_Notice_YouDroppedWeapon", text: "您已扔掉 E-11 SR", tone: "default", visibleMs: HINT_LOW_MS } } };
    // CS2's "bomb planted" two-liner is a high hint; the plugin shows it for 6 s, then the standing
    // overload countdown takes the slot until the generator overloads (40 s after the start).
    case "generator-started": return { messages: { hint_high: [
      { key: "SLGO_Notice_Generator_Started", text: "发电机已被启动。\n离过载还剩 40 秒。", tone: "warning", visibleMs: GENERATOR_STARTED_MS },
      {
        startMs: GENERATOR_STARTED_MS,
        key: "SLGO_Notice_Generator_Overload_Countdown",
        text: "离过载还剩 {seconds_remaining} 秒",
        tone: "warning",
        visibleMs: null,
        countdownMs: GENERATOR_OVERLOAD_MS - GENERATOR_STARTED_MS,
      },
    ] } };
    case "generator-start-progress": return { messages: { progress: { key: "SLGO_Progress_Generator_Start", text: "你正在启动发电机。", tone: "default", visibleMs: null, progress: { remainingMs: 10_000, totalMs: 10_000 } } } };
    case "generator-shutdown-progress": return { messages: { progress: { key: "SLGO_Progress_Generator_Shutdown", text: "你正在关闭发电机。", tone: "default", visibleMs: null, progress: { remainingMs: 7_000, totalMs: 7_000 } } } };
    case "all-slots": return { messages: {
      progress: { key: "SLGO_Progress_Generator_Shutdown", text: "你正在关闭发电机。", tone: "default", visibleMs: null, progress: { remainingMs: 7_000, totalMs: 7_000 } },
      alert: { key: "SFUI_Notice_Alert_Match_Point", text: "赛点", tone: "match_point", visibleMs: null },
      hint_high: { key: "SFUI_BuyMenu_YoureOutOfTime", text: "你的购买时间已过", tone: "warning", visibleMs: null },
      hint_low: { key: "SLGO_Notice_Got_Commander_Keycard", text: "你捡起了指挥官钥匙卡。", tone: "gold", visibleMs: null },
    } };
  }
}

/** When a scripted message leaves the board on its own (expiry, countdown or progress end), from scene start; null = never. */
function messageEndMs(message: ScriptedMessage): number | null {
  const ends = [message.visibleMs, message.countdownMs, message.progress?.remainingMs]
    .filter((value): value is number => value !== undefined && value !== null);
  return ends.length > 0 ? (message.startMs ?? 0) + Math.min(...ends) : null;
}

const slotMessages = (script: SlotScript): readonly ScriptedMessage[] => Array.isArray(script) ? script : [script as ScriptedMessage];

/** Length of one scene run before it starts over, or null for a scene that never changes on its own. */
export function hudSceneLoopMs(scene: HudScene, viewerRole: Role): number | null {
  const script = sceneScript(scene, viewerRole);
  const ends = [
    ...Object.values(script.messages ?? {}).flatMap((slot) => slotMessages(slot).map(messageEndMs)),
    script.panel ? RESULT_HOLD_MS : null,
  ].filter((value): value is number => value !== null);
  return ends.length > 0 ? Math.max(...ends) + LOOP_GAP_MS : null;
}

const remaining = (startMs: number, elapsedMs: number) => Math.max(0, Math.round(startMs - elapsedMs));

function messageAt(scene: HudScene, slot: SlotName, script: SlotScript, sceneElapsedMs: number, run: number): HudSlotMessage | HudProgressMessage | null {
  // The latest message that has started; a following one replaces it.
  const started = slotMessages(script).filter((candidate) => (candidate.startMs ?? 0) <= sceneElapsedMs);
  const message = started[started.length - 1];
  if (!message) return null;
  const end = messageEndMs(message);
  if (end !== null && sceneElapsedMs >= end) return null;
  const elapsedMs = sceneElapsedMs - (message.startMs ?? 0);
  const timed = message.countdownMs !== undefined || message.progress !== undefined;
  // Like the plugin board, a countdown or progress rewrite is a new write with a new id.
  const id = `${scene}-${run}-${slot}-${started.length}${timed ? `-${Math.floor(elapsedMs / 1000)}` : ""}`;
  const base: HudSlotMessage = {
    message_id: id,
    key: message.key,
    text: message.text,
    tone: message.tone,
    visible_remaining_ms: message.visibleMs === null ? null : remaining(message.visibleMs, elapsedMs),
    countdown_remaining_ms: message.countdownMs === undefined ? null : remaining(message.countdownMs, elapsedMs),
  };
  if (!message.progress) return base;
  return { ...base, progress: { remaining_ms: remaining(message.progress.remainingMs, elapsedMs), total_ms: message.progress.totalMs } };
}

function panelAt(scene: HudScene, panel: ScriptedPanel, viewerRole: Role, elapsedMs: number, run: number): RoundResultPanel | null {
  if (elapsedMs >= RESULT_HOLD_MS) return null;
  const winner: Role | null = panel.winner === "viewer" ? viewerRole
    : panel.winner === "opponent" ? otherRole(viewerRole)
      : panel.winner;
  const mvpPlayer = panel.mvp === null || winner === null ? null : MVP_BY_ROLE[winner];
  const mvp: RoundResultMvp | null = mvpPlayer
    ? { ...mvpPlayer, reason_text: panel.mvpReason ?? "MVP", music_kit_name: panel.musicKit ?? null }
    : null;
  return {
    result_id: `${scene}-${run}`,
    winner_team: winner,
    is_match_end: panel.isMatchEnd,
    title: { text: panel.title, outcome: panel.outcome },
    subtitle_text: panel.subtitle,
    mvp,
    visible_remaining_ms: remaining(RESULT_HOLD_MS, elapsedMs),
  };
}

export type HudSceneFrame = { messages: HudMessagesSnapshot; result: RoundResultSnapshot };

/**
 * The plugin's view of a scene `elapsedMs` into run number `run`: expired messages and the finished panel are
 * gone, remaining times count down. Pure, so previews and tests can pin any moment.
 */
export function createHudSceneFrame(scene: HudScene, viewerRole: Role, elapsedMs: number, run = 0): HudSceneFrame {
  const script = sceneScript(scene, viewerRole);
  const slot = (name: SlotName) => {
    const message = script.messages?.[name];
    return message ? messageAt(scene, name, message, elapsedMs, run) : null;
  };
  return {
    messages: {
      progress: slot("progress") as HudProgressMessage | null,
      alert: slot("alert"),
      hint_high: slot("hint_high"),
      hint_low: slot("hint_low"),
    },
    result: { panel: script.panel ? panelAt(scene, script.panel, viewerRole, elapsedMs, run) : null },
  };
}
