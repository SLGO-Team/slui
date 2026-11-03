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

/** The brightest washed channel (white artwork): no room pixel is brighter than this. */
export const ZONE_WASH_PEAK = Math.max(...Object.values(ZONE_WASH).flat()) / 255;

/** The zone wash scaled so its brightest channel is 255, for the `mapBlend` layers that dim it back with opacity. */
export const BLEND_WASH: Readonly<Record<MinimapZone, readonly [number, number, number]>> = {
  HeavyContainment: ZONE_WASH.HeavyContainment.map((channel) => channel / ZONE_WASH_PEAK) as [number, number, number],
  Entrance: ZONE_WASH.Entrance.map((channel) => channel / ZONE_WASH_PEAK) as [number, number, number],
};

/**
 * CS2 `cl_hud_radar_map_additive` adds the map to the blurred world under the radar's black fill: M + (1 - a)·W. The
 * page never sees the game; DWM composites it under the page as C + (1 - α)·W (premultiplied). So the radar keeps
 * α = a and C = M: the `BLEND_WASH` rooms over an opaque black fill, all of them dimmed to `roomOpacity` by black
 * over them (one picture, so room seams scale too), the whole base at opacity a.
 * That is exact while the wash fits under a (C ≤ α); below `ZONE_WASH_PEAK` the same rooms are lifted at
 * `liftOpacity`, which keeps C = M and raises α inside the rooms only to the peak, the least that can carry it.
 */
export function mapBlendLayers(backgroundAlpha: number): { roomOpacity: number; liftOpacity: number } {
  const peak = ZONE_WASH_PEAK;
  if (backgroundAlpha >= peak) return { roomOpacity: peak / backgroundAlpha, liftOpacity: 0 };
  return { roomOpacity: 1, liftOpacity: (peak - backgroundAlpha) / (1 - backgroundAlpha) };
}
