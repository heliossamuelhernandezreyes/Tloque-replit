import { imposeBooklet, type EditionLayout, type EditionSettings } from "./model"

export type PrintPass = "all" | "front" | "back"
export interface PrinterProfile {
  duplex: "auto" | "manual"
  reverseBacks: boolean; rotateBacks: boolean
  offsetX: number; offsetY: number
}
export const printerProfile = (value?: Partial<PrinterProfile> | null): PrinterProfile => ({
  duplex: value?.duplex === "manual" ? "manual" : "auto",
  reverseBacks: value?.reverseBacks === true, rotateBacks: value?.rotateBacks === true,
  offsetX: finiteOffset(value?.offsetX), offsetY: finiteOffset(value?.offsetY),
})
function finiteOffset(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(-5, Math.min(5, value)) : 0 }
export interface PrintSelection { pass?: PrintPass; signature?: number; sheet?: number; lastSheet?: number }
export interface PhysicalSide { signature: number; sheet: number; side: "front" | "back"; pages: number[] }
export const signatureSize = (settings: EditionSettings) => settings.binding === "saddle" ? 32 : settings.signature
export function physicalSides(layout: EditionLayout, imposed = layout.settings.destination === "booklet"): PhysicalSide[] {
  const count = layout.pages.length
  if (!Number.isSafeInteger(count) || count < 1 || count > 1800) throw new Error("Invalid print job")
  if (imposed) return imposeBooklet(count, signatureSize(layout.settings)).sides.map(s => ({ ...s, pages: [s.left, s.right] }))
  // Keep an explicit blank reverse for an odd-sized document. A manual pass
  // must have exactly one reverse for every physical sheet, including blanks.
  return Array.from({ length: Math.ceil(count / 2) * 2 }, (_, i) => ({ signature: 1, sheet: Math.floor(i / 2) + 1,
    side: i % 2 ? "back" : "front", pages: [i + 1] }))
}
export function selectPrintSides(sides: PhysicalSide[], selection: PrintSelection = {}, profile: PrinterProfile = printerProfile()): PhysicalSide[] {
  if (selection.pass !== undefined && !["all", "front", "back"].includes(selection.pass)) throw new Error("Invalid print pass")
  for (const field of [selection.signature, selection.sheet, selection.lastSheet]) if (field !== undefined && (!Number.isSafeInteger(field) || field < 1)) throw new Error("Invalid print selection")
  const selected = sides.filter(s => (!selection.signature || s.signature === selection.signature) && (!selection.sheet || s.sheet === selection.sheet)
    && (!selection.lastSheet || s.sheet <= selection.lastSheet) && (!selection.pass || selection.pass === "all" || s.side === selection.pass))
  if (!selected.length) throw new Error("Empty print selection")
  // Reverse only the second pass, never the interleaved automatic-duplex job.
  return selection.pass === "back" && profile.reverseBacks ? selected.reverse() : selected
}
