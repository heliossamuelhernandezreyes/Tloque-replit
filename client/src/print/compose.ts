import { editionSettings, pageSize, PT_MM, type EditionLayout, type EditionSettings, type FontMetrics, type FontStyle, type PdfCopy, type PrintBook, type PrintLabels, type PrintPage, type TextOp } from "./model"

const clean = (s: string) => String(s || "").replace(/\r\n?/g, "\n").normalize("NFC")
export function manuscriptParagraphs(content: string, mode: EditionSettings["textMode"]): string[] {
  const text = clean(content)
  if (mode === "reflow") return text.split(/\n\s*\n/).map(s => s.replace(/\n/g, " ").trim()).filter(Boolean)
  if (mode === "verse") return text.split("\n").map(s => s.replace(/\t/g, "    ").trimEnd())
  return text.split("\n").map(s => s.trim()).filter(Boolean)
}

// Bounded word spacing, never stretched letters. Split overlong words without
// inserting or deleting characters, and flag their first occurrence for review.
export function wrapText(text: string, width: number, metrics: FontMetrics, pt: number, font: FontStyle = "normal", indent = 0): { text: string; width: number; indent: number; broken: boolean }[] {
  const result: { text: string; width: number; indent: number; broken: boolean }[] = []
  let line = "", lineWidth = 0, offset = indent, broken = false
  const space = metrics.width(" ", pt, font)
  const flush = () => { if (line) result.push({ text: line, width: lineWidth, indent: offset, broken }); line = ""; lineWidth = 0; offset = 0; broken = false }
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const w = metrics.width(word, pt, font)
    if (line && lineWidth + space + w > width - offset) flush()
    if (w <= width - offset) {
      lineWidth += (line ? space : 0) + w; line += (line ? " " : "") + word
    } else {
      for (const character of word) {
        const cw = metrics.width(character, pt, font)
        if (line && lineWidth + cw > width - offset) { broken = true; flush() }
        line += character; lineWidth += cw; broken = true
      }
    }
  }
  flush()
  return result
}

export function composeEdition(book: PrintBook, input: EditionSettings, metrics: FontMetrics, labels: PrintLabels, copy?: PdfCopy, origin = "https://tloque.app"): EditionLayout {
  const settings = editionSettings(input), { width, height } = pageSize(settings)
  const { bodyPt, leading, inner, outer, top, bottom } = settings
  const layout: EditionLayout = { width, height, settings, pages: [], chapters: [], issues: [], wordCount: 0 }
  const source = book.chapters?.length ? book.chapters : [{ title: book.title, content: book.content || "" }]
  const length = source.reduce((sum, c) => sum + (c.content?.length || 0) + (c.title?.length || 0), 0)
  if (length > 6_000_000 || source.length > 500) { layout.issues.push({ code: "tooLong", severity: "error", scope: "interior" }); return layout }
  if (!source.some(c => c.content?.trim())) { layout.issues.push({ code: "missingText", severity: "error", scope: "interior" }); return layout }
  const missing = new Set<string>(), checked = new Set<string>()
  let unsupported = false
  // The current renderer does not implement complex-script shaping. Refuse an
  // incomplete edition instead of substituting unreadable glyphs.
  for (const value of [book.title, book.author, ...Object.values(labels), ...source.flatMap(c => [c.title, c.content])]) {
    for (const c of clean(value)) {
      if (/\s/u.test(c) || checked.has(c)) continue
      checked.add(c)
      const cp = c.codePointAt(0)!
      if ((cp >= 0x590 && cp <= 0x1cff) || (cp >= 0x2e80 && cp <= 0xd7ff) || cp > 0xffff) unsupported = true
      if (!(metrics.hasGlyph(c) && metrics.hasGlyph(c, "bold") && metrics.hasGlyph(c, "italic"))) missing.add(c)
    }
  }
  if (unsupported) layout.issues.push({ code: "unsupportedScript", severity: "error", scope: "interior" })
  if (missing.size) layout.issues.push({ code: "missingGlyph", severity: "error", scope: "interior", detail: [...missing].slice(0, 16).join(" ") })
  if (layout.issues.some(i => i.severity === "error")) return layout

  const tw = width - inner - outer, lh = bodyPt * leading * PT_MM, bottomY = height - bottom
  const left = (number: number) => number % 2 === 1 ? inner : outer
  let current: PrintPage, y = top, paragraphId = 0
  const page = (kind: PrintPage["kind"], chapter?: number) => {
    if (layout.pages.length >= 1800) throw new Error("tooLong")
    current = { kind, ops: [], chapter }; layout.pages.push(current); y = top + bodyPt * PT_MM
    return current
  }
  const text = (value: string, x: number, baseline: number, pt: number, font: FontStyle, role: TextOp["role"], center = false, gray = 0): TextOp => {
    const valueWidth = metrics.width(value, pt, font)
    const op: TextOp = { kind: "text", text: value, x: center ? x - valueWidth / 2 : x, y: baseline, width: valueWidth, pt, font, role, gray }
    current.ops.push(op); return op
  }
  const block = (value: string, start: number, pt: number, font: FontStyle, role: TextOp["role"], blockWidth = tw, centered = true) => {
    let baseline = start
    for (const line of wrapText(clean(value), blockWidth, metrics, pt, font)) {
      text(line.text, centered ? width / 2 : left(layout.pages.length), baseline, pt, font, role, centered)
      baseline += pt * PT_MM * 1.35
    }
    return baseline
  }
  const decorate = () => {
    const n = layout.pages.length
    text(String(n), n % 2 ? width - outer : outer, height - 10, 8, "normal", "footer", n % 2 === 1)
  }
  const continuation = (ci: number) => {
    page("body", ci)
    if (settings.headers) {
      const value = clean(layout.pages.length % 2 ? book.title : book.author)
      let header = value
      while (header.length && metrics.width(header, 7.5) > tw) header = header.slice(0, -1)
      if (header !== value) header = header.trimEnd().slice(0, -1) + "…"
      text(header, width / 2, top - 6, 7.5, "normal", "header", true, 70)
    }
    decorate()
  }

  page("title")
  const titleFont = settings.template === "contemporary" ? "normal" : "bold"
  let titlePt = settings.template === "large" ? 25 : 23, authorPt = 12
  const titleHeight = () => wrapText(clean(book.title), tw, metrics, titlePt, titleFont).length * titlePt * PT_MM * 1.35
    + 10 + wrapText(clean(book.author), tw, metrics, authorPt, "italic").length * authorPt * PT_MM * 1.35
  while (height * .32 + titleHeight() > height - 44 && (titlePt > 16 || authorPt > 10)) {
    if (titlePt > 16) titlePt -= .5
    else authorPt -= .5
  }
  y = block(book.title, height * 0.32, titlePt, titleFont, "title")
  y = block(book.author, y + 10, authorPt, "italic", "title")
  if (y > height - 44) layout.issues.push({ code: "layoutOverflow", severity: "error", scope: "interior", page: 1 })
  current!.ops.push({ kind: "line", x: width / 2 - 8, x2: width / 2 + 8, y: height - 36, y2: height - 36, gray: 80, weight: .25 })
  text("TLOQUE", width / 2, height - 27, 9, "normal", "title", true, 60)

  page("legal")
  y = block(book.title, top + 18, 12, "bold", "legal")
  y = block(book.author, y + 3, 10, "normal", "legal")
  if (book.publicationYear) y = block(String(book.publicationYear), y + 4, 9, "normal", "legal")
  y = block(labels.edition, y + 9, 9, "normal", "legal")
  y = block(labels.rights, y + 4, 9, "normal", "legal")
  if (copy) {
    y = block(labels.copy + ": " + copy.folio, y + 8, 9, "bold", "legal")
    y = block(labels.key + ": " + copy.key, y + 2, 8.5, "normal", "legal")
    y = block(labels.claim, y + 4, 8.5, "normal", "legal")
    const size = 34
    current!.ops.push({ kind: "qr", x: width / 2 - size / 2, y: y + 3, size,
      value: origin + "/claim/" + encodeURIComponent(copy.folio) + "#key=" + encodeURIComponent(copy.key) })
    if (y + size + 3 > bottomY) throw new Error("tooLong")
  }

  // Reserve contents before composition; its fixed page-number column prevents
  // resolving references from changing the pagination.
  const tocRows = source.map(c => wrapText(clean(c.title || book.title), tw - 16, metrics, 10.5))
  const tocSlots: { page: PrintPage; y: number; index: number }[] = []
  if (settings.toc && source.length > 1) {
    page("contents"); y = block(labels.contents, top + 13, 20, "normal", "heading") + 10
    tocRows.forEach((rows, index) => {
      const h = rows.length * 5.6 + 4
      if (y + h > bottomY) { page("contents"); y = top + 8 }
      tocSlots.push({ page: current!, y, index }); y += h
    })
  }

  source.forEach((chapter, ci) => {
    if (settings.recto && (layout.pages.length + 1) % 2 === 0) page("blank")
    page("chapter", ci); decorate()
    const title = clean(chapter.title || book.title)
    layout.chapters.push({ title, page: layout.pages.length })
    y = height * (settings.template === "contemporary" ? .19 : .23)
    if (source.length > 1) text(String(ci + 1).padStart(2, "0"), width / 2, y - 12, 10, "normal", "heading", true, 60)
    y = block(title, y, settings.template === "large" ? 19 : 16, "bold", "heading", tw * .95) + 10
    const paragraphs = manuscriptParagraphs(chapter.content, settings.textMode)
    paragraphs.forEach((paragraph, pi) => {
      paragraphId++
      if (!paragraph.trim()) { y += lh * .6; return }
      layout.wordCount += paragraph.trim().split(/\s+/u).length
      const scene = /^\s*(?:\*\s*){3,}$/.test(paragraph) || /^\s*(?:·\s*){3,}$/.test(paragraph)
      const indent = settings.textMode === "verse" ? Math.min(12, (paragraph.match(/^ */)?.[0].length || 0) * 1.2)
        : pi && settings.template === "classic" ? bodyPt * PT_MM : 0
      const rows = wrapText(paragraph, tw, metrics, bodyPt, "normal", scene ? 0 : indent)
      if (rows.some(row => row.broken) && !layout.issues.some(i => i.code === "longWord")) layout.issues.push({ code: "longWord", severity: "warning", scope: "interior", page: layout.pages.length })
      let offset = 0
      while (offset < rows.length) {
        let room = Math.max(0, Math.floor((bottomY - y) / lh) + 1)
        const remaining = rows.length - offset
        if (room < Math.min(2, remaining)) { continuation(ci); room = Math.floor((bottomY - y) / lh) + 1 }
        let take = Math.min(room, remaining)
        if (remaining === 3 && take === 2) { continuation(ci); continue }
        if (remaining > take && remaining - take === 1 && take > 2) take--
        if (remaining > take && take < 2) { continuation(ci); continue }
        for (let ri = 0; ri < take; ri++) {
          const rowIndex = offset + ri, row = rows[rowIndex], pageLeft = left(layout.pages.length)
          const op = text(row.text, scene ? width / 2 : pageLeft + row.indent, y, bodyPt, "normal", "body", scene)
          op.paragraph = paragraphId; op.line = rowIndex; op.lines = rows.length
          const words = row.text.split(" "), extra = tw - row.indent - row.width
          const normalSpace = metrics.width(" ", bodyPt)
          if (settings.justify && settings.textMode !== "verse" && !scene && rowIndex < rows.length - 1 && words.length > 1 && extra / (words.length - 1) <= normalSpace * .8 && !row.broken) {
            let x = pageLeft + row.indent
            op.words = words.map(word => { const positioned = { text: word, x }; x += metrics.width(word, bodyPt) + normalSpace + extra / (words.length - 1); return positioned })
            op.width = tw - row.indent
          }
          y += lh
        }
        offset += take
        if (offset < rows.length) continuation(ci)
      }
      if (settings.template !== "classic" || scene) y += lh * .45
    })
  })
  if (y + lh * 2 > bottomY) continuation(source.length - 1)
  text(labels.end, width / 2, y + lh, 10, "italic", "body", true, 60)
  for (const slot of tocSlots) {
    current = slot.page
    let baseline = slot.y
    const pageNumber = layout.pages.indexOf(current) + 1
    tocRows[slot.index].forEach(row => { text(row.text, left(pageNumber), baseline, 10.5, "normal", "toc"); baseline += 5.6 })
    const number = String(layout.chapters[slot.index].page)
    text(number, left(pageNumber) + tw - metrics.width(number, 10.5), slot.y, 10.5, "normal", "toc")
  }
  if (layout.pages.length % 2) page("blank")
  // Never export overset front matter or a chapter heading outside the paper.
  // Page numbers and running headers intentionally sit outside the body frame.
  layout.pages.forEach((p, index) => {
    if (p.ops.some(op => op.kind === "text" && (
      op.x < -.01 || op.x + op.width > width + .01 || op.y - op.pt * PT_MM * .75 < 0
      || op.y + op.pt * PT_MM * .25 > height
      || (["legal", "toc", "heading"].includes(op.role) && op.y > bottomY)
    )) && !layout.issues.some(i => i.code === "layoutOverflow" && i.page === index + 1)) {
      layout.issues.push({ code: "layoutOverflow", severity: "error", scope: "interior", page: index + 1 })
    }
  })
  const gutterMin = layout.pages.length > 700 ? 22.3 : layout.pages.length > 500 ? 19.1 : layout.pages.length > 300 ? 15.9 : 12.7
  if (inner < gutterMin) layout.issues.push({ code: "gutter", severity: "warning", scope: "interior", detail: String(gutterMin) })
  return layout
}
