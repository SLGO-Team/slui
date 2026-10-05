import type { ReactNode } from "react";
import {
  HUD_DEBUG_AVAILABILITIES,
  HUD_DEBUG_BACKGROUNDS,
  HUD_DEBUG_CLOCKS,
  HUD_DEBUG_PRESETS,
  HUD_DEBUG_ROUND_STATES,
  type HudDebugOptions,
} from "./hudDebug";
import { HUD_SCENES, HUD_SCENE_LABELS } from "./hudScenes";
import "./HudDebugPanel.css";

type DebugOption<T extends string> = {
  value: T;
  label: string;
};

const VARIANT_OPTIONS = [
  { value: "compact", label: "简洁" },
  { value: "detailed", label: "详细" },
] as const;

const VIEWER_OPTIONS = [
  { value: "team-a", label: "Team A" },
  { value: "team-b", label: "Team B" },
  { value: "spectator", label: "观战" },
] as const;

const ROUND_STATE_LABELS: Readonly<Record<typeof HUD_DEBUG_ROUND_STATES[number], string>> = {
  Idle: "Idle",
  WaitingForPlayers: "等待玩家",
  PreRoundWait: "回合准备",
  BuyPhase: "购买阶段",
  ActionPhase: "行动阶段",
  RoundEnd: "回合结束",
  MatchEnd: "比赛结束",
};

const CLOCK_LABELS: Readonly<Record<typeof HUD_DEBUG_CLOCKS[number], string>> = {
  phase: "阶段",
  generator: "发电机",
  pause: "暂停",
};

const PRESET_LABELS: Readonly<Record<typeof HUD_DEBUG_PRESETS[number], string>> = {
  standard: "标准",
  "all-alive": "全员存活",
  "critical-unknown": "残血 / 未知",
  casualties: "死亡 / 离线",
  "large-roster": "20 人阵容",
};

const AVAILABILITY_LABELS: Readonly<Record<typeof HUD_DEBUG_AVAILABILITIES[number], string>> = {
  live: "Live",
  stale: "Stale",
  offline: "Offline",
  restarted: "Restarted",
  "baseline-required": "待基线",
  "no-match": "无比赛",
};

const BACKGROUND_LABELS: Readonly<Record<typeof HUD_DEBUG_BACKGROUNDS[number], string>> = {
  "1": "背景 1",
  "2": "背景 2",
};

function DebugSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: ReactNode;
  value: T;
  options: readonly DebugOption<T>[];
  onChange(value: T): void;
}) {
  return (
    <label className="hud-debug-panel__field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function HudDebugPanel({
  options,
  onChange,
}: {
  options: HudDebugOptions;
  onChange(options: HudDebugOptions): void;
}) {
  const update = <K extends keyof HudDebugOptions>(key: K, value: HudDebugOptions[K]) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <aside className="hud-debug-panel" aria-label="HUD 调试">
      <div className="hud-debug-panel__title">
        <strong>HUD DEBUG</strong>
        <output>{AVAILABILITY_LABELS[options.availability]}</output>
      </div>
      <div className="hud-debug-panel__controls">
        <DebugSelect
          label="布局"
          value={options.variant}
          options={VARIANT_OPTIONS}
          onChange={(value) => update("variant", value)}
        />
        <DebugSelect
          label="视角"
          value={options.viewerTeam}
          options={VIEWER_OPTIONS}
          onChange={(value) => update("viewerTeam", value)}
        />
        <DebugSelect
          label="回合"
          value={options.roundState}
          options={HUD_DEBUG_ROUND_STATES.map((value) => ({ value, label: ROUND_STATE_LABELS[value] }))}
          onChange={(value) => update("roundState", value)}
        />
        <DebugSelect
          label="计时"
          value={options.clock}
          options={HUD_DEBUG_CLOCKS.map((value) => ({ value, label: CLOCK_LABELS[value] }))}
          onChange={(value) => update("clock", value)}
        />
        <DebugSelect
          label="场景"
          value={options.preset}
          options={HUD_DEBUG_PRESETS.map((value) => ({ value, label: PRESET_LABELS[value] }))}
          onChange={(value) => update("preset", value)}
        />
        <DebugSelect
          label="连接"
          value={options.availability}
          options={HUD_DEBUG_AVAILABILITIES.map((value) => ({ value, label: AVAILABILITY_LABELS[value] }))}
          onChange={(value) => update("availability", value)}
        />
        <DebugSelect
          label="背景"
          value={options.background}
          options={HUD_DEBUG_BACKGROUNDS.map((value) => ({ value, label: BACKGROUND_LABELS[value] }))}
          onChange={(value) => update("background", value)}
        />
        <DebugSelect
          label="提示"
          value={options.hudScene}
          options={HUD_SCENES.map((value) => ({ value, label: HUD_SCENE_LABELS[value] }))}
          onChange={(value) => update("hudScene", value)}
        />
      </div>
    </aside>
  );
}
