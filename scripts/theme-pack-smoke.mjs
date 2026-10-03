import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { BUILTIN_SHOP_SOUND_SOURCES, resolveShopSoundSources, THEME_PACK_SHOP_SOUNDS } from "../src/features/shop/audio.ts";
import { FONT_FACES, resolveFontFaces } from "../src/shared/fonts.ts";
import { EMPTY_THEME_PACK, themePackUrl } from "../src/shared/themePack.ts";

const pack = (files) => ({ files: new Set(files), baseUrl: "http://theme.localhost/" });
const fullPack = pack([
  ...FONT_FACES.map((face) => face.pack.file),
  THEME_PACK_SHOP_SOUNDS.select,
  THEME_PACK_SHOP_SOUNDS.unavailable,
  ...THEME_PACK_SHOP_SOUNDS.purchase,
]);

assert.equal(themePackUrl(fullPack, "fonts/stratum2-bold.otf"), "http://theme.localhost/fonts/stratum2-bold.otf");
assert.equal(themePackUrl(EMPTY_THEME_PACK, "fonts/stratum2-bold.otf"), null);

// Every face resolves to its pack file with the pack metrics when the pack is complete.
const packFaces = resolveFontFaces(fullPack);
assert.equal(packFaces.length, FONT_FACES.length);
for (const [index, face] of FONT_FACES.entries()) {
  const resolved = packFaces[index];
  assert.equal(resolved.family, face.family);
  assert.ok(resolved.source.startsWith(`url("http://theme.localhost/${face.pack.file}")`), resolved.source);
  assert.equal(resolved.descriptors.weight, String(face.weight));
  assert.equal(resolved.descriptors.ascentOverride, face.pack.metrics?.ascentOverride);
}

// Without the pack every face uses its bundled fallback (and that file exists).
const fallbackFaces = resolveFontFaces(EMPTY_THEME_PACK);
assert.equal(fallbackFaces.length, FONT_FACES.length);
for (const [index, face] of FONT_FACES.entries()) {
  await access(new URL(`../public${face.fallback.file}`, import.meta.url));
  assert.ok(fallbackFaces[index].source.startsWith(`url("/assets/fonts/fallback/`), fallbackFaces[index].source);
  assert.ok(fallbackFaces[index].descriptors.sizeAdjust, `${face.family} fallback is scaled to Stratum2 cap height`);
}

// A partial pack overrides only what it provides.
const partial = pack(["fonts/stratum2-medium.otf", "sounds/radial_menu_buy_02.wav"]);
const partialFaces = resolveFontFaces(partial);
for (const face of partialFaces) {
  const spec = FONT_FACES.find((candidate) => candidate.family === face.family && String(candidate.weight) === face.descriptors.weight);
  const fromPack = face.source.includes("theme.localhost");
  assert.equal(fromPack, spec.pack.file === "fonts/stratum2-medium.otf", `${face.family} ${face.descriptors.weight}`);
}
assert.deepEqual(resolveShopSoundSources(EMPTY_THEME_PACK), BUILTIN_SHOP_SOUND_SOURCES);
assert.deepEqual(resolveShopSoundSources(partial), {
  ...BUILTIN_SHOP_SOUND_SOURCES,
  purchase: [BUILTIN_SHOP_SOUND_SOURCES.purchase[0], "http://theme.localhost/sounds/radial_menu_buy_02.wav", BUILTIN_SHOP_SOUND_SOURCES.purchase[2]],
});
assert.equal(resolveShopSoundSources(fullPack).select, "http://theme.localhost/sounds/radial_canselect_01.wav");

console.log("theme pack smoke passed");
