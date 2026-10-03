export type RadarPreferences = {
  alwaysCentered: boolean;
  orientation: "fixed" | "heading-up";
  mapBlend: boolean;
  blurBackground: boolean;
  backgroundAlpha: number;
  hudScale: number;
  mapScale: number;
  alternateMapScale: number;
  squareWithScoreboard: boolean;
  forceSquare: boolean;
  dynamicZoom: boolean;
};

export type RadarControls = { alternateZoomActive: boolean };
export type RadarRenderCapabilities = { pageBackdrop: boolean };

// SLUI defaults, not an assertion about the native CS2 defaults.
export const DEFAULT_RADAR_PREFERENCES: Readonly<RadarPreferences> = {
  alwaysCentered: true, orientation: "fixed", mapBlend: true, blurBackground: true,
  backgroundAlpha: 0.63, hudScale: 1, mapScale: 0.70, alternateMapScale: 1,
  squareWithScoreboard: true, forceSquare: false, dynamicZoom: false,
};
export const CS2_REFERENCE_RADAR_PREFERENCES: Readonly<RadarPreferences> = {
  ...DEFAULT_RADAR_PREFERENCES, orientation: "heading-up", mapScale: 0.25,
};
export const RADAR_NUMERIC_RANGES = {
  backgroundAlpha: [0, 1], hudScale: [0.8, 1.3], mapScale: [0.25, 1], alternateMapScale: [0.25, 1],
} as const;

export function normalizeRadarPreferences(value?: Partial<RadarPreferences> | null): RadarPreferences {
  const input = value && typeof value === "object" ? value : {};
  const number = (key: keyof typeof RADAR_NUMERIC_RANGES): number => {
    const candidate = input[key];
    const [min, max] = RADAR_NUMERIC_RANGES[key];
    return typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(min, Math.min(max, candidate)) : DEFAULT_RADAR_PREFERENCES[key];
  };
  const boolean = (key: "alwaysCentered" | "mapBlend" | "blurBackground" | "squareWithScoreboard" | "forceSquare" | "dynamicZoom"): boolean =>
    typeof input[key] === "boolean" ? input[key] : DEFAULT_RADAR_PREFERENCES[key];
  return {
    alwaysCentered: boolean("alwaysCentered"), orientation: input.orientation === "heading-up" ? "heading-up" : "fixed",
    mapBlend: boolean("mapBlend"), blurBackground: boolean("blurBackground"),
    backgroundAlpha: number("backgroundAlpha"), hudScale: number("hudScale"), mapScale: number("mapScale"),
    alternateMapScale: number("alternateMapScale"), squareWithScoreboard: boolean("squareWithScoreboard"),
    forceSquare: boolean("forceSquare"), dynamicZoom: boolean("dynamicZoom"),
  };
}
