const SCORE_TEXTAREA_LABEL = "Código TloqueScore"
const MAX_SCORE_FILE_BYTES = 4 * 1024 * 1024
const ALLOWED_EXTENSIONS = [".tloque", ".tloquescore", ".txt"]

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
    container.append(node)
  }
  node.className = `mt-2 rounded-lg px-3 py-2 text-[11px] leading-5 ${
    tone === "ok"
      ? "bg-emerald-400/5 text-emerald-200"
      : tone === "error"
        ? "bg-red-950/30 text-red-200"
        : "bg-sky-400/5 text-sky-200"
  }`
  node.textContent = message
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
    <p class="text-xs font-medium text-sky-100">Partituras como archivo</p>
    <p class="mt-1 text-[10px] leading-4 text-zinc-500">Abre directamente .tloque, .tloquescore o .txt. El archivo se carga completo en el compositor sin depender del portapapeles.</p>
  `

  const actions = document.createElement("div")
  actions.className = "grid grid-cols-2 gap-2 sm:flex"

  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".tloque,.tloquescore,.txt,text/plain"
  input.className = "sr-only"

  const openButton = document.createElement("button")
  openButton.type = "button"
  openButton.className = "min-h-11 rounded-lg bg-sky-300 px-4 py-2 text-xs font-semibold text-sky-950"
  openButton.textContent = "Abrir partitura"
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

    if (!extensionOf(file.name)) {
      notify(panel, "Formato no admitido. Usa .tloque, .tloquescore o .txt.", "error")
      return
    }
    if (file.size > MAX_SCORE_FILE_BYTES) {
      notify(panel, "La partitura supera 4 MB. Ese tamaño no es razonable para TloqueScore de texto.", "error")
      return
    }

    try {
      let source = await file.text()
      source = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()
      if (!source.startsWith("TLOQUE_SCORE 2")) {
        notify(panel, "El archivo no comienza con TLOQUE_SCORE 2 y no se cargó.", "error")
        return
      }
      if (textarea.value.trim() && textarea.value.trim() !== source) {
        const replace = window.confirm("Ya hay una obra en el compositor. ¿Reemplazarla con la partitura seleccionada?")
        if (!replace) return
      }

      assignTextareaValue(textarea, source)
      textarea.focus()
      textarea.setSelectionRange(0, 0)
      notify(panel, `Cargada completa · ${summarize(source)} · ${(file.size / 1024).toFixed(1)} KB`, "ok")
      textarea.scrollIntoView({ behavior: "smooth", block: "center" })
    } catch (error) {
      console.error("No se pudo abrir la partitura TloqueScore", error)
      notify(panel, "No se pudo leer el archivo seleccionado.", "error")
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
