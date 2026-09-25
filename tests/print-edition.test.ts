import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { composeEdition, manuscriptParagraphs, wrapText } from "../client/src/print/compose"
import { composeCover } from "../client/src/print/cover"
import { DEFAULT_EDITION, editionSettings, imposeBooklet, pageSize, printLabels, useTemplate, type PrintBook, type TextOp } from "../client/src/print/model"
import { fontMetrics, pdfDocument, renderInterior, type PrintFonts } from "../client/src/print/pdfRuntime"
import { renderCover, renderCoverKit } from "../client/src/print/coverPdf"

const fonts = Object.fromEntries([["normal", "Regular"], ["bold", "Bold"], ["italic", "It"]].map(([key, name]) => [key, readFileSync(new URL("../client/src/print/assets/SourceSerif4-" + name + ".ttf", import.meta.url)).toString("base64")])) as PrintFonts
const metrics = fontMetrics(pdfDocument(148, 210, fonts)), labels = printLabels("es")
const sample = "El río guardaba la memoria de aquella noche. ¿Quién había dejado una lámpara encendida? Lucía escuchó el viento y siguió el camino hacia la biblioteca."
const book: PrintBook = { title: "La memoria del río", author: "Lucía Márquez", originalLanguage: "es", synopsis: sample, chapters: Array.from({ length: 5 }, (_, i) => ({ title: "Capítulo " + (i + 1) + ": Las páginas del agua", content: Array.from({ length: 30 }, (_, n) => (i + 1) + "." + (n + 1) + " " + sample.repeat(n % 4 + 1)).join("\n\n") })) }
const compose = (patch = {}, value = book) => composeEdition(value, editionSettings(patch), metrics, labels)
const compact = (text: string) => text.normalize("NFC").replace(/\s/g, "")

test("persisted Gutenberg translation credits appear in the printed edition", () => {
  const layout = compose({}, { ...book, sourceMetadata: { provider: "gutenberg", translators: ["Pedro Pedraza y Páez"], sourceUrl: "https://www.gutenberg.org/ebooks/61851" } })
  const credits = layout.pages.filter(page => page.kind === "legal").flatMap(page => page.ops)
    .filter((op): op is TextOp => op.kind === "text").map(op => op.text).join(" ")
  assert.match(credits, /Traducción: Pedro Pedraza y Páez/)
  assert.match(credits, /Project Gutenberg/)
  assert.match(credits, /ebooks\/61851/)
  assert.ok(!layout.issues.some(issue => issue.severity === "error"))
})

test("print composition preserves manuscript characters and resolves chapter references", () => {
  const layout = compose()
  assert.ok(layout.pages.length > 15); assert.equal(layout.pages.length % 2, 0)
  layout.chapters.forEach((chapter, i) => { assert.equal(chapter.page % 2, 1); assert.equal(layout.pages[chapter.page - 1].chapter, i) })
  const body = layout.pages.flatMap(p => p.ops).filter((op): op is TextOp => op.kind === "text" && op.paragraph !== undefined)
  assert.equal(compact(body.map(op => op.text).join("")), compact(book.chapters!.map(c => c.content).join("")))
  const contents = layout.pages.filter(p => p.kind === "contents").flatMap(p => p.ops).filter(op => op.kind === "text").map(op => op.text)
  layout.chapters.forEach(c => assert.ok(contents.includes(String(c.page))))
  assert.ok(layout.pages.filter(p => p.kind === "blank").every(p => p.ops.length === 0))
})

test("body lines respect mirrored margins and paragraph fragments keep at least two lines", () => {
  for (const template of ["classic", "large", "contemporary"] as const) {
    const settings = useTemplate(DEFAULT_EDITION, template), layout = compose(settings)
    const fragments = new Map<number, Map<number, number>>()
    layout.pages.forEach((page, pi) => page.ops.forEach(op => {
      if (op.kind !== "text") return
      assert.ok(op.x >= -0.01 && op.x + op.width <= layout.width + .05, "Text outside page " + (pi + 1) + ": " + op.text)
      assert.ok(op.y >= 0 && op.y < layout.height, "Vertical overflow " + (pi + 1))
      if (op.paragraph === undefined) return
      const left = (pi + 1) % 2 ? settings.inner : settings.outer
      assert.ok(op.x >= left - .01 && op.x + op.width <= left + layout.width - settings.inner - settings.outer + .01)
      assert.ok(op.y <= layout.height - settings.bottom + .01)
      if (!fragments.has(op.paragraph)) fragments.set(op.paragraph, new Map())
      const parts = fragments.get(op.paragraph)!; parts.set(pi, (parts.get(pi) || 0) + 1)
    }))
    fragments.forEach(parts => { if (parts.size > 1) parts.forEach(n => assert.ok(n >= 2, template + ": isolated paragraph line")) })
  }
})

test("settings reject invalid persisted values and enforce physical paper geometry", () => {
  const settings = editionSettings({ bodyPt: NaN, inner: -99, leading: Infinity, signature: 7 as never, destination: "injected" as never })
  assert.equal(settings.bodyPt, 11); assert.equal(settings.inner, 16); assert.equal(settings.signature, 16)
  assert.deepEqual(pageSize(editionSettings({ destination: "booklet", paper: "a4" })), { width: 148.5, height: 210 })
  assert.deepEqual(pageSize(editionSettings({ destination: "home", paper: "letter" })), { width: 215.9, height: 279.4 })
})

test("booklet imposition includes every padded page exactly once with shorter final signatures", () => {
  for (const signature of [4, 8, 16, 32]) for (let count = 1; count <= 141; count++) {
    const plan = imposeBooklet(count, signature)
    const all = plan.sides.flatMap(s => [s.left, s.right]).sort((a, b) => a - b)
    assert.deepEqual(all, Array.from({ length: plan.paddedPages }, (_, i) => i + 1))
    assert.equal(plan.blanks, plan.paddedPages - count)
    plan.sides.forEach((s, i) => assert.equal(s.side, i % 2 ? "back" : "front"))
  }
  assert.deepEqual(imposeBooklet(8, 8).sides.map(s => [s.left, s.right]), [[8, 1], [2, 7], [6, 3], [4, 5]])
  assert.throws(() => imposeBooklet(0, 16)); assert.throws(() => imposeBooklet(40, 12))
})

test("Unicode normalization works; the basic Source Serif metrics still reject absent glyphs", () => {
  const supported = compose({}, { ...book, chapters: [{ title: "Ελληνικά · русский", content: "México: acción, corazón — Ελληνικά, русский." }] })
  assert.equal(supported.issues.some(i => i.severity === "error"), false)
  for (const content of ["مرحبا بالعالم", "日本語の本", "Emoji 🦄"]) {
    const layout = compose({}, { ...book, chapters: [{ title: "Texto", content }] })
    assert.ok(layout.issues.some(i => i.severity === "error")); assert.equal(layout.pages.length, 0)
    assert.throws(() => renderInterior(layout, fonts, book.title))
  }
})

test("empty, oversized and verse manuscripts are handled without silently dropping text", () => {
  assert.equal(compose({}, { title: "Vacío", author: "Autor" }).issues[0].code, "missingText")
  assert.equal(compose({}, { title: "Largo", author: "Autor", content: "a".repeat(6_000_001) }).issues[0].code, "tooLong")
  assert.deepEqual(manuscriptParagraphs("Uno\ndos\n\n   tres", "verse"), ["Uno", "dos", "", "   tres"])
  assert.deepEqual(manuscriptParagraphs("Uno\ndos\n\n tres", "reflow"), ["Uno dos", "tres"])
  const word = "Anticonstitucionalísimamente".repeat(6), rows = wrapText(word, 60, metrics, 12)
  assert.equal(rows.map(row => row.text).join(""), word); assert.ok(rows.some(row => row.broken))
})

test("activation stays inside the legal page with a fragment key and a public cover QR", () => {
  const copy = { folio: "QA-ONLY-123", key: "fixture-key-1234567890" }, origin = "https://example.test"
  const interior = composeEdition(book, editionSettings({ spineMm: 9 }), metrics, labels, copy, origin)
  const qr = interior.pages.flatMap(p => p.ops).find(op => op.kind === "qr")!
  assert.equal(qr.kind === "qr" && qr.value, origin + "/claim/" + copy.folio + "#key=" + copy.key)
  const cover = composeCover(book, interior, metrics, null, copy, origin)
  assert.ok(JSON.stringify(cover).includes(copy.folio)); assert.ok(!JSON.stringify(cover).includes(copy.key))
})

test("cover preflight measures effective resolution and rejects missing spine or overflowing copy", () => {
  const interior = compose(), image = { data: "fixture", width: 300, height: 450 }
  const cover = composeCover(book, interior, metrics, image)
  assert.ok(cover.issues.some(i => i.code === "spineRequired")); assert.ok(cover.issues.some(i => i.code === "coverResolution"))
  assert.equal(cover.ppi, Math.floor(450 / (210 / 25.4))); assert.throws(() => renderCover(cover, fonts, book.title))
  const long = composeCover({ ...book, synopsis: sample.repeat(60) }, compose({ spineMm: 8 }), metrics, null)
  assert.ok(long.issues.some(i => i.code === "coverOverflow"))
  const tooWide = composeCover(book, compose({ destination: "booklet", spineMm: 70 }), metrics, null)
  assert.throws(() => renderCoverKit(tooWide, fonts, book.title, "letter", { cut: "Cut", fold: "Fold", glue: "Glue" }))
})

test("PDFs embed TrueType fonts and publish real trim boxes and print scaling preferences", () => {
  const layout = compose({}, { ...book, chapters: [{ title: "Capítulo", content: sample }] })
  const bytes = Buffer.from(renderInterior(layout, fonts, book.title)).toString("latin1")
  assert.match(bytes, /^%PDF-1\./); assert.match(bytes, /\/FontFile2/); assert.match(bytes, /\/ToUnicode/)
  assert.match(bytes, /\/TrimBox/); assert.match(bytes, /\/PrintScaling \/None/); assert.doesNotMatch(bytes, /\/OutputIntents|PDF\/X/)
})

test("long metadata fits the title page; overset headings block export", () => {
  const metadata = { ...book, title: "La memoria del río ".repeat(10).trim(), author: "Lucía Márquez ".repeat(10).trim() }
  const layout = compose({}, metadata)
  assert.equal(layout.issues.some(i => i.severity === "error"), false)
  const title = layout.pages[0].ops.filter(op => op.kind === "text").map(op => op.text).join("")
  assert.ok(compact(title).startsWith(compact(metadata.title + metadata.author)))
  for (const oversized of [
    { ...book, title: sample.repeat(40) },
    { ...book, chapters: [{ title: sample.repeat(40), content: sample }] },
  ]) {
    const failed = compose({}, oversized)
    assert.ok(failed.issues.some(i => i.code === "layoutOverflow" && i.severity === "error" && i.page))
    assert.throws(() => renderInterior(failed, fonts, oversized.title))
  }
})

test("existing front and back artwork keep their proportions without duplicate cover text", () => {
  const original = { ...book, coverUrl: "/front.png", backCoverUrl: "/back.png" }
  const front = { data: "front-image", width: 1600, height: 2400 }, back = { data: "back-image", width: 1500, height: 2300 }
  const copy = { folio: "QA-ART-ONLY", key: "fixture-private-key" }
  const cover = composeCover(original, compose({ spineMm: 8 }), metrics, front, copy, "https://example.test", back)
  const images = cover.ops.filter(op => op.kind === "image")
  assert.deepEqual(images.map(op => op.data), [front.data, back.data])
  assert.ok(Math.abs(images[0].width / images[0].height - front.width / front.height) < 1e-8)
  assert.ok(Math.abs(images[1].width / images[1].height - back.width / back.height) < 1e-8)
  assert.ok(!JSON.stringify(cover).includes(copy.key))
  assert.ok(!cover.ops.some(op => op.kind === "text" && op.text.includes("El río guardaba")))
  const textBack = composeCover(original, compose({ spineMm: 8, backCoverArt: false }), metrics, front, undefined, "https://example.test", back)
  assert.equal(textBack.ops.filter(op => op.kind === "image").length, 1)
  assert.ok(textBack.ops.some(op => op.kind === "text" && op.text.includes("El río guardaba")))
})
