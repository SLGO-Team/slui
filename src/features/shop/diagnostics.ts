import type { ShopViewModel } from "./model.ts";

/**
 * Why an open shop closed, one `shop closed:` line each in slui.log: the shop key, a chat key (Y/U), Escape, the
 * navbar's 返回, the overlay window's blur, the shop no longer available (session, snapshot or buy window), the team
 * menu opening, the overlay switched off.
 */
export type ShopCloseReason = "shop-key" | "chat-key" | "escape" | "button" | "blur" | "unavailable" | "team-select" | "overlay-disabled";

/** What ShopPanel itself closes on. */
export type ShopPanelCloseReason = Extract<ShopCloseReason, "escape" | "button" | "blur">;

/**
 * The inputs the shop key decides on, as one log fragment: the session status, whether a snapshot exists and has the
 * buy window open, the shop's availability and how old (local receipt time) the last snapshot is at `nowMs`.
 */
export function shopKeyInputs(sessionStatus: string, shop: Pick<ShopViewModel, "hasSnapshot" | "windowOpen" | "availability" | "frame">, nowMs: number): string {
  const age = shop.frame === null ? "none" : `${Math.max(0, (nowMs - shop.frame.receivedAtMs) / 1000).toFixed(1)}s`;
  return `session ${sessionStatus}, snapshot ${shop.hasSnapshot}, window open ${shop.windowOpen}, availability ${shop.availability}, snapshot age ${age}`;
}
