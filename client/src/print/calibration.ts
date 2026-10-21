import { pdfDocument, setPageBoxes, type PrintFonts } from "./pdfRuntime"
import { PT_MM } from "./model"
import { printerProfile, type PrinterProfile } from "./homeJob"
import { homeText } from "./homeStrings"

export function renderCalibration(fonts: PrintFonts, paper: "letter" | "a4", booklet: boolean, pass: "front" | "back" | "all", language: string, input?: PrinterProfile): ArrayBuffer {
  const portrait = paper === "letter" ? [215.9, 279.4] : [210, 297]
  const [w, h] = booklet ? [portrait[1], portrait[0]] : portrait
  const doc = pdfDocument(w, h, fonts), p = printerProfile(input), t = homeText(language)
  if (pass !== "all") doc.viewerPreferences({ Duplex: "Simplex", PrintScaling: "None" })
  doc.setProperties({ title: t("calibration"), creator: "Tloque · Edition Studio" })
  const ids = pass === "all" ? ["A", "A", "B", "B"] : pass === "back" && p.reverseBacks ? ["B", "A"] : ["A", "B"]
  ids.forEach((id, i) => {
    if (i) doc.addPage()
    doc.saveGraphicsState()
    const side = pass === "all" ? i % 2 ? "back" : "front" : pass
    if (side === "back") {
      doc.setCurrentTransformationMatrix(doc.Matrix(1, 0, 0, 1, p.offsetX / PT_MM, -p.offsetY / PT_MM))
      if (pass !== "all" && p.rotateBacks) doc.setCurrentTransformationMatrix(doc.Matrix(-1, 0, 0, -1, w / PT_MM, h / PT_MM))
    }
    doc.setDrawColor(80); doc.setLineWidth(.2); doc.rect(12, 12, w - 24, h - 24)
    doc.setFontSize(10); doc.text(t("physicalProof"), w / 2, 21, { align: "center" })
    doc.setFontSize(16); doc.text(t("top"), w / 2, 38, { align: "center" })
    doc.line(w / 2, 42, w / 2, 49); doc.line(w / 2, 42, w / 2 - 2, 45); doc.line(w / 2, 42, w / 2 + 2, 45)
    doc.setFontSize(64); doc.text(id, w / 2, 75, { align: "center" })
    doc.setFontSize(15); doc.text(t(side), w / 2, 89, { align: "center" })
    const x = w / 2 - 50, y = 112
    doc.line(x, y, x + 100, y)
    for (let mm = 0; mm <= 100; mm += 10) doc.line(x + mm, y - (mm % 50 ? 2 : 4), x + mm, y + 3)
    doc.setFontSize(10); doc.text(t("ruler"), w / 2, y + 12, { align: "center" })
    for (const [cx, cy] of [[20, 48], [w - 20, 48], [20, h - 24], [w - 20, h - 24]]) {
      doc.line(cx - 4, cy, cx + 4, cy); doc.line(cx, cy - 4, cx, cy + 4)
    }
    if (booklet) { doc.setLineDashPattern([2, 2], 0); doc.line(w / 2, h - 45, w / 2, h - 17) }
    doc.restoreGraphicsState(); setPageBoxes(doc, w, h)
  })
  return doc.output("arraybuffer")
}
