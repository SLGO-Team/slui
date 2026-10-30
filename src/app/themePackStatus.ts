import { THEME_PACK_SHOP_SOUNDS } from "../features/shop/audio.ts";
import { FONT_FACES } from "../shared/fonts.ts";
import type { ThemePack } from "../shared/themePack.ts";

// Every file this version reads from the theme pack. Updates replace the app but never the pack, so a pack installed
// with an older version can lack files a newer one reads; each of those falls back to its bundled default.
export const THEME_PACK_FILES: readonly string[] = [...new Set([
  ...FONT_FACES.map((face) => face.pack.file),
  ...Object.values(THEME_PACK_SHOP_SOUNDS),
])].sort();

/** Files this version reads that an installed pack lacks; none without a pack, which is not an incomplete one. */
export function missingThemePackFiles(pack: ThemePack, required: readonly string[] = THEME_PACK_FILES): string[] {
  if (pack.files.size === 0) return [];
  return required.filter((file) => !pack.files.has(file));
}

/** Home page notice while the installed pack is incomplete. */
export type ThemePackNotice = { title: string; detail: string };

export function themePackNotice(missing: readonly string[]): ThemePackNotice | null {
  if (missing.length === 0) return null;
  const fonts = missing.some((file) => file.startsWith("fonts/"));
  const sounds = missing.some((file) => file.startsWith("sounds/"));
  const kind = fonts && sounds ? "字体和音效" : fonts ? "字体" : "音效";
  return { title: "主题包不完整", detail: `缺少 ${missing.length} 个文件，部分${kind}暂用内置版本，请更新主题包。` };
}

/** One diagnostics line for the pack this run loaded. */
export function themePackLogLine(pack: ThemePack, missing: readonly string[] = missingThemePackFiles(pack)): string {
  if (pack.files.size === 0) return "theme pack: none";
  const count = `theme pack: ${pack.files.size} files`;
  return missing.length === 0 ? `${count}, complete` : `${count}, missing ${missing.length}: ${missing.join(", ")}`;
}
