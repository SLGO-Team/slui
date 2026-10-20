import type { RequiredBanner, UpdateAction } from "../updateModel";
import { UpdateIcon } from "./icons";

const ACTION_LABEL: Record<UpdateAction, string> = { install: "更新并重启", check: "重试" };

/** Home page banner while SLUI is below the required version and will not connect. */
export function UpdateBanner({ banner, onAction }: { banner: RequiredBanner; onAction(action: UpdateAction): void }) {
  return <section className="home-banner" role="alert">
    <span className="home-banner__icon"><UpdateIcon /></span>
    <div className="home-banner__text">
      <strong className="home-banner__title">{banner.title}</strong>
      {banner.detail ? <span className="home-banner__detail">{banner.detail}</span> : null}
    </div>
    {banner.action
      ? <button type="button" disabled={banner.busy} onClick={() => onAction(banner.action!)}
        className={banner.action === "install" ? "home-button home-button--small home-button--primary" : "home-button home-button--small"}>
        {ACTION_LABEL[banner.action]}
      </button>
      : null}
  </section>;
}
