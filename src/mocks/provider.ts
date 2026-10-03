import type { ChatMessage, ChatNotice, MatchPlayer, MatchPlayerLoadout, MatchSnapshot, ProtocolEnvelope, ShopSnapshot, SlgoEvent } from "../contracts";
import { RealtimeMockProvider } from "./minimapProvider.ts";
import { mockMinimapInit, mockMinimapPositions } from "./minimapFixtures.ts";
export { mockMinimapInit, mockMinimapPositions } from "./minimapFixtures.ts";

const envelope = <T, TType extends string>(type: TType, sequence: number, payload: T): ProtocolEnvelope<T, TType> => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${sequence}`,
  server_id: "slgo-demo",
  instance_id: "instance-demo-1",
  round_id: "round-demo-7",
  sequence,
  type,
  sent_at: new Date().toISOString(),
  payload,
});

const ntfLoadout = (money: number, primary: string, utility: string[], armor: MatchPlayerLoadout["armor"], hasCommanderKeycard = false): MatchPlayerLoadout => ({
  money,
  primary_item_id: primary,
  utility_item_ids: utility,
  armor,
  has_commander_keycard: hasCommanderKeycard,
  has_generator_upgrade: false,
});

const scpLoadout = (money: number, role: string, upgrades: string[], hasGeneratorUpgrade = false): MatchPlayerLoadout => ({
  money,
  primary_item_id: role,
  utility_item_ids: upgrades,
  armor: null,
  has_commander_keycard: false,
  has_generator_upgrade: hasGeneratorUpgrade,
});

/**
 * Full (alive) loadouts of every mock player, keyed by player id. A snapshot only carries
 * them for the viewer's team, projected by presence (see projectMockLoadout).
 */
export const mockLoadoutById: Readonly<Record<string, MatchPlayerLoadout>> = {
  "76561198000000001": ntfLoadout(14_600, "GunE11SR", ["GrenadeFlash", "GrenadeHE", "Medkit", "SCP1344"], "light", true),
  "76561198000000002": ntfLoadout(4_800, "GunLogicer", ["GrenadeFlash", "Medkit", "SCP2176"], "combat"),
  "76561198000000003": ntfLoadout(900, "GunCOM15", ["GrenadeHE", "Medkit", "Painkillers", "SCP1853"], "heavy"),
  "76561198000000004": ntfLoadout(200, "GunCrossvec", ["GrenadeFlash", "Medkit", "SCP207"], "combat"),
  "76561198000000005": ntfLoadout(6_650, "GunFRMG0", ["Adrenaline", "SCP268"], "light"),
  "hud-large-team-a-06": ntfLoadout(3_250, "GunE11SR", ["GrenadeFlash", "Medkit"], "light"),
  "hud-large-team-a-07": ntfLoadout(2_100, "GunLogicer", ["GrenadeHE", "Painkillers", "SCP207"], "combat"),
  "hud-large-team-a-08": ntfLoadout(1_700, "GunCOM15", ["Medkit", "SCP1853"], "heavy"),
  "hud-large-team-a-09": ntfLoadout(950, "GunCrossvec", ["GrenadeFlash", "Adrenaline", "SCP268"], "combat"),
  "hud-large-team-a-10": ntfLoadout(500, "GunFRMG0", ["GrenadeHE", "SCP1344"], "light"),
  "76561198000000006": scpLoadout(3_200, "Scp173", ["HealthUpgrade2", "ShieldUpgrade1"], true),
  "76561198000000007": scpLoadout(1_450, "Scp939", ["HealthUpgrade1"]),
  "76561198000000008": scpLoadout(5_100, "Scp079", ["Scp079Level3"]),
  "76561198000000009": scpLoadout(2_600, "Scp106", ["ShieldUpgrade2"]),
  "76561198000000010": scpLoadout(800, "Scp049", []),
  "hud-large-team-b-06": scpLoadout(2_300, "Scp0492", ["HealthUpgrade1"]),
  "hud-large-team-b-07": scpLoadout(1_900, "Scp096", []),
  "hud-large-team-b-08": scpLoadout(1_200, "Scp3114", ["ShieldUpgrade1"]),
  "hud-large-team-b-09": scpLoadout(700, "Scp0492", []),
  "hud-large-team-b-10": scpLoadout(400, "Scp0492", ["HealthUpgrade3", "ShieldUpgrade3"], true),
};

/** The plugin's presence projection: offline -> null, dead -> money only, alive -> everything. */
export function projectMockLoadout(playerId: string, presence: Pick<MatchPlayer, "is_online" | "is_alive">): MatchPlayerLoadout | null {
  const loadout = mockLoadoutById[playerId];
  if (!loadout || !presence.is_online) return null;
  if (!presence.is_alive) {
    return { money: loadout.money, primary_item_id: null, utility_item_ids: [], armor: null, has_commander_keycard: false, has_generator_upgrade: false };
  }
  return loadout;
}

type MockVitals = Pick<MatchPlayer, "health" | "shield" | "max_health" | "max_shield" | "aux_power" | "max_aux_power">;

/**
 * SCP vitals on the plugin's scale: the 0-100 preset values scaled to SCP caps, and an alive SCP-079
 * reporting aux power in place of health and shield.
 */
export function scpMockVitals(playerId: string, vitals: Pick<MatchPlayer, "health" | "shield">, alive: boolean): MockVitals {
  if (!alive) return vitals;
  if (mockLoadoutById[playerId]?.primary_item_id === "Scp079") {
    return { health: null, shield: null, max_health: null, max_shield: null, aux_power: 87, max_aux_power: 125 };
  }
  const scale = (value: number | null | undefined, max: number) => value == null ? value : Math.round((value / 100) * max);
  return { health: scale(vitals.health, 3_300), shield: scale(vitals.shield, 1_000), max_health: 3_300, max_shield: 1_000 };
}

const withMockLoadout = (player: MatchPlayer): MatchPlayer => ({ ...player, loadout: projectMockLoadout(player.player_id, player) });

export const mockMatchSnapshot: MatchSnapshot = {
  viewer_team_id: "team-a",
  state: "ActionPhase",
  round: 7,
  max_rounds: 15,
  phase_remaining_ms: 93_000,
  phase_paused: false,
  generator_remaining_ms: null,
  pause_remaining_ms: null,
  teams: [
    {
      team_id: "team-a",
      role: "ntf",
      display_name: "Foundation",
      score: 4,
      players: ([
        { player_id: "76561198000000001", display_name: "Nova", avatar_url: null, is_online: true, is_alive: true, health: 100, shield: 70 , kills: 3 },
        { player_id: "76561198000000002", display_name: "Atlas", avatar_url: null, is_online: true, is_alive: true, health: 72, shield: 35 , kills: 1 },
        { player_id: "76561198000000003", display_name: "Cipher", avatar_url: null, is_online: true, is_alive: true, health: 45, shield: 100 },
        { player_id: "76561198000000004", display_name: "Vanguard", avatar_url: null, is_online: true, is_alive: true, health: 88 , kills: 5 },
        { player_id: "76561198000000005", display_name: "Echo", avatar_url: null, is_online: true, is_alive: true, health: 60, shield: 0, kills: 7 },
      ] satisfies MatchPlayer[]).map(withMockLoadout),
    },
    {
      team_id: "team-b",
      role: "scp",
      display_name: "Chaos",
      score: 2,
      players: [
        { player_id: "76561198000000006", display_name: "Rook", avatar_url: null, is_online: true, is_alive: true , kills: 2 },
        { player_id: "76561198000000007", display_name: "Striker", avatar_url: null, is_online: true, is_alive: true },
        { player_id: "76561198000000008", display_name: "Specter", avatar_url: null, is_online: true, is_alive: true , kills: 4 },
        { player_id: "76561198000000009", display_name: "Phantom", avatar_url: null, is_online: true, is_alive: false , kills: 1 },
        { player_id: "76561198000000010", display_name: "Warden", avatar_url: null, is_online: false, is_alive: false , kills: 6 },
      ],
    },
  ],
};

export const mockShopSnapshot: ShopSnapshot = {
  balance: 4250,
  next_round_min_money: 4400,
  window_open: true,
  categories: [
    { id: "equipment", label: "护甲", order: 1 },
    { id: "pistols", label: "收容物", order: 2 },
    { id: "midtier", label: "中级", order: 3 },
    { id: "rifles", label: "步枪", order: 4 },
    { id: "grenades", label: "道具", order: 5 },
  ],
  items: [
    { item_id: "ArmorLight", name: "轻型护甲", description: "轻便护甲，提升携带容量", icon_url: "/assets/slui-svg/ArmorLight.svg", price: 200, quantity: 1, owned_quantity: 0, category_id: "equipment", purchasable: true, unavailable_reason: null },
    { item_id: "ArmorCombat", name: "战术护甲", description: "均衡护甲，提升携带容量", icon_url: "/assets/slui-svg/ArmorCombat.svg", price: 650, quantity: 1, owned_quantity: 1, category_id: "equipment", purchasable: true, unavailable_reason: null },
    { item_id: "ArmorHeavy", name: "重型护甲", description: "有一定防护能力，大幅提升携带容量", icon_url: "/assets/slui-svg/ArmorHeavy.svg", price: 1000, quantity: 1, owned_quantity: 0, category_id: "equipment", purchasable: true, unavailable_reason: null },

    { item_id: "SCP500", name: "SCP-500", description: "万能药，能快速回复大量血量并消除多数负面效果", icon_url: "/assets/slui-svg/SCP500.svg", price: 600, quantity: 1, owned_quantity: 0, category_id: "pistols", purchasable: true, unavailable_reason: null },
    { item_id: "SCP207", name: "SCP-207", description: "可提升移动速度，但会持续损害你的身体", icon_url: "/assets/slui-svg/SCP207.svg", price: 500, quantity: 1, owned_quantity: 0, category_id: "pistols", purchasable: true, unavailable_reason: null },
    { item_id: "SCP1853", name: "SCP-1853", description: "当生命受到威胁时，让你变得更加敏捷，同时提升人机功效", icon_url: "/assets/slui-svg/SCP1853.svg", price: 800, quantity: 1, owned_quantity: 0, category_id: "pistols", purchasable: true, unavailable_reason: null },
    { item_id: "SCP1344", name: "SCP-1344", description: "神奇的眼镜，使用后可以透视其他生物的位置，但一旦戴上就不要摘下...", icon_url: "/assets/slui-svg/SCP1344.svg", price: 800, quantity: 1, owned_quantity: 0, category_id: "pistols", purchasable: true, unavailable_reason: null },
    { item_id: "SCP268", name: "SCP-268", description: "神奇的帽子，戴上它后你将短暂“消失”，交互会解除其效果", icon_url: "/assets/slui-svg/SCP268.svg", price: 800, quantity: 0, owned_quantity: 2, category_id: "pistols", purchasable: false, unavailable_reason: "库存已达上限" },
    { item_id: "SCP2176", name: "SCP-2176", description: "神奇的灯泡，因为其破碎后能干扰电子设备，因此对SCP-079有特效", icon_url: "/assets/slui-svg/SCP2176.svg", price: 500, quantity: 1, owned_quantity: 0, category_id: "pistols", purchasable: true, unavailable_reason: null },

    { item_id: "GunCOM15", name: "COM-15", description: "由某个科学家带来的自卫手枪，只适合对付如049-2之类的弱小目标", icon_url: "/assets/slui-svg/GunCOM15.svg", price: 200, quantity: 1, owned_quantity: 0, category_id: "midtier", purchasable: true, unavailable_reason: null },
    { item_id: "GunCOM18", name: "COM-18", description: "火力强大的手枪，经济而有效，适合在ECO局使用", icon_url: "/assets/slui-svg/GunCOM18.svg", price: 500, quantity: 1, owned_quantity: 0, category_id: "midtier", purchasable: true, unavailable_reason: null },
    { item_id: "GunFSP9", name: "FSP-9", description: "精准冲锋枪，但火力略显不足，适合在反ECO局使用", icon_url: "/assets/slui-svg/GunFSP9.svg", price: 1050, quantity: 1, owned_quantity: 0, category_id: "midtier", purchasable: true, unavailable_reason: null },
    { item_id: "GunCrossvec", name: "CrossVec", description: "性能优秀的冲锋枪，足以应对棘手的情况，适合在强起局使用", icon_url: "/assets/slui-svg/GunCrossvec.svg", price: 1950, quantity: 1, owned_quantity: 0, category_id: "midtier", purchasable: true, unavailable_reason: null },

    { item_id: "GunE11SR", name: "E-11 SR", description: "全能型步枪，深受作战人员喜爱，适合在任何情况使用", icon_url: "/assets/slui-svg/GunE11SR.svg", price: 2900, quantity: 1, owned_quantity: 0, category_id: "rifles", purchasable: true, unavailable_reason: null },
    { item_id: "GunFRMG0", name: "FRMG0", description: "九尾狐列装的全能轻机枪，火力强大，优秀但昂贵，且重量较高，适合在特殊情况使用", icon_url: "/assets/slui-svg/GunFRMG0.svg", price: 3300, quantity: 1, owned_quantity: 0, category_id: "rifles", purchasable: true, unavailable_reason: null },
    { item_id: "GunAK", name: "AK", description: "高爆发步枪，但难以控制，在近距离杀伤或远距离架枪时表现", icon_url: "/assets/slui-svg/GunAK.svg", price: 2700, quantity: 1, owned_quantity: 0, category_id: "rifles", purchasable: true, unavailable_reason: null },
    { item_id: "GunLogicer", name: "Logicer", description: "混沌分裂者列装的压制型机枪，火力强大，但机动时难以精确射击，且重量较高，适合在特殊情况使用", icon_url: "/assets/slui-svg/GunLogicer.svg", price: 3100, quantity: 1, owned_quantity: 0, category_id: "rifles", purchasable: true, unavailable_reason: null },
    { item_id: "MicroHID", name: "MicroHID", description: "专为收容SCP设计的放电装置，十分强大但电量有限，适合在特殊情况使用", icon_url: "/assets/slui-svg/MicroHID.svg", price: 4750, quantity: 1, owned_quantity: 0, category_id: "rifles", purchasable: false, unavailable_reason: "余额不足" },

    { item_id: "GrenadeFlash", name: "闪光弹", description: "能致盲敌人", icon_url: "/assets/slui-svg/GrenadeFlash.svg", price: 200, quantity: 2, owned_quantity: 0, category_id: "grenades", purchasable: true, unavailable_reason: null },
    { item_id: "GrenadeHE", name: "高爆手雷", description: "能造成大量伤害，可以有效压制敌人", icon_url: "/assets/slui-svg/GrenadeHE.svg", price: 300, quantity: 2, owned_quantity: 0, category_id: "grenades", purchasable: true, unavailable_reason: null },
    { item_id: "Painkillers", name: "止痛药", description: "缓慢回复血量", icon_url: "/assets/slui-svg/Painkillers.svg", price: 100, quantity: 2, owned_quantity: 0, category_id: "grenades", purchasable: true, unavailable_reason: null },
    { item_id: "Medkit", name: "医疗包", description: "瞬间回复血量", icon_url: "/assets/slui-svg/Medkit.svg", price: 200, quantity: 2, owned_quantity: 0, category_id: "grenades", purchasable: true, unavailable_reason: null },
    { item_id: "Adrenaline", name: "肾上腺素", description: "提供临时护盾，立即回复体力，还能有效反制一些SCP", icon_url: "/assets/slui-svg/Adrenaline.svg", price: 400, quantity: 2, owned_quantity: 0, category_id: "grenades", purchasable: true, unavailable_reason: null },
  ],
};

/**
 * SCP faction fixture. Categories mirror the plugin's server-owned grouping:
 * equipment, danger/high-risk role tiers, and separate health/shield columns.
 */
export const mockScpShopSnapshot: ShopSnapshot = {
  balance: 4250,
  next_round_min_money: 4400,
  window_open: true,
  categories: [
    { id: "scp-equipment", label: "装备", order: 1 },
    { id: "scp-low", label: "危险", order: 2 },
    { id: "scp-mid", label: "高危", order: 3 },
    { id: "scp-health", label: "生命", order: 4 },
    { id: "scp-shield", label: "护盾", order: 5 },
  ],
  items: [
    { item_id: "Scp049", name: "SCP-049", description: "无声而致命，埋伏起来给予敌人出其不意的打击，适合ECO局使用", icon_url: "/assets/slui-svg/Scp049.svg", price: 800, quantity: 1, owned_quantity: 0, category_id: "scp-low", purchasable: true, unavailable_reason: null },
    { item_id: "Scp0492", name: "SCP-049-2", description: "小僵尸？依赖SCP-049的技能回复护盾，团结力量大，适合特殊情况使用", icon_url: "/assets/slui-svg/Scp0492.svg", price: 200, quantity: 1, owned_quantity: 0, category_id: "scp-low", purchasable: true, unavailable_reason: null },
    { item_id: "Scp3114", name: "SCP-3114", description: "能制造意想不到的混乱，适合在特殊情况使用", icon_url: "/assets/slui-svg/Scp3114.svg", price: 1200, quantity: 1, owned_quantity: 0, category_id: "scp-low", purchasable: true, unavailable_reason: null },

    { item_id: "Scp173", name: "SCP-173", description: "移动速度极快，抗伤能力较强，不擅长单打独斗，适合任何情况使用", icon_url: "/assets/slui-svg/Scp173.svg", price: 1950, quantity: 1, owned_quantity: 0, category_id: "scp-mid", purchasable: true, unavailable_reason: null },
    { item_id: "Scp939", name: "SCP-939", description: "全能，适合任何情况使用", icon_url: "/assets/slui-svg/Scp939.svg", price: 2900, quantity: 1, owned_quantity: 0, category_id: "scp-mid", purchasable: true, unavailable_reason: null },
    { item_id: "Scp106", name: "SCP-106", description: "位移和生存能力强，擅长侦查和包抄，适合任何情况使用", icon_url: "/assets/slui-svg/Scp106.svg", price: 3300, quantity: 1, owned_quantity: 0, category_id: "scp-mid", purchasable: true, unavailable_reason: null },
    { item_id: "Scp079", name: "SCP-079", description: "顶级辅助，和队友协作防守发电机，适合特殊情况使用", icon_url: "/assets/slui-svg/Scp079.svg", price: 2700, quantity: 1, owned_quantity: 0, category_id: "scp-mid", purchasable: true, unavailable_reason: null },

    { item_id: "Scp096", name: "SCP-096", description: "进攻能力极强，但无法持续作战，需要与队友配合，适合特殊情况使用", icon_url: "/assets/slui-svg/Scp096.svg", price: 4750, quantity: 1, owned_quantity: 0, category_id: "scp-mid", purchasable: false, unavailable_reason: "余额不足" },

    { item_id: "HealthUpgrade1", name: "生命强化 I", description: "增加生命上限", icon_url: "/assets/slui-svg/HealthUpgrade.svg", price: 250, quantity: 1, owned_quantity: 0, category_id: "scp-health", purchasable: true, unavailable_reason: null },
    { item_id: "HealthUpgrade2", name: "生命强化 II", description: "增加生命上限", icon_url: "/assets/slui-svg/HealthUpgrade.svg", price: 500, quantity: 1, owned_quantity: 0, category_id: "scp-health", purchasable: true, unavailable_reason: null },
    { item_id: "HealthUpgrade3", name: "生命强化 III", description: "增加生命上限", icon_url: "/assets/slui-svg/HealthUpgrade.svg", price: 1000, quantity: 1, owned_quantity: 0, category_id: "scp-health", purchasable: true, unavailable_reason: null },

    { item_id: "ShieldUpgrade1", name: "护盾强化 I", description: "增加护盾上限", icon_url: "/assets/slui-svg/ShieldUpgrade.svg", price: 400, quantity: 1, owned_quantity: 0, category_id: "scp-shield", purchasable: true, unavailable_reason: null },
    { item_id: "ShieldUpgrade2", name: "护盾强化 II", description: "增加护盾上限", icon_url: "/assets/slui-svg/ShieldUpgrade.svg", price: 800, quantity: 1, owned_quantity: 0, category_id: "scp-shield", purchasable: true, unavailable_reason: null },
    { item_id: "ShieldUpgrade3", name: "护盾强化 III", description: "增加护盾上限", icon_url: "/assets/slui-svg/ShieldUpgrade.svg", price: 1600, quantity: 1, owned_quantity: 0, category_id: "scp-shield", purchasable: true, unavailable_reason: null },

    { item_id: "GeneratorInteractionUpgrade", name: "电板破坏加速", description: "缩短关闭发电机的时间至5秒", icon_url: "/assets/icons/wire-cutters.svg", price: 400, quantity: 1, owned_quantity: 0, category_id: "scp-equipment", purchasable: true, unavailable_reason: null },
  ],
};

/** SCP-079 receives a server-defined power column instead of health/shield. */
export const mockScp079ShopSnapshot: ShopSnapshot = {
  ...mockScpShopSnapshot,
  categories: [
    { id: "scp-equipment", label: "装备", order: 1 },
    { id: "scp-low", label: "危险", order: 2 },
    { id: "scp-mid", label: "高危", order: 3 },
    { id: "scp-power", label: "电力升级", order: 4 },
  ],
  items: [
    ...mockScpShopSnapshot.items.filter((item) => item.category_id === "scp-equipment"),
    ...mockScpShopSnapshot.items
      .filter((item) => item.category_id === "scp-low" || item.category_id === "scp-mid")
      .map((item) => item.item_id === "Scp079"
        ? { ...item, quantity: 0, owned_quantity: 1, purchasable: false, unavailable_reason: "已拥有当前角色" }
        : item),
    { item_id: "Scp079Level2", name: "SCP-079 等级 II", description: "提升SCP-079至2级", icon_url: "/assets/slui-svg/Scp079Upgrade.svg", price: 500, quantity: 1, owned_quantity: 0, category_id: "scp-power", purchasable: true, unavailable_reason: null },
    { item_id: "Scp079Level3", name: "SCP-079 等级 III", description: "提升SCP-079至3级", icon_url: "/assets/slui-svg/Scp079Upgrade.svg", price: 1200, quantity: 1, owned_quantity: 0, category_id: "scp-power", purchasable: true, unavailable_reason: null },
    { item_id: "Scp079Level4", name: "SCP-079 等级 IV", description: "提升SCP-079至4级", icon_url: "/assets/slui-svg/Scp079Upgrade.svg", price: 2100, quantity: 1, owned_quantity: 0, category_id: "scp-power", purchasable: true, unavailable_reason: null },
  ],
};

export type MockShopRole = "scp" | "scp079";

export function mockShopSnapshotFor(viewerTeamId: "team-a" | "team-b", shopRole: MockShopRole = "scp"): ShopSnapshot {
  if (viewerTeamId !== "team-b") return mockShopSnapshot;
  return shopRole === "scp079" ? mockScp079ShopSnapshot : mockScpShopSnapshot;
}

export const mockChatHistory: ChatMessage[] = [
  { message_id: "chat-1", scope: "team", sender_id: "76561198000000002", sender_name: "Atlas", team_id: "team-a", role: "ntf", body: "Holding the west checkpoint.", sent_at: new Date("2026-08-25T12:00:00.000Z").toISOString() },
  { message_id: "chat-2", scope: "team", sender_id: "76561198000000001", sender_name: "Nova", team_id: "team-a", role: "ntf", body: "Copy. Rotating now.", sent_at: new Date("2026-08-25T12:00:03.000Z").toISOString() },
  { message_id: "chat-3", scope: "global", sender_id: "76561198000000006", sender_name: "Rook", team_id: "team-b", role: "scp", body: "gl hf <3", sent_at: new Date("2026-08-25T12:00:05.000Z").toISOString() },
];

export const mockChatNotices: ChatNotice[] = [
  { notice_id: "notice-1", segments: [{ text: "Echo 加入了游戏", tone: "muted" }], sent_at: new Date("2026-08-25T12:00:01.000Z").toISOString() },
  { notice_id: "notice-2", segments: [{ text: "击杀奖励 ", tone: "default" }, { text: "+300$", tone: "money" }], sent_at: new Date("2026-08-25T12:00:04.000Z").toISOString() },
];

export const mockEvents: SlgoEvent[] = [
  envelope("sidecar.baseline", 1, { baseline: true }),
  envelope("match.snapshot", 2, mockMatchSnapshot),
  envelope("minimap.init", 3, mockMinimapInit),
  envelope("minimap.positions", 4, mockMinimapPositions),
  envelope("shop.snapshot", 5, mockShopSnapshot),
  envelope("chat.message", 6, mockChatHistory[0]),
  envelope("chat.notice", 7, mockChatNotices[0]),
  envelope("chat.message", 8, mockChatHistory[1]),
  envelope("chat.notice", 9, mockChatNotices[1]),
  envelope("chat.message", 10, mockChatHistory[2]),
] as SlgoEvent[];

function publicMockPlayer(player: MatchPlayer): MatchPlayer {
  const publicPlayer = { ...player };
  delete publicPlayer.health;
  delete publicPlayer.shield;
  delete publicPlayer.max_health;
  delete publicPlayer.max_shield;
  delete publicPlayer.aux_power;
  delete publicPlayer.max_aux_power;
  delete publicPlayer.loadout;
  return publicPlayer;
}

function mockSnapshotForViewer(viewerTeamId: "team-a" | "team-b"): MatchSnapshot {
  if (viewerTeamId === "team-a") return mockMatchSnapshot;

  const scpVitals = [
    { health: 100, shield: 70 },
    { health: 82, shield: 35 },
    { health: 45, shield: 100 },
    { health: 0, shield: 0 },
    { health: 0, shield: 0 },
  ];

  return {
    ...mockMatchSnapshot,
    viewer_team_id: "team-b",
    teams: [
      {
        ...mockMatchSnapshot.teams[0],
        players: mockMatchSnapshot.teams[0].players.map(publicMockPlayer),
      },
      {
        ...mockMatchSnapshot.teams[1],
        players: mockMatchSnapshot.teams[1].players.map((player, index) => withMockLoadout({
          ...player,
          ...scpMockVitals(player.player_id, scpVitals[index], player.is_online && player.is_alive),
        })),
      },
    ],
  };
}

export function createMockProvider(viewerTeamId: "team-a" | "team-b" = "team-a", shopRole: MockShopRole = "scp") {
  const snapshot = mockSnapshotForViewer(viewerTeamId);
  const shopSnapshot = mockShopSnapshotFor(viewerTeamId, shopRole);
  const events = mockEvents.map((event) => (
    event.type === "match.snapshot"
      ? { ...event, payload: snapshot }
      : event.type === "shop.snapshot"
        ? { ...event, payload: shopSnapshot }
      : event
  )) as SlgoEvent[];
  return new RealtimeMockProvider(events, viewerTeamId);
}
