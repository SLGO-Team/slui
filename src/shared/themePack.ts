// Optional theme pack: an external directory whose files override bundled fonts
// and sounds one by one. platform/themePack.ts loads it once before the first
// render; features only resolve asset URLs through it.

export type ThemePack = {
  /** Relative paths inside the pack, such as `fonts/stratum2-bold.otf`. */
  readonly files: ReadonlySet<string>;
  readonly baseUrl: string;
};

export const EMPTY_THEME_PACK: ThemePack = { files: new Set(), baseUrl: "" };

let activeThemePack = EMPTY_THEME_PACK;

export function setThemePack(pack: ThemePack): void {
  activeThemePack = pack;
}

export function currentThemePack(): ThemePack {
  return activeThemePack;
}

export function themePackUrl(pack: ThemePack, file: string): string | null {
  return pack.files.has(file) ? pack.baseUrl + file : null;
}
