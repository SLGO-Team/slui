// Line icons for the home window chrome; 24px grid, drawn with currentColor.
type IconProps = { size?: number };

function Icon({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return <svg className="home-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">{children}</svg>;
}

export const HomeIcon = (props: IconProps) => <Icon {...props}>
  <path d="M3 11 12 3.5 21 11" /><path d="M5.5 9v11h13V9" /><path d="M10 20v-6h4v6" />
</Icon>;

export const SettingsIcon = (props: IconProps) => <Icon {...props}>
  <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
  <rect x="13" y="4" width="4" height="4" /><rect x="7" y="10" width="4" height="4" /><rect x="15" y="16" width="4" height="4" />
</Icon>;

export const AccountIcon = (props: IconProps) => <Icon {...props}>
  <circle cx="12" cy="8.5" r="4" /><path d="M4 20.5c1.2-4 4.3-6 8-6s6.8 2 8 6" />
</Icon>;

export const GameIcon = (props: IconProps) => <Icon {...props}>
  <path d="M7 7h10l4 10.5-2.5 1.5L15 15H9l-3.5 4L3 17.5Z" /><path d="M8 10v3M6.5 11.5h3" /><path d="M15.5 10.5h.01M17 12.5h.01" />
</Icon>;

export const ServerIcon = (props: IconProps) => <Icon {...props}>
  <rect x="4" y="4" width="16" height="6.5" /><rect x="4" y="13.5" width="16" height="6.5" />
  <path d="M7.5 7.25h.01M7.5 16.75h.01M12 7.25h5M12 16.75h5" />
</Icon>;

export const ResetIcon = (props: IconProps) => <Icon size={14} {...props}>
  <path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" />
</Icon>;

export const MinimizeIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
  <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
</svg>;

export const CloseIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
  <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
</svg>;
