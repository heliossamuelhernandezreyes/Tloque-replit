import type { NativePhysicalModelSource } from "@shared/native-acoustic-source"
import {
  acousticMetricStatus,
  type NativeAcousticMetric,
  type NativeAcousticValidationReport,
  validationProfileForInstrument,
} from "@shared/native-acoustic-validation"

export interface AcousticProbeSet {
  sampleRate: number
  targetFrequencyHz: number
  soft: Float32Array
  loud: Float32Array
  sustained: Float32Array
  attack: Float32Array
  legato: Float32Array
  legatoBoundaryFrame: number
}

function rms(data: Float32Array, start = 0, end = data.length) {
  const from = Math.max(0, Math.min(data.length, start))
  const to = Math.max(from + 1, Math.min(data.length, end))
  let sum = 0
  for (let i = from; i < to; i += 1) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

function db(value: number) { return 20 * Math.log10(Math.max(1e-9, value)) }

function estimateFundamental(data: Float32Array, sampleRate: number, targetHz: number) {
  if (data.length < 64 || !Number.isFinite(targetHz) || targetHz <= 0) return targetHz
  const minLag = Math.max(2, Math.floor(sampleRate / (targetHz * 1.12)))
  const maxLag = Math.min(data.length - 2, Math.ceil(sampleRate / (targetHz * 0.88)))
  const start = Math.floor(data.length * 0.18)
  const end = Math.floor(data.length * 0.82)
  let bestLag = minLag
  let best = -Infinity
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0, energyA = 0, energyB = 0
    for (let i = start; i < end - lag; i += 1) {
      const a = data[i], b = data[i + lag]
      score += a * b; energyA += a * a; energyB += b * b
    }
    const normalized = score / Math.sqrt(Math.max(1e-12, energyA * energyB))
    if (normalized > best) { best = normalized; bestLag = lag }
  }
  return sampleRate / Math.max(1, bestLag)
}

function pitchErrorCents(actualHz: number, targetHz: number) {
  return Math.abs(1200 * Math.log2(Math.max(1e-9, actualHz) / Math.max(1e-9, targetHz)))
}

function spectralHighRatio(data: Float32Array) {
  let diff = 0
  for (let i = 1; i < data.length; i += 1) { const d = data[i] - data[i - 1]; diff += d * d }
  return Math.min(1, Math.sqrt(diff / Math.max(1, data.length - 1)) / Math.max(1e-9, rms(data)))
}

function attackTimeMs(data: Float32Array, sampleRate: number) {
  let peak = 1e-9
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]))
  const threshold = peak * 0.72
  const window = Math.max(8, Math.floor(sampleRate * 0.006))
  for (let i = window; i < data.length; i += 1) {
    if (rms(data, i - window, i) >= threshold * 0.7) return (i / sampleRate) * 1000
  }
  return (data.length / sampleRate) * 1000
}

function legatoDiscontinuityDb(data: Float32Array, boundary: number, sampleRate: number) {
  const window = Math.max(16, Math.floor(sampleRate * 0.025))
  const before = rms(data, boundary - window, boundary)
  const after = rms(data, boundary, boundary + window)
  return Math.abs(db(after) - db(before))
}

function metric(id: NativeAcousticMetric["id"], label: string, value: number, unit: NativeAcousticMetric["unit"], min: number, max: number, note: string): NativeAcousticMetric {
  return { id, label, value, unit, targetMin: min, targetMax: max, status: acousticMetricStatus(value, min, max), note }
}

export function analyzePhysicalModelProbe(source: NativePhysicalModelSource, probes: AcousticProbeSet): NativeAcousticValidationReport {
  const profile = validationProfileForInstrument(source.instrumentId)
  if (!profile) throw new Error(`No hay perfil acústico para ${source.instrumentId}`)
  const estimated = estimateFundamental(probes.sustained, probes.sampleRate, probes.targetFrequencyHz)
  const pitch = pitchErrorCents(estimated, probes.targetFrequencyHz)
  const dynamic = db(rms(probes.loud)) - db(rms(probes.soft))
  const spectral = spectralHighRatio(probes.sustained)
  const attack = attackTimeMs(probes.attack, probes.sampleRate)
  const legato = legatoDiscontinuityDb(probes.legato, probes.legatoBoundaryFrame, probes.sampleRate)
  const metrics: NativeAcousticMetric[] = [
    metric("pitch-stability", "Estabilidad tonal", pitch, "cents", 0, profile.pitchStabilityCentsMax, `f0 estimada ${estimated.toFixed(2)} Hz / objetivo ${probes.targetFrequencyHz.toFixed(2)} Hz`),
    metric("dynamic-response", "Respuesta dinámica", dynamic, "db", profile.dynamicResponseDbMin, profile.dynamicResponseDbMax, "Diferencia RMS entre probes soft y loud"),
    metric("spectral-balance", "Balance espectral", spectral, "ratio", profile.spectralBalanceMin, profile.spectralBalanceMax, "Proxy determinista de energía alta basado en primera diferencia"),
    metric("attack-envelope", "Ataque", attack, "ms", profile.attackMsMin, profile.attackMsMax, "Tiempo hasta envolvente estable"),
    metric("legato-continuity", "Continuidad legato", legato, "db", 0, profile.legatoDiscontinuityDbMax, "Salto RMS alrededor de la transición"),
  ]
  const pass = metrics.every(item => item.status === "pass")
  return {
    version: 1,
    modelId: source.modelId,
    instrumentId: source.instrumentId,
    generatedAt: new Date().toISOString(),
    referenceSet: profile.referenceSet,
    metrics,
    pass,
    masterEligible: false,
  }
}
