import type { GameConditionBanner as Banner } from "../gameConditionsModel";
import { WarningIcon } from "./icons";

/** Home page notice while a game condition hands SLUI's shop, chat and team menu back to the game's own UI. */
export function GameConditionBanner({ banner, onAction }: { banner: Banner; onAction(): void }) {
  return <section className="home-banner" data-tone="warn" role="status">
    <span className="home-banner__icon"><WarningIcon /></span>
    <div className="home-banner__text">
      <strong className="home-banner__title">{banner.title}</strong>
      <span className="home-banner__detail">{banner.detail}</span>
    </div>
    {banner.action
      ? <button type="button" disabled={banner.action.busy} onClick={onAction}
        className="home-button home-button--small home-button--primary">
        {banner.action.label}
      </button>
      : null}
  </section>;
}
