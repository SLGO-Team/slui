"""Builds the bundled OFL fallback fonts in public/assets/fonts/fallback/.

Inputs come from https://github.com/google/fonts (OFL, no Reserved Font Names):
  ofl/barlow/Barlow-{Light,Regular,Medium,Bold}.ttf + OFL.txt  -> re-encoded as WOFF2 (lossless)
  ofl/saira/Saira[wdth,wght].ttf + OFL.txt                -> static condensed instances, WOFF2

The Saira instances replace Stratum2 Condensed. Each (wght, wdth) pair was
chosen so the instance matches the Stratum2 Condensed weight in both advance
width and ink coverage after cap-height normalization.

Usage: python scripts/build-fallback-fonts.py <dir with barlow/ and saira/>
Requires fontTools and brotli (WOFF2).
"""

import shutil
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "fonts" / "fallback"
SAIRA_CONDENSED = {
    "light": {"wght": 200, "wdth": 53.3},
    "medium": {"wght": 650, "wdth": 55.4},
    "bold": {"wght": 750, "wdth": 57.7},
}


def main(source: Path) -> None:
    (OUT / "barlow").mkdir(parents=True, exist_ok=True)
    (OUT / "saira").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / "barlow" / "OFL.txt", OUT / "barlow" / "OFL.txt")
    for weight in ("Light", "Regular", "Medium", "Bold"):
        font = TTFont(source / "barlow" / f"Barlow-{weight}.ttf")
        font.flavor = "woff2"
        font.save(OUT / "barlow" / f"Barlow-{weight}.woff2")
    shutil.copyfile(source / "saira" / "OFL.txt", OUT / "saira" / "OFL.txt")
    for style, location in SAIRA_CONDENSED.items():
        font = TTFont(source / "saira" / "Saira[wdth,wght].ttf")
        instance = instancer.instantiateVariableFont(font, location)
        instance.flavor = "woff2"
        instance.save(OUT / "saira" / f"saira-condensed-{style}.woff2")
        print(f"saira-condensed-{style}.woff2 {location}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
