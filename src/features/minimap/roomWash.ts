import type { MinimapZone } from "../../contracts/index.ts";

/** CS2's radar tints the map per zone. The room artwork is drawn in white and light grey, so the tint multiplies it. */
export const ZONE_WASH: Readonly<Record<MinimapZone, readonly [number, number, number]>> = {
  HeavyContainment: [80, 92, 91],
  Entrance: [90, 96, 80],
};

const FILL = /\bfill="#([0-9a-fA-F]{6})"/g;

/**
 * The artwork with every `fill="#rrggbb"` multiplied by `rgb` (sRGB, per channel; opacity untouched): the pixels an
 * sRGB colour-matrix filter would give, without a filter. A filter on each room (or each zone group) is re-rasterized on
 * every camera move, and two filtered layers meeting at a zone border drew a hairline between them (task
 * 10-31-perf-radar-zone-filters). `minimap-wash-smoke` checks that the artwork paints with nothing else.
 */
export function washSvg(svg: string, rgb: readonly [number, number, number]): string {
  return svg.replace(FILL, (_, hex: string) => {
    const value = Number.parseInt(hex, 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    return `fill="#${channels.map((channel, index) => Math.round(channel * rgb[index] / 255).toString(16).padStart(2, "0")).join("")}"`;
  });
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
