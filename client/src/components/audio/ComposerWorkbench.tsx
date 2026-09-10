import { useEffect, useRef, useState, type RefObject } from "react"
import { Copy, Download, FileUp, Sparkles } from "lucide-react"
import type { LinearScoreRecipe } from "@shared/audio"
import { NATIVE_LIBRARY_INDEX } from "@shared/native-library-index"
import { withOrchestralModule } from "@shared/orchestral-synthesis"
import type { useScoreValidation } from "@/hooks/useScoreValidation"
import {
  DEFAULT_COMPOSER_BRIEF, SCORE_SKILL_URL, activeScoreTrack, buildComposerBrief, buildScoreRepairPrompt,
  normalizeScoreInput, scoreInstrumentName, scoreLineRange, snippetFitsInstrument, type ComposerBrief,
} from "@/lib/tloqueComposer"
import { downloadScoreFile, readScoreFile, SCORE_FILE_ACCEPT, type ImportedScoreFile } from "@/lib/tloqueScoreFileBridge"
import { ScoreOverview } from "./ScoreOverview"

export const composerInput = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-base text-zinc-100 outline-none focus:border-sky-300 focus:ring-1 focus:ring-sky-300 disabled:opacity-50"
export const composerButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-40"
type Palette = readonly { title: string; items: readonly { label: string; snippet: string }[] }[]
interface Props {
  source: string
  recipe: LinearScoreRecipe | null
  validation: ReturnType<typeof useScoreValidation>
  editorRef: RefObject<HTMLTextAreaElement>
  palette: Palette
  busy: boolean
  onChange: (source: string) => void
  onImport: (file: ImportedScoreFile) => void
  onImportBusy: (busy: boolean) => void
  onCreate: () => void
  onSnippet: (snippet: string) => void
}

export function ComposerWorkbench({ source, recipe, validation, editorRef, palette, busy, onChange, onImport, onImportBusy, onCreate, onSnippet }: Props) {
  const [mode, setMode] = useState<"guided" | "expert">("guided")
  const [brief, setBrief] = useState<ComposerBrief>(() => ({ ...DEFAULT_COMPOSER_BRIEF, instruments: [...DEFAULT_COMPOSER_BRIEF.instruments] }))
  const [skill, setSkill] = useState("")
  const [skillError, setSkillError] = useState("")
  const [skillAttempt, setSkillAttempt] = useState(0)
  const [copyMessage, setCopyMessage] = useState("")
  const [manualCopy, setManualCopy] = useState("")
  const [fileMessage, setFileMessage] = useState("")
  const [fileError, setFileError] = useState("")
  const [importReport, setImportReport] = useState<ImportedScoreFile["report"]>(null)
  const [importing, setImporting] = useState(false)
  const [cursor, setCursor] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const manualCopyRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)
  const currentSource = useRef(source)
  currentSource.current = source
  const activeTrack = activeScoreTrack(source, cursor)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onImportBusy(false) } }, [onImportBusy])
  useEffect(() => {
    if (!manualCopy) return
    manualCopyRef.current?.focus()
    manualCopyRef.current?.select()
    manualCopyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [manualCopy])
  useEffect(() => {
    const abort = new AbortController()
    setSkillError("")
    void fetch(SCORE_SKILL_URL, { cache: "no-store", signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(`No se pudo cargar la skill · HTTP ${response.status}`)
      const text = await response.text()
      if (!text.startsWith("---\n") || !text.includes('version: "3.9.0"')) throw new Error("La skill descargable no coincide con esta interfaz. Recarga la aplicación.")
      if (!abort.signal.aborted) setSkill(text)
    }).catch(error => { if (!abort.signal.aborted) setSkillError(error instanceof Error ? error.message : "No se pudo cargar la skill") })
    return () => abort.abort()
  }, [skillAttempt])

  function copy(text: string, label: string) {
    setCopyMessage(""); setManualCopy("")
    if (!navigator.clipboard?.writeText) { setManualCopy(text); setCopyMessage("Selecciona y copia el texto de abajo."); return }
    // Skill is preloaded: writeText starts in the click's user activation (mobile Safari).
    void navigator.clipboard.writeText(text).then(() => {
      if (mounted.current) setCopyMessage(`${label} copiado. Pégalo en tu IA.`)
    }).catch(() => { if (mounted.current) { setManualCopy(text); setCopyMessage("Este navegador no permitió copiar. Selecciona el texto de abajo.") } })
  }

  function goToLine(line: number) {
    const editor = editorRef.current
    if (!editor) return
    const range = scoreLineRange(source, line)
    editor.focus(); editor.setSelectionRange(range.start, range.end)
    const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight) || 24
    const actualLine = source.slice(0, range.start).split("\n").length
    editor.scrollTop = Math.max(0, (actualLine - 3) * lineHeight)
    editor.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  async function openFile(file: File) {
    if (source.trim() && !window.confirm("Ya hay una obra en el compositor. ¿Reemplazarla con la partitura seleccionada?")) return
    const original = source
    setImporting(true); onImportBusy(true); setFileError(""); setFileMessage(`Importando ${file.name}…`)
    try {
      const imported = await readScoreFile(file)
      if (!mounted.current || currentSource.current !== original) return
      setImportReport(imported.report); onImport(imported)
      setFileMessage(imported.report ? `Importada · ${imported.report.measures} compases · ${imported.report.sourceParts} partes → ${imported.report.outputTracks} pistas. Revisa la fidelidad y licencia.` : `Cargada ${file.name}. Validación local automática para archivos habituales.`)
    } catch (error) { if (mounted.current) { setFileError(error instanceof Error ? error.message.slice(0, 800) : "No se pudo importar"); setFileMessage("") } }
    finally { if (mounted.current) { setImporting(false); onImportBusy(false) } }
  }

  const status = {
    empty: "El editor está vacío", waiting: "Cambios pendientes · validando al terminar de escribir…",
    compiling: "Validando en este navegador…", valid: "Partitura válida · lista para escuchar",
    invalid: "Hay errores que corregir", manual: "Obra extensa: pulsa Validar para proteger la fluidez del editor",
  }[validation.state]
  const instruments = NATIVE_LIBRARY_INDEX.filter(item => item.masterApproved && item.family !== "voice")

  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[0.18em] text-sky-300">TloqueScore · Studio 3.9</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">De una idea a una obra.</h2></div>
      <div role="group" aria-label="Modo del compositor" className="flex rounded-xl border border-white/10 bg-black/20 p-1">
        {([ ["guided", "Guiado"], ["expert", "Experto"] ] as const).map(([value, label]) => <button key={value} onClick={() => setMode(value)} aria-pressed={mode === value} className="min-h-11 rounded-lg px-4 text-sm aria-pressed:bg-sky-300 aria-pressed:font-semibold aria-pressed:text-sky-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">{label}</button>)}
      </div>
    </div>
    <p className="text-sm leading-6 text-zinc-400">Prepara tu encargo, trae la partitura de tu IA y dale voz. Tu código sigue siendo la obra; el motor interpreta lo que escribes.</p>
    {mode === "guided" && <details open={!source.trim() || undefined} className="rounded-2xl border border-sky-300/20 bg-sky-300/[0.04] p-4">
      <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold text-sky-100">01 · Prepara el encargo para tu IA</summary>
      <div className="mt-3 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">Propósito<select className={composerInput} value={brief.purpose} onChange={e => setBrief({ ...brief, purpose: e.target.value as ComposerBrief["purpose"] })}><option value="reading">Acompañar lectura</option><option value="concert">Escucha protagonista</option></select></label>
          <label className="text-sm text-zinc-300">Duración objetivo<select className={composerInput} value={brief.seconds} onChange={e => setBrief({ ...brief, seconds: Number(e.target.value) })}>{[30, 60, 120, 180, 300].map(seconds => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} segundos` : `${seconds / 60} min`}</option>)}</select></label>
        </div>
        <label className="block text-sm text-zinc-300">Emoción y recorrido<textarea className={`${composerInput} min-h-24 resize-y`} maxLength={600} value={brief.mood} onChange={e => setBrief({ ...brief, mood: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-zinc-300">Compás<select className={composerInput} value={brief.meter} onChange={e => setBrief({ ...brief, meter: e.target.value as ComposerBrief["meter"] })}>{["4/4", "3/4", "6/8"].map(meter => <option key={meter}>{meter}</option>)}</select></label>
          <label className="text-sm text-zinc-300">Tempo · negras/min<input className={composerInput} type="number" min={20} max={300} value={brief.bpm} onChange={e => setBrief({ ...brief, bpm: Number(e.target.value) })} onBlur={() => setBrief({ ...brief, bpm: Math.max(20, Math.min(300, Math.round(brief.bpm) || 64)) })} /></label>
        </div>
        <details className="rounded-xl border border-white/10 px-3">
          <summary className="min-h-11 cursor-pointer py-3 text-sm">Instrumentos del encargo · {brief.instruments.length} seleccionados</summary>
          <p className="pb-2 text-xs leading-5 text-zinc-400">Inventario verificado; no acredita bancos instalados. Máximo 16 instrumentos.</p>
          <div className="grid gap-1 pb-3 sm:grid-cols-2">{instruments.map(item => <label key={item.instrumentId} className="flex min-h-11 min-w-0 items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={brief.instruments.includes(item.instrumentId)} disabled={!brief.instruments.includes(item.instrumentId) && brief.instruments.length >= 16} onChange={e => setBrief({ ...brief, instruments: e.target.checked ? [...brief.instruments, item.instrumentId] : brief.instruments.filter(id => id !== item.instrumentId) })} /><span title={item.instrumentId}>{scoreInstrumentName(item.instrumentId)}</span></label>)}</div>
        </details>
        <label className="block text-sm text-zinc-300">Fuente solicitada en el encargo<select className={composerInput} value={brief.moduleId} onChange={e => setBrief({ ...brief, moduleId: e.target.value as ComposerBrief["moduleId"] })}><option value="orchestra-synth">Síntesis orquestal · sin descargas</option><option value="native-auto">Bancos nativos · requieren comprobación</option><option value="builtin">Síntesis clásica</option></select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={brief.loop} onChange={e => setBrief({ ...brief, loop: e.target.checked })} /> Repetir en bucle</label>
        {brief.moduleId === "native-auto" && <p className="text-xs leading-5 text-amber-200">El encargo no afirma que los bancos estén disponibles. Podrás comprobar sus manifiestos después de compilar la obra.</p>}
        <button disabled={!skill || !brief.instruments.length} className={`${composerButton} w-full !border-sky-300 !bg-sky-300 !text-sky-950 sm:w-auto`} onClick={() => copy(`${skill}\n\n${buildComposerBrief(brief)}`, "Skill y encargo")}><Sparkles className="h-4 w-4" /> Copiar todo para mi IA</button>
        <p className="text-xs leading-5 text-zinc-400">Incluye la skill completa y tus opciones. Pégalo en tu IA; luego trae su único bloque TloqueScore al editor. No se envía nada automáticamente a otra IA.</p>
        <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-zinc-300">Ver encargo y opciones de copia</summary><pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/25 p-3 text-xs leading-5">{buildComposerBrief(brief)}</pre><div className="flex flex-wrap gap-2"><button className={composerButton} disabled={!brief.instruments.length} onClick={() => copy(buildComposerBrief(brief), "Encargo")}><Copy className="h-4 w-4" /> Sólo encargo</button><button className={composerButton} disabled={!skill} onClick={() => copy(skill, "Skill")}><Copy className="h-4 w-4" /> Sólo skill</button></div></details>
      </div>
    </details>}
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400"><a className={composerButton} href={SCORE_SKILL_URL} download="TLOQUE_SCORE_AI_SKILL.md"><Download className="h-4 w-4" /> Descargar skill 3.9</a><span>Autocontenida · cuatro ejemplos compilables</span></div>
    {skillError && <div role="alert" className="text-sm text-amber-200">{skillError} <button className={composerButton} onClick={() => setSkillAttempt(value => value + 1)}>Reintentar</button></div>}
    {copyMessage && <p role="status" className="rounded-xl border border-sky-300/20 bg-sky-300/5 p-3 text-sm text-sky-100">{copyMessage}</p>}
    {manualCopy && <label className="block text-sm text-sky-100">Texto listo para copiar manualmente<textarea ref={manualCopyRef} aria-label="Copia manual para IA" className={`${composerInput} min-h-40 font-mono`} value={manualCopy} readOnly onFocus={e => e.target.select()} /></label>}
    <fieldset disabled={busy || importing} className="min-w-0 space-y-3 rounded-2xl border border-white/10 bg-black/15 p-4">
      <legend className="px-2 text-base font-semibold">02 · Tu partitura</legend>
      <div className="flex flex-wrap gap-2">
        <button className={composerButton} onClick={() => fileInput.current?.click()}><FileUp className="h-4 w-4" /> Abrir / importar</button>
        <button className={composerButton} disabled={!source.trim()} onClick={() => { try { setFileMessage(`Guardado ${downloadScoreFile(source)}`); setFileError("") } catch { setFileError("No se pudo descargar el archivo") } }}>Guardar archivo</button>
        <button className={composerButton} onClick={() => { onCreate(); setImportReport(null) }}>Crear obra base</button>
        <input ref={fileInput} aria-label="Archivo de partitura" className="sr-only" type="file" accept={SCORE_FILE_ACCEPT} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openFile(file) }} />
      </div>
      <p className="text-xs leading-5 text-zinc-400">Pega código o importa TloqueScore / MusicXML / MXL. La importación y validación son locales; la partitura se envía a Tloque cuando guardas en Fonoteca.</p>
      {fileMessage && <p role="status" className="text-sm text-sky-200">{fileMessage}</p>}
      {fileError && <p role="alert" className="text-sm text-red-200">{fileError}</p>}
      {importReport && importReport.warnings.length > 0 && <details className="rounded-xl border border-amber-300/20 p-3 text-xs leading-5 text-amber-100"><summary className="min-h-11 cursor-pointer py-2">Avisos de fidelidad · {importReport.warnings.reduce((sum, warning) => sum + warning.count, 0)}</summary><ul className="list-disc space-y-1 pl-4">{importReport.warnings.map(warning => <li key={warning.code}>{warning.message}{warning.count > 1 ? ` (${warning.count}×)` : ""}</li>)}</ul></details>}
      <label htmlFor="tloque-score-editor" className="block text-sm text-zinc-300">Código TloqueScore</label>
      <textarea id="tloque-score-editor" ref={editorRef} className={`${composerInput} !mt-0 min-h-[320px] scroll-mt-24 resize-y font-mono leading-6 sm:min-h-[400px]`} aria-label="Código TloqueScore" aria-describedby="tloque-validation-status" aria-invalid={validation.state === "invalid"} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder="TLOQUE_SCORE 2… Pega aquí la respuesta completa de tu IA." value={source} onSelect={e => setCursor(e.currentTarget.selectionStart)} onChange={e => { onChange(e.target.value); setImportReport(null) }} onPaste={event => {
        const editor = event.currentTarget
        if (!source.trim() || (editor.selectionStart === 0 && editor.selectionEnd === source.length)) {
          const pasted = event.clipboardData.getData("text/plain")
          if (pasted) { event.preventDefault(); onChange(normalizeScoreInput(pasted)); setImportReport(null) }
        }
      }} />
      <div id="tloque-validation-status" role="status" className={`text-sm leading-5 ${validation.state === "invalid" ? "text-red-200" : validation.state === "valid" ? "text-emerald-200" : "text-zinc-400"}`}>{status}</div>
      {validation.state === "invalid" && <div role="alert" className="rounded-xl border border-red-300/20 bg-red-300/5 p-3">
        <p className="mb-2 text-sm font-medium text-red-100">Toca un error para ir a su línea.</p>
        <ul className="max-h-64 space-y-1 overflow-y-auto">{validation.diagnostics.map((item, index) => <li key={index}><button className="min-h-11 w-full rounded-lg px-2 py-2 text-left text-sm text-red-200 hover:bg-red-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300" onClick={() => goToLine(item.line)}>L{item.line} · {item.message}</button></li>)}</ul>
        {validation.message && <p className="text-sm text-red-200">{validation.message}</p>}
        {validation.diagnostics.length > 0 && <button className={`${composerButton} mt-3`} disabled={!skill} onClick={() => copy(`${skill}\n\n${buildScoreRepairPrompt(source, validation.diagnostics)}`, "Skill, obra y diagnóstico")}><Copy className="h-4 w-4" /> Copiar reparación para IA</button>}
      </div>}
      <details open={mode === "expert" || undefined} className="rounded-xl border border-white/10 p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Herramientas de edición · paleta y fuente</summary>
        <p className="my-2 text-xs leading-5 text-zinc-400">{activeTrack ? `Cursor en ${activeTrack.id} · ${activeTrack.instrument}. Se filtran los gestos por familia.` : "Coloca el cursor dentro de una sección después de use para activar la paleta."} Ajusta la posición 1:1 al insertar.</p>
        <div className="space-y-3">{palette.map(group => {
          const items = activeTrack ? group.items.filter(item => snippetFitsInstrument(item.snippet, activeTrack.instrument)) : group.items
          if (!items.length) return null
          return <div key={group.title}><p className="mb-2 text-xs text-zinc-400">{group.title}</p><div className="flex flex-wrap gap-2">{items.map(item => <button key={item.label} disabled={!activeTrack} className={composerButton} onClick={() => onSnippet(item.snippet)}>{item.label}</button>)}</div></div>
        })}</div>
        <label className="mt-4 block text-sm">Fuente del código actual<select className={composerInput} disabled={!/^TLOQUE_SCORE\s+2\s*$/m.test(source)} value={source.match(/^module\s+(\S+)/m)?.[1] ?? "builtin"} onChange={e => onChange(withOrchestralModule(source, e.target.value as ComposerBrief["moduleId"]))}><option value="orchestra-synth">Síntesis orquestal · sin bancos</option><option value="native-auto">Bancos nativos · requieren comprobación</option><option value="builtin">Síntesis clásica</option>{source.match(/^module\s+(\S+)/m)?.[1] && !["orchestra-synth", "native-auto", "builtin"].includes(source.match(/^module\s+(\S+)/m)![1]) && <option value={source.match(/^module\s+(\S+)/m)![1]}>{source.match(/^module\s+(\S+)/m)![1]}</option>}</select></label>
        <p className="mt-2 text-xs leading-5 text-zinc-400">Cambiar la fuente conserva las notas y vuelve a validar. No es una comparación A/B de volumen igualado.</p>
      </details>
      {mode === "expert" && <p className="text-xs leading-5 text-zinc-400">En 6/8, posiciones en corcheas; duraciones y rampas en negras. Roles fijos por pista. Consulta la skill para la gramática completa.</p>}
    </fieldset>
    {recipe && <ScoreOverview key={recipe.plan.sourceHash} recipe={recipe} onSection={id => { const line = source.split("\n").findIndex(text => text.startsWith(`section ${id} `)); if (line >= 0) goToLine(line + 1) }} />}
  </div>
}
