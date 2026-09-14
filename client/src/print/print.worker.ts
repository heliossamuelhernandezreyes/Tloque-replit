import { composeEdition } from "./compose"
import { composeCover, type CoverLayout, type PrintImage } from "./cover"
import { renderCover, renderCoverKit } from "./coverPdf"
import { loadPrintFonts } from "./fontAssets"
import { fontMetrics, pdfDocument, renderInterior, type PrintFonts } from "./pdfRuntime"
import type { EditionLayout, EditionSettings, PdfCopy, PrintBook, PrintLabels } from "./model"

export interface ComposeRequest { type: "compose"; book: PrintBook; settings: EditionSettings; labels: PrintLabels; kitLabels: { cut: string; fold: string; glue: string }; copy?: PdfCopy; origin: string; art: PrintImage | null }
export type ExportKind = "interior" | "booklet" | "cover" | "coverKit"
export type WorkerRequest = ComposeRequest | { type: "export"; kind: ExportKind }
export type WorkerResponse = { type: "ready"; interior: EditionLayout; cover: CoverLayout } | { type: "file"; kind: ExportKind; buffer: ArrayBuffer } | { type: "error"; message: string }

let result: { interior: EditionLayout; cover: CoverLayout; fonts: PrintFonts; title: string; kitLabels: ComposeRequest["kitLabels"] } | undefined
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === "compose") {
      const { book, settings, labels, copy, origin, art } = event.data
      const fonts = await loadPrintFonts(), metrics = fontMetrics(pdfDocument(148, 210, fonts))
      const interior = composeEdition(book, settings, metrics, labels, copy, origin)
      const cover = composeCover(book, interior, metrics, art, copy, origin)
      result = { interior, cover, fonts, title: book.title, kitLabels: event.data.kitLabels }
      self.postMessage({ type: "ready", interior, cover } satisfies WorkerResponse)
    } else {
      if (!result) throw new Error("notReady")
      const { interior, cover, fonts, title } = result, kind = event.data.kind
      const buffer = kind === "coverKit" ? renderCoverKit(cover, fonts, title, interior.settings.paper, result.kitLabels)
        : kind === "cover" ? renderCover(cover, fonts, title) : renderInterior(interior, fonts, title, kind === "booklet")
      self.postMessage({ type: "file", kind, buffer } satisfies WorkerResponse, { transfer: [buffer] })
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error && ["fonts", "tooLong"].includes(error.message) ? error.message : "generation" } satisfies WorkerResponse)
  }
}
