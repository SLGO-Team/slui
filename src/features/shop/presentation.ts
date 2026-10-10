import type { Role, ShopCategory, ShopItem } from "../../contracts/index.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";

/** Design-canvas width of the buy-menu content column. Layout values that only
 *  matter to CSS (card height, gaps, mask opacity, panel background) live in
 *  ShopPanel.css so there is a single source for them. */
export const SHOP_CONTENT_WIDTH = 950;

export const SHOP_WASH_BY_ROLE: Readonly<Record<Role, string>> = ROLE_COLORS;

export const SHOP_FALLBACK_ICONS: Readonly<Record<string, string>> = {
  Adrenaline: "/assets/slui-svg/Adrenaline.svg",
  ArmorLight: "/assets/slui-svg/ArmorLight.svg",
  ArmorCombat: "/assets/slui-svg/ArmorCombat.svg",
  ArmorHeavy: "/assets/slui-svg/ArmorHeavy.svg",
  GrenadeFlash: "/assets/slui-svg/GrenadeFlash.svg",
  GrenadeHE: "/assets/slui-svg/GrenadeHE.svg",
  GunAK: "/assets/slui-svg/GunAK.svg",
  GunCOM15: "/assets/slui-svg/GunCOM15.svg",
  GunCOM18: "/assets/slui-svg/GunCOM18.svg",
  GunCrossvec: "/assets/slui-svg/GunCrossvec.svg",
  GunE11SR: "/assets/slui-svg/GunE11SR.svg",
  GunFRMG0: "/assets/slui-svg/GunFRMG0.svg",
  GunFSP9: "/assets/slui-svg/GunFSP9.svg",
  GunLogicer: "/assets/slui-svg/GunLogicer.svg",
  KeycardNTFCommander: "/assets/slui-svg/KeycardNTFCommander.svg",
  Medkit: "/assets/slui-svg/Medkit.svg",
  MicroHID: "/assets/slui-svg/MicroHID.svg",
  Painkillers: "/assets/slui-svg/Painkillers.svg",
  SCP500: "/assets/slui-svg/SCP500.svg",
  SCP1344: "/assets/slui-svg/SCP1344.svg",
  SCP1853: "/assets/slui-svg/SCP1853.svg",
  SCP207: "/assets/slui-svg/SCP207.svg",
  SCP2176: "/assets/slui-svg/SCP2176.svg",
  SCP268: "/assets/slui-svg/SCP268.svg",
  Scp049: "/assets/slui-svg/Scp049.svg",
  Scp0492: "/assets/slui-svg/Scp0492.svg",
  Scp079: "/assets/slui-svg/Scp079.svg",
  Scp096: "/assets/slui-svg/Scp096.svg",
  Scp106: "/assets/slui-svg/Scp106.svg",
  Scp173: "/assets/slui-svg/Scp173.svg",
  Scp3114: "/assets/slui-svg/Scp3114.svg",
  Scp939: "/assets/slui-svg/Scp939.svg",
  HealthUpgrade: "/assets/slui-svg/HealthUpgrade.svg",
  HealthUpgrade1: "/assets/slui-svg/HealthUpgrade.svg",
  HealthUpgrade2: "/assets/slui-svg/HealthUpgrade.svg",
  HealthUpgrade3: "/assets/slui-svg/HealthUpgrade.svg",
  ShieldUpgrade: "/assets/slui-svg/ShieldUpgrade.svg",
  ShieldUpgrade1: "/assets/slui-svg/ShieldUpgrade.svg",
  ShieldUpgrade2: "/assets/slui-svg/ShieldUpgrade.svg",
  ShieldUpgrade3: "/assets/slui-svg/ShieldUpgrade.svg",
  GeneratorInteractionUpgrade: "/assets/icons/wire-cutters.svg",
  Scp079Level2: "/assets/slui-svg/Scp079Upgrade.svg",
  Scp079Level3: "/assets/slui-svg/Scp079Upgrade.svg",
  Scp079Level4: "/assets/slui-svg/Scp079Upgrade.svg",
  armor: "/assets/slui-svg/ArmorCombat.svg",
  medkit: "/assets/slui-svg/Medkit.svg",
  smoke: "/assets/slui-svg/GrenadeFlash.svg",
  grenade: "/assets/slui-svg/GrenadeHE.svg",
  pistol: "/assets/slui-svg/GunCOM15.svg",
};
export const SHOP_DEFAULT_ICON = "/assets/slui-svg/Adrenaline.svg";

export const SHOP_PREVIEW_IMAGES: Readonly<Record<string, string>> = {
  Adrenaline: "/assets/shop-items/Adrenaline.png",
  ArmorLight: "/assets/shop-items/ArmorLight.png",
  ArmorCombat: "/assets/shop-items/ArmorCombat.png",
  ArmorHeavy: "/assets/shop-items/ArmorHeavy.png",
  GrenadeFlash: "/assets/shop-items/GrenadeFlash.png",
  GrenadeHE: "/assets/shop-items/GrenadeHE.png",
  GunAK: "/assets/shop-items/GunAK.png",
  GunCOM15: "/assets/shop-items/GunCOM15.png",
  GunCOM18: "/assets/shop-items/GunCOM18.png",
  GunCrossvec: "/assets/shop-items/GunCrossvec.png",
  GunE11SR: "/assets/shop-items/GunE11SR.png",
  GunFRMG0: "/assets/shop-items/GunFRMG0.png",
  GunFSP9: "/assets/shop-items/GunFSP9.png",
  GunLogicer: "/assets/shop-items/GunLogicer.png",
  Medkit: "/assets/shop-items/Medkit.png",
  MicroHID: "/assets/shop-items/MicroHID.png",
  Painkillers: "/assets/shop-items/Painkillers.png",
  SCP1344: "/assets/shop-items/SCP1344.png",
  SCP1853: "/assets/shop-items/SCP1853.png",
  SCP207: "/assets/shop-items/SCP207.png",
  SCP2176: "/assets/shop-items/SCP2176.png",
  SCP268: "/assets/shop-items/SCP268.png",
  SCP500: "/assets/shop-items/SCP500.png",
  Scp049: "/assets/shop-items/Scp049.png",
  Scp0492: "/assets/shop-items/Scp0492.png",
  Scp079: "/assets/shop-items/Scp079.png",
  Scp096: "/assets/shop-items/Scp096.png",
  Scp106: "/assets/shop-items/Scp106.png",
  Scp173: "/assets/shop-items/Scp173.png",
  Scp3114: "/assets/shop-items/Scp3114.png",
  Scp939: "/assets/shop-items/Scp939.png",
};

export function shopIconSource(item: Pick<ShopItem, "item_id" | "icon_url">): string {
  return item.icon_url?.trim() || SHOP_FALLBACK_ICONS[item.item_id] || SHOP_DEFAULT_ICON;
}

export function shopPreviewSource(item: Pick<ShopItem, "item_id">): string {
  return SHOP_PREVIEW_IMAGES[item.item_id] || SHOP_FALLBACK_ICONS[item.item_id] || SHOP_DEFAULT_ICON;
}

export function shopWashForRole(role: Role): string {
  return SHOP_WASH_BY_ROLE[role];
}

/** buymenu.css:816-822 - `.player-pip.has-item` is white until a player colour is known. */
export const SHOP_PIP_FALLBACK_COLOR = "#ffffff";

/**
 * The teammate-inventory pips of one card (buymenu.xml TeammateInventory): one colour per holder, in
 * team slot order. `playerColors` is the HUD-wide slot colour map (playerSlotColors), whose key order is
 * the match.snapshot team order. A plugin without `owner_player_ids` only reports the viewer's own
 * `owned_quantity`, so the viewer is then the only possible holder.
 */
export function shopOwnerPipColors(
  item: Pick<ShopItem, "owner_player_ids" | "owned_quantity">,
  playerColors: Readonly<Record<string, string>>,
  localPlayerId: string | null,
): string[] {
  if (item.owner_player_ids === undefined || item.owner_player_ids === null) {
    if ((item.owned_quantity ?? 0) <= 0) return [];
    return [(localPlayerId === null ? undefined : playerColors[localPlayerId]) ?? SHOP_PIP_FALLBACK_COLOR];
  }
  const slots = Object.keys(playerColors);
  const slotOf = (playerId: string) => {
    const index = slots.indexOf(playerId);
    return index < 0 ? slots.length : index;
  };
  return [...new Set(item.owner_player_ids)]
    .sort((a, b) => slotOf(a) - slotOf(b))
    .map((playerId) => playerColors[playerId] ?? SHOP_PIP_FALLBACK_COLOR);
}

// The default five-column widths reproduce the NTF/CS2 menu. SCP has its own
// category order, so its danger and high-risk columns use the swapped widths.
const FIVE_COLUMN_WIDTHS = [171, 171, 209, 228, 171] as const;
const SCP_FIVE_COLUMN_WIDTHS = [171, 209, 228, 171, 171] as const;

export function allocateShopColumnWidths(count: number, role: Role = "ntf"): number[] {
  if (count <= 0) return [];
  if (count === FIVE_COLUMN_WIDTHS.length) {
    return [...(role === "scp" ? SCP_FIVE_COLUMN_WIDTHS : FIVE_COLUMN_WIDTHS)];
  }
  const width = SHOP_CONTENT_WIDTH / count;
  return Array.from({ length: count }, () => width);
}

export type ShopColumn = {
  id: string;
  label: string;
  order: number;
  width: number;
  items: ShopItem[];
};

export function groupShopItems(items: ShopItem[], categories?: readonly ShopCategory[], role: Role = "ntf"): ShopColumn[] {
  if (!categories || categories.length === 0) {
    return [{ id: "all", label: "商店", order: 0, width: SHOP_CONTENT_WIDTH, items: [...items] }];
  }
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const buckets = new Map(sorted.map((category) => [category.id, [] as ShopItem[]]));
  const unassigned: ShopItem[] = [];
  for (const item of items) {
    if (item.category_id && buckets.has(item.category_id)) buckets.get(item.category_id)?.push(item);
    else unassigned.push(item);
  }
  if (unassigned.length) {
    const fallback = sorted[sorted.length - 1];
    if (fallback) buckets.get(fallback.id)?.push(...unassigned);
  }
  const widths = allocateShopColumnWidths(sorted.length, role);
  return sorted.map((category, index) => ({ ...category, width: widths[index], items: buckets.get(category.id) ?? [] }));
}

export function formatShopMoney(value: number): string {
  return `$${Math.max(0, Math.trunc(value)).toLocaleString("en-US")}`;
}

// CS2 keeps the min-money label neutral at the high threshold and shifts it
// toward the buy-menu warning color as the estimate approaches the low
// threshold. These are the stock client thresholds; the plugin still owns the
// amount itself, while this helper only reproduces the native presentation.
const SHOP_MIN_MONEY_LOW = 1_400;
const SHOP_MIN_MONEY_HIGH = 5_000;
const SHOP_MIN_MONEY_BASE = [128, 128, 128] as const;
const SHOP_MIN_MONEY_WARNING = [177, 175, 45] as const;

export function shopMinMoneyColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return `rgb(${SHOP_MIN_MONEY_BASE.join(" ")})`;
  }
  const progress = Math.max(0, Math.min(1, (SHOP_MIN_MONEY_HIGH - value) / (SHOP_MIN_MONEY_HIGH - SHOP_MIN_MONEY_LOW)));
  const channels = SHOP_MIN_MONEY_BASE.map((channel, index) => Math.round(channel + (SHOP_MIN_MONEY_WARNING[index] - channel) * progress));
  return `rgb(${channels.join(" ")})`;
}
