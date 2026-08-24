export type NativeAcousticMetricStatus = "pass" | "warn" | "fail"

export interface NativeAcousticMetric {
  id: "pitch-stability" | "dynamic-response" | "spectral-balance" | "attack-envelope" | "legato-continuity"
  label: string
  value: number
  unit: "cents" | "db" | "ratio" | "ms"
  targetMin: number
  targetMax: number
  status: NativeAcousticMetricStatus
  note: string
}

export interface NativeAcousticValidationReport {
  version: 1
  modelId: string
  instrumentId: string
  generatedAt: string
  referenceSet: string
  metrics: readonly NativeAcousticMetric[]
  pass: boolean
  masterEligible: boolean
}

export interface NativeAcousticValidationProfile {
  instrumentId: string
  referenceSet: string
  pitchStabilityCentsMax: number
  dynamicResponseDbMin: number
  dynamicResponseDbMax: number
  spectralBalanceMin: number
  spectralBalanceMax: number
  attackMsMin: number
  attackMsMax: number
  legatoDiscontinuityDbMax: number
}

export const NATIVE_ACOUSTIC_VALIDATION_PROFILES: readonly NativeAcousticValidationProfile[] = [
  {
    instrumentId: "woodwinds.english-horn",
    referenceSet: "tloque-double-reed-reference-v1",
    pitchStabilityCentsMax: 18,
    dynamicResponseDbMin: 7,
    dynamicResponseDbMax: 24,
    spectralBalanceMin: 0.18,
    spectralBalanceMax: 0.72,
    attackMsMin: 18,
    attackMsMax: 145,
    legatoDiscontinuityDbMax: 5.5,
  },
  {
    instrumentId: "woodwinds.contrabassoon",
    referenceSet: "tloque-double-reed-reference-v1",
    pitchStabilityCentsMax: 22,
    dynamicResponseDbMin: 6,
    dynamicResponseDbMax: 22,
    spectralBalanceMin: 0.12,
    spectralBalanceMax: 0.62,
    attackMsMin: 24,
    attackMsMax: 180,
    legatoDiscontinuityDbMax: 6.5,
  },
]

export function validationProfileForInstrument(instrumentId: string): NativeAcousticValidationProfile | null {
  return NATIVE_ACOUSTIC_VALIDATION_PROFILES.find(profile => profile.instrumentId === instrumentId) ?? null
}

export function acousticMetricStatus(value: number, min: number, max: number, warnMargin = 0.15): NativeAcousticMetricStatus {
  if (value >= min && value <= max) return "pass"
  const span = Math.max(1e-6, max - min)
  if (value >= min - span * warnMargin && value <= max + span * warnMargin) return "warn"
  return "fail"
}

export function validationReportMasterEligible(report: NativeAcousticValidationReport | null | undefined): boolean {
  return Boolean(report?.pass && report.masterEligible && report.metrics.every(metric => metric.status === "pass"))
}
