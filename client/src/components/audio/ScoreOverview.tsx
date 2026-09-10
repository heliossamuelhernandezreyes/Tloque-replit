import { useEffect, useMemo, useRef, useState } from "react"
import type { LinearScoreRecipe } from "@shared/audio"
import { checkRequiredBanks, scoreInstrumentName, summarizeInterpretation, summarizeScore, type BankCheck, type BankRequirement } from "@/lib/tloqueComposer"

const action = "min-h-11 rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40"
const roles: Record<string, string> = { melody: "Melodía", harmony: "Armonía", bass: "Bajo", texture: "Textura", pulse: "Pulso", accent: "Acento" }
const forms: Record<string, string> = { exposition: "Exposición", development: "Desarrollo", recapitulation: "Regreso", coda: "Coda", interlude: "Interludio", custom: "Sección" }
function pitchName(midi: number) { return `${["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][midi % 12]}${Math.floor(midi / 12) - 1}` }

export function ScoreOverview({ recipe, onSection }: { recipe: LinearScoreRecipe; onSection: (id: string) => void }) {
  const summary = useMemo(() => summarizeScore(recipe), [recipe])
  const [page, setPage] = useState(0)
  const [interpretation, setInterpretation] = useState<ReturnType<typeof summarizeInterpretation> | null>(null)
  const [banks, setBanks] = useState<BankCheck[] | null>(null)
  const [busy, setBusy] = useState<"analysis" | "banks" | null>(null)
  const [error, setError] = useState("")
  const epoch = useRef(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    epoch.current++; setPage(0); setInterpretation(null); setBanks(null); setBusy(null); setError("")
    return () => { epoch.current++; abort.current?.abort() }
  }, [recipe])

  async function analyze() {
    const token = epoch.current
    setBusy("analysis"); setError("")
    try {
      const { buildPerformancePlan } = await import("@/audio/PerformanceEngine")
      if (token !== epoch.current) return
      const analysis = summarizeInterpretation(buildPerformancePlan(recipe, []))
      if (token === epoch.current) setInterpretation(analysis)
    } catch (error) { if (token === epoch.current) setError(error instanceof Error ? error.message : "No se pudo analizar") }
    finally { if (token === epoch.current) setBusy(null) }
  }

  async function checkBanks() {
    if (recipe.version !== 2 || recipe.plan.moduleId !== "native-auto") return
    const token = epoch.current
    abort.current?.abort(); abort.current = new AbortController()
    const signal = abort.current.signal
    setBusy("banks"); setError("")
    try {
      const { preferredNativeModuleForInstrument } = await import("@/audio/NativeAutoModule")
      if (token !== epoch.current) return
      const byModule = new Map<string | null, BankRequirement>()
      for (const track of summary.tracks) {
        const moduleId = preferredNativeModuleForInstrument(track.instrument)
        const requirement = byModule.get(moduleId) ?? { moduleId, instruments: [] }
        if (!requirement.instruments.includes(track.instrument)) requirement.instruments.push(track.instrument)
        byModule.set(moduleId, requirement)
      }
      const results = await checkRequiredBanks([...byModule.values()], signal)
      if (token === epoch.current) setBanks(results)
    } catch (error) { if (token === epoch.current && !signal.aborted) setError(error instanceof Error ? error.message : "No se pudieron comprobar los bancos") }
    finally { if (token === epoch.current) setBusy(null) }
  }

  const pages = Math.max(1, Math.ceil(summary.sections.length / 12))
  const visiblePage = Math.min(page, pages - 1)
  return (
    <section aria-label="Mapa de la obra" className="min-w-0 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.035] p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-emerald-100">03 · Entiende tu obra</h3>
        <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs text-emerald-200">Partitura válida</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Duración nominal", `${Math.round(summary.seconds)} s`], ["Compases", recipe.plan.totalBars], ["Pistas", summary.tracks.length], ["Eventos / notas", `${summary.events} / ${summary.pitches}`]].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-black/20 p-3"><dt className="text-xs text-zinc-400">{label}</dt><dd className="mt-1 text-lg font-medium tabular-nums">{value}</dd></div>
        ))}
      </dl>
      <p className="text-xs leading-5 text-zinc-400">Un acorde es un evento con varias notas. La duración no incluye las colas; partitura válida no significa calidad sonora comprobada.</p>
      {summary.sections.length > 0 && <div>
        <h4 className="mb-2 text-sm font-medium">Forma musical · toca una sección para editarla</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {summary.sections.slice(visiblePage * 12, (visiblePage + 1) * 12).map(section => (
            <button key={section.id} type="button" onClick={() => onSection(section.id)} className={`${action} min-w-0 text-left`}>
              <span className="block truncate text-emerald-100">{forms[section.form]} · {section.id}</span>
              <span className="mt-1 block text-xs text-zinc-400">c. {section.startBar}–{section.startBar + section.bars - 1} · {section.meter.numerator}/{section.meter.denominator} · {section.bpm} BPM{section.repeat > 1 ? ` · ×${section.repeat}` : ""}</span>
            </button>
          ))}
        </div>
        {pages > 1 && <nav aria-label="Páginas de secciones" className="mt-2 flex items-center justify-between gap-2"><button className={action} disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Anterior</button><span className="text-xs">{visiblePage + 1} / {pages}</span><button className={action} disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>Siguiente</button></nav>}
      </div>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Instrumentos, funciones y registro escrito</summary>
        <ul className="grid gap-2 sm:grid-cols-2">
          {summary.tracks.map(track => <li key={track.id} className="min-w-0 rounded-xl bg-black/20 p-3 text-xs leading-5">
            <p className="font-semibold text-zinc-200">{scoreInstrumentName(track.instrument)} · {roles[track.role]}</p><p className="break-all text-zinc-400">Pista {track.id} · {track.instrument}</p>
            <p className="text-zinc-300">{track.events} eventos · {track.controls} controles · {track.events ? `${pitchName(track.minMidi)}–${pitchName(track.maxMidi)}` : "sin notas"}</p>
          </li>)}
        </ul>
      </details>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Qué interpreta el motor</summary>
        <p className="mb-3 text-xs leading-5 text-zinc-400">Análisis V1/V6 de la partitura, sin cambiarla ni generar audio. Frases, puntos culminantes y tensión son heurísticas musicales, no una puntuación de calidad ni una prueba de capacidades grabadas.</p>
        <button className={action} disabled={busy !== null} onClick={() => void analyze()}>{busy === "analysis" ? "Analizando…" : "Analizar interpretación"}</button>
        {summary.events > 12_000 && <p className="mt-2 text-xs text-amber-200">Partitura extensa: el análisis puede tardar en este dispositivo.</p>}
        {interpretation && <ul className="mt-3 grid gap-2 sm:grid-cols-2">{interpretation.map(track => <li key={track.trackId} className="rounded-lg bg-black/20 p-3 text-xs leading-5"><strong>{track.trackId}</strong> · {track.phrases} frases · {track.climaxes} eventos culminantes · {track.breaths} reinicios de aire · tensión media {track.tension.toFixed(2)}</li>)}</ul>}
      </details>
      {recipe.version === 2 && <div className="rounded-xl border border-white/10 p-3 text-xs leading-5">
        <p className="break-all">Fuente: <strong>{recipe.plan.moduleId}</strong> · calidad {recipe.plan.quality}</p>
        {["orchestra-synth", "builtin"].includes(recipe.plan.moduleId) ? <p className="text-zinc-400">Síntesis sin bancos descargados. No es una grabación acústica.</p> : recipe.plan.moduleId === "native-auto" ? <>
          <p className="my-2 text-zinc-400">Requiere los bancos de estos instrumentos. Esta comprobación sólo lee manifiestos del servidor; no verifica PCM, articulaciones ni disponibilidad sin conexión.</p>
          <button className={action} disabled={busy !== null} onClick={() => void checkBanks()}>{busy === "banks" ? "Comprobando…" : "Comprobar bancos requeridos"}</button>
          {banks && <ul className="mt-2 space-y-2" aria-live="polite">{banks.map((bank, index) => <li key={bank.moduleId ?? index} className={`break-words ${bank.status === "available" ? "text-emerald-200" : bank.status === "missing" ? "text-amber-200" : "text-zinc-300"}`}><span className="block break-all">{bank.instruments.join(", ")}</span>{bank.detail}</li>)}</ul>}
        </> : <p className="text-zinc-400">Módulo explícito: su disponibilidad se valida al guardar y renderizar.</p>}
      </div>}
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
      <details className="text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">Contrato técnico</summary><p className="break-all">Hash {recipe.plan.sourceHash} · {recipe.version === 2 ? recipe.plan.compilerVersion : "TloqueScore 1"} · Intérprete V1 / ejecutante V6 · Conductor V7</p></details>
    </section>
  )
}
