import { useId } from "react";
import type { OverlaySettings as Overlay, WorldBlurLayers } from "../../platform/overlaySettings";
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
      note="像 CS2 一样模糊计分板等面板后面的游戏画面。Windows 关闭“透明效果”或开启节能模式时自动改用不透明底色。">
      <Switch id={`${baseId}-blur`} checked={value.worldBlur}
        onChange={(worldBlur) => onChange({ ...value, worldBlur })} />
    </SettingRow>
    {value.worldBlur ? <SettingRow htmlFor={`${baseId}-blur-layers`} label="模糊强度" note="1 为默认；每加一档模糊更强。">
      <div className="home-number">
        <RangeInput id={`${baseId}-blur-layers`} min={1} max={3} step={1} value={value.worldBlurLayers}
          onChange={(next) => onChange({ ...value, worldBlurLayers: next as WorldBlurLayers })} />
        <output className="home-number__box" htmlFor={`${baseId}-blur-layers`}>{value.worldBlurLayers}</output>
      </div>
    </SettingRow> : null}
  </SettingsGroup>;
}
