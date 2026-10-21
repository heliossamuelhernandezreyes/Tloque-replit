import type { CoverLayout, CoverOp } from "./cover"
import type { jsPDF } from "jspdf"
import { drawPage, pdfDocument, setPageBoxes, type PrintFonts } from "./pdfRuntime"

function drawCoverOp(doc: jsPDF, op: CoverOp, dx = 0, dy = 0) {
  if (op.kind === "rect") { doc.setFillColor(String(op.gray / 255)); doc.rect(op.x + dx, op.y + dy, op.width, op.height, "F") }
  else drawPage(doc, { kind: "title", ops: [op] }, dx, dy)
}
export function renderCover(cover: CoverLayout, fonts: PrintFonts, title: string): ArrayBuffer {
  if (cover.issues.some(i => i.severity === "error")) throw new Error("Invalid cover")
  const doc = pdfDocument(cover.width, cover.height, fonts)
  doc.setProperties({ title: title + " · Cover", creator: "Tloque · Edition Studio", subject: "Cover spread · RGB artwork · No PDF/X output intent" })
  doc.viewerPreferences({ Duplex: "Simplex", PrintScaling: "None" })
  cover.ops.forEach(op => drawCoverOp(doc, op))
  setPageBoxes(doc, cover.width, cover.height, cover.bleed)
  return doc.output("arraybuffer")
}
// Two single-sided sheets with a measured spine and a 12 mm glue tab.
export function renderCoverKit(cover: CoverLayout, fonts: PrintFonts, title: string, paper: "letter" | "a4", labels: { cut: string; fold: string; glue: string }): ArrayBuffer {
  const w = paper === "letter" ? 215.9 : 210, h = paper === "letter" ? 279.4 : 297
  const pw = cover.trimWidth, ph = cover.trimHeight, spine = cover.spine, tab = 12
  if (cover.issues.some(i => i.severity === "error") || pw + spine > w - 20 || ph > h - 36) throw new Error("Invalid cover kit")
  const doc = pdfDocument(w, h, fonts)
  doc.viewerPreferences({ Duplex: "Simplex", PrintScaling: "None" })
  doc.setProperties({ title: title + " · Cover kit", creator: "Tloque · Edition Studio", subject: "Two single-sided cover sheets, actual size" })
  const y = (h - ph) / 2
  const panel = (x: number, panelWidth: number, sourceX: number) => {
    // Keep the path unpainted until clip(): rect's default stroke consumes it.
    doc.saveGraphicsState(); doc.rect(x, y, panelWidth, ph, null); doc.clip(); doc.discardPath()
    cover.ops.forEach(op => drawCoverOp(doc, op, x - sourceX, y - cover.bleed))
    doc.restoreGraphicsState()
  }
  const lines = (x: number, panelWidth: number, fold: number) => {
    doc.setLineDashPattern([], 0); doc.setDrawColor(65); doc.setLineWidth(.2); doc.rect(x, y, panelWidth, ph)
    doc.setLineDashPattern([2, 1.5], 0); doc.line(fold, y - 3, fold, y + ph + 3); doc.setLineDashPattern([], 0)
    doc.setTextColor(50); doc.setFontSize(9); doc.setFont("SourceSerif4", "normal")
    doc.text(labels.cut + " / " + labels.fold, w / 2, y + ph + 10, { align: "center" })
    doc.setFontSize(8); doc.text(pw + " × " + ph + " mm · 100%", w / 2, y - 7, { align: "center" })
    setPageBoxes(doc, w, h)
  }
  let x = (w - pw - spine) / 2
  panel(x, pw + spine, cover.bleed + pw); lines(x, pw + spine, x + spine)
  doc.addPage(); x = (w - pw - tab) / 2
  panel(x, pw, cover.bleed); lines(x, pw + tab, x + pw)
  doc.setFontSize(7); doc.text(labels.glue, x + pw + 4, y + ph / 2, { angle: 90 })
  return doc.output("arraybuffer")
}

export function renderHomeCover(cover: CoverLayout, fonts: PrintFonts, title: string, paper: "letter" | "a4", labels: { cut: string; fold: string; glue: string }): ArrayBuffer {
  if (cover.binding === "bound") return renderCoverKit(cover, fonts, title, paper, labels)
  if (cover.issues.some(i => i.severity === "error")) throw new Error("Invalid cover")
  const pw = paper === "letter" ? 215.9 : 210, ph = paper === "letter" ? 279.4 : 297
  const loose = cover.binding === "loose", w = loose ? pw : ph, h = loose ? ph : pw
  const doc = pdfDocument(w, h, fonts)
  doc.viewerPreferences({ Duplex: "Simplex", PrintScaling: "None" })
  doc.setProperties({ title: title + " · Home cover", creator: "Tloque · Edition Studio", subject: loose ? "Two single-sided full-size cover sheets" : "Single-sided folded booklet cover, no block spine" })
  const panel = (x: number, width: number, sourceX: number) => {
    doc.saveGraphicsState(); doc.rect(x, 0, width, h, null); doc.clip(); doc.discardPath()
    cover.ops.forEach(op => drawCoverOp(doc, op, x - sourceX, -cover.bleed)); doc.restoreGraphicsState()
  }
  if (loose) {
    panel(0, pw, cover.bleed + cover.trimWidth)
    setPageBoxes(doc, w, h); doc.addPage()
    panel(0, pw, cover.bleed)
  } else {
    if (Math.abs(cover.trimWidth * 2 - w) > .01 || Math.abs(cover.trimHeight - h) > .01) throw new Error("Invalid folded cover")
    // Ordinary printers leave white edges. A folded cover deliberately uses
    // that inset instead of pretending that borderless printing is available.
    doc.saveGraphicsState(); doc.rect(10, 10, w - 20, h - 20, null); doc.clip(); doc.discardPath()
    cover.ops.forEach(op => drawCoverOp(doc, op, -cover.bleed, -cover.bleed)); doc.restoreGraphicsState()
    doc.setDrawColor(160); doc.setLineWidth(.15); doc.setLineDashPattern([2, 2], 0)
    doc.line(w / 2, 3, w / 2, 8); doc.line(w / 2, h - 8, w / 2, h - 3)
  }
  setPageBoxes(doc, w, h); return doc.output("arraybuffer")
}
