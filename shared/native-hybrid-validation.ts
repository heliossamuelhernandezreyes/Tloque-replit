import type { NativeHybridPhysicalLayer, NativeHybridSource } from "./native-hybrid-source"
import { NATIVE_HYBRID_PERFORMANCE_VERSION } from "./native-hybrid-performance"

export type HybridAbMetricId =
  | "transient-preservation"
  | "sustain-continuity"
  | "dynamic-response"
  | "spectral-deviation"
  | "tail-naturalness"
export type HybridAbRegister = "low" | "mid" | "high"
export type HybridAbGesture = "soft" | "neutral" | "strong"

export interface HybridAbMetric {
  id: HybridAbMetricId
  label: string
  value: number
  targetMin: number
  targetMax: number
  pass: boolean
}
export interface HybridAbCellResult {
  register: HybridAbRegister
  gesture: HybridAbGesture
  gestureLabel: string
  midi: number
  metrics: readonly HybridAbMetric[]
  objectivePass: boolean
}
export interface HybridAbRegisterResult {
  register: HybridAbRegister
  midi: number
  metrics: readonly HybridAbMetric[]
  objectivePass: boolean
}
export type HybridHumanReviewMode = "blind-ab" | "labeled-ab" | "unreviewed"

export interface HybridAbValidationReport {
  instrumentId: string
  engineVersion: NativeHybridSource["engineVersion"]
  performanceVersion: typeof NATIVE_HYBRID_PERFORMANCE_VERSION
  physicalLayer: NativeHybridPhysicalLayer
  generatedAt: string
  sampleReferenceId: string
  calibrationCandidateId: string | null
  cellResults: readonly HybridAbCellResult[]
  registerResults: readonly HybridAbRegisterResult[]
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
const LABELS: Record<HybridAbMetricId, string> = {
  "transient-preservation": "Preservación del ataque sampleado",
  "sustain-continuity": "Ganancia de continuidad sostenida",
  "dynamic-response": "Preservación del contraste dinámico",
  "spectral-deviation": "Desviación espectral vs sample",
  "tail-naturalness": "Extensión controlada de cola",
}

export function hybridMetricTargets(layer: NativeHybridPhysicalLayer) { return TARGETS[layer] }
function metricsFor(source: NativeHybridSource, values: Record<HybridAbMetricId, number>) {
  const targets = TARGETS[source.physicalLayer]
  return (Object.keys(targets) as HybridAbMetricId[]).map(id => {
    const target = targets[id], value = values[id]
    return { id, label: LABELS[id], value, targetMin: target.min, targetMax: target.max, pass: Number.isFinite(value) && value >= target.min && value <= target.max }
  })
}
function worstMetricValues(source: NativeHybridSource, groups: readonly { metrics: readonly HybridAbMetric[] }[]) {
  const ids = Object.keys(TARGETS[source.physicalLayer]) as HybridAbMetricId[]
  return Object.fromEntries(ids.map(id => {
    const target = TARGETS[source.physicalLayer][id]
    const values = groups.map(group => group.metrics.find(metric => metric.id === id)?.value ?? Number.NaN)
    return [id, target.min === 0 ? Math.max(...values) : Math.min(...values)]
  })) as Record<HybridAbMetricId, number>
}

export interface HybridAbCellValues {
  register: HybridAbRegister
  gesture: HybridAbGesture
  gestureLabel: string
  midi: number
  values: Record<HybridAbMetricId, number>
}

const REGISTERS: readonly HybridAbRegister[] = ["low", "mid", "high"]
const GESTURES: readonly HybridAbGesture[] = ["soft", "neutral", "strong"]

export function buildHybridAbReport(
  source: NativeHybridSource,
  sampleReferenceId: string,
  cellValues: readonly HybridAbCellValues[],
  review?: { preference: HybridAbValidationReport["humanPreference"]; mode?: HybridHumanReviewMode; note?: string },
  calibrationCandidateId: string | null = null,
): HybridAbValidationReport {
  const cellResults = cellValues.map(item => {
    const metrics = metricsFor(source, item.values)
    return { ...item, metrics, objectivePass: metrics.every(metric => metric.pass) }
  })
  const registerResults = REGISTERS.map(register => {
    const cells = cellResults.filter(cell => cell.register === register)
    const metrics = metricsFor(source, worstMetricValues(source, cells))
    return { register, midi: cells[0]?.midi ?? Number.NaN, metrics, objectivePass: cells.length === 3 && cells.every(cell => cell.objectivePass) && metrics.every(metric => metric.pass) }
  })
  const metrics = metricsFor(source, worstMetricValues(source, cellResults))
  const exactCoverage = cellResults.length === 9 && REGISTERS.every(register => GESTURES.every(gesture => cellResults.filter(cell => cell.register === register && cell.gesture === gesture).length === 1))
  return {
    instrumentId: source.instrumentId,
    engineVersion: source.engineVersion,
    performanceVersion: NATIVE_HYBRID_PERFORMANCE_VERSION,
    physicalLayer: source.physicalLayer,
    generatedAt: new Date().toISOString(),
    sampleReferenceId,
    calibrationCandidateId,
    cellResults,
    registerResults,
    metrics,
    objectivePass: exactCoverage && cellResults.every(cell => cell.objectivePass) && registerResults.every(result => result.objectivePass) && metrics.every(metric => metric.pass),
    humanPreference: review?.preference ?? "unreviewed",
    humanReviewMode: review?.mode ?? "unreviewed",
    reviewerNote: review?.note?.trim().slice(0, 600) ?? "",
  }
}

export function hybridMasterEvidenceValid(source: NativeHybridSource, report: HybridAbValidationReport | null | undefined) {
  const cells: readonly HybridAbCellResult[] = report?.cellResults ?? []
  const exactCoverage = cells.length === 9 && REGISTERS.every(register => GESTURES.every(gesture => cells.filter(cell => cell.register === register && cell.gesture === gesture).length === 1))
  return Boolean(
    report &&
    report.instrumentId === source.instrumentId &&
    report.engineVersion === source.engineVersion &&
    report.performanceVersion === NATIVE_HYBRID_PERFORMANCE_VERSION &&
    report.physicalLayer === source.physicalLayer &&
    !report.calibrationCandidateId &&
    exactCoverage &&
    report.objectivePass &&
    cells.every(cell => cell.objectivePass && cell.metrics.every(metric => metric.pass)) &&
    (report.registerResults ?? []).length === 3 &&
    report.registerResults.every(result => result.objectivePass && result.metrics.every(metric => metric.pass)) &&
    report.metrics.every(metric => metric.pass) &&
    report.humanReviewMode === "blind-ab" &&
    report.humanPreference === "hybrid",
  )
}
