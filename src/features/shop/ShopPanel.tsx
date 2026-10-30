import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Role, ShopCommand } from "../../contracts";
import { DEFAULT_AUDIO_SETTINGS } from "../../platform/audioSettings";
import { useBackdropRef } from "../../platform/backdrop";
import { useClockSelector } from "../../shared/clock.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import type { ShopPanelCloseReason } from "./diagnostics";
import { createFulfillCommand, createPurchaseCommand, createRefundAllCommand, createRefundCommand, createRequestCommand, isShopItemPurchaseBlocked, type ShopItemView, type ShopRequestView, type ShopViewModel } from "./model";
import { formatShopMoney, groupShopItems, groupShopRequests, shopIconSource, shopMinMoneyColor, shopOwnerPipColors, shopPreviewSource, shopWashForRole, type ShopColumn } from "./presentation";
import { useShopAudio } from "./useShopAudio";
import "./ShopPanel.css";

export type ShopPanelProps = {
  shop: ShopViewModel;
  role?: Role;
  /** HUD-wide player slot colours (playerSlotColors); they colour the teammate-inventory pips. */
  playerColors?: Readonly<Record<string, string>>;
  /** The local player: the only holder an older plugin (no owner_player_ids) can report. */
  localPlayerId?: string | null;
  /** Player-opened via the shop hotkey; shown only while the buy window is open too. */
  open: boolean;
  /** Settings `audio.shopVolume`: 1 plays the CS2 volumes; defaults to 15% of them. */
  volume?: number;
  /** The buy time left at a time, from MatchSnapshot.phase_remaining_ms (the HUD clock's phaseClockSeconds). */
  countdownAt?: (nowMs: number) => number | null;
  /** Purchases, teammate-request toggles, fulfilments and refunds; the model tracks each until its result. */
  onCommand(command: ShopCommand): void;
  onClose(reason: ShopPanelCloseReason): void;
  /** Diagnostics log (slui.log): the shop drawn and hidden, and the window's focus and blur while it is drawn. */
  onDiagnostic?(message: string): void;
};

function formatShopCountdown(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60).toString().padStart(2, "0")}:${(safeSeconds % 60).toString().padStart(2, "0")}`;
}

const NO_PLAYER_COLORS: Readonly<Record<string, string>> = {};
const NO_COUNTDOWN = () => null;

/** Selected on the overlay clock, so only the countdown re-renders each second. */
function ShopCountdown({ countdownAt }: { countdownAt: (nowMs: number) => number | null }) {
  return <b>{formatShopCountdown(useClockSelector(countdownAt))}</b>;
}

/**
 * buymenu.xml ItemPanel: a `button-container` holding the BuyButton and, as its sibling, the SellbackButton
 * (buttons cannot nest). The in-game capture shows the sellback button taking the hover from the card: the
 * details card goes away and only the 退款 tooltip shows.
 */
function ShopCard({ item, slot, wash, pips, onPurchase, onRequest, onRefund, onRefundHover, onHover, onPreview }: { item: ShopItemView; slot: number; wash: string; pips: readonly string[]; onPurchase(item: ShopItemView): void; onRequest(item: ShopItemView): void; onRefund(item: ShopItemView): void; onRefundHover(item: ShopItemView | null, button?: HTMLElement): void; onHover(item: ShopItemView | null): void; onPreview(itemId: string): void }) {
  const owned = item.owned_quantity !== undefined && item.owned_quantity !== null && item.owned_quantity > 0;
  const refundable = item.refundable === true;
  const cardStyle = { "--shop-wash": wash } as CSSProperties;
  const handleClick = () => {
    onPreview(item.item_id);
    onPurchase(item);
  };
  return (
    <div className="shop-card-slot">
    <button
      type="button"
      className={`shop-card${item.unavailable ? " shop-card--disabled" : ""}${owned ? " shop-card--owned" : ""}${item.commandState === "success" ? " shop-card--success" : ""}`}
      style={cardStyle}
      data-shop-item={item.item_id}
      data-shop-state={item.commandState}
      data-shop-disabled={item.disabled ? "true" : "false"}
      aria-disabled={item.disabled}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") { onHover(item); onPreview(item.item_id); } }}
      onPointerLeave={() => onHover(null)}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) { onHover(item); onPreview(item.item_id); } }}
      onBlur={() => onHover(null)}
      onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
      onClick={handleClick}
      onContextMenu={(event) => { event.preventDefault(); onRequest(item); }}
      aria-label={`${item.name} ${formatShopMoney(item.price)}${item.unavailable ? `: ${item.unavailable_reason ?? "不可购买"}` : ""}${item.requested ? "，已请求队友购买" : ""}${refundable ? "，可退款" : ""}`}
    >
      <span className="shop-card__key" aria-hidden="true">{slot}</span>
      <span className="shop-card__name">{item.name}</span>
      <span className="shop-card__icon" style={{ maskImage: `url("${shopIconSource(item)}")`, WebkitMaskImage: `url("${shopIconSource(item)}")` }} aria-hidden="true" />
      <span className="shop-card__price">{formatShopMoney(item.price)}</span>
      {pips.length > 0 ? (
        <span className="shop-card__owners" aria-hidden="true">
          {pips.map((color, index) => <span key={index} className="shop-card__pip" style={{ backgroundColor: color }} />)}
        </span>
      ) : null}
      {/* The viewer's own open teammate request, in the card's free bottom-left corner (the undo button's
          corner: a refundable card shows that instead). */}
      {item.requested && !refundable ? <span className="shop-card__requested" aria-hidden="true">已请求</span> : null}
      {/* The plugin answers in well under the timeout, so an in-flight purchase only blocks
          repeats and draws nothing; the label marks one that has outlived the timeout. */}
    </button>
    {/* buymenu.css .sellback-button: collapsed unless the card `can-sellback`; it never purchases. */}
    {refundable ? (
      <button
        type="button"
        className="shop-card__sellback"
        data-shop-refund={item.item_id}
        aria-label={`退款 ${item.name}`}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") onRefundHover(item, event.currentTarget); }}
        onPointerLeave={() => onRefundHover(null)}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) onRefundHover(item, event.currentTarget); }}
        onBlur={() => onRefundHover(null)}
        onClick={() => onRefund(item)}
        onContextMenu={(event) => event.preventDefault()}
      />
    ) : null}
    </div>
  );
}

/** buymenu.xml snippet-ground-weapon-entry: icon on the left, requester and price on the right. */
function ShopRequestEntry({ request, onFulfil, onHover }: { request: ShopRequestView; onFulfil(request: ShopRequestView): void; onHover(request: ShopRequestView | null): void }) {
  const icon = shopIconSource(request);
  return (
    <button
      type="button"
      className={`shop-request${request.unavailable ? " shop-request--disabled" : ""}`}
      data-shop-request={request.request_id}
      data-shop-state={request.commandState}
      aria-disabled={request.disabled}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") onHover(request); }}
      onPointerLeave={() => onHover(null)}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) onHover(request); }}
      onBlur={() => onHover(null)}
      onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
      onClick={() => onFulfil(request)}
      aria-label={`为 ${request.requester_name} 购买 ${request.name} ${formatShopMoney(request.price)}${request.unavailable ? `: ${request.unavailable_reason ?? "不可购买"}` : ""}`}
    >
      {/* The hidden image gives the box the icon's own width at 20px; the mask paints it in the wash. */}
      <span className="shop-request__icon" style={{ maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` }} aria-hidden="true">
        <img src={icon} alt="" />
      </span>
      <span className="shop-request__label" aria-hidden="true">
        <span className="shop-request__name">{request.requester_name}</span>
        <span className="shop-request__price">{formatShopMoney(request.price)}</span>
      </span>
    </button>
  );
}

/**
 * buymenu.xml `buymenu__ground-weapons`, which SLGO has no dropped weapons for: the SCP side's teammate
 * requests, one lister per item column. It grows from 0 while requests exist, as `.show-ground-weapons` does.
 */
function ShopRequestArea({ columns, requests, onFulfil, onHover }: { columns: readonly ShopColumn[]; requests: readonly ShopRequestView[]; onFulfil(request: ShopRequestView): void; onHover(request: ShopRequestView | null): void }) {
  const listers = groupShopRequests(requests, columns);
  return (
    <div className={`shop-requests${requests.length > 0 ? " shop-requests--shown" : ""}`} data-shop-requests aria-label="队友请求" aria-hidden={requests.length === 0}>
      <span className="shop-requests__title" aria-hidden="true">队友请求</span>
      <div className="shop-requests__list">
        {listers.map((lister) => (
          <div key={lister.id} className="shop-requests__lister" style={{ width: `${lister.width}px` }} data-shop-request-column={lister.id}>
            {lister.requests.map((request) => <ShopRequestEntry key={request.request_id} request={request} onFulfil={onFulfil} onHover={onHover} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** hud.xml's HudBlur blurs the world under the BuyMenu rect: a native blur under the whole mask. */
function ShopMask() {
  return <div ref={useBackdropRef()} className="shop-mask" aria-hidden="true" />;
}

export const ShopPanel = memo(function ShopPanel({
  shop,
  role = "scp",
  playerColors = NO_PLAYER_COLORS,
  localPlayerId = null,
  open,
  volume = DEFAULT_AUDIO_SETTINGS.shopVolume,
  countdownAt = NO_COUNTDOWN,
  onCommand,
  onClose,
  onDiagnostic,
}: ShopPanelProps) {
  const scale = useOverlayScale();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [hoveredRequestId, setHoveredRequestId] = useState<string | null>(null);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  // A refused attempt on an unavailable card shows the plugin's reason in the failure banner, as
  // CS2 does; `seq` restarts the banner animation when the same reason repeats.
  const [denial, setDenial] = useState<{ reason: string; seq: number } | null>(null);
  const columns = useMemo(() => groupShopItems(shop.items, shop.categories, role), [role, shop.items, shop.categories]);
  const visible = open && shop.hasSnapshot && shop.windowOpen;
  const audio = useShopAudio(visible, volume);
  useEffect(() => { if (!visible) setDenial(null); }, [visible]);
  // Banner only: CS2's buy menu has no failure sound (the purchase cue already played).
  const deny = useCallback((item: ShopItemView | ShopRequestView) => {
    // A purchase still in flight blocks a repeat silently; only an unavailable card has a reason.
    if (item.unavailable) setDenial((current) => ({ reason: item.unavailable_reason ?? "不可购买", seq: (current?.seq ?? 0) + 1 }));
  }, []);
  // CS2 HoverSlot plays buymenu_mouseover on every card, buyable or not.
  const handleItemHover = useCallback((item: ShopItemView | null) => {
    setHoveredItemId(item?.item_id ?? null);
    if (item) audio.play("hover");
  }, [audio]);
  // CS2 PurchaseSlot plays buymenu_purchase on any card, then sends `buy`; the server's refusal is
  // silent. The cue acknowledges the attempt; only the authoritative result confirms the purchase.
  const handleItemPurchase = useCallback((item: ShopItemView) => {
    audio.play("purchase");
    if (isShopItemPurchaseBlocked(item)) {
      deny(item);
      return;
    }
    setDenial(null);
    onCommand(createPurchaseCommand(item.item_id));
  }, [audio, deny, onCommand]);
  // R or a right-click on a card: the plugin creates, cancels (same item) or replaces the request and
  // answers anything it refuses in the failure banner. Nothing to do while requesting is closed.
  const canRequest = shop.canRequest;
  const handleItemRequest = useCallback((item: ShopItemView) => {
    if (!canRequest || item.requestPending) return;
    audio.play("select");
    setDenial(null);
    onCommand(createRequestCommand(item.item_id));
  }, [audio, canRequest, onCommand]);
  // CS2 SellbackSlot plays buymenu_purchase, then sends `sellback`; only a refundable card offers it.
  const handleItemRefund = useCallback((item: ShopItemView) => {
    if (item.refundable !== true || item.refundPending) return;
    audio.play("purchase");
    setDenial(null);
    onCommand(createRefundCommand(item.item_id));
  }, [audio, onCommand]);
  // The sellback button's text tooltip (CSGOTooltipManager TooltipText), drawn on the design canvas so the
  // columns' scroll boxes cannot clip it; placed from the button's box (canvas units).
  const canvasRef = useRef<HTMLDivElement>(null);
  const [refundTip, setRefundTip] = useState<{ itemId: string; left: number; top: number } | null>(null);
  const handleRefundHover = useCallback((item: ShopItemView | null, button?: HTMLElement) => {
    const canvas = canvasRef.current;
    if (!item || !button || !canvas) {
      setRefundTip(null);
      return;
    }
    const target = button.getBoundingClientRect();
    const origin = canvas.getBoundingClientRect();
    setRefundTip({ itemId: item.item_id, left: (target.right - origin.left) / scale, top: (target.top + target.height / 2 - origin.top) / scale });
  }, [scale]);
  // A refunded card loses its button under the pointer, so no pointerleave clears the tooltip.
  const refundTipShown = refundTip !== null && shop.items.some((item) => item.item_id === refundTip.itemId && item.refundable === true);
  useEffect(() => { if (refundTip !== null && (!refundTipShown || !visible)) setRefundTip(null); }, [refundTip, refundTipShown, visible]);
  // CS2 sellbackall: no sound; with nothing refundable it does nothing.
  const canRefundAll = shop.canRefundAll;
  const handleRefundAll = useCallback(() => {
    if (!canRefundAll) return;
    setDenial(null);
    onCommand(createRefundAllCommand());
  }, [canRefundAll, onCommand]);
  const handleRequestHover = useCallback((request: ShopRequestView | null) => {
    setHoveredRequestId(request?.request_id ?? null);
    if (!request) return;
    setPreviewItemId(request.item_id);
    audio.play("hover");
  }, [audio]);
  // Buying a teammate's request plays the purchase cue like any other purchase attempt.
  const handleFulfil = useCallback((request: ShopRequestView) => {
    audio.play("purchase");
    if (isShopItemPurchaseBlocked(request)) {
      deny(request);
      return;
    }
    setDenial(null);
    onCommand(createFulfillCommand(request.request_id));
  }, [audio, deny, onCommand]);
  // Diagnostics only: the window's focus and blur while the shop is drawn. The shop closes when the overlay loses the
  // system foreground (App, from the native state), never on blur: another application's overlay showing its window
  // (NVIDIA's Alt+R statistics) bounces focus inside the overlay window while the overlay keeps the foreground.
  useEffect(() => {
    if (!visible) return undefined;
    let hasFocus = document.hasFocus();
    const shownAt = performance.now();
    const since = () => `${Math.round(performance.now() - shownAt)}ms`;
    onDiagnostic?.(`shop shown (window focused: ${hasFocus})`);
    const handleFocus = () => {
      onDiagnostic?.(`shop window focus at ${since()}`);
      hasFocus = true;
    };
    const handleBlur = () => {
      onDiagnostic?.(`shop window blur at ${since()} (had focus: ${hasFocus})`);
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      onDiagnostic?.(`shop hidden after ${since()}`);
    };
  }, [onDiagnostic, visible]);
  useEffect(() => {
    if (!visible) return undefined;
    const handleWindowKeyDown =(event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='textbox']"))) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (selectedCategory !== null) {
          setSelectedCategory(null);
        } else {
          onClose("escape");
        }
        return;
      }
      if (event.code === "KeyR") {
        const hovered = hoveredItemId === null ? undefined : shop.items.find((item) => item.item_id === hoveredItemId);
        if (!hovered || !canRequest) return;
        event.preventDefault();
        handleItemRequest(hovered);
        return;
      }
      // The plugin's in-game 退款 / 全部退款 keys (Backspace / Delete, Delete also being CS2's sellbackall
      // bind): the open shop holds the foreground, so the game never sees them.
      if (event.code === "Backspace") {
        event.preventDefault();
        const hovered = hoveredItemId === null ? undefined : shop.items.find((item) => item.item_id === hoveredItemId);
        if (hovered) handleItemRefund(hovered);
        return;
      }
      if (event.code === "Delete") {
        event.preventDefault();
        handleRefundAll();
        return;
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const slot = Number(event.key) - 1;
      event.preventDefault();
      if (selectedCategory === null) {
        const column = columns[slot];
        if (!column) return;
        setSelectedCategory(column.id);
        audio.play("select");
        return;
      }
      const column = columns.find((candidate) => candidate.id === selectedCategory);
      const item = column?.items[slot] as ShopItemView | undefined;
      if (!item) return;
      // Same rule as a click: owned_quantity is display-only (the pip), purchasable decides.
      if (isShopItemPurchaseBlocked(item)) {
        audio.play("purchase");
        deny(item);
        setSelectedCategory(null);
        return;
      }
      setPreviewItemId(item.item_id);
      handleItemPurchase(item);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [audio, canRequest, columns, deny, handleItemPurchase, handleItemRefund, handleItemRequest, handleRefundAll, hoveredItemId, onClose, selectedCategory, shop.items, visible]);
  if (!visible) return null;
  const wash = shopWashForRole(role);
  const selected = selectedCategory;
  const hoveredItem = shop.items.find((item) => item.item_id === hoveredItemId);
  const hoveredRequest = shop.requests.find((request) => request.request_id === hoveredRequestId);
  // A request may be for an item outside the viewer's own catalog (an SCP-079 viewer, all-items scope).
  const previewKnown = previewItemId !== null && (shop.items.some((item) => item.item_id === previewItemId) || shop.requests.some((request) => request.item_id === previewItemId));
  const previewId = previewKnown ? previewItemId : shop.items[0]?.item_id ?? null;
  const showRequests = shop.requests.length > 0;
  const failure = denial ? { text: denial.reason, key: `denial-${denial.seq}` } : shop.failureReason ? { text: shop.failureReason, key: `plugin-${shop.failureReason}` } : null;
  return (
    <>
      <ShopMask />
      <section className="shop-overlay" data-shop-availability={shop.availability} aria-label="商店">
        <div ref={canvasRef} className="shop-design-canvas" style={{ "--shop-overlay-scale": scale, "--shop-wash": wash } as CSSProperties}>
        <div className="shop-content" data-shop-content>
          <div className="shop-left">
            <div className="shop-info" data-shop-info>
              <strong className="shop-balance">{formatShopMoney(shop.balance)}</strong>
              <span className="shop-time">
                <span>剩余购买时间</span>
                <ShopCountdown countdownAt={countdownAt} />
              </span>
              {shop.nextRoundMinMoney !== null ? <span className="shop-min-money" style={{ color: shopMinMoneyColor(shop.nextRoundMinMoney) }}>下回合最低金额: {formatShopMoney(shop.nextRoundMinMoney)}</span> : null}
            </div>
            <div className={`shop-body${showRequests ? " shop-body--requests" : ""}`} data-shop-body>
              <div className={`shop-categories${selectedCategory ? " shop-categories--selected" : ""}`} data-shop-columns style={{ "--shop-column-count": columns.length } as CSSProperties}>
                {columns.map((column, columnIndex) => (
                  <div key={column.id} className={`shop-column${selected === column.id ? " shop-column--selected" : ""}`} style={{ width: `${column.width}px` }} data-shop-column={column.id}>
                    <div className="shop-column__header">
                      <span className="shop-column__key">{columnIndex + 1}</span>
                      <span>{column.label}</span>
                    </div>
                    <div className="shop-column__items">
                      {column.items.map((item, itemIndex) => <ShopCard key={item.item_id} item={item as ShopItemView} slot={itemIndex + 1} wash={wash} pips={shopOwnerPipColors(item, playerColors, localPlayerId)} onPurchase={handleItemPurchase} onRequest={handleItemRequest} onRefund={handleItemRefund} onRefundHover={handleRefundHover} onHover={handleItemHover} onPreview={setPreviewItemId} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ShopRequestArea columns={columns} requests={shop.requests} onFulfil={handleFulfil} onHover={handleRequestHover} />
          </div>
          <aside className="shop-right" data-shop-details>
            {previewId !== null ? <img key={previewId} className="shop-item-preview" src={shopPreviewSource({ item_id: previewId })} alt="" aria-hidden="true" /> : null}
            <div className="shop-failure-container" role="status" aria-live="polite">
              {failure ? <span key={failure.key} className="shop-failure">{failure.text}</span> : null}
            </div>
            {hoveredRequest ? <div className="shop-details-card">
              <strong>为 {hoveredRequest.requester_name} 购买 {hoveredRequest.name}</strong>
              <span>{hoveredRequest.description ?? "你付款，队友收货。"}</span>
            </div> : hoveredItem ? <div className="shop-details-card">
              <strong>{hoveredItem.name}</strong>
              <span>{hoveredItem.description ?? "插件确认购买后，余额与库存将更新。"}</span>
            </div> : null}
          </aside>
        </div>
        {refundTip !== null && refundTipShown ? <span className="shop-tooltip" style={{ left: `${refundTip.left}px`, top: `${refundTip.top}px` }} role="tooltip">退款</span> : null}
        <nav className="shop-navbar" aria-label="商店操作">
          {/* buymenu.xml BuyForTeammateLabel: CS2's own buy-for-teammate hint, washed and dimmed. */}
          {canRequest ? <span className="shop-navbar__for-teammate">按<span className="shop-navbar__key">[R]</span>或右键请求队友购买</span> : null}
          {/* buymenu.xml's sellbackall PopupButton, after rebuy / autobuy (not replicated); DEL is CS2's bind. */}
          {shop.refundsSupported ? <button type="button" data-shop-refund-all onClick={handleRefundAll}><span className="shop-navbar__key">[DEL]</span>全部退款</button> : null}
          <button type="button" onClick={() => onClose("button")}><span className="shop-navbar__key">[ESCAPE]</span>返回</button>
        </nav>
        </div>
      </section>
    </>
  );
});
