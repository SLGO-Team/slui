import { CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TEAM_SELECT } from "../contracts/index.ts";
import type { HudMessageView, HudMessageZoneView } from "../features/hudmessages/model.ts";
import type { GameConditions } from "../platform/gameConditions.ts";

type Conditions = Pick<GameConditions, "elevatedGame" | "exclusiveFullscreen" | "hidesWhenUnfocused">;

/**
 * The features whose SLUI panels take the foreground. While input is blocked (`inputBlockedBy`) the overlay stops
 * claiming them, so the plugin draws its own team menu, opens its in-game shop on its key and shows its chat area;
 * every passive feature (HUD, killfeed, scoreboard, ...) stays with SLUI.
 */
export const INPUT_CLIENT_FEATURES: ReadonlySet<string> = new Set([
  CLIENT_FEATURE_CHAT_INPUT,
  CLIENT_FEATURE_SHOP_MENU,
  CLIENT_FEATURE_TEAM_SELECT,
]);

/** The `client.features` list: none while the overlay is off, `features` without the input features while blocked. */
export function claimedFeatures<F extends string>(features: readonly F[], enabled: boolean, inputBlocked: boolean): readonly F[] {
  if (!enabled) return [];
  return inputBlocked ? features.filter((feature) => !INPUT_CLIENT_FEATURES.has(feature)) : features;
}

export type GameConditionKey = "elevated-game" | "exclusive-fullscreen" | "hides-when-unfocused";

/** The conditions that hold: the elevated one first (it also blocks input in any display mode), the warning last. */
export function activeGameConditions(conditions: Conditions): GameConditionKey[] {
  const keys: GameConditionKey[] = [];
  if (conditions.elevatedGame) keys.push("elevated-game");
  if (conditions.exclusiveFullscreen) keys.push("exclusive-fullscreen");
  if (conditions.hidesWhenUnfocused) keys.push("hides-when-unfocused");
  return keys;
}

// ---- In-game hint: one passive notice per condition per SLUI run, in the message zone's high-hint slot ----

export const CONDITION_HINT_MS = 6_000;

/** Two lines of the 300 px hint box at most. */
export const CONDITION_HINT_TEXTS: Readonly<Record<GameConditionKey, string>> = {
  "elevated-game": "游戏以管理员身份运行，商店、聊天、选队暂用游戏内界面",
  "exclusive-fullscreen": "独占全屏下商店、聊天、选队改用游戏内界面，改为无边框可恢复",
  "hides-when-unfocused": "显示模式「后台时隐藏窗口」会让游戏最小化，请改为「始终可见」",
};

const CONDITION_HINT_KEYS: Readonly<Record<GameConditionKey, string>> = {
  "elevated-game": "SLUI_GameCondition_Elevated",
  "exclusive-fullscreen": "SLUI_GameCondition_ExclusiveFullscreen",
  "hides-when-unfocused": "SLUI_GameCondition_HidesWhenUnfocused",
};

export type ConditionHint = Readonly<{ condition: GameConditionKey; shownAtMs: number; expiresAtMs: number }>;

/** The next condition whose hint has not been shown this run, or null. */
export function nextConditionHint(conditions: Conditions, shown: ReadonlySet<GameConditionKey>): GameConditionKey | null {
  return activeGameConditions(conditions).find((key) => !shown.has(key)) ?? null;
}

export function startConditionHint(condition: GameConditionKey, nowMs: number): ConditionHint {
  return { condition, shownAtMs: nowMs, expiresAtMs: nowMs + CONDITION_HINT_MS };
}

/**
 * The message zone with the hint in the high-hint slot while it runs and the plugin's own high hint is empty: the
 * plugin's message always wins the slot.
 */
export function withConditionHint(zone: HudMessageZoneView, hint: ConditionHint | null, nowMs: number): HudMessageZoneView {
  if (hint === null || zone.hintHigh !== null || nowMs < hint.shownAtMs || nowMs >= hint.expiresAtMs) return zone;
  const view: HudMessageView = {
    slot: "hint_high",
    id: `slui-${hint.condition}`,
    key: CONDITION_HINT_KEYS[hint.condition],
    text: CONDITION_HINT_TEXTS[hint.condition],
    tone: "default",
    flash: null,
    shownAtMs: hint.shownAtMs,
    expiresAtMs: hint.expiresAtMs,
  };
  return { ...zone, hintHigh: view };
}

// ---- Home banners ----

export type RelaunchState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "cancelled" }
  | { phase: "failed"; reason: string };

export const RELAUNCH_IDLE: RelaunchState = { phase: "idle" };

export type GameConditionBanner = Readonly<{
  condition: GameConditionKey;
  title: string;
  detail: string;
  /** The elevated banner's relaunch button; `busy` while the UAC prompt is up. */
  action: Readonly<{ label: string; busy: boolean }> | null;
}>;

export const RELAUNCH_LABEL = "以管理员身份重启 SLUI";

function elevatedDetail(relaunch: RelaunchState): string {
  switch (relaunch.phase) {
    case "busy":
      return "请在 Windows 弹出的提示中允许 SLUI 以管理员身份运行。";
    case "cancelled":
      return "已取消以管理员身份重启。商店、聊天和选队仍使用游戏内界面。";
    case "failed":
      return `无法以管理员身份重启：${relaunch.reason}`;
    case "idle":
      return "SLUI 收不到游戏中的按键，商店、聊天和选队已改用游戏内界面。以管理员身份重启 SLUI 即可恢复。";
  }
}

function banner(condition: GameConditionKey, relaunch: RelaunchState): GameConditionBanner {
  switch (condition) {
    case "elevated-game":
      return {
        condition,
        title: "游戏以管理员身份运行",
        detail: elevatedDetail(relaunch),
        action: { label: RELAUNCH_LABEL, busy: relaunch.phase === "busy" },
      };
    case "exclusive-fullscreen":
      return {
        condition,
        title: "游戏使用独占全屏",
        detail: "独占全屏下 SLUI 的商店、聊天和选队会让游戏最小化，已改用游戏内界面。在游戏设置中把显示模式改为「无边窗口化 - 始终可见」或「窗口化」即可恢复。",
        action: null,
      };
    case "hides-when-unfocused":
      return {
        condition,
        title: "打开商店时游戏会最小化",
        detail: "游戏的显示模式是「无边窗口化 - 后台时隐藏窗口」，SLUI 的商店、聊天和选队一打开，游戏就会最小化。在游戏设置中把显示模式改为「无边窗口化 - 始终可见」即可。",
        action: null,
      };
  }
}

/** One banner per condition that holds, in `activeGameConditions` order. */
export function gameConditionBanners(conditions: Conditions, relaunch: RelaunchState): GameConditionBanner[] {
  return activeGameConditions(conditions).map((condition) => banner(condition, relaunch));
}
