import type { NativeHybridSource } from "./native-hybrid-source"
import { boundedHybridCalibrationTuning, tuningChangedAxes, type HybridCalibrationTuning } from "./native-hybrid-tuning"
import type { HybridAbCellResult, HybridAbMetric, HybridAbMetricId, HybridAbValidationReport } from "./native-hybrid-validation"

export interface HybridCalibrationCandidate {
  id: string
  instrumentId: string
  baseEngineVersion: NativeHybridSource["engineVersion"]
  wet: number
  wetScale: number
  tuning: HybridCalibrationTuning
  changedAxes: readonly (keyof HybridCalibrationTuning)[]
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

function step(deficit: number, min: number, max: number) {
  return clamp(min + deficit * (max - min) * 0.55, min, max)
}

function familySpecificTuning(source: NativeHybridSource, metric: HybridAbMetric, deficit: number): HybridCalibrationTuning {
  const intrusive = metric.id === "spectral-deviation" || metric.id === "transient-preservation" || metric.id === "dynamic-response"
  const insufficient = metric.id === "sustain-continuity" || metric.id === "tail-naturalness"
  const tuning: Partial<HybridCalibrationTuning> = {}

  if (intrusive) tuning.wetScale = 1 - step(deficit, 0.035, 0.105)
  if (insufficient) tuning.wetScale = 1 + step(deficit, 0.025, 0.075)

  if (source.physicalLayer === "bowed-string-resonator") {
    if (metric.id === "spectral-deviation") {
      tuning.textureScale = 1 - step(deficit, 0.035, 0.10)
      tuning.dampingScale = 1 - step(deficit, 0.025, 0.075)
    } else if (metric.id === "transient-preservation") {
      tuning.textureScale = 1 - step(deficit, 0.025, 0.075)
    } else if (metric.id === "dynamic-response") {
      tuning.feedbackScale = 1 - step(deficit, 0.008, 0.025)
    } else if (metric.id === "sustain-continuity") {
      tuning.feedbackScale = 1 + step(deficit, 0.008, 0.025)
      tuning.bodyScale = 1 + step(deficit, 0.025, 0.075)
    } else if (metric.id === "tail-naturalness") {
      tuning.feedbackScale = 1 + step(deficit, 0.008, 0.022)
      tuning.decayScale = 1 + step(deficit, 0.025, 0.075)
    }
  } else if (source.physicalLayer === "air-column-resonator") {
    if (metric.id === "spectral-deviation") {
      tuning.dampingScale = 1 - step(deficit, 0.025, 0.08)
      tuning.textureScale = 1 - step(deficit, 0.025, 0.075)
    } else if (metric.id === "transient-preservation") {
      tuning.textureScale = 1 - step(deficit, 0.025, 0.07)
    } else if (metric.id === "dynamic-response") {
      tuning.feedbackScale = 1 - step(deficit, 0.008, 0.022)
    } else if (metric.id === "sustain-continuity") {
      tuning.feedbackScale = 1 + step(deficit, 0.008, 0.024)
      tuning.bodyScale = 1 + step(deficit, 0.02, 0.06)
    } else if (metric.id === "tail-naturalness") {
      tuning.feedbackScale = 1 + step(deficit, 0.008, 0.022)
      tuning.decayScale = 1 + step(deficit, 0.02, 0.065)
    }
  } else {
    if (metric.id === "spectral-deviation") {
      tuning.bodyScale = 1 - step(deficit, 0.025, 0.075)
      tuning.dampingScale = 1 - step(deficit, 0.02, 0.06)
    } else if (metric.id === "transient-preservation") {
      tuning.bodyScale = 1 - step(deficit, 0.02, 0.06)
    } else if (metric.id === "dynamic-response") {
      tuning.bodyScale = 1 - step(deficit, 0.015, 0.05)
    } else if (metric.id === "sustain-continuity") {
      tuning.bodyScale = 1 + step(deficit, 0.025, 0.075)
      tuning.decayScale = 1 + step(deficit, 0.02, 0.06)
    } else if (metric.id === "tail-naturalness") {
      tuning.decayScale = 1 + step(deficit, 0.03, 0.09)
      tuning.bodyScale = 1 + step(deficit, 0.02, 0.055)
    }
  }

  return boundedHybridCalibrationTuning(tuning)
}

export function proposeHybridCalibrationCandidate(source: NativeHybridSource, report: HybridAbValidationReport): HybridCalibrationCandidate | null {
  if (report.instrumentId !== source.instrumentId || report.engineVersion !== source.engineVersion) return null
  const failure = worstHybridCalibrationFailure(report)
  if (!failure) return null
  const tuning = familySpecificTuning(source, failure.metric, failure.deficit)
  const wet = clamp(source.wet * tuning.wetScale, Math.max(0.015, source.wet * 0.72), Math.min(0.24, source.wet * 1.25))
  const normalizedTuning = { ...tuning, wetScale: wet / Math.max(1e-6, source.wet) }
  const changedAxes = tuningChangedAxes(normalizedTuning)
  const axisSummary = changedAxes.map(axis => `${axis}=${normalizedTuning[axis].toFixed(3)}x`).join(", ")
  return {
    id: `${source.instrumentId}:${source.engineVersion}:${failure.cell.register}:${failure.cell.gesture}:${failure.metric.id}:${changedAxes.map(axis => normalizedTuning[axis].toFixed(3)).join("-")}`,
    instrumentId: source.instrumentId,
    baseEngineVersion: source.engineVersion,
    wet,
    wetScale: normalizedTuning.wetScale,
    tuning: normalizedTuning,
    changedAxes,
    triggerCell: { register: failure.cell.register, gesture: failure.cell.gesture, metricId: failure.metric.id, value: failure.metric.value },
    reason: `${failure.cell.register}/${failure.cell.gesture}: ${failure.metric.label}=${failure.metric.value.toFixed(3)}. Candidato físico acotado: ${axisSummary}.`,
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
