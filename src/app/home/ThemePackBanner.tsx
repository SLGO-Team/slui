import type { ThemePackNotice } from "../themePackStatus";
import { WarningIcon } from "./icons";

/** Home page notice while the installed theme pack lacks files this version reads; nothing to act on in SLUI itself. */
export function ThemePackBanner({ notice }: { notice: ThemePackNotice }) {
  return <section className="home-banner" data-tone="warn" role="status">
    <span className="home-banner__icon"><WarningIcon /></span>
    <div className="home-banner__text">
      <strong className="home-banner__title">{notice.title}</strong>
      <span className="home-banner__detail">{notice.detail}</span>
    </div>
  </section>;
}
