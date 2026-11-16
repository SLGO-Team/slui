// Text formatting for the replay console and catalog (no layout: the components come from the CS2 captures).

/** `m:ss`, or `m:ss.d` with tenths (the drag label); hours roll into minutes like CS2's demo time label. */
export function formatReplayTime(ms: number, tenths = false): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalTenths = Math.floor(safe / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const base = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  return tenths ? `${base}.${totalTenths % 10}` : base;
}

/** `0.25×`, `1×`, `4×`. */
export function formatReplaySpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/** The first 8 characters of a match id (status lines: "正在加载 01a1e2db…"). */
export const shortMatchId = (matchId: string) => matchId.slice(0, 8);

const pad = (value: number) => value.toString().padStart(2, "0");

/** A match start in local time, `YYYY-MM-DD HH:mm`; the raw text when unparseable. */
export function formatCatalogStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A catalog duration (`null` = no footer yet). */
export const formatCatalogDuration = (ms: number | null) => ms === null ? "—" : formatReplayTime(ms);

/** "第 x / y 页，共 n 条". */
export const formatCatalogPage = (page: number, pageCount: number, total: number) => `第 ${page} / ${pageCount} 页，共 ${total} 条`;

/** The round label of the control row: the round number, or 热身 before the first round. */
export const formatReplayRound = (round: number | null, warmup: boolean) => round !== null ? `第 ${round} 回合` : warmup ? "热身" : "—";
