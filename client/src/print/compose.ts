import { editionSettings, pageSize, PT_MM, type EditionLayout, type EditionSettings, type FontMetrics, type FontStyle, type PdfCopy, type PrintBook, type PrintLabels, type PrintPage, type TextOp } from "./model"
import { emptyPrintResources, graphemes, validatePrintResources, type PrintResources } from "./resources"

const clean = (s: string) => String(s || "").replace(/\r\n?/g, "\n").normalize("NFC")
export function manuscriptParagraphs(content: string, mode: EditionSettings["textMode"]): string[] {
  const text = clean(content)
  if (mode === "reflow") return text.split(/\n\s*\n/).map(s => s.replace(/\n/g, " ").trim()).filter(Boolean)
  if (mode === "verse") return text.split("\n").map(s => s.replace(/\t/g, "    ").trimEnd())
  return text.split("\n").map(s => s.trim()).filter(Boolean)
}

// Bounded word spacing, never stretched letters. Split overlong words without
// inserting or deleting characters, and flag their first occurrence for review.
export function wrapText(text: string, width: number, metrics: FontMetrics, pt: number, font: FontStyle = "normal", indent = 0, direction?: "ltr" | "rtl"): { text: string; width: number; indent: number; broken: boolean }[] {
  const result: { text: string; width: number; indent: number; broken: boolean }[] = []
  let line = "", lineWidth = 0, offset = indent, broken = false
  const measure = (s: string) => metrics.width(s, pt, font, direction)
  const flush = () => { if (line) result.push({ text: line, width: lineWidth, indent: offset, broken }); line = ""; lineWidth = 0; offset = 0; broken = false }
  for (const word of text.split(/[^\S\u00a0\u202f]+/u).filter(Boolean)) {
    const w = measure(word)
    if (line && measure(line + " " + word) > width - offset) flush()
    if (w <= width - offset) {
      line += (line ? " " : "") + word; lineWidth = measure(line)
    } else {
      for (const character of (metrics.segments || graphemes)(word)) {
        if (line && measure(line + character) > width - offset) { broken = true; flush() }
        line += character; lineWidth = measure(line); broken = true
      }
    }
  }
  flush()
  return result
}

export function composeEdition(book: PrintBook, input: EditionSettings, metrics: FontMetrics, labels: PrintLabels, copy?: PdfCopy, origin = "https://tloque.app", inputResources: PrintResources = emptyPrintResources()): EditionLayout {
  const resources = validatePrintResources(inputResources)
  const settings = editionSettings(input), { width, height } = pageSize(settings)
  const { bodyPt, leading, inner, outer, top, bottom } = settings
  const layout: EditionLayout = { width, height, settings, pages: [], chapters: [], issues: [], wordCount: 0 }
  const source = book.chapters?.length ? book.chapters : [{ title: book.title, content: book.content || "" }]
  const length = source.reduce((sum, c) => sum + (c.content?.length || 0) + (c.title?.length || 0), 0)
  if (length > 6_000_000 || source.length > 500) { layout.issues.push({ code: "tooLong", severity: "error", scope: "interior" }); return layout }
  if (!source.some(c => c.content?.trim()) && !resources.illustrations.length) { layout.issues.push({ code: "missingText", severity: "error", scope: "interior" }); return layout }
  const missing = new Set<string>(), checked = new Set<string>()
  const values: [string, FontStyle][] = [[book.title, "normal"], [book.title, "bold"], [book.author, "normal"], [book.author, "italic"],
    ...Object.values(labels).map(v => [v, "normal"] as [string, FontStyle]), [labels.end, "italic"],
    ...(copy ? [[copy.folio, "bold"], [copy.key, "normal"]] as [string, FontStyle][] : []),
    ...source.flatMap(c => [[c.title, "normal"], [c.title, "bold"], [c.content, "normal"]] as [string, FontStyle][]),
    ...resources.illustrations.map(i => [i.caption, "normal"] as [string, FontStyle])]
  for (const [value, style] of values) {
    for (const c of (metrics.segments || graphemes)(clean(value))) {
      if (/^\s+$/u.test(c) || checked.has(style + c)) continue
      checked.add(style + c)
      if (!metrics.hasGlyph(c, style)) missing.add(c)
    }
  }
  if (missing.size) layout.issues.push({ code: "missingGlyph", severity: "error", scope: "interior", detail: [...missing].slice(0, 16).map(c => c + " (" + [...c].map(ch => "U+" + ch.codePointAt(0)!.toString(16).toUpperCase()).join(" ") + ")").join(" · ") })
  for (const i of resources.illustrations) if (!source[i.chapter] || i.afterParagraph > manuscriptParagraphs(source[i.chapter].content, settings.textMode).length) {
    layout.issues.push({ code: "artworkPosition", severity: "error", scope: "interior" }); break
  }
  if (layout.issues.some(i => i.severity === "error")) return layout

  const tw = width - inner - outer, lh = bodyPt * leading * PT_MM, bottomY = height - bottom
  const lineHeight = (value: string, pt: number, font: FontStyle) => {
    const extent = metrics.extents?.(value, pt, font)
    return Math.max(pt * PT_MM * 1.35, extent ? extent.ascent + extent.descent + pt * PT_MM * .15 : 0)
  }
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
      baseline += lineHeight(line.text, pt, font)
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
      if (metrics.width(header, 7.5) > tw) {
        const units = (metrics.segments || graphemes)(value)
        while (units.length && metrics.width(units.join("") + "…", 7.5) > tw) units.pop()
        header = units.join("").trimEnd() + "…"
      }
      text(header, width / 2, top - 6, 7.5, "normal", "header", true, 70)
    }
    decorate()
  }

  page("title")
  const titleFont = settings.template === "contemporary" ? "normal" : "bold"
  let titlePt = settings.template === "large" ? 25 : 23, authorPt = 12
  const titleHeight = () => wrapText(clean(book.title), tw, metrics, titlePt, titleFont).reduce((h, row) => h + lineHeight(row.text, titlePt, titleFont), 0)
    + 10 + wrapText(clean(book.author), tw, metrics, authorPt, "italic").reduce((h, row) => h + lineHeight(row.text, authorPt, "italic"), 0)
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
    const illustrate = (afterParagraph: number) => {
      for (const item of resources.illustrations.filter(i => i.chapter === ci && i.afterParagraph === afterParagraph)) {
        const rows = wrapText(clean(item.caption), tw, metrics, 9)
        const captionHeight = rows.length ? rows.length * 4.5 + 4 : 0
        const scale = Math.min(tw * item.widthPercent / 100 / item.image.width, (bottomY - top - 14 - captionHeight) / item.image.height)
        const iw = item.image.width * scale, ih = item.image.height * scale
        if (y + ih + captionHeight + 5 > bottomY) continuation(ci)
        current!.ops.push({ kind: "image", data: item.image.data, x: left(layout.pages.length) + (tw - iw) / 2, y, width: iw, height: ih, alt: item.caption })
        const ppi = Math.floor(25.4 / scale)
        if (ppi < 300) layout.issues.push({ code: "artworkResolution", severity: "warning", scope: "interior", detail: String(ppi) + " ppi", page: layout.pages.length })
        y += ih + 4
        for (const row of rows) { text(row.text, left(layout.pages.length) + tw / 2, y, 9, "normal", "body", true); y += 4.5 }
        y += lh
      }
    }
    paragraphs.forEach((paragraph, pi) => {
      illustrate(pi)
      paragraphId++
      if (!paragraph.trim()) { y += lh * .6; return }
      layout.wordCount += paragraph.trim().split(/\s+/u).length
      const scene = /^\s*(?:\*\s*){3,}$/.test(paragraph) || /^\s*(?:·\s*){3,}$/.test(paragraph)
      const indent = settings.textMode === "verse" ? Math.min(12, (paragraph.match(/^ */)?.[0].length || 0) * 1.2)
        : pi && settings.template === "classic" ? bodyPt * PT_MM : 0
      const direction = metrics.direction?.(paragraph) || "ltr"
      const rows = wrapText(paragraph, tw, metrics, bodyPt, "normal", scene ? 0 : indent, direction)
      const tall = rows.reduce((h, row) => Math.max(h, metrics.extents?.(row.text, bodyPt)?.ascent || 0), bodyPt * PT_MM)
      const rowHeight = rows.reduce((h, row) => Math.max(h, lineHeight(row.text, bodyPt, "normal")), lh)
      if (top + tall + rowHeight * (Math.min(3, rows.length) - 1) > bottomY) {
        layout.issues.push({ code: "layoutOverflow", severity: "error", scope: "interior", page: layout.pages.length }); return
      }
      y += Math.max(0, tall - bodyPt * PT_MM)
      if (rows.some(row => row.broken) && !layout.issues.some(i => i.code === "longWord")) layout.issues.push({ code: "longWord", severity: "warning", scope: "interior", page: layout.pages.length })
      let offset = 0
      while (offset < rows.length) {
        let room = Math.max(0, Math.floor((bottomY - y) / rowHeight) + 1)
        const remaining = rows.length - offset
        if (room < Math.min(2, remaining)) { continuation(ci); y = Math.max(y, top + tall); room = Math.floor((bottomY - y) / rowHeight) + 1 }
        let take = Math.min(room, remaining)
        if (remaining === 3 && take === 2) { continuation(ci); y = Math.max(y, top + tall); continue }
        if (remaining > take && remaining - take === 1 && take > 2) take--
        if (remaining > take && take < 2) { continuation(ci); y = Math.max(y, top + tall); continue }
        for (let ri = 0; ri < take; ri++) {
          const rowIndex = offset + ri, row = rows[rowIndex], pageLeft = left(layout.pages.length)
          const op = text(row.text, scene ? width / 2 : direction === "rtl" ? pageLeft + tw - row.indent - row.width : pageLeft + row.indent, y, bodyPt, "normal", "body", scene)
          op.direction = direction
          op.paragraph = paragraphId; op.line = rowIndex; op.lines = rows.length
          const words = row.text.split(" "), extra = tw - row.indent - row.width
          const normalSpace = metrics.width(" ", bodyPt)
          if (settings.justify && direction !== "rtl" && (metrics.canJustify?.(row.text) ?? true) && settings.textMode !== "verse" && !scene && rowIndex < rows.length - 1 && words.length > 1 && extra / (words.length - 1) <= normalSpace * .8 && !row.broken) {
            let x = pageLeft + row.indent
            op.words = words.map(word => { const positioned = { text: word, x }; x += metrics.width(word, bodyPt) + normalSpace + extra / (words.length - 1); return positioned })
            op.width = tw - row.indent
          }
          y += rowHeight
        }
        offset += take
        if (offset < rows.length) { continuation(ci); y = Math.max(y, top + tall) }
      }
      if (settings.template !== "classic" || scene) y += lh * .45
    })
    illustrate(paragraphs.length)
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
  const warnedImages = new Set<string>()
  layout.pages.forEach((p, index) => {
    for (const op of p.ops) if (op.kind === "text") {
      metrics.prepare?.(op)
      if (op.ink && !layout.issues.some(i => i.code === "outlinedText")) layout.issues.push({ code: "outlinedText", severity: "info", scope: "interior" })
      for (const item of op.ink || []) if (item.kind === "image" && item.sourceWidth && !warnedImages.has(item.data)) {
        const ppi = Math.floor(item.sourceWidth / item.width * 25.4)
        if (ppi < 300) { warnedImages.add(item.data); layout.issues.push({ code: "artworkResolution", severity: "warning", scope: "interior", detail: String(ppi) + " ppi", page: index + 1 }) }
      }
    }
    if (p.ops.some(op => op.kind === "text" && (
      op.x < -.01 || op.x + op.width > width + .01 || op.y - (metrics.extents?.(op.text, op.pt, op.font).ascent ?? op.pt * PT_MM * .75) < 0
      || op.y + (metrics.extents?.(op.text, op.pt, op.font).descent ?? op.pt * PT_MM * .25) > height
      || (["legal", "toc", "heading"].includes(op.role) && op.y > bottomY)
    )) && !layout.issues.some(i => i.code === "layoutOverflow" && i.page === index + 1)) {
      layout.issues.push({ code: "layoutOverflow", severity: "error", scope: "interior", page: index + 1 })
    }
  })
  const gutterMin = layout.pages.length > 700 ? 22.3 : layout.pages.length > 500 ? 19.1 : layout.pages.length > 300 ? 15.9 : 12.7
  if (inner < gutterMin) layout.issues.push({ code: "gutter", severity: "warning", scope: "interior", detail: String(gutterMin) })
  return layout
}
