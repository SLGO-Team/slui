import { useId } from "react";
import type { OverlaySettings as Overlay } from "../../platform/overlaySettings";
import { SettingRow, SettingsGroup, Switch } from "./controls";

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
  </SettingsGroup>;
}
