import type { ReactNode } from "react";

/** Checkbox in the HUD style; shared by the install options and the uninstall options. */
export function Check({ checked, onChange, children }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return <label className="setup-check">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="setup-check__box" aria-hidden="true" />
    {children}
  </label>;
}
