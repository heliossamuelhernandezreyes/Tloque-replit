import { useMemo, useState } from "react"
import { Download, FlaskConical, Loader2, Pause, Play, ShieldCheck } from "lucide-react"
import { hybridBlindAssignment, hybridPreferenceForBlindVote, type HybridAbBlindAssignment, type HybridAbBlindSide, type HybridAbBlindVote } from "@shared/hybrid-ab-blind"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { NATIVE_HYBRID_SOURCES, type NativeHybridSource } from "@shared/native-hybrid-source"
import type { HybridAbValidationReport } from "@shared/native-hybrid-validation"
import { hybridMetricTargets } from "@shared/native-hybrid-validation"
import { runHybridAbCalibration, type HybridAbCalibrationResult } from "@/audio/HybridAbCalibrationRunner"

const STORAGE_KEY = "tloque_hybrid_ab_reports_v1"
type SavedReports = Record<string, HybridAbValidationReport>

type BlindVotes = Record<string, HybridAbBlindVote>
type BlindAssignments = Record<string, HybridAbBlindAssignment>

function loadReports(): SavedReports {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return value && typeof value === "object" ? value : {} } catch { return {} }
}
function saveReports(value: SavedReports) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch {} }
function layerLabel(layer: NativeHybridSource["physicalLayer"]) {
  return layer === "bowed-string-resonator" ? "Arco + cuerda" : layer === "air-column-resonator" ? "Columna de aire" : "Resonancia simpática"
}
function downloadJson(report: HybridAbValidationReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a")
  a.href = url; a.download = `${report.instrumentId.replaceAll(".", "-")}-${report.engineVersion}-ab.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
function randomBlindAssignment() {
  try {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return hybridBlindAssignment((value[0] & 1) === 1)
  } catch {
    return hybridBlindAssignment(Math.random() >= 0.5)
  }
}

export function HybridAbLabPanel() {
  const hybrids = useMemo(() => [...NATIVE_HYBRID_SOURCES], [])
  const [reports, setReports] = useState<SavedReports>(loadReports)
  const [results, setResults] = useState<Record<string, HybridAbCalibrationResult>>({})
  const [urls, setUrls] = useState<Record<string, { sampled: string; hybrid: string }>>({})
  const [assignments, setAssignments] = useState<BlindAssignments>({})
  const [votes, setVotes] = useState<BlindVotes>({})
  const [running, setRunning] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [error, setError] = useState("")

  async function run(source: NativeHybridSource) {
    if (running) return
    setRunning(source.instrumentId); setError("")
    try {
      audio?.pause(); setAudio(null); setPlaying(null)
      const result = await runHybridAbCalibration(source)
      const previous = urls[source.instrumentId]
      if (previous) { URL.revokeObjectURL(previous.sampled); URL.revokeObjectURL(previous.hybrid) }
      const pair = { sampled: URL.createObjectURL(result.sampled), hybrid: URL.createObjectURL(result.hybrid) }
      setResults(current => ({ ...current, [source.instrumentId]: result }))
      setUrls(current => ({ ...current, [source.instrumentId]: pair }))
      setAssignments(current => ({ ...current, [source.instrumentId]: randomBlindAssignment() }))
      setVotes(current => { const next = { ...current }; delete next[source.instrumentId]; return next })
      setReports(current => { const next = { ...current, [source.instrumentId]: result.report }; saveReports(next); return next })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo ejecutar A/B") }
    finally { setRunning(null) }
  }

  function playBlind(instrumentId: string, side: HybridAbBlindSide) {
    const actual = assignments[instrumentId]?.[side]
    const url = actual ? urls[instrumentId]?.[actual] : null
    if (!url) return
    audio?.pause()
    if (playing === `${instrumentId}:${side}`) { setPlaying(null); setAudio(null); return }
    const next = new Audio(url); next.onended = () => { setPlaying(null); setAudio(null) }; void next.play(); setAudio(next); setPlaying(`${instrumentId}:${side}`)
  }

  function reviewBlind(source: NativeHybridSource, vote: HybridAbBlindVote) {
    const assignment = assignments[source.instrumentId], base = reports[source.instrumentId] ?? results[source.instrumentId]?.report
    if (!assignment || !base || votes[source.instrumentId]) return
    const preference = hybridPreferenceForBlindVote(assignment, vote)
    const reviewed: HybridAbValidationReport = {
      ...base,
      humanPreference: preference,
      humanReviewMode: "blind-ab",
      reviewerNote: vote === "tie"
        ? "A/B ciego local: empate. Identidades reveladas sólo después del voto."
        : `A/B ciego local: se eligió ${vote}. Identidades reveladas sólo después del voto; pendiente de revisión/versionado en el registro Master.`,
    }
    setVotes(current => ({ ...current, [source.instrumentId]: vote }))
    setReports(current => { const next = { ...current, [source.instrumentId]: reviewed }; saveReports(next); return next })
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="tloque-eyebrow">Sampled vs Hybrid</p>
          <h2 className="mt-1 text-xl text-white">Laboratorio A/B ciego</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/35">Cada nueva corrida randomiza qué motor está detrás de A y B. Escucha y vota sin conocer la identidad; sólo después del voto se revela cuál era sample y cuál hybrid. El screening automático sigue siendo un filtro de regresión, no sustituye el oído.</p>
        </div>
        <span className="text-xs text-white/30">{hybrids.filter(source => hybridSourceMasterApproved(source)).length}/{hybrids.length} Master</span>
      </div>
      {error && <p className="mt-4 rounded-xl border border-red-300/10 bg-red-300/[.04] px-4 py-3 text-xs text-red-200/70">{error}</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {hybrids.map(source => {
          const targets = hybridMetricTargets(source.physicalLayer), report = reports[source.instrumentId], pair = urls[source.instrumentId], assignment = assignments[source.instrumentId], vote = votes[source.instrumentId], busy = running === source.instrumentId, approved = hybridSourceMasterApproved(source)
          return <article key={source.instrumentId} className="rounded-2xl border border-white/[.06] bg-white/[.02] p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-medium text-white">{source.instrumentId}</p><p className="mt-1 text-[11px] text-white/35">{layerLabel(source.physicalLayer)} · {source.engineVersion}</p></div>
              <span className={`rounded-full px-2 py-1 text-[10px] ${approved ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}>{approved ? "MASTER" : "A/B pendiente"}</span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-white/30">{source.notes}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-white/35">
              <span>Ataque ≥ {targets["transient-preservation"].min.toFixed(2)}</span><span>Espectro ≤ {targets["spectral-deviation"].max.toFixed(2)}</span>
              <span>Dinámica ≥ {targets["dynamic-response"].min.toFixed(2)}</span><span>Continuidad ≥ {targets["sustain-continuity"].min.toFixed(2)}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => void run(source)} disabled={Boolean(running)} className="tloque-primary-button inline-flex items-center gap-2 disabled:opacity-45">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}{busy ? "Renderizando…" : pair ? "Nueva corrida ciega" : "Generar A/B ciego"}</button>
              {pair && assignment && <><button onClick={() => playBlind(source.instrumentId, "A")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === `${source.instrumentId}:A` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Escuchar A</button><button onClick={() => playBlind(source.instrumentId, "B")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === `${source.instrumentId}:B` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Escuchar B</button></>}
            </div>
            {report && <div className="mt-4 rounded-xl bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1 text-xs ${report.objectivePass ? "text-emerald-300" : "text-amber-300"}`}><ShieldCheck className="h-3.5 w-3.5" />{report.objectivePass ? "Screening PASS" : "Requiere ajuste"}</span><button onClick={() => downloadJson(report)} className="inline-flex items-center gap-1 text-[10px] text-white/40"><Download className="h-3 w-3" /> JSON</button></div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">{report.metrics.map(metric => <span key={metric.id} className={metric.pass ? "text-white/45" : "text-amber-300/70"}>{metric.label}: {metric.value.toFixed(3)}</span>)}</div>
              {assignment && !vote && <div className="mt-3 flex flex-wrap gap-2"><span className="mr-1 text-[10px] text-white/25">Preferencia ciega:</span>{(["A", "B", "tie"] as const).map(value => <button key={value} onClick={() => reviewBlind(source, value)} className="rounded-md bg-white/[.04] px-2 py-1 text-[10px] text-white/50 hover:bg-white/[.09] hover:text-white/75">{value === "tie" ? "Empate" : `Prefiero ${value}`}</button>)}</div>}
              {assignment && vote && <div className="mt-3 rounded-lg border border-white/[.06] bg-white/[.025] px-3 py-2 text-[10px] leading-5 text-white/40"><p>Voto bloqueado: {vote === "tie" ? "empate" : `preferiste ${vote}`}.</p><p>Revelación: A = {assignment.A} · B = {assignment.B}. Para una nueva evaluación debes generar otra corrida ciega.</p></div>}
              {!assignment && report.humanReviewMode === "blind-ab" && <p className="mt-3 text-[10px] text-white/30">Existe un reporte ciego guardado de una sesión anterior. Genera una nueva corrida para volver a escuchar sin revelar su asignación.</p>}
            </div>}
          </article>
        })}
      </div>
    </section>
  )
}
