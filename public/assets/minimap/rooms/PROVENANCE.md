# Room SVG notes

These 29 SVGs are room illustrations drawn after the SCP-079 facility map of
SCP: Secret Laboratory (Northwood Studios); see `THIRD_PARTY_NOTICES.md`.
`PROVENANCE.json` records SHA-256 hashes for every shipped SVG and the runtime
mapping, and `scripts/minimap-model-smoke.mjs` keeps them unchanged.

## Selection

`src/features/minimap/room-artwork.json` covers all 110 Entrance/HeavyContainment
templates in SLUI's pinned 14.2.7 template, including holiday variants. Each
prefab name maps explicitly to one SVG; for example, catalog key `HCZ_Hid`
resolves to `HCZ_MicroHID_New.svg` and the Entrance checkpoint uses
`EZ_HCZ_Checkpoint Part.svg`. No runtime filename guessing or generic fallback
occurs; unknown prefabs fail map resolution.

The prefab mapping is `heuristic-not-authoritative`. Some rooms intentionally share artwork:
079/096/106 use `HCZ_EndSmall`, HCZ checkpoint halves use `HCZ_Straight`, and
several Entrance offices use `EZ_Straight`. The SVGs are room illustrations, not
collision-accurate walls. No LCZ, Surface or unused artwork is bundled.

## Canvas and projection

All SVGs have a full 256x256 canvas and a (0.5,0.5) anchor, and the full canvas
spans one generator grid cell, 15x15 world units. Do not crop to the drawn
area or derive the world size from the image size. The artwork is
authored for a `(-x,z)` projection with `yaw+180`, which is equivalent to SLUI's
`(x,-z)` with `yaw`; no mirror or extra 180-degree rotation applies to these two
zones.

SLUI transforms the full-canvas corners into world coordinates once. The renderer
derives its SVG matrix from their camera projections, and overview fitting uses
the same corners. Original fills and alpha layers survive through SVG `image`
elements. Other-zone opacity retains the existing radar emphasis. Connector
center-lines are not painted over rooms. In all 16 pinned seed/holiday fixtures,
HCZ checkpoint yaw is 0 and Entrance checkpoint yaw is 270: the HCZ right-edge
exit at (256,128) and Entrance top-edge exit at (128,0) share one world position.
The SVGs connect directly without an extra line. The two checkpoint-pair records
remain in map topology for validation and the combined Chinese labels.
