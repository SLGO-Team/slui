import { themePackUrl, type ThemePack } from "./themePack.ts";

// Every UI font face is registered here instead of CSS @font-face so each face
// can carry metrics for whichever source actually loads: theme-pack Stratum2
// and the bundled fallback need different baseline overrides, which a CSS
// `src` fallback list cannot express. CSS keeps using the family names below.

// `sizeAdjust` is supported by Chromium/WebView2 but missing from the TS DOM lib.
type FontMetrics = Pick<FontFaceDescriptors, "ascentOverride" | "descentOverride" | "lineGapOverride" | "featureSettings"> & {
  sizeAdjust?: string;
};

type FontSource = {
  file: string;
  format: "opentype" | "truetype" | "woff2";
  metrics?: FontMetrics;
};

export type FontFaceSpec = {
  family: string;
  weight: number;
  /** Path inside the theme pack. */
  pack: FontSource;
  /** Bundled URL under public/, used when the pack does not provide `pack.file`. */
  fallback: FontSource;
};

// Effective line metrics (fractions of the font size) that layouts were tuned
// against. Stratum2's own tables give NATURAL; Panorama centers HUD text on cap
// height, which CAP_CENTERED reproduces on the Web.
type LineMetrics = { ascent: number; descent: number };
const NATURAL: LineMetrics = { ascent: 0.9, descent: 0.3 };
const CAP_CENTERED: LineMetrics = { ascent: 0.92, descent: 0.08 };
const SCORE: LineMetrics = { ascent: 1, descent: 0 };

const STRATUM2_CAP_HEIGHT = 0.666;

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

function stratum(file: string, line: LineMetrics | null): FontSource {
  return {
    file: `fonts/${file}`,
    format: file.endsWith(".ttf") ? "truetype" : "opentype",
    metrics: line ? { ascentOverride: percent(line.ascent), descentOverride: percent(line.descent), lineGapOverride: "0%" } : undefined,
  };
}

// Fallbacks are scaled to Stratum2's cap height. Chromium multiplies the
// ascent/descent overrides by size-adjust, so they are divided back here to keep
// the same line box. Tabular figures stand in for Stratum2's TF/Mono/Monodigit cuts.
function fallback(file: string, capHeight: number, line: LineMetrics, tabular = false): FontSource {
  const scale = STRATUM2_CAP_HEIGHT / capHeight;
  return {
    file: `/assets/fonts/fallback/${file}`,
    format: "truetype",
    metrics: {
      sizeAdjust: percent(scale),
      ascentOverride: percent(line.ascent / scale),
      descentOverride: percent(line.descent / scale),
      lineGapOverride: "0%",
      ...(tabular ? { featureSettings: "\"tnum\"" } : {}),
    },
  };
}

const BARLOW_CAP_HEIGHT = 0.7;
const SAIRA_CAP_HEIGHT = 0.688;
const barlow = (weight: "Light" | "Regular" | "Medium" | "Bold", line: LineMetrics, tabular = false) =>
  fallback(`barlow/Barlow-${weight}.ttf`, BARLOW_CAP_HEIGHT, line, tabular);
const sairaCondensed = (weight: "light" | "medium" | "bold", line: LineMetrics) =>
  fallback(`saira/saira-condensed-${weight}.ttf`, SAIRA_CAP_HEIGHT, line);

export const FONT_FACES: readonly FontFaceSpec[] = [
  // Top HUD (HudTeamCounter.css)
  { family: "Stratum2 Bold TF", weight: 700, pack: stratum("stratum2_tf_bold.otf", null), fallback: barlow("Bold", NATURAL, true) },
  { family: "Stratum2 HUD Timer", weight: 700, pack: stratum("stratum2_tf_bold.otf", CAP_CENTERED), fallback: barlow("Bold", CAP_CENTERED, true) },
  { family: "Stratum2 HUD Score", weight: 700, pack: stratum("stratum2_tf_bold.otf", SCORE), fallback: barlow("Bold", SCORE, true) },
  { family: "Stratum2 Light Condensed", weight: 300, pack: stratum("stratum2condensed-light.otf", null), fallback: sairaCondensed("light", NATURAL) },
  { family: "Stratum2 Mono", weight: 700, pack: stratum("stratum2mono-bold.otf", null), fallback: barlow("Bold", NATURAL, true) },
  // Shop (ShopPanel.css). The monodigit files only carry digit glyphs, so CSS
  // rules using them keep a full fallback chain.
  { family: "Stratum2 Shop", weight: 400, pack: stratum("stratum2-regular.otf", CAP_CENTERED), fallback: barlow("Regular", CAP_CENTERED) },
  { family: "Stratum2 Shop", weight: 500, pack: stratum("stratum2-medium.otf", CAP_CENTERED), fallback: barlow("Medium", CAP_CENTERED) },
  { family: "Stratum2 Shop", weight: 700, pack: stratum("stratum2-bold.otf", CAP_CENTERED), fallback: barlow("Bold", CAP_CENTERED) },
  {
    family: "Stratum2 Shop Condensed",
    weight: 500,
    pack: stratum("stratum2condensed-medium.otf", CAP_CENTERED),
    fallback: sairaCondensed("medium", CAP_CENTERED),
  },
  {
    family: "Stratum2 Shop Condensed",
    weight: 700,
    pack: stratum("stratum2condensed-bold.otf", CAP_CENTERED),
    fallback: sairaCondensed("bold", CAP_CENTERED),
  },
  { family: "Stratum2 Shop Mono", weight: 400, pack: stratum("stratum2mono-regular.otf", CAP_CENTERED), fallback: barlow("Regular", CAP_CENTERED, true) },
  { family: "Stratum2 Shop Mono", weight: 700, pack: stratum("stratum2mono-bold.otf", CAP_CENTERED), fallback: barlow("Bold", CAP_CENTERED, true) },
  {
    family: "Stratum2 Shop Monodigit",
    weight: 700,
    pack: stratum("stratum2bold_monodigit.ttf", CAP_CENTERED),
    fallback: barlow("Bold", CAP_CENTERED, true),
  },
  {
    family: "Stratum2 Shop Regular Monodigit",
    weight: 400,
    pack: stratum("stratum2regular_monodigit.ttf", CAP_CENTERED),
    fallback: barlow("Regular", CAP_CENTERED, true),
  },
  // Chat (ChatInput.css)
  { family: "Stratum2 Chat", weight: 300, pack: stratum("stratum2-light.otf", CAP_CENTERED), fallback: barlow("Light", CAP_CENTERED) },
  { family: "Stratum2 Chat", weight: 400, pack: stratum("stratum2-regular.otf", CAP_CENTERED), fallback: barlow("Regular", CAP_CENTERED) },
  { family: "Stratum2 Chat", weight: 500, pack: stratum("stratum2-medium.otf", CAP_CENTERED), fallback: barlow("Medium", CAP_CENTERED) },
  { family: "Stratum2 Chat", weight: 700, pack: stratum("stratum2-bold.otf", CAP_CENTERED), fallback: barlow("Bold", CAP_CENTERED) },
  // Minimap (MinimapRadar.css)
  { family: "Stratum2 Radar", weight: 500, pack: stratum("stratum2-medium.otf", CAP_CENTERED), fallback: barlow("Medium", CAP_CENTERED) },
  // Win panel (WinPanel.css). The title is centred on cap height like Panorama's vertical-align
  // center; the other labels are top-aligned Panorama labels and keep Stratum2's own metrics.
  {
    family: "Stratum2 WinPanel Title",
    weight: 700,
    pack: stratum("stratum2condensed-bold.otf", CAP_CENTERED),
    fallback: sairaCondensed("bold", CAP_CENTERED),
  },
  { family: "Stratum2 WinPanel", weight: 700, pack: stratum("stratum2-bold.otf", null), fallback: barlow("Bold", NATURAL) },
  {
    family: "Stratum2 WinPanel Condensed",
    weight: 500,
    pack: stratum("stratum2condensed-medium.otf", null),
    fallback: sairaCondensed("medium", NATURAL),
  },
  // Message zone (MessageZone.css): stratum-medium-tf labels, vertically centred like Panorama.
  { family: "Stratum2 Messages", weight: 500, pack: stratum("stratum2-medium.otf", CAP_CENTERED), fallback: barlow("Medium", CAP_CENTERED, true) },
];

export type ResolvedFontFace = {
  family: string;
  source: string;
  descriptors: FontFaceDescriptors & FontMetrics;
};

export function resolveFontFaces(pack: ThemePack, faces: readonly FontFaceSpec[] = FONT_FACES): ResolvedFontFace[] {
  return faces.map((face) => {
    const packUrl = themePackUrl(pack, face.pack.file);
    const chosen = packUrl ? { ...face.pack, url: packUrl } : { ...face.fallback, url: face.fallback.file };
    return {
      family: face.family,
      source: `url(${JSON.stringify(chosen.url)}) format("${chosen.format}")`,
      descriptors: { style: "normal", weight: String(face.weight), display: "swap", ...chosen.metrics },
    };
  });
}

/** Registers faces without waiting for downloads; the browser fetches on first use. */
export function registerFontFaces(pack: ThemePack, fonts: FontFaceSet = document.fonts): void {
  for (const face of resolveFontFaces(pack)) {
    fonts.add(new FontFace(face.family, face.source, face.descriptors));
  }
}
