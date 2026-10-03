import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BUILTIN_SHOP_SOUND_SOURCES as SHOP_SOUND_SOURCES, createShopAudio } from "../src/features/shop/audio.ts";

const sources = [SHOP_SOUND_SOURCES.select, SHOP_SOUND_SOURCES.unavailable, ...SHOP_SOUND_SOURCES.purchase];
assert.equal(new Set(sources).size, 5);
for (const source of sources) {
  const wav = await readFile(new URL(`../public${source}`, import.meta.url));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF", source);
  assert.equal(wav.toString("ascii", 8, 12), "WAVE", source);
  let pcm = false;
  let data = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const tag = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= wav.length, `complete WAV chunk: ${source}`);
    if (tag === "fmt ") pcm = wav.readUInt16LE(offset + 8) === 1;
    if (tag === "data") data = size > 0;
    offset += 8 + size + size % 2;
  }
  assert.ok(pcm && data, `playable PCM data: ${source}`);
}

function fixture({ readyState = 4, playError, volume } = {}) {
  let time = 1_000;
  const clips = [];
  const played = [];
  const playedVolumes = [];
  const player = createShopAudio({
    volume,
    now: () => time,
    createAudio(source) {
      const clip = {
        source, readyState, preload: "", currentTime: 1, volume: 1, paused: true,
        loads: 0,
        load() { this.loads += 1; },
        pause() { this.paused = true; },
        play() {
          played.push(source);
          playedVolumes.push(this.volume);
          this.paused = false;
          return playError ? Promise.reject(playError) : Promise.resolve();
        },
      };
      clips.push(clip);
      return clip;
    },
  });
  return { player, clips, played, playedVolumes, advance: (ms = 500) => { time += ms; } };
}

const audio = fixture();
audio.player.preload();
audio.player.preload();
assert.equal(audio.clips.length, 5, "preloading reuses all five clips");
assert.ok(audio.clips.every((clip) => clip.preload === "auto" && clip.loads === 1));
assert.ok(audio.clips.every((clip) => clip.volume === 0.3), "preloaded clips start at the quieter navigation volume");
audio.player.play("select");
assert.equal(audio.playedVolumes.at(-1), 0.3, "selection feedback uses the CS2 mouseover volume");
audio.advance(10);
audio.player.play("select");
assert.deepEqual(audio.played, [SHOP_SOUND_SOURCES.select], "rapid pointer or focus events do not pile up");
audio.advance();
audio.player.play("unavailable");
assert.equal(audio.played.at(-1), SHOP_SOUND_SOURCES.unavailable);
assert.equal(audio.playedVolumes.at(-1), 0.3, "unavailable hover uses the CS2 mouseover volume");
audio.advance();
audio.player.play("deny");
assert.equal(audio.played.at(-1), SHOP_SOUND_SOURCES.unavailable);
assert.equal(audio.playedVolumes.at(-1), 0.4, "purchase denial uses the CS2 failure volume");
const countAfterDenial = audio.played.length;
audio.advance(10);
audio.player.play("select");
assert.equal(audio.played.length, countAfterDenial, "a trailing hover cannot obscure action feedback");
audio.advance();
audio.player.play("unavailable");
assert.equal(audio.played.at(-1), SHOP_SOUND_SOURCES.unavailable);
assert.equal(audio.playedVolumes.at(-1), 0.3, "hover resets the volume of the clip shared with purchase denial");

for (let index = 0; index < 3; index += 1) {
  audio.advance();
  audio.player.play("purchase");
}
assert.deepEqual(audio.played.slice(-3), SHOP_SOUND_SOURCES.purchase, "all three purchase variants are used");
assert.deepEqual(audio.playedVolumes.slice(-3), [0.3, 0.3, 0.3], "all purchase variants use the CS2 purchase volume");
const countAfterPurchase = audio.played.length;
audio.advance(1);
audio.player.play("purchase");
assert.equal(audio.played.length, countAfterPurchase, "rapid repeated purchase cues are bounded");
assert.ok(audio.clips.filter((clip) => !clip.paused).length <= 2, "bounded concurrent audio");
audio.advance();
audio.player.play("purchase");
assert.equal(audio.played.at(-1), SHOP_SOUND_SOURCES.purchase[0], "purchase cycle wraps");
assert.equal(audio.clips.length, 5, "interaction does not allocate more audio elements");
assert.ok(audio.clips.every((clip) => clip.currentTime === 0 && clip.volume > 0 && clip.volume <= 1));
const countBeforeStop = audio.played.length;
audio.player.stop();
assert.ok(audio.clips.every((clip) => clip.paused), "stop silences active clips");
assert.equal(audio.played.length, countBeforeStop, "stopping feedback does not play another sound");
const countBeforeDispose = audio.played.length;
audio.player.dispose();
audio.advance();
audio.player.play("purchase");
audio.player.preload();
assert.equal(audio.played.length, countBeforeDispose, "disposed player never plays again");
assert.equal(audio.clips.length, 5);

const loading = fixture({ readyState: 0 });
loading.player.play("select");
assert.equal(loading.played.length, 0, "loading clips are skipped, not queued");
loading.clips.forEach((clip) => { clip.readyState = 4; });
await new Promise(setImmediate);
assert.equal(loading.played.length, 0, "becoming ready does not replay stale feedback");
loading.player.play("select");
assert.equal(loading.played.length, 1, "a new interaction can play after loading");

const blocked = fixture({ playError: new DOMException("Blocked until gesture", "NotAllowedError") });
blocked.player.play("purchase");
await new Promise(setImmediate);
assert.equal(blocked.played.length, 1, "autoplay denial is handled without automatic retries");
blocked.advance();
blocked.player.play("purchase");
await new Promise(setImmediate);
assert.equal(blocked.played.length, 2, "later gestures may retry without an unhandled rejection");
blocked.player.dispose();
loading.player.dispose();
assert.doesNotThrow(() => createShopAudio({ createAudio: () => null }).play("select"), "unavailable audio does not break the shop");

// The shop volume setting scales every cue's CS2 volume, from the next cue on.
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const scaled = fixture({ volume: 0.3 });
scaled.player.preload();
scaled.clips.forEach((clip) => close(clip.volume, 0.09, "preload volume is scaled"));
scaled.player.play("select");
close(scaled.playedVolumes.at(-1), 0.09, "select at 30%");
scaled.advance();
scaled.player.play("deny");
close(scaled.playedVolumes.at(-1), 0.12, "deny at 30%");
scaled.player.setVolume(0);
scaled.advance();
scaled.player.play("purchase");
assert.equal(scaled.playedVolumes.at(-1), 0, "a muted shop plays at zero volume");
for (const [input, expected] of [[2, 0.3], [-1, 0], [Number.NaN, 0.3]]) {
  scaled.player.setVolume(input);
  scaled.advance();
  scaled.player.play("purchase");
  close(scaled.playedVolumes.at(-1), expected, `setVolume(${input}) is clamped`);
}
scaled.player.dispose();
console.log("shop audio smoke: assets, preload, feedback volumes, volume setting, throttling, autoplay and cleanup ok");
