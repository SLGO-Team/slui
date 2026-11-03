# SCP:SL Shop Item Images

Retrieved from the [SCP: Secret Laboratory English Official Wiki](https://en.scpslgame.com/index.php?title=Items) on 2026-08-30.

The wiki states that its content is available under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) unless otherwise noted. SCP: Secret Laboratory and the depicted game assets belong to Northwood Studios. This directory contains local copies so the client does not depend on the wiki or its CDN at runtime.

Since 2026-10-31 the local copies are stored as lossless WebP (Pillow, `lossless=True, method=6, exact=True`, ICC
profile kept): the decoded RGBA equals the retrieved PNG's, and Chromium composites them identically (translucent
edge pixels may differ by 1/255 from decoder premultiply rounding). `Scp079.png`, `Scp096.png` and `Scp939.png` stay
PNG: they carry `gAMA`/`cHRM` but no `sRGB` chunk, so Chromium applies a 2.2 gamma conversion to them that a WebP
without an equivalent profile would drop.

| Local file | Wiki page | Original image |
| --- | --- | --- |
| `ArmorLight.webp` | [Light Armor](https://en.scpslgame.com/index.php?title=Light_Armor) | [LightArmorIcon.png](https://hub.scpslgame.com/images/8/8d/LightArmorIcon.png) |
| `ArmorCombat.webp` | [Combat Armor](https://en.scpslgame.com/index.php?title=Combat_Armor) | [CombatArmorIcon.png](https://hub.scpslgame.com/images/e/e2/CombatArmorIcon.png) |
| `ArmorHeavy.webp` | [Heavy Armor](https://en.scpslgame.com/index.php?title=Heavy_Armor) | [HeavyArmorIcon.png](https://hub.scpslgame.com/images/7/77/HeavyArmorIcon.png) |
| `Adrenaline.webp` | [Adrenaline](https://en.scpslgame.com/index.php?title=Adrenaline) | [AdrenalineIcon.png](https://hub.scpslgame.com/images/0/0d/AdrenalineIcon.png) |
| `Medkit.webp` | [First Aid Kit](https://en.scpslgame.com/index.php?title=First_Aid_Kit) | [MedkitIcon.png](https://hub.scpslgame.com/images/7/77/MedkitIcon.png) |
| `Painkillers.webp` | [Painkillers](https://en.scpslgame.com/index.php?title=Painkillers) | [NewPainkillersIcon.png](https://hub.scpslgame.com/images/b/bb/NewPainkillersIcon.png) |
| `SCP500.webp` | [SCP-500](https://en.scpslgame.com/index.php?title=SCP-500) | [SCP500Icon.png](https://hub.scpslgame.com/images/a/ac/SCP500Icon.png) |
| `SCP207.webp` | [SCP-207](https://en.scpslgame.com/index.php?title=SCP-207) | [UpdatedSCP207Icon.png](https://hub.scpslgame.com/images/d/dd/UpdatedSCP207Icon.png) |
| `SCP1853.webp` | [SCP-1853](https://en.scpslgame.com/index.php?title=SCP-1853) | [SCP1853Icon.png](https://hub.scpslgame.com/images/d/d8/SCP1853Icon.png) |
| `SCP1344.webp` | [SCP-1344](https://en.scpslgame.com/index.php?title=SCP-1344) | [Scp1344Icon.png](https://hub.scpslgame.com/images/0/08/Scp1344Icon.png) |
| `SCP268.webp` | [SCP-268](https://en.scpslgame.com/index.php?title=SCP-268) | [UpdatedSCP268Icon.png](https://hub.scpslgame.com/images/e/e8/UpdatedSCP268Icon.png) |
| `SCP2176.webp` | [SCP-2176](https://en.scpslgame.com/index.php?title=SCP-2176) | [Updated2176Icon.png](https://hub.scpslgame.com/images/5/52/Updated2176Icon.png) |
| `GunCOM15.webp` | [COM-15](https://en.scpslgame.com/index.php?title=COM-15) | [COM-15Icon.png](https://hub.scpslgame.com/images/2/22/COM-15Icon.png) |
| `GunCOM18.webp` | [COM-18](https://en.scpslgame.com/index.php?title=COM-18) | [IconCom18.png](https://hub.scpslgame.com/images/2/2e/IconCom18.png) |
| `GunCrossvec.webp` | [Crossvec](https://en.scpslgame.com/index.php?title=Crossvec) | [CrossvecIcon.png](https://hub.scpslgame.com/images/f/f0/CrossvecIcon.png) |
| `GunFRMG0.webp` | [FR-MG-0](https://en.scpslgame.com/index.php?title=FR-MG-0) | [FRMG0Icon.png](https://hub.scpslgame.com/images/d/d0/FRMG0Icon.png) |
| `GunFSP9.webp` | [FSP-9](https://en.scpslgame.com/index.php?title=FSP-9) | [FSP-9Icon.png](https://hub.scpslgame.com/images/4/4d/FSP-9Icon.png) |
| `GunE11SR.webp` | [MTF-E11-SR](https://en.scpslgame.com/index.php?title=MTF-E11-SR) | [E11SRIcon.png](https://hub.scpslgame.com/images/9/96/E11SRIcon.png) |
| `GunAK.webp` | [AK](https://en.scpslgame.com/index.php?title=AK) | [NewAKIcon.png](https://hub.scpslgame.com/images/3/33/NewAKIcon.png) |
| `GunLogicer.webp` | [Logicer](https://en.scpslgame.com/index.php?title=Logicer) | [LogicerIcon.png](https://hub.scpslgame.com/images/d/d4/LogicerIcon.png) |
| `MicroHID.webp` | [Micro H.I.D.](https://en.scpslgame.com/index.php?title=Micro_H.I.D.) | [NewMicroHidIcon.png](https://hub.scpslgame.com/images/d/d1/NewMicroHidIcon.png) |
| `GrenadeFlash.webp` | [Flashbang Grenade](https://en.scpslgame.com/index.php?title=Flashbang_Grenade) | [FlashbangIcon.png](https://hub.scpslgame.com/images/2/2d/FlashbangIcon.png) |
| `GrenadeHE.webp` | [High-Explosive Grenade](https://en.scpslgame.com/index.php?title=High-Explosive_Grenade) | [GrenadeIcon.png](https://hub.scpslgame.com/images/4/44/GrenadeIcon.png) |

## SCP role detail images

The role portraits below are local copies of the supplied `SLGO-assets/image`
artwork. `Scp173.png` uses the supplied transparent source from
`slui-svg/png` because the role-image directory does not contain an SCP-173
portrait. The files are bundled locally for the detail panel and are never
requested at runtime from an external host.

| Local file | Supplied source |
| --- | --- |
| `Scp049.webp` | `333px-049F1.png` |
| `Scp0492.webp` | `SCPCAT049-2.png` |
| `Scp079.png` | `SCPCAT_079.png` |
| `Scp096.png` | `333px-SCPCAT096.png` |
| `Scp106.webp` | `333px-106F1.png` |
| `Scp173.webp` | `slui-svg/png/Scp173.png` |
| `Scp3114.webp` | `3114_Icon.png` |
| `Scp939.png` | `SCP939F1.png` |
