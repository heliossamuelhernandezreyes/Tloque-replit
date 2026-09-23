import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { create } from "fontkit"
import { composeEdition, wrapText } from "../client/src/print/compose"
import { composeCover } from "../client/src/print/cover"
import { renderCover, renderCoverKit } from "../client/src/print/coverPdf"
import { editionSettings, printLabels, type TextOp } from "../client/src/print/model"
import { fontMetrics, pdfDocument, renderInterior, type PrintFonts } from "../client/src/print/pdfRuntime"
import { unicodeMetrics } from "../client/src/print/unicodeFonts"
import { emptyPrintResources, graphemes, resourceSegments, validatePrintResources, type PrintResources } from "../client/src/print/resources"

const readFont = (name: string) => readFileSync(new URL("../client/src/print/assets/" + name + ".ttf", import.meta.url)).toString("base64")
const fonts = { normal: readFont("SourceSerif4-Regular"), bold: readFont("SourceSerif4-Bold"), italic: readFont("SourceSerif4-It") } as PrintFonts
const fallback = readFont("DejaVuSans"), base = fontMetrics(pdfDocument(148, 210, fonts))
const custom = readFileSync(new URL("./fixtures/print-glyphs.ttf", import.meta.url)).toString("base64")
const png = { data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQCaj4DwADNAHc8SieSgAAAABJRU5ErkJggg==", width: 1, height: 1 }
const make = (resources = emptyPrintResources()) => unicodeMetrics(base, fonts, fallback, resources)
const body = (content: string, resources = emptyPrintResources()) => composeEdition({ title: "Prueba", author: "Autor", content }, editionSettings(), make(resources), printLabels("es"), undefined, undefined, resources)
const textOps = (layout: ReturnType<typeof body>) => layout.pages.flatMap(p => p.ops).filter((op): op is TextOp => op.kind === "text")

test("Arabic, Hebrew, astral emoji and combining marks print as real outlines without Unicode range restrictions", () => {
  const content = "مرحبا بالعالم 123\nשלום עולם 123\n∑ ∞ ♫ ✦ 😀\na\u0323\u0301"
  const layout = body(content)
  assert.ok(!layout.issues.some(i => i.severity === "error"), JSON.stringify(layout.issues))
  const lines = textOps(layout).filter(op => op.paragraph)
  assert.equal(lines.map(op => op.text).join("\n"), content.normalize("NFC"))
  assert.ok(lines.every(op => op.ink?.some(item => item.kind === "path" && item.path.commands.length)))
  assert.equal(lines[0].direction, "rtl"); assert.ok(lines[0].x > 70)
  assert.ok(Buffer.from(renderInterior(layout, fonts, "Prueba")).length > 5000)
})

test("RTL punctuation is mirrored exactly once and European numbers retain their order", () => {
  const layout = body("مرحبا (123)")
  const op = textOps(layout).find(op => op.paragraph)!
  const source = create(Buffer.from(fonts.normal, "base64"))
  const glyph = (text: string) => source.layout(text).glyphs[0].path.toSVG()
  const shapes = op.ink!.filter(i => i.kind === "path")
  assert.deepEqual(shapes.slice(0, 5).map(p => p.path.svg), [glyph("("), glyph("1"), glyph("2"), glyph("3"), glyph(")")])
})

test("intentional blank glyphs and ideographic spaces never become missing-glyph boxes", () => {
  const m = make(), op: TextOp = { kind: "text", text: "\u3000\u2800", x: 20, y: 30, pt: 11, font: "normal", gray: 0, role: "header", width: m.width("\u3000\u2800", 11) }
  assert.equal(m.hasGlyph("\u2800"), true)
  m.prepare!(op)
  assert.deepEqual(op.ink, [])
  assert.ok(op.width > 6)
})

test("uploaded private-use glyphs work in body, title, author and cover without requiring three font styles", () => {
  const resources: PrintResources = { ...emptyPrintResources(), fonts: [{ id: "custom", name: "original.ttf", data: custom }] }
  const m = make(resources), book = { title: "Semilla \ue001", author: "Autor \u{f0001}", content: "Mi alfabeto \ue001\u{f0001}." }
  const layout = composeEdition(book, editionSettings({ spineMm: 5 }), m, printLabels(), undefined, undefined, resources)
  assert.ok(!layout.issues.some(i => i.severity === "error"))
  assert.ok(textOps(layout).filter(op => /[\ue001\u{f0001}]/u.test(op.text)).every(op => op.ink?.length))
  const cover = composeCover(book, layout, m, null)
  assert.ok(!cover.issues.some(i => i.severity === "error"))
  assert.ok(renderCover(cover, fonts, book.title).byteLength > 1000)
  assert.ok(renderCoverKit(cover, fonts, book.title, "letter", { cut: "Cut", fold: "Fold", glue: "Glue" }).byteLength > 1000)
})

test("unavailable glyphs have actionable code points; an exact drawing supplies the missing shape", () => {
  const content = "Inventado \u{f0001}."
  const missing = body(content)
  assert.equal(missing.pages.length, 0)
  assert.match(missing.issues[0].detail!, /U\+F0001/)
  assert.throws(() => renderInterior(missing, fonts, "Prueba"))
  const resources = { ...emptyPrintResources(), symbols: [{ id: "drawing", token: "\u{f0001}", image: png }] }
  const layout = body(content, resources)
  assert.ok(!layout.issues.some(i => i.severity === "error"))
  assert.ok(textOps(layout).some(op => op.ink?.some(i => i.kind === "image")))
  assert.ok(renderInterior(layout, fonts, "Prueba").byteLength > 1000)
})

test("wrapping keeps combining sequences, emoji ZWJ and drawing markers atomic", () => {
  const resources = { ...emptyPrintResources(), symbols: [{ id: "seal", token: "[[sello]]", image: png }, { id: "emoji", token: "👩‍💻", image: png }] }
  const m = make(resources), sequence = "a\u0323\u0301👩‍💻[[sello]]😀".repeat(8)
  const rows = wrapText(sequence, 18, m, 11)
  assert.equal(rows.map(r => r.text).join(""), sequence)
  assert.ok(rows.every(r => !r.text.startsWith("\u0301") && (!r.text.includes("[[") || r.text.includes("[[sello]]"))))
  for (const row of rows) assert.ok(resourceSegments(row.text, resources.symbols).every(s => graphemes(s).length === 1 || s === "[[sello]]"))
  assert.equal(wrapText("a\u00a0b", 80, m, 11)[0].text, "a\u00a0b")
})

test("illustrations fit the page, preserve aspect ratio, report resolution and survive imposition", () => {
  const resources = { ...emptyPrintResources(), illustrations: [{ id: "art", chapter: 0, afterParagraph: 0, widthPercent: 70, caption: "Un dibujo 😀", image: png }] }
  const layout = body("Texto tras el dibujo.", resources)
  assert.ok(!layout.issues.some(i => i.severity === "error"))
  const images = layout.pages.flatMap(p => p.ops).filter(op => op.kind === "image")
  assert.equal(images.length, 1); assert.equal(images[0].width, images[0].height)
  assert.ok(images[0].x >= layout.settings.outer && images[0].y + images[0].height < layout.height - layout.settings.bottom)
  assert.ok(layout.issues.some(i => i.code === "artworkResolution" && i.page))
  assert.ok(renderInterior(layout, fonts, "Prueba", true).byteLength > 1000)
  assert.ok(body("", resources).pages.length, "An illustrated chapter can be text-free")
  assert.ok(body("Texto", { ...resources, illustrations: [{ ...resources.illustrations[0], afterParagraph: 999 }] }).issues.some(i => i.code === "artworkPosition"))
})

test("resource validation rejects corrupt fonts, remote images, duplicate symbols and unbounded inputs", () => {
  assert.throws(() => make({ ...emptyPrintResources(), fonts: [{ id: "bad", name: "bad.ttf", data: "YQ==".repeat(300) }] }))
  assert.throws(() => validatePrintResources({ ...emptyPrintResources(), symbols: [{ id: "x", token: "x", image: { ...png, data: "https://example.test/picture.png" } }] }))
  assert.throws(() => validatePrintResources({ ...emptyPrintResources(), symbols: [{ id: "x", token: "x", image: png }, { id: "y", token: "x", image: png }] }))
  assert.throws(() => validatePrintResources({ ...emptyPrintResources(), illustrations: [{ id: "art", chapter: 0, afterParagraph: -1, widthPercent: 900, caption: "", image: png }] }))
  const resources = emptyPrintResources()
  assert.deepEqual(validatePrintResources(JSON.parse(JSON.stringify(resources))), resources)
})

test("ordinary books retain selectable embedded text and existing pagination", () => {
  const value = { title: "México", author: "Lucía", content: "El río y la memoria. ".repeat(200) }
  const before = composeEdition(value, editionSettings(), base, printLabels())
  const after = composeEdition(value, editionSettings(), make(), printLabels())
  assert.deepEqual(after, before)
})

test("oversized glyph metrics block impossible widow/orphan layout instead of looping", () => {
  const huge = { ...base, extents: () => ({ ascent: 60, descent: 40 }) }
  const layout = composeEdition({ title: "Test", author: "Autor", content: "Texto para varias líneas. ".repeat(40) }, editionSettings(), huge, printLabels())
  assert.ok(layout.issues.some(i => i.code === "layoutOverflow" && i.severity === "error"))
  assert.throws(() => renderInterior(layout, fonts, "Test"))
})
