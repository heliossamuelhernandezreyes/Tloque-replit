import { useMemo, useState } from "react"
import { ArrowLeft, Download, FlaskConical, Loader2, Play, ShieldCheck } from "lucide-react"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"
import { NATIVE_PHYSICAL_MODEL_SOURCES } from "@shared/native-acoustic-source"
import type { NativeAcousticValidationReport } from "@shared/native-acoustic-validation"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { NATIVE_HYBRID_SOURCES } from "@shared/native-hybrid-source"
import { hybridMetricTargets } from "@shared/native-hybrid-validation"
import { runPhysicalModelCalibration } from "@/audio/PhysicalModelCalibrationRunner"

const STORAGE_KEY = "tloque_physical_model_calibration_v1"

type ReportHistory = Record<string, NativeAcousticValidationReport[]>

function loadHistory(): ReportHistory {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch { return {} }
}

function saveHistory(history: ReportHistory) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)) } catch {}
}

function statusClass(status: "pass" | "warn" | "fail") {
  return status === "pass" ? "text-emerald-300" : status === "warn" ? "text-amber-300" : "text-red-300"
}

function downloadReport(report: NativeAcousticValidationReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${report.instrumentId.replaceAll(".", "-")}-${report.modelId}-calibration.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function previousMetric(history: readonly NativeAcousticValidationReport[], metricId: string) {
  if (history.length < 2) return null
  return history.at(-2)?.metrics.find(metric => metric.id === metricId) ?? null
}

function hybridLayerLabel(layer: string) {
  if (layer === "bowed-string-resonator") return "Arco + cuerda"
  if (layer === "air-column-resonator") return "Columna de aire"
  return "Resonancia simpática"
}

export default function PhysicalModelLab() {
  const [, setLocation] = useLocation()
  const models = useMemo(() => [...NATIVE_PHYSICAL_MODEL_SOURCES], [])
  const hybrids = useMemo(() => [...NATIVE_HYBRID_SOURCES], [])
  const [history, setHistory] = useState<ReportHistory>(loadHistory)
  const [running, setRunning] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [error, setError] = useState("")

  async function calibrate(moduleId: string) {
    const source = models.find(item => item.moduleId === moduleId)
    if (!source) return null
    const report = await runPhysicalModelCalibration(source)
    setHistory(current => {
      const next = { ...current, [moduleId]: [...(current[moduleId] ?? []), report].slice(-8) }
      saveHistory(next)
      return next
    })
    return report
  }

  async function run(moduleId: string) {
    if (running || runningAll) return
    setRunning(moduleId)
    setError("")
    try { await calibrate(moduleId) }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo ejecutar la calibración") }
    finally { setRunning(null) }
  }

  async function runAll() {
    if (running || runningAll) return
    setRunningAll(true)
    setError("")
    try {
      for (const model of models) {
        setRunning(model.moduleId)
        await calibrate(model.moduleId)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo ejecutar la calibración")
    } finally {
      setRunning(null)
      setRunningAll(false)
    }
  }

  return (
    <Layout>
      <section className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        <button onClick={() => setLocation("/admin")} className="mb-5 inline-flex items-center gap-2 text-xs text-white/45 hover:text-white/70">
          <ArrowLeft className="h-3.5 w-3.5" /> Admin
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="tloque-eyebrow">Tloque · Acoustic Lab</p>
            <h1 className="mt-1 text-2xl text-white">Fuentes físicas e híbridas · validación Master</h1>
          </div>
          <button onClick={() => void runAll()} disabled={Boolean(running) || runningAll} className="tloque-primary-button inline-flex items-center gap-2 disabled:opacity-45">
            {runningAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            {runningAll ? "Calibrando…" : "Calibrar modelos"}
          </button>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
          Los modelos completos se miden con probes WebAudio. Las fuentes híbridas usan una política sampled-vs-hybrid: deben conservar el ataque real, mejorar continuidad/dinámica/cola dentro de límites espectrales y ganar una revisión A/B humana. Ninguna capa Studio entra a Master sin evidencia de la versión exacta.
        </p>

        {error && <p className="mt-5 rounded-xl border border-red-300/10 bg-red-300/[.04] px-4 py-3 text-sm text-red-200/70">{error}</p>}

        <div className="mt-7 space-y-4">
          {models.map(model => {
            const runs = history[model.moduleId] ?? []
            const report = runs.at(-1)
            const busy = running === model.moduleId
            return (
              <article key={model.moduleId} className="tloque-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{model.instrumentId}</p>
                    <p className="mt-1 text-xs text-white/35">{model.modelId} · {model.engineVersion} · MIDI {model.midiMin}–{model.midiMax}</p>
                    <p className="mt-1 text-[10px] text-white/20">{runs.length} corrida{runs.length === 1 ? "" : "s"} guardada{runs.length === 1 ? "" : "s"}</p>
                  </div>
                  <button onClick={() => void run(model.moduleId)} disabled={Boolean(running) || runningAll} className="tloque-primary-button inline-flex items-center gap-2 disabled:opacity-45">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    {busy ? "Midiendo…" : "Calibrar"}
                  </button>
                </div>

                {report && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[.025] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className={`h-4 w-4 ${report.pass ? "text-emerald-300" : "text-amber-300"}`} />
                        <span className="text-xs text-white/70">Objetivo: {report.pass ? "PASS" : "requiere ajuste"}</span>
                        <span className="text-[10px] text-white/25">{new Date(report.generatedAt).toLocaleString()}</span>
                      </div>
                      <button onClick={() => downloadReport(report)} className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white/75">
                        <Download className="h-3.5 w-3.5" /> Exportar JSON
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                      {report.metrics.map(metric => {
                        const previous = previousMetric(runs, metric.id)
                        const delta = previous ? metric.value - previous.value : null
                        return (
                          <div key={metric.id} className="rounded-xl border border-white/[.06] bg-black/20 p-3">
                            <p className="text-[11px] text-white/40">{metric.label}</p>
                            <p className={`mt-1 text-sm font-medium ${statusClass(metric.status)}`}>
                              {Number.isFinite(metric.value) ? metric.value.toFixed(2) : "—"} {metric.unit}
                            </p>
                            <p className="mt-1 text-[10px] leading-4 text-white/25">objetivo {metric.targetMin}–{metric.targetMax}</p>
                            {delta !== null && Number.isFinite(delta) && <p className="mt-1 text-[10px] text-white/30">Δ anterior {delta >= 0 ? "+" : ""}{delta.toFixed(2)}</p>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>

        <div className="mt-10 flex items-end justify-between gap-4">
          <div>
            <p className="tloque-eyebrow">Sampled vs Hybrid</p>
            <h2 className="mt-1 text-xl text-white">Candidatos A/B</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-white/35">Los umbrales son específicos por familia. La preferencia humana debe ser híbrida; un empate o preferencia por el sample mantiene el overlay fuera de Master.</p>
          </div>
          <span className="text-xs text-white/30">{hybrids.filter(source => hybridSourceMasterApproved(source)).length}/{hybrids.length} Master</span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {hybrids.map(source => {
            const targets = hybridMetricTargets(source.physicalLayer)
            const approved = hybridSourceMasterApproved(source)
            return (
              <article key={source.instrumentId} className="rounded-2xl border border-white/[.06] bg-white/[.02] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{source.instrumentId}</p>
                    <p className="mt-1 text-[11px] text-white/35">{hybridLayerLabel(source.physicalLayer)} · {source.engineVersion}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${approved ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}>{approved ? "MASTER" : "A/B pendiente"}</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-white/30">{source.notes}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[10px] text-white/25">Ataque preservado</p><p className="mt-0.5 text-xs text-white/55">≥ {targets["transient-preservation"].min.toFixed(2)}</p></div>
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[10px] text-white/25">Desviación espectral</p><p className="mt-0.5 text-xs text-white/55">≤ {targets["spectral-deviation"].max.toFixed(2)}</p></div>
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[10px] text-white/25">Continuidad mínima</p><p className="mt-0.5 text-xs text-white/55">≥ {targets["sustain-continuity"].min.toFixed(2)}</p></div>
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[10px] text-white/25">Mejora de cola</p><p className="mt-0.5 text-xs text-white/55">≥ {targets["tail-naturalness"].min.toFixed(2)}</p></div>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </Layout>
  )
}
