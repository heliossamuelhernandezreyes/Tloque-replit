import type { LinearScoreRecipe } from "@shared/audio"

const SCORE_TEXTAREA_LABEL = "Código TloqueScore"
const MAX_SCORE_FILE_BYTES = 4_000_000
const MAX_MUSIC_XML_BYTES = 12 * 1024 * 1024
const MAX_MXL_BYTES = 16 * 1024 * 1024
const SCORE_EXTENSIONS = [".tloque", ".tloquescore", ".txt"] as const
const MUSIC_XML_EXTENSIONS = [".musicxml", ".xml", ".mxl"] as const
const ALLOWED_EXTENSIONS = [...SCORE_EXTENSIONS, ...MUSIC_XML_EXTENSIONS]

export const TLOQUE_SCORE_IMPORTED_EVENT = "tloque-score-imported"

export interface TloqueScoreImportedDetail {
  fileName: string
  title: string
  composer: string
  recipe: LinearScoreRecipe
  report: {
    format: "musicxml" | "mxl"
    sourceParts: number
    outputTracks: number
    measures: number
    notes: number
    controls: number
    sections: number
    mergedParts: number
    warnings: { code: string; message: string; count: number }[]
  }
}

function extensionOf(name: string) {
  const lower = name.toLowerCase()
  return ALLOWED_EXTENSIONS.find(extension => lower.endsWith(extension)) || ""
}

function scoreTitle(source: string) {
  const match = source.match(/^title\s+"([^"]+)"/m)
  return match?.[1]?.trim() || "Obra TloqueScore"
}

function safeFileName(title: string) {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
  return normalized || "obra-tloque"
}

function summarize(source: string) {
  const tracks = (source.match(/^track\s+/gm) || []).length
  const sections = (source.match(/^section\s+/gm) || []).length
  const events = (source.match(/^\d+:\d+(?:\.\d+)?\s+/gm) || []).length
  const hits = (source.match(/^hit\s+/gm) || []).length
  return `${scoreTitle(source)} · ${tracks} pistas · ${sections} secciones · ${events + hits} eventos`
}

function assignTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
  descriptor?.set?.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
  textarea.dispatchEvent(new Event("change", { bubbles: true }))
}

function notify(container: HTMLElement, message: string, tone: "ok" | "error" | "info" = "info") {
  let node = container.querySelector<HTMLElement>("[data-tloque-score-file-status]")
  if (!node) {
    node = document.createElement("p")
    node.dataset.tloqueScoreFileStatus = "true"
    node.className = "mt-2 rounded-lg px-3 py-2 text-[11px] leading-5"
    node.setAttribute("aria-live", "polite")
    container.append(node)
  }
  node.setAttribute("role", tone === "error" ? "alert" : "status")
  node.className = `mt-2 rounded-lg px-3 py-2 text-[11px] leading-5 ${
    tone === "ok"
      ? "bg-emerald-400/5 text-emerald-200"
      : tone === "error"
        ? "bg-red-950/30 text-red-200"
        : "bg-sky-400/5 text-sky-200"
  }`
  node.textContent = message
}

function clearImportReport(container: HTMLElement) {
  container.querySelector("[data-tloque-score-import-report]")?.remove()
}

function showImportReport(container: HTMLElement, detail: TloqueScoreImportedDetail) {
  clearImportReport(container)
  if (!detail.report.warnings.length) return
  const details = document.createElement("details")
  details.dataset.tloqueScoreImportReport = "true"
  details.className = "mt-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.035] px-3 py-2 text-[11px] leading-5 text-amber-100"
  const summary = document.createElement("summary")
  const warningCount = detail.report.warnings.reduce((sum, warning) => sum + warning.count, 0)
  summary.className = "cursor-pointer font-medium"
  summary.textContent = `${warningCount} aviso${warningCount === 1 ? "" : "s"} de fidelidad · revisar antes de publicar`
  const list = document.createElement("ul")
  list.className = "mt-2 list-disc space-y-1 pl-4 text-amber-100/80"
  for (const warning of detail.report.warnings) {
    const item = document.createElement("li")
    item.textContent = `${warning.message}${warning.count > 1 ? ` (${warning.count}×)` : ""}`
    list.append(item)
  }
  details.append(summary, list)
  container.append(details)
}

function installForTextarea(textarea: HTMLTextAreaElement) {
  if (textarea.dataset.tloqueFileBridge === "ready") return
  textarea.dataset.tloqueFileBridge = "ready"

  const parent = textarea.parentElement
  if (!parent) return

  const panel = document.createElement("div")
  panel.dataset.tloqueScoreFileBridge = "true"
  panel.className = "rounded-xl border border-sky-400/20 bg-sky-400/[0.035] p-3"

  const header = document.createElement("div")
  header.className = "flex flex-col gap-3 sm:flex-row sm:items-center"

  const copy = document.createElement("div")
  copy.className = "min-w-0 flex-1"
  copy.innerHTML = `
    <p class="text-xs font-medium text-sky-100">Abrir o importar partitura</p>
    <p class="mt-1 text-[10px] leading-4 text-zinc-500">Abre TloqueScore o convierte MusicXML (.musicxml, .xml y .mxl) localmente. Nada del archivo sale del navegador hasta que guardas la obra.</p>
  `

  const actions = document.createElement("div")
  actions.className = "grid grid-cols-2 gap-2 sm:flex"

  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".tloque,.tloquescore,.txt,.musicxml,.xml,.mxl,text/plain,application/xml,text/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,application/zip"
  input.className = "sr-only"

  const openButton = document.createElement("button")
  openButton.type = "button"
  openButton.className = "min-h-11 rounded-lg bg-sky-300 px-4 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50"
  openButton.textContent = "Abrir / importar"
  openButton.addEventListener("click", () => input.click())

  const saveButton = document.createElement("button")
  saveButton.type = "button"
  saveButton.className = "min-h-11 rounded-lg border border-white/10 bg-white/[0.055] px-4 py-2 text-xs font-semibold text-zinc-200"
  saveButton.textContent = "Guardar archivo"
  saveButton.addEventListener("click", () => {
    const source = textarea.value.trim()
    if (!source) {
      notify(panel, "No hay una partitura que guardar todavía.", "error")
      return
    }
    const blob = new Blob([`${source}\n`], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${safeFileName(scoreTitle(source))}.tloque`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify(panel, `Guardada: ${anchor.download}`, "ok")
  })

  input.addEventListener("change", async () => {
    const file = input.files?.[0]
    input.value = ""
    if (!file) return

    const extension = extensionOf(file.name)
    if (!extension) {
      notify(panel, "Formato no admitido. Usa TloqueScore, .musicxml, .xml o .mxl.", "error")
      return
    }
    const isMusicXml = MUSIC_XML_EXTENSIONS.includes(extension as typeof MUSIC_XML_EXTENSIONS[number])
    const maximumBytes = extension === ".mxl" ? MAX_MXL_BYTES : isMusicXml ? MAX_MUSIC_XML_BYTES : MAX_SCORE_FILE_BYTES
    if (file.size > maximumBytes) {
      notify(panel, `El archivo supera el límite de ${(maximumBytes / 1024 / 1024).toFixed(0)} MB para ${extension}.`, "error")
      return
    }
    if (textarea.value.trim()) {
      const replace = window.confirm("Ya hay una obra en el compositor. ¿Reemplazarla con la partitura seleccionada?")
      if (!replace) return
    }

    openButton.disabled = true
    openButton.setAttribute("aria-busy", "true")
    try {
      clearImportReport(panel)
      if (isMusicXml) {
        notify(panel, `Importando ${file.name}…`, "info")
        const { importMusicXmlFile } = await import("./musicXmlImporter")
        const imported = await importMusicXmlFile(file)
        const detail: TloqueScoreImportedDetail = {
          fileName: file.name,
          title: imported.title,
          composer: imported.composer,
          recipe: imported.recipe,
          report: imported.report,
        }
        assignTextareaValue(textarea, imported.source)
        textarea.dispatchEvent(new CustomEvent<TloqueScoreImportedDetail>(TLOQUE_SCORE_IMPORTED_EVENT, { bubbles: true, detail }))
        textarea.focus()
        textarea.setSelectionRange(0, 0)
        const report = imported.report
        notify(panel, `Importada · ${report.measures} compases · ${report.sourceParts} partes → ${report.outputTracks} pistas · ${report.notes} eventos`, "ok")
        showImportReport(panel, detail)
        textarea.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }
      let source = await file.text()
      source = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()
      if (!source.startsWith("TLOQUE_SCORE 2")) {
        notify(panel, "El archivo no comienza con TLOQUE_SCORE 2 y no se cargó.", "error")
        return
      }

      assignTextareaValue(textarea, source)
      textarea.focus()
      textarea.setSelectionRange(0, 0)
      notify(panel, `Cargada completa · ${summarize(source)} · ${(file.size / 1024).toFixed(1)} KB`, "ok")
      textarea.scrollIntoView({ behavior: "smooth", block: "center" })
    } catch (error) {
      console.error("No se pudo abrir o importar la partitura", error)
      const detail = error instanceof Error ? error.message : "No se pudo leer el archivo seleccionado."
      notify(panel, detail.slice(0, 800), "error")
    } finally {
      openButton.disabled = false
      openButton.removeAttribute("aria-busy")
    }
  })

  actions.append(openButton, saveButton, input)
  header.append(copy, actions)
  panel.append(header)
  parent.insertBefore(panel, textarea)
}

function scan() {
  const textareas = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")]
  for (const textarea of textareas) {
    if (textarea.getAttribute("aria-label") === SCORE_TEXTAREA_LABEL) installForTextarea(textarea)
  }
}

let observer: MutationObserver | null = null

export function installTloqueScoreFileBridge() {
  if (observer) return
  scan()
  observer = new MutationObserver(scan)
  observer.observe(document.documentElement, { childList: true, subtree: true })
}
