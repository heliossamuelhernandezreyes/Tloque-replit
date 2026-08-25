import type { NativeHybridPhysicalLayer, NativeHybridSource } from "./native-hybrid-source"

export type HybridAbMetricId =
  | "transient-preservation"
  | "sustain-continuity"
  | "dynamic-response"
  | "spectral-deviation"
  | "tail-naturalness"

export interface HybridAbMetric {
  id: HybridAbMetricId
  label: string
  value: number
  targetMin: number
  targetMax: number
  pass: boolean
}

export type HybridHumanReviewMode = "blind-ab" | "labeled-ab" | "unreviewed"

export interface HybridAbValidationReport {
  instrumentId: string
  engineVersion: NativeHybridSource["engineVersion"]
  physicalLayer: NativeHybridPhysicalLayer
  generatedAt: string
  sampleReferenceId: string
  metrics: readonly HybridAbMetric[]
  objectivePass: boolean
  humanPreference: "sampled" | "hybrid" | "tie" | "unreviewed"
  humanReviewMode: HybridHumanReviewMode
  reviewerNote: string
}

interface MetricTarget { min: number; max: number }

const TARGETS: Record<NativeHybridPhysicalLayer, Record<HybridAbMetricId, MetricTarget>> = {
  "bowed-string-resonator": {
    "transient-preservation": { min: 0.9, max: 1 },
    "sustain-continuity": { min: 0.08, max: 1 },
    "dynamic-response": { min: 0.9, max: 1 },
    "spectral-deviation": { min: 0, max: 0.18 },
    "tail-naturalness": { min: 0.02, max: 1 },
  },
  "air-column-resonator": {
    "transient-preservation": { min: 0.92, max: 1 },
    "sustain-continuity": { min: 0.07, max: 1 },
    "dynamic-response": { min: 0.92, max: 1 },
    "spectral-deviation": { min: 0, max: 0.16 },
    "tail-naturalness": { min: 0.015, max: 1 },
  },
  "sympathetic-resonance": {
    "transient-preservation": { min: 0.96, max: 1 },
    "sustain-continuity": { min: 0.03, max: 1 },
    "dynamic-response": { min: 0.94, max: 1 },
    "spectral-deviation": { min: 0, max: 0.12 },
    "tail-naturalness": { min: 0.08, max: 1 },
  },
}

export function hybridMetricTargets(layer: NativeHybridPhysicalLayer) { return TARGETS[layer] }

export function buildHybridAbReport(
  source: NativeHybridSource,
  sampleReferenceId: string,
  values: Record<HybridAbMetricId, number>,
  review?: { preference: HybridAbValidationReport["humanPreference"]; mode?: HybridHumanReviewMode; note?: string },
): HybridAbValidationReport {
  const targets = TARGETS[source.physicalLayer]
  const labels: Record<HybridAbMetricId, string> = {
    "transient-preservation": "Preservación del ataque sampleado",
    "sustain-continuity": "Ganancia de continuidad sostenida",
    "dynamic-response": "Preservación del contraste dinámico",
    "spectral-deviation": "Desviación espectral vs sample",
    "tail-naturalness": "Extensión controlada de cola",
  }
  const metrics = (Object.keys(targets) as HybridAbMetricId[]).map(id => {
    const target = targets[id], value = values[id]
    return { id, label: labels[id], value, targetMin: target.min, targetMax: target.max, pass: Number.isFinite(value) && value >= target.min && value <= target.max }
  })
  return {
    instrumentId: source.instrumentId,
    engineVersion: source.engineVersion,
    physicalLayer: source.physicalLayer,
    generatedAt: new Date().toISOString(),
    sampleReferenceId,
    metrics,
    objectivePass: metrics.every(metric => metric.pass),
    humanPreference: review?.preference ?? "unreviewed",
    humanReviewMode: review?.mode ?? "unreviewed",
    reviewerNote: review?.note?.trim().slice(0, 600) ?? "",
  }
}

export function hybridMasterEvidenceValid(source: NativeHybridSource, report: HybridAbValidationReport | null | undefined) {
  return Boolean(
    report &&
    report.instrumentId === source.instrumentId &&
    report.engineVersion === source.engineVersion &&
    report.physicalLayer === source.physicalLayer &&
    report.objectivePass &&
    report.metrics.every(metric => metric.pass) &&
    report.humanReviewMode === "blind-ab" &&
    report.humanPreference === "hybrid",
  )
}
