# Team select illustrations

The two illustrations stand in for CS2's team models on the team select menu. Both are made from the supplied
`SLGO-assets/image` artwork, the SCP: Secret Laboratory wiki art also used by `../shop-items` (see its `SOURCES.md`:
the wiki's content is under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) unless otherwise noted;
SCP: Secret Laboratory and the depicted designs belong to Northwood Studios). They are bundled locally and never
requested from an external host. The icons in this directory (`*.svg`) are SLUI-drawn.

| Local file | Supplied source | Processing |
| --- | --- | --- |
| `ntf-squad.webp` | `MTF_ProfileImage.png` | Cropped to its painted area, scaled to 1164 px tall, WebP with alpha. |
| `scp-group.webp` | `333px-106F1.png`, `333px-SCPCAT096.png`, `337px-MatthewF1.png` (SCP-173), `333px-049F1.png`, `SCP939F1.png` | The five classic SCPs' class portraits grouped on one transparent canvas (below), cropped, WebP with alpha. |

`scp-group.webp` layout, back to front, each portrait cropped to its painted area first; scale, then the centre x and
bottom y on a 1300 x 1200 canvas, which is then cropped to the painted area:

| Portrait | Scale | Centre x | Bottom y | Mirrored |
| --- | --- | --- | --- | --- |
| SCP-106 | 0.86 | 700 | 860 | no |
| SCP-096 | 0.95 | 440 | 1005 | yes |
| SCP-173 | 0.9 | 950 | 1040 | yes |
| SCP-049 | 1.0 | 680 | 1060 | no |
| SCP-939 | 0.5 | 380 | 1090 | no |

The SCP group's ground shadow is CSS (`.ts-ground`), outside the hover outline; the NTF painting has its own ground.
