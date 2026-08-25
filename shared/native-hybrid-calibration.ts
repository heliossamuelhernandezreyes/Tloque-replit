import type { NativeHybridSource } from "./native-hybrid-source"
import type { HybridAbCellResult, HybridAbMetric, HybridAbMetricId, HybridAbValidationReport } from "./native-hybrid-validation"

export interface HybridCalibrationCandidate {
  id: string
  instrumentId: string
  baseEngineVersion: NativeHybridSource["engineVersion"]
  wet: number
  wetScale: number
  triggerCell: { register: string; gesture: string; metricId: HybridAbMetricId; value: number }
  reason: string
  generatedAt: string
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }

function metricDeficit(metric: HybridAbMetric) {
  if (metric.pass) return 0
  if (metric.value < metric.targetMin) return (metric.targetMin - metric.value) / Math.max(0.01, metric.targetMax - metric.targetMin)
  return (metric.value - metric.targetMax) / Math.max(0.01, metric.targetMax - metric.targetMin)
}

export function worstHybridCalibrationFailure(report: HybridAbValidationReport) {
  let worst: { cell: HybridAbCellResult; metric: HybridAbMetric; deficit: number } | null = null
  for (const cell of report.cellResults ?? []) {
    for (const metric of cell.metrics) {
      const deficit = metricDeficit(metric)
      if (deficit > 0 && (!worst || deficit > worst.deficit)) worst = { cell, metric, deficit }
    }
  }
  return worst
}

function desiredWetScale(metric: HybridAbMetric, deficit: number) {
  // Excess spectral change or damaged attack/dynamics means the overlay is too intrusive.
  if (metric.id === "spectral-deviation" || metric.id === "transient-preservation" || metric.id === "dynamic-response") {
    return 1 - clamp(0.035 + deficit * 0.08, 0.04, 0.12)
  }
  // Insufficient continuity/tail usually means the physical layer is too quiet.
  return 1 + clamp(0.025 + deficit * 0.06, 0.03, 0.1)
}

export function proposeHybridCalibrationCandidate(source: NativeHybridSource, report: HybridAbValidationReport): HybridCalibrationCandidate | null {
  if (report.instrumentId !== source.instrumentId || report.engineVersion !== source.engineVersion) return null
  const failure = worstHybridCalibrationFailure(report)
  if (!failure) return null
  const wetScale = desiredWetScale(failure.metric, failure.deficit)
  const wet = clamp(source.wet * wetScale, Math.max(0.015, source.wet * 0.72), Math.min(0.24, source.wet * 1.25))
  const direction = wet < source.wet ? "reducir" : "aumentar"
  return {
    id: `${source.instrumentId}:${source.engineVersion}:${failure.cell.register}:${failure.cell.gesture}:${failure.metric.id}:${wet.toFixed(4)}`,
    instrumentId: source.instrumentId,
    baseEngineVersion: source.engineVersion,
    wet,
    wetScale: wet / Math.max(1e-6, source.wet),
    triggerCell: { register: failure.cell.register, gesture: failure.cell.gesture, metricId: failure.metric.id, value: failure.metric.value },
    reason: `${failure.cell.register}/${failure.cell.gesture}: ${failure.metric.label}=${failure.metric.value.toFixed(3)}. Propuesta acotada: ${direction} wet ${(Math.abs(wet / source.wet - 1) * 100).toFixed(1)}%.`,
    generatedAt: new Date().toISOString(),
  }
}

export function sourceWithCalibrationCandidate(source: NativeHybridSource, candidate: HybridCalibrationCandidate): NativeHybridSource {
  if (candidate.instrumentId !== source.instrumentId || candidate.baseEngineVersion !== source.engineVersion) return source
  return { ...source, wet: candidate.wet }
}

export function hybridCalibrationScore(report: HybridAbValidationReport) {
  const cells = report.cellResults ?? []
  if (!cells.length) return { passingCells: 0, totalCells: 0, worstMargin: -Infinity }
  let worstMargin = Infinity
  let passingCells = 0
  for (const cell of cells) {
    if (cell.objectivePass) passingCells += 1
    for (const metric of cell.metrics) {
      const span = Math.max(0.01, metric.targetMax - metric.targetMin)
      const margin = Math.min((metric.value - metric.targetMin) / span, (metric.targetMax - metric.value) / span)
      worstMargin = Math.min(worstMargin, margin)
    }
  }
  return { passingCells, totalCells: cells.length, worstMargin }
}
