import { composeEdition } from "./compose"
import { composeCover, type CoverLayout, type PrintImage } from "./cover"
import { renderCover, renderCoverKit, renderHomeCover } from "./coverPdf"
import { renderCalibration } from "./calibration"
import type { PrintSelection, PrinterProfile } from "./homeJob"
import { loadPrintFonts, loadFallbackFont } from "./fontAssets"
import { unicodeMetrics } from "./unicodeFonts"
import { emptyPrintResources, type PrintResources } from "./resources"
import { fontMetrics, pdfDocument, renderInterior, type PrintFonts } from "./pdfRuntime"
import type { EditionLayout, EditionSettings, PdfCopy, PrintBook, PrintLabels } from "./model"

export interface ComposeRequest { type: "compose"; book: PrintBook; settings: EditionSettings; labels: PrintLabels; kitLabels: { cut: string; fold: string; glue: string }; language?: string; copy?: PdfCopy; origin: string; art: PrintImage | null; backArt: PrintImage | null; resources?: PrintResources }
export type ExportKind = "interior" | "booklet" | "cover" | "coverKit" | "coverHome" | "proof" | "calibrationFront" | "calibrationBack" | "calibrationAuto"
export type WorkerRequest = ComposeRequest | { type: "export"; kind: ExportKind; selection?: PrintSelection; profile?: PrinterProfile }
export type WorkerResponse = { type: "ready"; interior: EditionLayout; cover: CoverLayout } | { type: "file"; kind: ExportKind; buffer: ArrayBuffer } | { type: "error"; message: string }

let result: { interior: EditionLayout; cover: CoverLayout; fonts: PrintFonts; title: string; language: string; kitLabels: ComposeRequest["kitLabels"] } | undefined
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === "compose") {
      const { book, settings, labels, copy, origin, art, backArt } = event.data
      const [fonts, fallback] = await Promise.all([loadPrintFonts(), loadFallbackFont()])
      const resources = event.data.resources || emptyPrintResources()
      const metrics = unicodeMetrics(fontMetrics(pdfDocument(148, 210, fonts)), fonts, fallback, resources)
      const interior = composeEdition(book, settings, metrics, labels, copy, origin, resources)
      const cover = composeCover(book, interior, metrics, art, copy, origin, backArt)
      result = { interior, cover, fonts, title: book.title, language: event.data.language || "es", kitLabels: event.data.kitLabels }
      self.postMessage({ type: "ready", interior, cover } satisfies WorkerResponse)
    } else {
      if (!result) throw new Error("notReady")
      const { interior, cover, fonts, title } = result, { kind, selection, profile } = event.data
      const buffer = kind === "coverKit" ? renderCoverKit(cover, fonts, title, interior.settings.paper, result.kitLabels)
        : kind === "coverHome" ? renderHomeCover(cover, fonts, title, interior.settings.paper, result.kitLabels)
        : kind.startsWith("calibration") ? renderCalibration(fonts, interior.settings.paper, interior.settings.destination === "booklet", kind === "calibrationAuto" ? "all" : kind === "calibrationFront" ? "front" : "back", result.language, profile)
        : kind === "cover" ? renderCover(cover, fonts, title) : renderInterior(interior, fonts, title, kind === "booklet" || (kind === "proof" && interior.settings.destination === "booklet"), selection, kind === "interior" && interior.settings.destination === "booklet" ? undefined : profile)
      self.postMessage({ type: "file", kind, buffer } satisfies WorkerResponse, { transfer: [buffer] })
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error && ["fonts", "tooLong", "customFont", "resources", "missingGlyph"].includes(error.message) ? error.message : "generation" } satisfies WorkerResponse)
  }
}
