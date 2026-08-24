import { useEffect, useMemo, useState } from "react"
import { Download, FlaskConical, Loader2, Pause, Play, ShieldCheck } from "lucide-react"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { NATIVE_HYBRID_SOURCES, type NativeHybridSource } from "@shared/native-hybrid-source"
import type { HybridAbValidationReport } from "@shared/native-hybrid-validation"
import { hybridMetricTargets } from "@shared/native-hybrid-validation"
import { runHybridAbCalibration, type HybridAbCalibrationResult } from "@/audio/HybridAbCalibrationRunner"

const STORAGE_KEY = "tloque_hybrid_ab_reports_v1"
type SavedReports = Record<string, HybridAbValidationReport>

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

export function HybridAbLabPanel() {
  const hybrids = useMemo(() => [...NATIVE_HYBRID_SOURCES], [])
  const [reports, setReports] = useState<SavedReports>(loadReports)
  const [results, setResults] = useState<Record<string, HybridAbCalibrationResult>>({})
  const [urls, setUrls] = useState<Record<string, { sampled: string; hybrid: string }>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [error, setError] = useState("")

  useEffect(() => () => { audio?.pause(); Object.values(urls).forEach(pair => { URL.revokeObjectURL(pair.sampled); URL.revokeObjectURL(pair.hybrid) }) }, [audio, urls])

  async function run(source: NativeHybridSource) {
    if (running) return
    setRunning(source.instrumentId); setError("")
    try {
      const result = await runHybridAbCalibration(source)
      const previous = urls[source.instrumentId]
      if (previous) { URL.revokeObjectURL(previous.sampled); URL.revokeObjectURL(previous.hybrid) }
      const pair = { sampled: URL.createObjectURL(result.sampled), hybrid: URL.createObjectURL(result.hybrid) }
      setResults(current => ({ ...current, [source.instrumentId]: result }))
      setUrls(current => ({ ...current, [source.instrumentId]: pair }))
      setReports(current => { const next = { ...current, [source.instrumentId]: result.report }; saveReports(next); return next })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo ejecutar A/B") }
    finally { setRunning(null) }
  }

  function play(instrumentId: string, side: "sampled" | "hybrid") {
    const url = urls[instrumentId]?.[side]
    if (!url) return
    audio?.pause()
    if (playing === `${instrumentId}:${side}`) { setPlaying(null); setAudio(null); return }
    const next = new Audio(url); next.onended = () => { setPlaying(null); setAudio(null) }; void next.play(); setAudio(next); setPlaying(`${instrumentId}:${side}`)
  }

  function review(source: NativeHybridSource, preference: HybridAbValidationReport["humanPreference"]) {
    const base = reports[source.instrumentId] ?? results[source.instrumentId]?.report
    if (!base) return
    const reviewed: HybridAbValidationReport = { ...base, humanPreference: preference, reviewerNote: preference === "hybrid" ? "A/B local: se prefiere la capa híbrida; pendiente de revisión/versionado en el registro Master." : preference === "sampled" ? "A/B local: se conserva el sample; el overlay requiere ajuste." : "A/B local sin ganador claro." }
    setReports(current => { const next = { ...current, [source.instrumentId]: reviewed }; saveReports(next); return next })
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="tloque-eyebrow">Sampled vs Hybrid</p>
          <h2 className="mt-1 text-xl text-white">Laboratorio A/B híbrido</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/35">A usa exactamente el exportador sample-only. B suma sólo la capa física. El screening automático evita regresiones; la preferencia humana decide si el híbrido merece proponerse para Master.</p>
        </div>
        <span className="text-xs text-white/30">{hybrids.filter(source => hybridSourceMasterApproved(source)).length}/{hybrids.length} Master</span>
      </div>
      {error && <p className="mt-4 rounded-xl border border-red-300/10 bg-red-300/[.04] px-4 py-3 text-xs text-red-200/70">{error}</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {hybrids.map(source => {
          const targets = hybridMetricTargets(source.physicalLayer), report = reports[source.instrumentId], pair = urls[source.instrumentId], busy = running === source.instrumentId, approved = hybridSourceMasterApproved(source)
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
              <button onClick={() => void run(source)} disabled={Boolean(running)} className="tloque-primary-button inline-flex items-center gap-2 disabled:opacity-45">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}{busy ? "Renderizando…" : "Generar A/B"}</button>
              {pair && <><button onClick={() => play(source.instrumentId, "sampled")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === `${source.instrumentId}:sampled` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} A · sample</button><button onClick={() => play(source.instrumentId, "hybrid")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === `${source.instrumentId}:hybrid` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} B · hybrid</button></>}
            </div>
            {report && <div className="mt-4 rounded-xl bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1 text-xs ${report.objectivePass ? "text-emerald-300" : "text-amber-300"}`}><ShieldCheck className="h-3.5 w-3.5" />{report.objectivePass ? "Screening PASS" : "Requiere ajuste"}</span><button onClick={() => downloadJson(report)} className="inline-flex items-center gap-1 text-[10px] text-white/40"><Download className="h-3 w-3" /> JSON</button></div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">{report.metrics.map(metric => <span key={metric.id} className={metric.pass ? "text-white/45" : "text-amber-300/70"}>{metric.label}: {metric.value.toFixed(3)}</span>)}</div>
              <div className="mt-3 flex flex-wrap gap-2"><span className="mr-1 text-[10px] text-white/25">Preferencia humana:</span>{(["sampled", "hybrid", "tie"] as const).map(value => <button key={value} onClick={() => review(source, value)} className={`rounded-md px-2 py-1 text-[10px] ${report.humanPreference === value ? "bg-white/15 text-white" : "bg-white/[.04] text-white/40"}`}>{value === "sampled" ? "A sample" : value === "hybrid" ? "B hybrid" : "Empate"}</button>)}</div>
            </div>}
          </article>
        })}
      </div>
    </section>
  )
}
