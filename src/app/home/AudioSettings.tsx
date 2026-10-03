import { useId } from "react";
import type { AudioSettings as Audio } from "../../platform/audioSettings";
import { RangeInput, SettingRow, SettingsGroup } from "./controls";

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function AudioSettings({ id, value, onChange, onReset }: {
  id: string;
  value: Audio;
  onChange(next: Audio): void;
  onReset(): void;
}) {
  const baseId = useId();
  return <SettingsGroup id={id} title="声音" eyebrow="AUDIO" onReset={onReset}>
    <SettingRow htmlFor={`${baseId}-shop`} label="商店音效音量" note="100% 为 CS2 购买菜单原始音量。">
      <div className="home-number">
        <RangeInput id={`${baseId}-shop`} min={0} max={100} step={1} value={Math.round(value.shopVolume * 100)}
          onChange={(next) => onChange({ ...value, shopVolume: next / 100 })} />
        <output className="home-number__box" htmlFor={`${baseId}-shop`}>{percent(value.shopVolume)}</output>
      </div>
    </SettingRow>
  </SettingsGroup>;
}
