"""Independent PDF inspection and rendered proofs for the browser fixture.
Install QA-only tools: pypdf==6.10.0, Pillow, poppler-utils.
Run after npm run test:print:browser. Does not certify PDF/X or printer approval.
"""
import json
import math
import subprocess
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(".tloque_cache/print-qa")
EXPECTED = json.loads((ROOT / "expected.json").read_text())
MM_PT = 72 / 25.4


def compact(text):
    return "".join(unicodedata.normalize("NFC", text).split())


def close(actual, target, label):
    assert math.isclose(float(actual), target, abs_tol=0.02), (label, actual, target)


def inspect(name, width, height, duplex, require_text=True):
    reader = PdfReader(ROOT / (name + ".pdf"))
    assert not reader.is_encrypted
    catalog = reader.trailer["/Root"]
    assert "/OutputIntents" not in catalog, "No unsupported PDF/X/ICC claim"
    prefs = catalog["/ViewerPreferences"]
    assert prefs["/PrintScaling"] == "/None"
    assert prefs["/Duplex"] == duplex, (name, prefs)
    embedded = set()
    for number, page in enumerate(reader.pages, 1):
        close(page.mediabox.width, width * MM_PT, name + " MediaBox width")
        close(page.mediabox.height, height * MM_PT, name + " MediaBox height")
        assert "/TrimBox" in page and "/BleedBox" in page
        assert 0 <= page.trimbox.left < page.trimbox.right <= page.mediabox.right + 0.02
        assert 0 <= page.trimbox.bottom < page.trimbox.top <= page.mediabox.top + 0.02
        for font in page.get("/Resources", {}).get("/Font", {}).values():
            font = font.get_object()
            assert "/ToUnicode" in font, (name, number, "Font without Unicode mapping")
            assert "/SourceSerif4" in str(font.get("/BaseFont")), font
            descendant = font["/DescendantFonts"][0].get_object()
            descriptor = descendant["/FontDescriptor"]
            assert "/FontFile2" in descriptor, (name, number, "Unembedded TrueType")
            assert len(descriptor["/FontFile2"].get_data()) > 1000
            embedded.add(str(font["/BaseFont"]))
    if require_text:
        assert embedded, name + ": missing font resources"
    print(name + ": " + str(len(reader.pages)) + " pages, " + str(width) + " x " + str(height) + " mm; all used text fonts embedded")
    return reader


def compare_pages(reader, pages, name):
    assert len(reader.pages) == len(pages), (name, len(reader.pages), len(pages))
    for number, (actual, expected) in enumerate(zip(reader.pages, pages), 1):
        result = compact(actual.extract_text())
        target = compact(expected["text"])
        assert result == target, (name, number, "PDF text changed", result[:120], target[:120])
        if expected["kind"] == "blank":
            assert not result


readers = {}
for name in ("interior-a5", "interior-a4", "booklet-reading-order"):
    expected = EXPECTED[name]
    reader = inspect(name, expected["width"], expected["height"], "/DuplexFlipLongEdge")
    readers[name] = reader
    compare_pages(reader, expected["pages"], name)
    assert len(reader.outline) == len(expected["chapters"])
    for actual, chapter in zip(reader.outline, expected["chapters"]):
        assert actual.title == chapter["title"]
        assert reader.get_destination_page_number(actual) + 1 == chapter["page"]
    assert "ÚLTIMALÍNEA:México,Ελληνικά,русский." in compact("".join(p.extract_text() for p in reader.pages))
    for page in reader.pages:
        close(page.trimbox.width, expected["width"] * MM_PT, name + " trim")
        if page.get_contents() is not None:
            stream = ContentStream(page.get_contents(), reader)
            assert not any(operator in (b"rg", b"RG", b"k", b"K", b"Do") for _, operator in stream.operations), "Interior must stay vector grayscale"

logical = EXPECTED["booklet-reading-order"]
booklet = inspect("booklet-letter", 279.4, 215.9, "/DuplexFlipShortEdge")
assert len(booklet.pages) == len(logical["plan"]["sides"])
for page, side in zip(booklet.pages, logical["plan"]["sides"]):
    def logical_text(number):
        return logical["pages"][number - 1]["text"] if number <= len(logical["pages"]) else ""
    assert compact(page.extract_text()) == compact(logical_text(side["left"]) + logical_text(side["right"])), ("Wrong physical sheet order", side)

cover = inspect("cover-wrap", 148 * 2 + 8.4 + 6.35, 210 + 6.35, "/Simplex")
assert len(cover.pages) == 1
close(cover.pages[0].trimbox.left, 3.175 * MM_PT, "Cover left bleed")
close(cover.pages[0].trimbox.bottom, 3.175 * MM_PT, "Cover bottom bleed")
close(cover.pages[0].trimbox.width, (296 + 8.4) * MM_PT, "Wrap trim including spine")
close(cover.pages[0].trimbox.height, 210 * MM_PT, "Cover trim height")
kit = inspect("cover-kit", 215.9, 279.4, "/Simplex")
assert len(kit.pages) == 2
assert all("100%" in page.extract_text() for page in kit.pages)
assert "Pegar" in kit.pages[1].extract_text()
artwork = inspect("cover-artwork", 310.75, 216.35, "/Simplex", require_text=False)
assert len(artwork.pages) == 1 and len(artwork.pages[0].images) == 2
assert all(image.image.size == (600, 900) for image in artwork.pages[0].images)
assert not artwork.pages[0].extract_text(), "Do not duplicate lettering already in original artwork"
unicode_interior = inspect("unicode-interior", 148, 210, "/DuplexFlipLongEdge")
unicode_cover = inspect("unicode-cover", 307.35, 216.35, "/Simplex", require_text=False)
unicode_booklet = inspect("unicode-booklet", 279.4, 215.9, "/DuplexFlipShortEdge")
unicode_kit = inspect("unicode-cover-kit", 215.9, 279.4, "/Simplex")
unicode_page = unicode_interior.pages[2]
unicode_ops = ContentStream(unicode_page.get_contents(), unicode_interior).operations
assert sum(operator == b"Do" for _, operator in unicode_ops) == 3, "One illustration and two inline drawings"
assert sum(operator == b"f" for _, operator in unicode_ops) > 50, "Extended text must contain actual vector outlines"
assert all(image.image.size == (1500, 750) for image in unicode_page.images)
assert len(unicode_kit.pages) == 2
assert "[[sello]]" not in "".join(p.extract_text() for p in unicode_interior.pages)
job = (ROOT / "booklet-job.txt").read_text()
assert "Cuadernillo | Hoja | Cara | Izquierda | Derecha" in job
assert "fixture-key" not in job

# Render with Poppler, independently of both SVG and jsPDF. These are the actual
# downloaded PDFs; do not replace with a screenshot of the browser preview.
def render(name, number, label):
    prefix = ROOT / label
    subprocess.run(["pdftoppm", "-f", str(number), "-singlefile", "-scale-to", "1300", "-png",
                    str(ROOT / (name + ".pdf")), str(prefix)], check=True, capture_output=True)
    return prefix.with_suffix(".png")


chapter_page = EXPECTED["interior-a5"]["chapters"][0]["page"]
proofs = [
    render("interior-a5", 1, "proof-title"),
    render("interior-a5", 3, "proof-contents"),
    render("interior-a5", chapter_page, "proof-chapter"),
    render("interior-a5", chapter_page + 1, "proof-body"),
    render("cover-wrap", 1, "proof-wrap"),
    render("cover-kit", 1, "proof-kit-front"),
    render("cover-kit", 2, "proof-kit-back"),
    render("cover-artwork", 1, "proof-artwork"),
]

# A structurally valid clip operator can still be applied to an empty path.
# Check actual rendered ink: neither wrap panel may spill into a sheet margin.
for image_path, panel_width in ((proofs[5], 139.7 + 6.2), (proofs[6], 139.7 + 12)):
    rendered = Image.open(image_path).convert("L")
    sx, sy = rendered.width / 215.9, rendered.height / 279.4
    x, y = (215.9 - panel_width) / 2, (279.4 - 215.9) / 2
    top, bottom = round((y + 20) * sy), round((y + 195.9) * sy)
    for region in ((0, top, round((x - 2) * sx), bottom),
                   (round((x + panel_width + 2) * sx), top, rendered.width, bottom)):
        assert rendered.crop(region).getextrema()[0] >= 250, (image_path.name, "Cover ink escaped its cut-out panel")


def contact(name, paths, columns=2, cell=(700, 920)):
    rows = math.ceil(len(paths) / columns)
    sheet = Image.new("RGB", (columns * cell[0], rows * cell[1]), "#ecebe7")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(paths):
        item = Image.open(path).convert("RGB")
        item.thumbnail((cell[0] - 32, cell[1] - 60), Image.Resampling.LANCZOS)
        x, y = (i % columns) * cell[0], (i // columns) * cell[1]
        sheet.paste(item, (x + (cell[0] - item.width) // 2, y + 42))
        draw.text((x + 16, y + 15), path.stem, fill="#242424")
    path = ROOT / (name + ".jpg")
    sheet.save(path, quality=86, optimize=True)
    return path


contact("proofs-interior", proofs[:4])
contact("proofs-cover", proofs[4:], cell=(700, 930))
contact("studio-screens", [ROOT / "studio-desktop.png", ROOT / "cover-desktop.png"], columns=1, cell=(1400, 1010))
contact("studio-mobile-screens", [ROOT / "studio-mobile.png", ROOT / "preview-mobile.png"], cell=(420, 910))
unicode_proofs = [render("unicode-interior", 3, "proof-unicode"), render("unicode-booklet", 2, "proof-unicode-booklet"),
                  render("unicode-cover", 1, "proof-unicode-cover"), render("unicode-cover-kit", 1, "proof-unicode-kit")]
contact("proofs-unicode", unicode_proofs, cell=(800, 1100))
contact("studio-unicode-screens", [ROOT / "studio-unicode.png"], columns=1, cell=(1440, 1050))
print("PDF inspection passed: complete text, Unicode, page geometry, fonts, imposition, separate cover and cut-out kit.")
