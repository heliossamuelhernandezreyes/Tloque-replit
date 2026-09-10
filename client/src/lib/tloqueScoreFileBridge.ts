import type { LinearScoreRecipe } from "@shared/audio"
import type { MusicXmlImportResult } from "./musicXmlImporter"
import { normalizeScoreInput } from "./tloqueComposer"

export const SCORE_FILE_ACCEPT = ".tloque,.tloquescore,.txt,.musicxml,.xml,.mxl"
export interface ImportedScoreFile {
  source: string
  fileName: string
  title: string
  composer: string
  recipe: LinearScoreRecipe | null
  report: MusicXmlImportResult["report"] | null
}

export function scoreTitle(source: string) {
  return source.match(/^title\s+"([^"]+)"/m)?.[1]?.trim() || "Obra TloqueScore"
}

export function scoreFileName(title: string) {
  const name = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
  return `${name || "obra-tloque"}.tloque`
}

export async function readScoreFile(file: File): Promise<ImportedScoreFile> {
  const extension = file.name.toLowerCase().match(/\.(tloque|tloquescore|txt|musicxml|xml|mxl)$/)?.[1]
  if (!extension) throw new Error("Formato no admitido. Usa TloqueScore, .musicxml, .xml o .mxl.")
  const isXml = ["musicxml", "xml", "mxl"].includes(extension)
  const limit = extension === "mxl" ? 16 * 1024 * 1024 : isXml ? 12 * 1024 * 1024 : 4_000_000
  if (file.size > limit) throw new Error(`El archivo supera el límite de ${(limit / 1024 / 1024).toFixed(1)} MB para .${extension}.`)
  if (isXml) {
    const { importMusicXmlFile } = await import("./musicXmlImporter")
    const imported = await importMusicXmlFile(file)
    return { ...imported, fileName: file.name }
  }
  const source = normalizeScoreInput(await file.text())
  if (!/^TLOQUE_SCORE 2(?:\n|$)/.test(source)) throw new Error("El archivo no comienza con TLOQUE_SCORE 2 y no se cargó.")
  return { source, fileName: file.name, title: scoreTitle(source), composer: "", recipe: null, report: null }
}

export function downloadScoreFile(source: string): string {
  const name = scoreFileName(scoreTitle(source))
  const url = URL.createObjectURL(new Blob([`${source.trim()}\n`], { type: "text/plain;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url; anchor.download = name
  document.body.append(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}
