import { useEffect, useId, useState } from "react";
import { RADAR_NUMERIC_RANGES, type RadarPreferences } from "../../features/minimap/preferences";
import { RangeInput, SettingRow, SettingsGroup, Switch } from "./controls";

type BooleanKey = "alwaysCentered" | "mapBlend" | "blurBackground" | "squareWithScoreboard" | "forceSquare" | "dynamicZoom";
type NumericKey = keyof typeof RADAR_NUMERIC_RANGES;

type Row =
  | { kind: "boolean"; key: BooleanKey; label: string; note?: string }
  | { kind: "number"; key: NumericKey; label: string }
  | { kind: "orientation"; label: string };

// Order and names follow the in-game radar settings group.
const ROWS: readonly Row[] = [
  { kind: "boolean", key: "alwaysCentered", label: "雷达保持玩家居中" },
  { kind: "orientation", label: "雷达方向" },
  { kind: "boolean", key: "mapBlend", label: "雷达地图与背景融合" },
  { kind: "boolean", key: "blurBackground", label: "模糊背景",
    note: "透明 UI 窗口无法读取背后的游戏画面，此项在游戏内暂不产生效果。" },
  { kind: "number", key: "backgroundAlpha", label: "雷达背景透明度" },
  { kind: "number", key: "hudScale", label: "雷达 HUD 大小" },
  { kind: "number", key: "mapScale", label: "雷达地图缩放" },
  { kind: "number", key: "alternateMapScale", label: "雷达地图切换缩放" },
  { kind: "boolean", key: "squareWithScoreboard", label: "打开计分板时使用方形外观" },
  { kind: "boolean", key: "forceSquare", label: "强制方形外观" },
  { kind: "boolean", key: "dynamicZoom", label: "雷达动态缩放" },
];

const STEP = 0.01;
const format = (value: number) => value.toFixed(2);

function NumberControl({ id, value, range, onChange }: {
  id: string;
  value: number;
  range: readonly [number, number];
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(format(value));
  useEffect(() => setDraft(format(value)), [value]);
  // Typed values are committed on blur/Enter so partial input like "1." is not rejected mid-edit.
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) onChange(Math.min(range[1], Math.max(range[0], parsed)));
    else setDraft(format(value));
  };
  return <div className="home-number">
    <RangeInput id={id} min={range[0]} max={range[1]} step={STEP} value={value} onChange={onChange} />
    <input type="text" inputMode="decimal" className="home-number__box" aria-label="数值" value={draft}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") commit(); }} />
  </div>;
}

export function RadarSettings({ id, value, saveError, onChange, onReset }: {
  id: string;
  value: RadarPreferences;
  saveError: string | null;
  onChange(next: RadarPreferences): void;
  onReset(): void;
}) {
  const baseId = useId();
  const set = <K extends keyof RadarPreferences>(key: K, next: RadarPreferences[K]) => onChange({ ...value, [key]: next });
  return <SettingsGroup id={id} title="雷达" eyebrow="RADAR" onReset={onReset}>
    {saveError ? <p className="home-error" role="alert">设置保存失败：{saveError}。修改已在本次运行中生效，下次修改时会重试保存。</p> : null}
    {ROWS.map((row) => {
      const rowId = `${baseId}-${row.kind === "orientation" ? "orientation" : row.key}`;
      return <SettingRow key={rowId} htmlFor={rowId} label={row.label} note={row.kind === "boolean" ? row.note : undefined}>
        {row.kind === "boolean" ? <Switch id={rowId} checked={value[row.key]} onChange={(next) => set(row.key, next)} /> : null}
        {row.kind === "number" ? <NumberControl id={rowId} value={value[row.key]} range={RADAR_NUMERIC_RANGES[row.key]}
          onChange={(next) => set(row.key, next)} /> : null}
        {row.kind === "orientation" ? <select id={rowId} className="home-select" value={value.orientation}
          onChange={(event) => set("orientation", event.target.value === "heading-up" ? "heading-up" : "fixed")}>
          <option value="fixed">固定方向</option>
          <option value="heading-up">跟随视角旋转</option>
        </select> : null}
      </SettingRow>;
    })}
  </SettingsGroup>;
}
