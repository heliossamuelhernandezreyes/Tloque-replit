import { PT_MM, type EditionLayout, type FontMetrics, type PageOp, type PdfCopy, type PrintBook, type PrintIssue, type TextOp } from "./model"
import { wrapText } from "./compose"

export interface PrintImage { data: string; width: number; height: number }
export type CoverOp = PageOp | { kind: "rect"; x: number; y: number; width: number; height: number; gray: number }
  | { kind: "image"; x: number; y: number; width: number; height: number; data: string }
export interface CoverLayout { width: number; height: number; trimWidth: number; trimHeight: number; spine: number; bleed: number; ops: CoverOp[]; issues: PrintIssue[]; ppi: number | null }
export function composeCover(book: PrintBook, interior: EditionLayout, metrics: FontMetrics, art: PrintImage | null, copy?: PdfCopy, origin = "https://tloque.app"): CoverLayout {
  const { width: w, height: h, settings: s } = interior, b = s.bleedMm, spine = s.spineMm
  const width = w * 2 + spine + b * 2, height = h + b * 2, frontX = b + w + spine
  const cover: CoverLayout = { width, height, trimWidth: w, trimHeight: h, spine, bleed: b, ops: [], issues: [], ppi: null }
  cover.ops.push({ kind: "rect", x: 0, y: 0, width, height, gray: 20 })
  if (spine <= 0) cover.issues.push({ code: "spineRequired", severity: "error", scope: "cover" })
  cover.issues.push({ code: "colorProfile", severity: "info", scope: "cover" })
  const writeBlock = (value: string, x: number, start: number, maxWidth: number, maxHeight: number, pt: number, minPt: number, font: TextOp["font"], gray = 245) => {
    let size = pt, rows = wrapText(value.normalize("NFC"), maxWidth, metrics, size, font)
    while (rows.length * size * PT_MM * 1.35 > maxHeight && size > minPt) { size -= .5; rows = wrapText(value.normalize("NFC"), maxWidth, metrics, size, font) }
    if (rows.length * size * PT_MM * 1.35 > maxHeight) {
      cover.issues.push({ code: "coverOverflow", severity: "error", scope: "cover" }); return
    }
    if ([...value.normalize("NFC")].some(c => !/\s/u.test(c) && !metrics.hasGlyph(c, font))) cover.issues.push({ code: "missingGlyph", severity: "error", scope: "cover" })
    rows.forEach((row, i) => cover.ops.push({ kind: "text", text: row.text, x, y: start + i * size * PT_MM * 1.35, width: row.width, pt: size, font, role: "title", gray }))
  }
  const safe = 15
  if (s.coverArt && art) {
    // Fit the complete original cover, preserving embedded lettering and aspect
    // ratio. The solid surround extends into bleed; the artwork is not upscaled.
    const scale = Math.min(w / art.width, h / art.height)
    const aw = art.width * scale, ah = art.height * scale
    cover.ops.push({ kind: "image", data: art.data, x: frontX + (w - aw) / 2, y: b + (h - ah) / 2, width: aw, height: ah })
    cover.ppi = Math.floor(25.4 / scale)
    if (cover.ppi < 300) cover.issues.push({ code: "coverResolution", severity: "warning", scope: "cover", detail: String(cover.ppi) })
  } else if (s.coverArt && book.coverUrl) cover.issues.push({ code: "coverMissing", severity: "warning", scope: "cover" })
  if (!(s.coverArt && art)) {
    writeBlock(book.title, frontX + safe, b + h * .29, w - safe * 2, 32, 24, 12, "bold")
    writeBlock(book.author, frontX + safe, b + h * .29 + 46, w - safe * 2, 18, 12, 9, "italic")
    writeBlock("TLOQUE", frontX + safe, b + h - 12, w - safe * 2, 10, 8, 8, "normal", 185)
  }
  writeBlock(book.synopsis || book.title, b + safe, b + 34, w - safe * 2, h - 100, 12, 9, "normal")
  if (copy) {
    cover.ops.push({ kind: "qr", value: origin + "/claim/" + encodeURIComponent(copy.folio), x: b + safe, y: b + h - 50, size: 29 })
    writeBlock(copy.folio, b + safe, b + h - 14, w - safe * 2, 8, 8, 8, "normal", 230)
  } else writeBlock("TLOQUE", b + safe, b + h - 18, w - safe * 2, 10, 9, 9, "normal", 185)
  // A printer-specific template is needed to determine safe spine lettering.
  return cover
}
