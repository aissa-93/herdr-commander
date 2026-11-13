"""Build PxPlus_IBM_VGA_8x16-Bold.ttf from the regular face.

The VGA font has one weight. Without a bold face, the app fakes bold, and on
Windows that smears a pixel font: every pixel grows right by one, which fills
the one-pixel gaps inside m, w, e, and the spacing column between letters.

This bold works on the font's own pixel grid (100 units = 1 pixel). A pixel
is added to the right of a lit pixel only when both it and the pixel after it
are empty, so inner gaps stay open, and never in the last column, so letters
keep their spacing. Box-drawing and block glyphs are copied unchanged so lines
still join up.

    pip install fonttools skia-pathops
    python make-bold.py
"""
from pathlib import Path

from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
import pathops

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "PxPlus_IBM_VGA_8x16.ttf"
TARGET = HERE / "PxPlus_IBM_VGA_8x16-Bold.ttf"
PX = 100
FAMILY = "PxPlus IBM VGA 8x16"


def unchanged_codepoint(cp):
    # Box drawing, blocks, shades, and the legacy-computing block mosaics.
    return 0x2500 <= cp <= 0x259F or 0x1FB00 <= cp <= 0x1FBFF


def pixels(glyph_set, name, glyph, columns):
    rows = {}
    if glyph.numberOfContours == 0:
        return rows
    for y in range(glyph.yMin // PX, -(-glyph.yMax // PX)):
        row = set()
        for x in range(columns):
            pen = PointInsidePen(glyph_set, (x * PX + PX / 2, y * PX + PX / 2))
            glyph_set[name].draw(pen)
            if pen.getResult():
                row.add(x)
        if row:
            rows[y] = row
    return rows


def embolden(rows, columns):
    out = {}
    for y, row in rows.items():
        grown = set(row)
        for x in row:
            nxt = x + 1
            # Keep the last column empty for spacing, and never close a gap.
            if nxt < columns - 1 and nxt not in row and nxt + 1 not in row:
                grown.add(nxt)
        out[y] = grown
    return out


def draw(rows, glyph_set):
    path = pathops.Path()
    pen = path.getPen()
    for y, row in rows.items():
        for x in row:
            pen.moveTo((x * PX, y * PX))
            pen.lineTo((x * PX, (y + 1) * PX))
            pen.lineTo(((x + 1) * PX, (y + 1) * PX))
            pen.lineTo(((x + 1) * PX, y * PX))
            pen.closePath()
    path.simplify(fix_winding=True)
    tt = TTGlyphPen(glyph_set)
    path.draw(tt)
    return tt.glyph()


def main():
    font = TTFont(SOURCE)
    glyf = font["glyf"]
    glyph_set = font.getGlyphSet()
    keep = {name for cp, name in font.getBestCmap().items() if unchanged_codepoint(cp)}

    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if name in keep or glyph.isComposite() or glyph.numberOfContours == 0:
            continue
        coords = glyph.getCoordinates(glyf)[0]
        if any(x % PX or y % PX for x, y in coords):
            continue  # not on the pixel grid; leave it as drawn
        columns = font["hmtx"][name][0] // PX
        rows = pixels(glyph_set, name, glyph, columns)
        bold = embolden(rows, columns)
        if bold != rows:
            glyf[name] = draw(bold, glyph_set)

    names = {
        1: FAMILY,
        2: "Bold",
        3: "VileR:PxPlus IBM VGA 8x16 Bold:v2.2-2020-11 (Commander bold)",
        4: f"{FAMILY} Bold",
        6: "PxPlus_IBM_VGA_8x16-Bold",
        10: "Bold weight derived from PxPlus IBM VGA 8x16 for Herdr Commander: "
            "pixels grown right where no gap closes. Same licence (CC BY-SA 4.0).",
    }
    table = font["name"]
    for record in list(table.names):
        if record.nameID in (16, 17, 18):
            table.removeNames(nameID=record.nameID)
    for name_id, text in names.items():
        table.setName(text, name_id, 1, 0, 0)
        table.setName(text, name_id, 3, 1, 0x409)

    os2 = font["OS/2"]
    os2.usWeightClass = 700
    os2.fsSelection = (os2.fsSelection & ~(1 << 6) & ~1) | (1 << 5)  # BOLD, not REGULAR
    font["head"].macStyle = (font["head"].macStyle & ~0b10) | 0b1
    font["post"].italicAngle = 0

    font.save(TARGET)
    print(f"wrote {TARGET.name}")


if __name__ == "__main__":
    main()
