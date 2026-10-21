import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { composeEdition, manuscriptParagraphs } from "../client/src/print/compose"
import { composeCover } from "../client/src/print/cover"
import { renderHomeCover } from "../client/src/print/coverPdf"
import { editionSettings, printLabels, type TextOp } from "../client/src/print/model"
import { fontMetrics, pdfDocument, renderInterior } from "../client/src/print/pdfRuntime"
import { physicalSides, printerProfile, selectPrintSides } from "../client/src/print/homeJob"
import { renderCalibration } from "../client/src/print/calibration"
import { emptyPrintResources } from "../client/src/print/resources"
import { unicodeMetrics } from "../client/src/print/unicodeFonts"
import { bookSettingsKey, createEditionProject, initialEditionSettings, manuscriptFingerprint, readEditionProject } from "../client/src/print/project"

const f = (name: string) => readFileSync(new URL("../client/src/print/assets/" + name + ".ttf", import.meta.url)).toString("base64")
const fonts = { normal: f("SourceSerif4-Regular"), bold: f("SourceSerif4-Bold"), italic: f("SourceSerif4-It") }
const base = fontMetrics(pdfDocument(148, 210, fonts)), metrics = unicodeMetrics(base, fonts, f("DejaVuSans"))
const book = { id: 1, revision: 4, title: "Páginas y memoria", author: "Lucía", content: "Cada hoja conserva una palabra. ".repeat(60) }
const compose = (patch = {}, value = book) => composeEdition(value, editionSettings(patch), metrics, printLabels("es"))
const logical = (count: number, patch = {}) => ({ ...compose(patch), pages: Array.from({ length: count }, () => ({ kind: "blank" as const, ops: [] })) })

test("manual pass pairs survive both stack orders without renumbering or losing blank backs", () => {
  const layout = logical(18, { destination: "booklet", signature: 8 })
  const sides = physicalSides(layout)
  assert.equal(sides.length, 10)
  assert.deepEqual(sides[8].pages, [20, 17]); assert.deepEqual(sides[9].pages, [18, 19])
  for (const reverseBacks of [false, true]) {
    const profile = printerProfile({ duplex: "manual", reverseBacks })
    const fronts = selectPrintSides(sides, { pass: "front" }, profile)
    const backs = selectPrintSides(sides, { pass: "back" }, profile)
    const feed = reverseBacks ? [...fronts].reverse() : fronts
    assert.deepEqual(backs.map(b => b.sheet), feed.map(f => f.sheet))
  }
  assert.deepEqual(selectPrintSides(sides, { signature: 2, sheet: 3 }).map(s => s.pages), [[16, 9], [10, 15]])
  assert.deepEqual(selectPrintSides(sides, { pass: "all" }, printerProfile({ reverseBacks: true })), sides)
  const odd = physicalSides(logical(3, { destination: "home" }))
  assert.deepEqual(odd.map(s => s.pages), [[1], [2], [3], [4]])
  assert.equal(selectPrintSides(odd, { pass: "back" }).length, 2)
  assert.throws(() => selectPrintSides(sides, { sheet: 99 }))
  assert.throws(() => selectPrintSides(sides, { signature: NaN }))
})

test("all permitted signature sizes preserve every logical page and matching front/back sheet ids", () => {
  for (const signature of [4, 8, 16, 32]) for (const count of [1, 2, 7, 8, 17, 33, 301, 1799, 1800]) {
    const sides = physicalSides(logical(count, { destination: "booklet", signature }))
    const all = sides.flatMap(s => s.pages).sort((a, b) => a - b)
    assert.deepEqual(all, Array.from({ length: Math.ceil(count / 4) * 4 }, (_, i) => i + 1))
    for (let i = 0; i < sides.length; i += 2) assert.equal(sides[i].sheet, sides[i + 1].sheet)
  }
})

test("saddle binding is one signature and blocks a long manuscript instead of changing its binding", () => {
  const settings = { destination: "booklet", binding: "saddle", signature: 4 }
  assert.equal(new Set(physicalSides(logical(26, settings)).map(s => s.signature)).size, 1)
  const long = compose(settings, { ...book, content: book.content.repeat(30) })
  assert.ok(long.pages.length > 32)
  assert.ok(long.issues.some(i => i.code === "bindingLimit" && i.severity === "error"))
  assert.throws(() => renderInterior(long, fonts, book.title, true))
  assert.equal(long.settings.binding, "saddle")
})

test("verse preserves significant internal and leading spaces, tabs and stanza gaps in final operations", () => {
  const content = "    luz    agua\n\n        sombra\tmar"
  const layout = compose({ textMode: "verse" }, { ...book, content })
  const rows = layout.pages.flatMap(p => p.ops).filter((o): o is TextOp => o.kind === "text" && o.paragraph !== undefined)
  assert.deepEqual(rows.map(o => o.text), ["    luz    agua", "        sombra    mar"])
  assert.deepEqual(manuscriptParagraphs(content, "verse"), ["    luz    agua", "", "        sombra    mar"])
  assert.ok(!layout.issues.some(i => i.severity === "error"))
  const wrapped = compose({ textMode: "verse" }, { ...book, content: "a    ".repeat(80) })
  assert.ok(wrapped.issues.some(i => i.code === "verseWrap"))
})

test("actual horizontal glyph ink is validated even when its advance fits the page", () => {
  const resources = { ...emptyPrintResources(), fonts: [{ id: "fixture", name: "test.ttf", data: readFileSync(new URL("./fixtures/print-glyphs.ttf", import.meta.url)).toString("base64") }] }
  const m = unicodeMetrics(base, fonts, f("DejaVuSans"), resources)
  const layout = composeEdition({ ...book, content: "\ue002" }, editionSettings(), m, printLabels(), undefined, undefined, resources)
  assert.ok(layout.issues.some(i => i.code === "layoutOverflow" && i.severity === "error"))
  assert.throws(() => renderInterior(layout, fonts, book.title))
})

test("Unicode PDF reuses vector glyph Forms instead of duplicating every path", () => {
  const layout = compose({}, { ...book, content: "مرحبا بالعالم 123. ".repeat(240) })
  assert.ok(!layout.issues.some(i => i.severity === "error"))
  const bytes = Buffer.from(renderInterior(layout, fonts, book.title))
  assert.match(bytes.toString("latin1"), /\/Subtype \/Form/)
  assert.ok(bytes.byteLength < 350_000, "Repeated vector outlines must share forms")
})

test("loose and saddle home covers export without inventing a block spine", () => {
  for (const patch of [{ destination: "home" }, { destination: "booklet", binding: "saddle" }]) {
    const interior = compose(patch), cover = composeCover(book, interior, metrics, null)
    assert.equal(cover.spine, 0)
    assert.ok(!cover.issues.some(i => i.code === "spineRequired"))
    assert.ok(renderHomeCover(cover, fonts, book.title, "letter", { cut: "Cut", fold: "Fold", glue: "Glue" }).byteLength > 1000)
  }
  assert.ok(composeCover(book, compose({ destination: "booklet" }), metrics, null).issues.some(i => i.code === "spineRequired"))
})

test("manual PDFs and calibration are explicitly single-sided and retain the same copy folio", () => {
  const layout = composeEdition(book, editionSettings({ destination: "booklet" }), metrics, printLabels(), { folio: "TEST-ONE-COPY", key: "fictional-test-key" })
  for (const pass of ["front", "back"] as const) {
    const pdf = Buffer.from(renderInterior(layout, fonts, book.title, true, { pass }, printerProfile({ duplex: "manual", rotateBacks: true }))).toString("latin1")
    assert.match(pdf, /\/Duplex \/Simplex/)
    const calibration = Buffer.from(renderCalibration(fonts, "letter", true, pass, "es", printerProfile({ reverseBacks: true }))).toString("latin1")
    assert.match(calibration, /\/Duplex \/Simplex/)
  }
})

test("edition projects restore the exact revision and reject shifted illustration anchors", async () => {
  const resources = emptyPrintResources(), project = await createEditionProject(book, editionSettings({ textMode: "verse", bodyPt: 14, spineMm: 7 }), resources, "Contraportada", null, null)
  const loaded = await readEditionProject(JSON.parse(JSON.stringify(project)), book)
  assert.deepEqual(loaded, project)
  assert.equal(loaded.settings.spineMm, 7)
  await assert.rejects(readEditionProject(project, { ...book, content: "Un párrafo añadido.\n" + book.content }), /projectMismatch/)
  await assert.rejects(readEditionProject(project, { ...book, revision: 5 }), /projectMismatch/)
  await assert.rejects(readEditionProject({ ...project, art: { data: "https://example.test/image.png", width: 1, height: 1 } }, book))
  assert.equal("key" in project, false); assert.equal("content" in project, false)
  assert.equal(await manuscriptFingerprint(book), project.fingerprint)
})

test("a previous work's verse mode cannot change the interpretation of a Gutenberg book", () => {
  const saved = new Map([["tloque_print_edition_v1", JSON.stringify({ textMode: "verse" })], [bookSettingsKey(book), JSON.stringify({ textMode: "verse" })]])
  const local = { getItem: (key: string) => saved.get(key) || null }
  assert.equal(initialEditionSettings(book, local).textMode, "verse")
  assert.equal(initialEditionSettings({ ...book, id: "gutenberg-999" }, local).textMode, "reflow")
  assert.equal(initialEditionSettings({ ...book, id: 2 }, local).textMode, "paragraphs")
  assert.deepEqual(printerProfile({ offsetX: Infinity, offsetY: 99 }), { duplex: "auto", reverseBacks: false, rotateBacks: false, offsetX: 0, offsetY: 5 })
})
