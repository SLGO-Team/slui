import { useId } from "react";
import type { WorldBlurStrength } from "../../platform/backdrop";
import type { OverlaySettings as Overlay } from "../../platform/overlaySettings";
import { RangeInput, SettingRow, SettingsGroup, Switch } from "./controls";

export function SystemSettings({ id, value, onChange, onReset }: {
  id: string;
  value: Overlay;
  onChange(next: Overlay): void;
  onReset(): void;
}) {
  const baseId = useId();
  return <SettingsGroup id={id} title="系统" eyebrow="SYSTEM" onReset={onReset}>
    <SettingRow htmlFor={`${baseId}-auto`} label="连接服务器后自动启用 UI"
      note="每次连接到游戏服务器时自动启用；连接期间手动停用后，下次连接前不会再自动启用。">
      <Switch id={`${baseId}-auto`} checked={value.autoEnableOnConnect}
        onChange={(autoEnableOnConnect) => onChange({ ...value, autoEnableOnConnect })} />
    </SettingRow>
    <SettingRow htmlFor={`${baseId}-blur`} label="游戏背景模糊"
      note="像 CS2 一样模糊计分板等面板后面的游戏画面。需要 Windows 11；无法模糊时自动改用不透明底色。">
      <Switch id={`${baseId}-blur`} checked={value.worldBlur}
        onChange={(worldBlur) => onChange({ ...value, worldBlur })} />
    </SettingRow>
    {value.worldBlur ? <SettingRow htmlFor={`${baseId}-blur-strength`} label="模糊强度" note="1 为默认；每加一档模糊更强。">
      <div className="home-number">
        <RangeInput id={`${baseId}-blur-strength`} min={1} max={3} step={1} value={value.worldBlurStrength}
          onChange={(next) => onChange({ ...value, worldBlurStrength: next as WorldBlurStrength })} />
        <output className="home-number__box" htmlFor={`${baseId}-blur-strength`}>{value.worldBlurStrength}</output>
      </div>
    </SettingRow> : null}
  </SettingsGroup>;
}
