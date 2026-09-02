import { useMemo, useState } from "react"
import { Download, FlaskConical, Loader2, Pause, Play, Search, ShieldCheck, Sparkles } from "lucide-react"
import { hybridBlindAssignment, hybridPreferenceForBlindVote, type HybridAbBlindAssignment, type HybridAbBlindSide, type HybridAbBlindVote } from "@shared/hybrid-ab-blind"
import { hybridCalibrationScore, proposeHybridCalibrationCandidate, type HybridCalibrationCandidate } from "@shared/native-hybrid-calibration"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { NATIVE_HYBRID_PERFORMANCE_VERSION } from "@shared/native-hybrid-performance"
import { NATIVE_HYBRID_SOURCES, type NativeHybridSource } from "@shared/native-hybrid-source"
import type { HybridAbValidationReport } from "@shared/native-hybrid-validation"
import { hybridMetricTargets } from "@shared/native-hybrid-validation"
import { runHybridAbCalibration, type HybridAbCalibrationResult } from "@/audio/HybridAbCalibrationRunner"
import { runHybridCalibrationCandidate } from "@/audio/HybridCalibrationCandidateRunner"
import { runHybridLocalSearch, type HybridLocalSearchResult } from "@/audio/HybridLocalSearchRunner"

const STORAGE_KEY = "tloque_hybrid_ab_reports_v2"
type SavedReports = Record<string, HybridAbValidationReport>
type BlindVotes = Record<string, HybridAbBlindVote>
type BlindAssignments = Record<string, HybridAbBlindAssignment>
type CandidateState = Record<string, { candidate: HybridCalibrationCandidate; result: HybridAbCalibrationResult; baseline: HybridAbValidationReport }>
type SearchState = Record<string, HybridLocalSearchResult>

function loadReports(): SavedReports {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return value && typeof value === "object" ? value : {} } catch { return {} }
}
function saveReports(value: SavedReports) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch {} }
function layerLabel(layer: NativeHybridSource["physicalLayer"]) {
  return layer === "bowed-string-resonator" ? "Arco + cuerda" : layer === "air-column-resonator" ? "Columna de aire" : "Resonancia simpática"
}
function downloadJson(report: HybridAbValidationReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a")
  a.href = url; a.download = `${report.instrumentId.replaceAll(".", "-")}-${report.engineVersion}-${report.performanceVersion}-ab.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
function randomBlindAssignment() {
  try { const value = new Uint32Array(1); crypto.getRandomValues(value); return hybridBlindAssignment((value[0] & 1) === 1) }
  catch { return hybridBlindAssignment(Math.random() >= 0.5) }
}

export function HybridAbLabPanel() {
  const hybrids = useMemo(() => [...NATIVE_HYBRID_SOURCES], [])
  const [reports, setReports] = useState<SavedReports>(loadReports)
  const [results, setResults] = useState<Record<string, HybridAbCalibrationResult>>({})
  const [candidateStates, setCandidateStates] = useState<CandidateState>({})
  const [searchStates, setSearchStates] = useState<SearchState>({})
  const [searchProgress, setSearchProgress] = useState<Record<string, string>>({})
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
      setCandidateStates(current => { const next = { ...current }; delete next[source.instrumentId]; return next })
      setSearchStates(current => { const next = { ...current }; delete next[source.instrumentId]; return next })
      setUrls(current => ({ ...current, [source.instrumentId]: pair }))
      setAssignments(current => ({ ...current, [source.instrumentId]: randomBlindAssignment() }))
      setVotes(current => { const next = { ...current }; delete next[source.instrumentId]; return next })
      setReports(current => { const next = { ...current, [source.instrumentId]: result.report }; saveReports(next); return next })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo ejecutar A/B") }
    finally { setRunning(null) }
  }

  async function tryCandidate(source: NativeHybridSource, baseline: HybridAbValidationReport) {
    if (running) return
    const candidate = proposeHybridCalibrationCandidate(source, baseline)
    if (!candidate) { setError("No hay un fallo objetivo compatible con ajuste automático acotado."); return }
    setRunning(`${source.instrumentId}:candidate`); setError("")
    try {
      const result = await runHybridCalibrationCandidate(source, candidate)
      setCandidateStates(current => ({ ...current, [source.instrumentId]: { candidate, result, baseline } }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo probar la variante candidata") }
    finally { setRunning(null) }
  }

  async function searchCandidates(source: NativeHybridSource, baseline: HybridAbValidationReport) {
    if (running) return
    setRunning(`${source.instrumentId}:search`); setError("")
    setSearchProgress(current => ({ ...current, [source.instrumentId]: "Preparando búsqueda local…" }))
    try {
      const result = await runHybridLocalSearch(source, baseline, undefined, (completed, total, label) => {
        setSearchProgress(current => ({ ...current, [source.instrumentId]: `${completed}/${total} · ${label}` }))
      })
      setSearchStates(current => ({ ...current, [source.instrumentId]: result }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar la búsqueda local") }
    finally {
      setRunning(null)
      setSearchProgress(current => { const next = { ...current }; delete next[source.instrumentId]; return next })
    }
  }

  function playBlind(instrumentId: string, side: HybridAbBlindSide) {
    const actual = assignments[instrumentId]?.[side], url = actual ? urls[instrumentId]?.[actual] : null
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
      ...base, humanPreference: preference, humanReviewMode: "blind-ab",
      reviewerNote: vote === "tie" ? "A/B ciego local: empate. Identidades reveladas sólo después del voto." : `A/B ciego local: se eligió ${vote}. Identidades reveladas sólo después del voto; pendiente de revisión/versionado en el registro Master.`,
    }
    setVotes(current => ({ ...current, [source.instrumentId]: vote }))
    setReports(current => { const next = { ...current, [source.instrumentId]: reviewed }; saveReports(next); return next })
  }

  return <section className="mt-10">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="tloque-eyebrow">Sampled vs Hybrid</p><h2 className="mt-1 text-xl text-white">Laboratorio A/B ciego</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-white/35">Matriz 3×3 de registro y gesto bajo {NATIVE_HYBRID_PERFORMANCE_VERSION}. Cuando falla, puedes probar una hipótesis o lanzar una búsqueda local de tres intensidades. Las variantes son efímeras y nunca pueden aprobar Master hasta promoverse y versionarse.</p></div><span className="text-xs text-white/30">{hybrids.filter(source => hybridSourceMasterApproved(source)).length}/{hybrids.length} Master</span></div>
    {error && <p className="mt-4 rounded-xl border border-red-300/10 bg-red-300/[.04] px-4 py-3 text-xs text-red-200/70">{error}</p>}
    <div className="mt-4 grid gap-3 md:grid-cols-2">{hybrids.map(source => {
      const targets = hybridMetricTargets(source.physicalLayer), report = reports[source.instrumentId], pair = urls[source.instrumentId], assignment = assignments[source.instrumentId], vote = votes[source.instrumentId]
      const busy = running === source.instrumentId, candidateBusy = running === `${source.instrumentId}:candidate`, searchBusy = running === `${source.instrumentId}:search`, approved = hybridSourceMasterApproved(source), candidateState = candidateStates[source.instrumentId], localSearch = searchStates[source.instrumentId]
      const baselineScore = report ? hybridCalibrationScore(report) : null, candidateScore = candidateState ? hybridCalibrationScore(candidateState.result.report) : null
      const candidateImproved = Boolean(baselineScore && candidateScore && (candidateScore.passingCells > baselineScore.passingCells || (candidateScore.passingCells === baselineScore.passingCells && candidateScore.worstMargin > baselineScore.worstMargin)))
      const winnerTrial = localSearch?.winner
      const winnerScore = winnerTrial ? hybridCalibrationScore(winnerTrial.report) : null
      return <article key={source.instrumentId} className="rounded-2xl border border-white/[.06] bg-white/[.02] p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-white">{source.instrumentId}</p><p className="mt-1 text-[11px] text-white/35">{layerLabel(source.physicalLayer)} · {source.engineVersion} · wet {source.wet.toFixed(3)}</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${approved ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}>{approved ? "MASTER" : "A/B pendiente"}</span></div>
        <p className="mt-2 text-[11px] leading-5 text-white/30">{source.notes}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-white/35"><span>Ataque ≥ {targets["transient-preservation"].min.toFixed(2)}</span><span>Espectro ≤ {targets["spectral-deviation"].max.toFixed(2)}</span><span>Dinámica ≥ {targets["dynamic-response"].min.toFixed(2)}</span><span>Continuidad ≥ {targets["sustain-continuity"].min.toFixed(2)}</span></div>
        <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void run(source)} disabled={Boolean(running)} className="tloque-primary-button inline-flex items-center gap-2 disabled:opacity-45">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}{busy ? "Renderizando…" : pair ? "Nueva corrida ciega" : "Generar A/B ciego"}</button>
          {report && !report.objectivePass && <><button onClick={() => void tryCandidate(source, report)} disabled={Boolean(running)} className="inline-flex items-center gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[.04] px-3 py-2 text-xs text-amber-100/70 disabled:opacity-45">{candidateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{candidateBusy ? "Probando…" : "Probar ajuste"}</button><button onClick={() => void searchCandidates(source, report)} disabled={Boolean(running)} className="inline-flex items-center gap-2 rounded-lg border border-sky-300/15 bg-sky-300/[.04] px-3 py-2 text-xs text-sky-100/70 disabled:opacity-45">{searchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{searchBusy ? (searchProgress[source.instrumentId] ?? "Buscando…") : "Buscar mejor ajuste"}</button></>}
          {pair && assignment && <><button onClick={() => playBlind(source.instrumentId, "A")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === `${source.instrumentId}:A` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Escuchar A</button><button onClick={() => playBlind(source.instrumentId, "B")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === `${source.instrumentId}:B` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Escuchar B</button></>}
        </div>
        {candidateState && <div className={`mt-3 rounded-xl border px-3 py-2 text-[10px] leading-5 ${candidateImproved ? "border-emerald-300/10 bg-emerald-300/[.03] text-emerald-100/60" : "border-amber-300/10 bg-amber-300/[.03] text-amber-100/60"}`}><p className="font-medium">Variante temporal · wet {candidateState.candidate.wet.toFixed(4)} ({candidateState.candidate.wetScale.toFixed(3)}×)</p><p>{candidateState.candidate.reason}</p><p>Antes: {baselineScore?.passingCells ?? 0}/9 · margen {baselineScore?.worstMargin.toFixed(3)}. Después: {candidateScore?.passingCells ?? 0}/9 · margen {candidateScore?.worstMargin.toFixed(3)}. {candidateImproved ? "Mejora objetiva; candidata a promoción/versionado." : "No mejora el peor caso; no promover."}</p><p>Safety: candidateId={candidateState.candidate.id}; esta evidencia no puede aprobar Master.</p></div>}
        {localSearch && <div className="mt-3 rounded-xl border border-sky-300/10 bg-sky-300/[.025] px-3 py-2 text-[10px] leading-5 text-sky-100/60"><p className="font-medium">Búsqueda local · {localSearch.trials.length} candidata(s){localSearch.stoppedEarly ? " · corte temprano 9/9" : ""}</p>{localSearch.summary.trials.map(trial => <p key={trial.candidateId}>{trial.label}: {trial.passingCells}/{trial.totalCells} · margen {trial.worstMargin.toFixed(3)}{trial.candidateId === localSearch.summary.winnerCandidateId ? " ← mejor" : ""}</p>)}{winnerTrial && winnerScore ? <><p className="mt-1">Ganadora: {winnerTrial.candidate.searchLabel} · {winnerTrial.candidate.changedAxes.map(axis => `${axis}=${winnerTrial.candidate.tuning[axis].toFixed(3)}x`).join(", ")}</p><p>Baseline {baselineScore?.passingCells ?? 0}/9 → {winnerScore.passingCells}/9; margen {baselineScore?.worstMargin.toFixed(3)} → {winnerScore.worstMargin.toFixed(3)}.</p><p>Resultado experimental; requiere promoción de perfil + engineVersion + nueva matriz ciega.</p></> : <p className="mt-1 text-amber-100/60">Ninguna candidata superó el baseline; conservar configuración actual.</p>}</div>}
        {report && <div className="mt-4 rounded-xl bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1 text-xs ${report.objectivePass ? "text-emerald-300" : "text-amber-300"}`}><ShieldCheck className="h-3.5 w-3.5" />{report.objectivePass ? "Screening PASS" : `Requiere ajuste · ${baselineScore?.passingCells ?? 0}/9 celdas`}</span><button onClick={() => downloadJson(report)} className="inline-flex items-center gap-1 text-[10px] text-white/40"><Download className="h-3 w-3" /> JSON</button></div><div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">{report.metrics.map(metric => <span key={metric.id} className={metric.pass ? "text-white/45" : "text-amber-300/70"}>{metric.label}: {metric.value.toFixed(3)}</span>)}</div>
          {assignment && !vote && <div className="mt-3 flex flex-wrap gap-2"><span className="mr-1 text-[10px] text-white/25">Preferencia ciega:</span>{(["A", "B", "tie"] as const).map(value => <button key={value} onClick={() => reviewBlind(source, value)} className="rounded-md bg-white/[.04] px-2 py-1 text-[10px] text-white/50 hover:bg-white/[.09] hover:text-white/75">{value === "tie" ? "Empate" : `Prefiero ${value}`}</button>)}</div>}
          {assignment && vote && <div className="mt-3 rounded-lg border border-white/[.06] bg-white/[.025] px-3 py-2 text-[10px] leading-5 text-white/40"><p>Voto bloqueado: {vote === "tie" ? "empate" : `preferiste ${vote}`}.</p><p>Revelación: A = {assignment.A} · B = {assignment.B}. Para una nueva evaluación debes generar otra corrida ciega.</p></div>}
        </div>}
      </article>})}</div>
  </section>
}
