# Vendored map-seed

- Upstream: https://github.com/kldhsh123/scpsl-map-seed
- Package: `@scpsl-tools/map-seed@1.0.0`
- Commit: `65c82b8f930eaef3ee30304a23c96af3a75711a3`
- Actual upstream license: Apache-2.0, retained verbatim in `LICENSE`. The upstream package.json MIT field conflicts with that file.
- Original source, template and license SHA-256 values and 16 complete generated-output fixture hashes are retained in `fixtures.json`.
- `index.d.ts` is retained verbatim as upstream output type evidence. Its filesystem-wrapper exports are not entry points for this vendor.

SLUI modifications, 2026-09-07: `generator.js` adds a two-line modification/license notice and replaces the single `Buffer.from(atlas.rgbaBase64, 'base64')` expression with `Uint8Array.from(atob(atlas.rgbaBase64), (character) => character.charCodeAt(0))`. The generator algorithm, random number implementation, errors, and JSON template are otherwise unchanged. `generator.d.ts` adds the actual core entry-point signature; SLUI's resolver imports the JSON asset directly without upstream filesystem loaders or Buffer polyfills.

Run `node scripts/minimap-model-smoke.mjs` from the repository root. It verifies retained source bytes (reversing only the documented notice/expression for the source hash), all 16 full output hashes, and browser bundling without Node globals. Runtime/tests do not require the original developer's tools directory.
