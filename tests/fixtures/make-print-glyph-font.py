"""Rebuild the tiny, original drawing font used by print tests (fonttools).
These are invented glyphs assigned to BMP and supplementary private-use codes.
No third-party font artwork is copied into this fixture.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder([".notdef", "space", "seed", "star"])
builder.setupCharacterMap({0x20: "space", 0xE001: "seed", 0xF0001: "star"})
glyphs = {}
for name, points in {
    ".notdef": [(100, 0), (100, 700), (700, 700), (700, 0)],
    "space": [],
    "seed": [(400, 0), (100, 350), (400, 700), (700, 350)],
    "star": [(400, 700), (480, 430), (760, 350), (480, 270), (400, 0), (320, 270), (40, 350), (320, 430)],
}.items():
    pen = TTGlyphPen(None)
    if points:
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    glyphs[name] = pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({name: (800 if name != "space" else 300, 0) for name in glyphs})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({"familyName": "Tloque Test Drawings", "styleName": "Regular", "uniqueFontIdentifier": "Tloque-Test-Drawings-1", "fullName": "Tloque Test Drawings", "psName": "TloqueTestDrawings"})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.setupMaxp()
builder.save(Path(__file__).with_name("print-glyphs.ttf"))
