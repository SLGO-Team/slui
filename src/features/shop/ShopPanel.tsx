import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Role, ShopPurchaseCommand } from "../../contracts";
import { DEFAULT_AUDIO_SETTINGS } from "../../platform/audioSettings";
import { useOverlayScale } from "../../shared/overlay.ts";
import { createPurchaseCommand, isShopItemPurchaseBlocked, type ShopItemView, type ShopViewModel } from "./model";
import { formatShopMoney, groupShopItems, shopIconSource, shopMinMoneyColor, shopOwnerPipColors, shopPreviewSource, shopWashForRole } from "./presentation";
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
  /** Interpolated from MatchSnapshot.phase_remaining_ms by the HUD selector. */
  countdownSeconds?: number | null;
  countdownPaused?: boolean;
  onPurchase(command: ShopPurchaseCommand): void;
  onClose(): void;
};

function formatShopCountdown(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60).toString().padStart(2, "0")}:${(safeSeconds % 60).toString().padStart(2, "0")}`;
}

const NO_PLAYER_COLORS: Readonly<Record<string, string>> = {};

function ShopCard({ item, slot, wash, pips, onPurchase, onHover, onPreview }: { item: ShopItemView; slot: number; wash: string; pips: readonly string[]; onPurchase(item: ShopItemView): void; onHover(item: ShopItemView | null): void; onPreview(itemId: string): void }) {
  const owned = item.owned_quantity !== undefined && item.owned_quantity !== null && item.owned_quantity > 0;
  const cardStyle = { "--shop-wash": wash } as CSSProperties;
  const handleClick = () => {
    onPreview(item.item_id);
    onPurchase(item);
  };
  return (
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
      aria-label={`${item.name} ${formatShopMoney(item.price)}${item.unavailable ? `: ${item.unavailable_reason ?? "不可购买"}` : ""}`}
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
      {/* The plugin answers in well under the timeout, so an in-flight purchase only blocks
          repeats and draws nothing; the label marks one that has outlived the timeout. */}
      {item.commandState === "timedOut" ? <span className="shop-card__pending-label">等待确认</span> : null}
    </button>
  );
}

export function ShopPanel({
  shop,
  role = "scp",
  playerColors = NO_PLAYER_COLORS,
  localPlayerId = null,
  open,
  volume = DEFAULT_AUDIO_SETTINGS.shopVolume,
  countdownSeconds,
  countdownPaused = false,
  onPurchase,
  onClose,
}: ShopPanelProps) {
  const scale = useOverlayScale();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  // A refused attempt on an unavailable card shows the plugin's reason in the failure banner, as
  // CS2 does; `seq` restarts the banner animation when the same reason repeats.
  const [denial, setDenial] = useState<{ reason: string; seq: number } | null>(null);
  const columns = useMemo(() => groupShopItems(shop.items, shop.categories, role), [role, shop.items, shop.categories]);
  const visible = open && shop.hasSnapshot && shop.windowOpen;
  const audio = useShopAudio(visible, shop.items, volume);
  useEffect(() => { if (!visible) setDenial(null); }, [visible]);
  const deny = useCallback((item: ShopItemView) => {
    audio.play("deny");
    // A purchase still in flight blocks a repeat silently; only an unavailable card has a reason.
    if (item.unavailable) setDenial((current) => ({ reason: item.unavailable_reason ?? "不可购买", seq: (current?.seq ?? 0) + 1 }));
  }, [audio]);
  const handleItemHover = useCallback((item: ShopItemView | null) => {
    setHoveredItemId(item?.item_id ?? null);
    if (item) audio.play(item.unavailable ? "unavailable" : "select");
  }, [audio]);
  const handleItemPurchase = useCallback((item: ShopItemView) => {
    if (isShopItemPurchaseBlocked(item)) {
      deny(item);
      return;
    }
    // This cue acknowledges submission; only the authoritative result confirms purchase.
    audio.play("purchase");
    setDenial(null);
    onPurchase(createPurchaseCommand(item.item_id));
  }, [audio, deny, onPurchase]);
  // The open shop holds the foreground. Losing it (Alt+Tab, a click in another window)
  // gives the game back its locked cursor, so the shop closes, as chat does. Blurs
  // before the window first has focus belong to the foreground switch itself.
  useEffect(() => {
    if (!visible) return undefined;
    let hasFocus = document.hasFocus();
    const handleFocus = () => { hasFocus = true; };
    const handleBlur = () => { if (hasFocus) onClose(); };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [onClose, visible]);
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
          onClose();
        }
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
        deny(item);
        setSelectedCategory(null);
        return;
      }
      setPreviewItemId(item.item_id);
      handleItemPurchase(item);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [audio, columns, deny, handleItemPurchase, onClose, selectedCategory, visible]);
  if (!visible) return null;
  const wash = shopWashForRole(role);
  const selected = selectedCategory;
  const hoveredItem = shop.items.find((item) => item.item_id === hoveredItemId);
  const previewItem = shop.items.find((item) => item.item_id === previewItemId) ?? shop.items[0];
  const failure = denial ? { text: denial.reason, key: `denial-${denial.seq}` } : shop.failureReason ? { text: shop.failureReason, key: `plugin-${shop.failureReason}` } : null;
  return (
    <>
      <div className="shop-mask" aria-hidden="true" />
      <section className="shop-overlay" data-shop-availability={shop.availability} aria-label="商店">
        <div className="shop-design-canvas" style={{ "--shop-overlay-scale": scale } as CSSProperties}>
        <div className="shop-content" data-shop-content>
          <div className="shop-left">
            <div className="shop-info" data-shop-info>
              <strong className="shop-balance">{formatShopMoney(shop.balance)}</strong>
              <span className="shop-time">
                <span>剩余购买时间</span>
                <b>{formatShopCountdown(countdownSeconds)}</b>
                {countdownPaused ? <i>暂停</i> : null}
              </span>
              {shop.nextRoundMinMoney !== null ? <span className="shop-min-money" style={{ color: shopMinMoneyColor(shop.nextRoundMinMoney) }}>下回合最低金额: {formatShopMoney(shop.nextRoundMinMoney)}</span> : null}
            </div>
            <div className="shop-body" data-shop-body>
              <div className={`shop-categories${selectedCategory ? " shop-categories--selected" : ""}`} data-shop-columns style={{ "--shop-column-count": columns.length } as CSSProperties}>
                {columns.map((column, columnIndex) => (
                  <div key={column.id} className={`shop-column${selected === column.id ? " shop-column--selected" : ""}`} style={{ width: `${column.width}px` }} data-shop-column={column.id}>
                    <div className="shop-column__header">
                      <span className="shop-column__key">{columnIndex + 1}</span>
                      <span>{column.label}</span>
                    </div>
                    <div className="shop-column__items">
                      {column.items.map((item, itemIndex) => <ShopCard key={item.item_id} item={item as ShopItemView} slot={itemIndex + 1} wash={wash} pips={shopOwnerPipColors(item, playerColors, localPlayerId)} onPurchase={handleItemPurchase} onHover={handleItemHover} onPreview={setPreviewItemId} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <aside className="shop-right" data-shop-details>
            {previewItem ? <img key={previewItem.item_id} className="shop-item-preview" src={shopPreviewSource(previewItem)} alt="" aria-hidden="true" /> : null}
            <div className="shop-failure-container" role="status" aria-live="polite">
              {failure ? <span key={failure.key} className="shop-failure">{failure.text}</span> : null}
            </div>
            {hoveredItem ? <div className="shop-details-card">
              <strong>{hoveredItem.name}</strong>
              <span>{hoveredItem.description ?? "插件确认购买后，余额与库存将更新。"}</span>
            </div> : null}
          </aside>
        </div>
        <nav className="shop-navbar" aria-label="商店操作">
          <button type="button" onClick={onClose}><kbd>ESCAPE</kbd><span>返回</span></button>
        </nav>
        </div>
      </section>
    </>
  );
}
