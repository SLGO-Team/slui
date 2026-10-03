"""Builds the bundled OFL fallback fonts in public/assets/fonts/fallback/.

Inputs come from https://github.com/google/fonts (OFL, no Reserved Font Names):
  ofl/barlow/Barlow-{Light,Regular,Medium,Bold}.ttf + OFL.txt  -> copied as-is
  ofl/saira/Saira[wdth,wght].ttf + OFL.txt                -> static condensed instances

The Saira instances replace Stratum2 Condensed. Each (wght, wdth) pair was
chosen so the instance matches the Stratum2 Condensed weight in both advance
width and ink coverage after cap-height normalization.

Usage: python scripts/build-fallback-fonts.py <dir with barlow/ and saira/>
Requires fontTools.
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
    for name in ("Barlow-Light.ttf", "Barlow-Regular.ttf", "Barlow-Medium.ttf", "Barlow-Bold.ttf", "OFL.txt"):
        shutil.copyfile(source / "barlow" / name, OUT / "barlow" / name)
    shutil.copyfile(source / "saira" / "OFL.txt", OUT / "saira" / "OFL.txt")
    for style, location in SAIRA_CONDENSED.items():
        font = TTFont(source / "saira" / "Saira[wdth,wght].ttf")
        instance = instancer.instantiateVariableFont(font, location)
        instance.save(OUT / "saira" / f"saira-condensed-{style}.ttf")
        print(f"saira-condensed-{style}.ttf {location}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
