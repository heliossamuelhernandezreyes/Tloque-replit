import { jsPDF } from "jspdf"
import qrcode from "qrcode-generator"
import { PT_MM, imposeBooklet, type EditionLayout, type FontMetrics, type PrintPage } from "./model"

export type PrintFonts = Record<"normal" | "bold" | "italic", string>
export function pdfDocument(width: number, height: number, fonts: PrintFonts) {
  const doc = new jsPDF({ unit: "mm", format: [width, height], orientation: width > height ? "landscape" : "portrait", compress: true, putOnlyUsedFonts: true, floatPrecision: 6 })
  for (const style of ["normal", "bold", "italic"] as const) {
    const filename = "SourceSerif4-" + style + ".ttf"
    doc.addFileToVFS(filename, fonts[style]); doc.addFont(filename, "SourceSerif4", style)
  }
  doc.setFont("SourceSerif4", "normal")
  doc.viewerPreferences({ PrintScaling: "None", Duplex: width > height ? "DuplexFlipShortEdge" : "DuplexFlipLongEdge" })
  return doc
}
export function fontMetrics(doc: jsPDF): FontMetrics {
  const cache = new Map<string, number>()
  return {
    width(text, pt, style = "normal") {
      const key = style + "\0" + pt + "\0" + text
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      doc.setFont("SourceSerif4", style); doc.setFontSize(pt)
      const width = doc.getTextWidth(text)
      if (cache.size > 24000) cache.clear()
      cache.set(key, width); return width
    },
    hasGlyph(character, style = "normal") {
      doc.setFont("SourceSerif4", style)
      const metadata = doc.getFont().metadata as unknown as { characterToGlyph: (code: number) => number }
      return metadata.characterToGlyph(character.codePointAt(0)!) !== 0
    },
  }
}
export function qrMatrix(value: string): boolean[][] {
  const qr = qrcode(0, "M"); qr.addData(value); qr.make()
  return Array.from({ length: qr.getModuleCount() }, (_, r) => Array.from({ length: qr.getModuleCount() }, (_, c) => qr.isDark(r, c)))
}
export function drawQr(doc: jsPDF, value: string, x: number, y: number, size: number) {
  const matrix = qrMatrix(value), module = size / (matrix.length + 8)
  doc.setFillColor("1"); doc.rect(x, y, size, size, "F"); doc.setFillColor("0")
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) doc.rect(x + (c + 4) * module, y + (r + 4) * module, module, module, "F")
  }))
}
export function drawPage(doc: jsPDF, page: PrintPage, dx = 0, dy = 0) {
  for (const op of page.ops) {
    if (op.kind === "text") {
      doc.setFont("SourceSerif4", op.font); doc.setFontSize(op.pt); doc.setTextColor(op.gray)
      if (op.ink) {
        doc.setFillColor(String(op.gray / 255))
        for (const item of op.ink) {
          if (item.kind === "image") doc.addImage(item.data, item.data.startsWith("data:image/png") ? "PNG" : "JPEG", item.x + dx, item.y + dy, item.width, item.height)
          else {
            doc.path(item.path.commands.map(c => ({ op: c.op, c: c.c.map((v, i) => i % 2 ? item.y + dy - v * item.scale : item.x + dx + v * item.scale) })))
            doc.fill()
          }
        }
      } else if (op.words) op.words.forEach(w => doc.text(w.text, w.x + dx, op.y + dy))
      else doc.text(op.text, op.x + dx, op.y + dy)
    } else if (op.kind === "line") {
      doc.setDrawColor(op.gray); doc.setLineWidth(op.weight); doc.line(op.x + dx, op.y + dy, op.x2 + dx, op.y2 + dy)
    } else if (op.kind === "image") doc.addImage(op.data, op.data.startsWith("data:image/png") ? "PNG" : "JPEG", op.x + dx, op.y + dy, op.width, op.height)
    else drawQr(doc, op.value, op.x + dx, op.y + dy, op.size)
  }
}
// Isolate jsPDF's version-specific page dictionary adapter; PDF QA verifies it.
export function setPageBoxes(doc: jsPDF, width: number, height: number, inset = 0) {
  const context = doc.getCurrentPageInfo().pageContext as unknown as Record<string, unknown>
  context.trimBox = { bottomLeftX: inset / PT_MM, bottomLeftY: inset / PT_MM, topRightX: (width - inset) / PT_MM, topRightY: (height - inset) / PT_MM }
  context.bleedBox = { bottomLeftX: 0, bottomLeftY: 0, topRightX: width / PT_MM, topRightY: height / PT_MM }
}
export function renderInterior(layout: EditionLayout, fonts: PrintFonts, title: string, imposed = false): ArrayBuffer {
  if (!layout.pages.length || layout.issues.some(i => i.scope === "interior" && i.severity === "error")) throw new Error("Invalid interior")
  const w = layout.width, h = layout.height
  const doc = pdfDocument(imposed ? w * 2 : w, h, fonts)
  doc.setProperties({ title, creator: "Tloque · Edition Studio", subject: imposed ? "Booklet signatures / Cuadernillos" : "Book interior / Interior", keywords: "Tloque, print edition" })
  if (imposed) {
    const plan = imposeBooklet(layout.pages.length, layout.settings.signature)
    plan.sides.forEach((side, i) => {
      if (i) doc.addPage()
      for (const [number, x] of [[side.left, 0], [side.right, w]]) if (layout.pages[number - 1]) drawPage(doc, layout.pages[number - 1], x)
      setPageBoxes(doc, w * 2, h)
    })
  } else {
    layout.pages.forEach((page, i) => { if (i) doc.addPage(); drawPage(doc, page); setPageBoxes(doc, w, h) })
    layout.chapters.forEach(ch => doc.outline.add(null, ch.title, { pageNumber: ch.page }))
  }
  return doc.output("arraybuffer")
}
