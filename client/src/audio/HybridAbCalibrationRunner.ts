import { compileTloqueScore } from "@shared/audio"
import type { CalibratedHybridSource } from "@shared/native-hybrid-calibration"
import type { NativeHybridSource } from "@shared/native-hybrid-source"
import {
  buildHybridAbReport,
  type HybridAbCellValues,
  type HybridAbGesture,
  type HybridAbMetricId,
  type HybridAbRegister,
} from "@shared/native-hybrid-validation"
import { preferredNativeModuleForInstrument } from "./NativeAutoModule"
import { preflightNativeSamplePacks, renderTloqueScoreWithNativeSamplePackToWav } from "./NativeSampleScoreExporter"

export interface HybridAbCalibrationResult {
  report: ReturnType<typeof buildHybridAbReport>
  sampled: Blob
  hybrid: Blob
}

type GestureProfile = {
  label: string
  controls: string
  softVelocity: number
  loudVelocity: number
  sustainVelocity: number
  legatoVelocity: number
}

const REGISTERS: readonly HybridAbRegister[] = ["low", "mid", "high"]
const GESTURES: readonly HybridAbGesture[] = ["soft", "neutral", "strong"]
const CELL_SECONDS = 8

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function midiNote(midi: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}
function registerMidi(source: NativeHybridSource, register: HybridAbRegister) {
  const span = source.midiMax - source.midiMin
  const fraction = register === "low" ? 0.22 : register === "mid" ? 0.5 : 0.78
  return Math.max(source.midiMin, Math.min(source.midiMax, Math.round(source.midiMin + span * fraction)))
}

function gestureProfile(source: NativeHybridSource, gesture: HybridAbGesture): GestureProfile {
  const velocity = gesture === "soft"
    ? { softVelocity: 0.22, loudVelocity: 0.62, sustainVelocity: 0.38, legatoVelocity: 0.34 }
    : gesture === "neutral"
      ? { softVelocity: 0.32, loudVelocity: 0.82, sustainVelocity: 0.60, legatoVelocity: 0.56 }
      : { softVelocity: 0.46, loudVelocity: 0.96, sustainVelocity: 0.82, legatoVelocity: 0.76 }

  if (source.physicalLayer === "bowed-string-resonator") {
    if (gesture === "soft") return { ...velocity, label: "soft / tasto", controls: "control 3:1 expression=0.40 brightness=0.30 vibrato=0.035 pressure=0.30 bow=0.80 coupling=0.24 ramp=0.30\ncontrol 4:2 expression=0.32 brightness=0.27 vibrato=0.025 pressure=0.24 bow=0.84 coupling=0.18 ramp=0.25" }
    if (gesture === "strong") return { ...velocity, label: "strong / ponticello", controls: "control 3:1 expression=0.86 brightness=0.80 vibrato=0.11 pressure=0.86 bow=0.20 coupling=0.70 ramp=0.30\ncontrol 4:2 expression=0.68 brightness=0.72 vibrato=0.08 pressure=0.66 bow=0.28 coupling=0.56 ramp=0.25" }
    return { ...velocity, label: "neutral / ordinario", controls: "control 3:1 expression=0.64 brightness=0.54 vibrato=0.065 pressure=0.58 bow=0.50 coupling=0.46 ramp=0.30\ncontrol 4:2 expression=0.50 brightness=0.46 vibrato=0.045 pressure=0.46 bow=0.57 coupling=0.36 ramp=0.25" }
  }

  if (source.physicalLayer === "air-column-resonator") {
    if (gesture === "soft") return { ...velocity, label: "soft / relaxed", controls: "control 3:1 expression=0.40 brightness=0.34 vibrato=0.035 pressure=0.30 embouchure=0.34 ramp=0.30\ncontrol 4:2 expression=0.32 brightness=0.30 vibrato=0.025 pressure=0.24 embouchure=0.30 ramp=0.25" }
    if (gesture === "strong") return { ...velocity, label: "strong / focused", controls: "control 3:1 expression=0.86 brightness=0.78 vibrato=0.10 pressure=0.86 embouchure=0.74 ramp=0.30\ncontrol 4:2 expression=0.68 brightness=0.70 vibrato=0.075 pressure=0.68 embouchure=0.66 ramp=0.25" }
    return { ...velocity, label: "neutral / centered", controls: "control 3:1 expression=0.64 brightness=0.55 vibrato=0.06 pressure=0.58 embouchure=0.52 ramp=0.30\ncontrol 4:2 expression=0.50 brightness=0.47 vibrato=0.045 pressure=0.46 embouchure=0.46 ramp=0.25" }
  }

  const keyed = source.instrumentId === "piano.grand" || source.instrumentId === "keys.celesta"
  if (keyed) {
    if (gesture === "soft") return { ...velocity, label: "soft / dry", controls: "control 3:1 pedal=up damper=0.82 coupling=0.18 expression=0.38 brightness=0.42 ramp=0.18\ncontrol 4:2 pedal=up damper=0.88 coupling=0.12 expression=0.30 brightness=0.38 ramp=0.18" }
    if (gesture === "strong") return { ...velocity, label: "strong / resonant", controls: "control 3:1 pedal=down damper=0.08 coupling=0.86 expression=0.84 brightness=0.68 ramp=0.18\ncontrol 4:2 pedal=down damper=0.14 coupling=0.74 expression=0.68 brightness=0.60 ramp=0.18" }
    return { ...velocity, label: "neutral / balanced", controls: "control 3:1 pedal=down damper=0.44 coupling=0.50 expression=0.62 brightness=0.54 ramp=0.18\ncontrol 4:2 pedal=up damper=0.56 coupling=0.38 expression=0.50 brightness=0.48 ramp=0.18" }
  }

  if (gesture === "soft") return { ...velocity, label: "soft / dry", controls: "control 3:1 pluck=0.72 damper=0.74 coupling=0.18 expression=0.38 brightness=0.40 ramp=0.18\ncontrol 4:2 pluck=0.76 damper=0.82 coupling=0.12 expression=0.30 brightness=0.36 ramp=0.18" }
  if (gesture === "strong") return { ...velocity, label: "strong / resonant", controls: "control 3:1 pluck=0.24 damper=0.14 coupling=0.80 expression=0.84 brightness=0.70 ramp=0.18\ncontrol 4:2 pluck=0.30 damper=0.20 coupling=0.68 expression=0.68 brightness=0.62 ramp=0.18" }
  return { ...velocity, label: "neutral / balanced", controls: "control 3:1 pluck=0.50 damper=0.42 coupling=0.48 expression=0.62 brightness=0.54 ramp=0.18\ncontrol 4:2 pluck=0.56 damper=0.52 coupling=0.36 expression=0.50 brightness=0.48 ramp=0.18" }
}

function cellBlock(source: NativeHybridSource, register: HybridAbRegister, gesture: HybridAbGesture) {
  const midi = registerMidi(source, register)
  const upper = Math.min(source.midiMax, midi + 2)
  const profile = gestureProfile(source, gesture)
  return `section ${register}_${gesture} form=development bars=4 repeat=1 fade=0 tempo=120 rubato=0
use probe
1:1 ${midiNote(midi)} 1.5 velocity=${profile.softVelocity.toFixed(2)} articulation=normal
2:1 ${midiNote(midi)} 1.5 velocity=${profile.loudVelocity.toFixed(2)} articulation=normal
${profile.controls}
3:1 ${midiNote(midi)} 4 velocity=${profile.sustainVelocity.toFixed(2)} articulation=normal
4:1 ${midiNote(upper)} 2 velocity=${profile.legatoVelocity.toFixed(2)} articulation=legato
end`
}
function probeScore(source: NativeHybridSource) {
  const cells = REGISTERS.flatMap(register => GESTURES.map(gesture => cellBlock(source, register, gesture))).join("\n")
  return `TLOQUE_SCORE 2
title "Hybrid A-B register gesture matrix ${source.instrumentId}"
tempo 120
meter 4/4
loop false
seed 20260825
humanize 0
quality studio
module native-auto
track probe synth=pad instrument=${source.instrumentId} program=0 role=melody gain=0.32 pan=0 attack=0.025 release=1 expression=0.55 brightness=0.52 vibrato=0.06
${cells}`
}

function mono(buffer: AudioBuffer) {
  const out = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < out.length; i += 1) out[i] += data[i] / buffer.numberOfChannels
  }
  return out
}
function rms(data: Float32Array, start: number, end: number) {
  if (!data.length) return 0
  const a = Math.max(0, Math.min(data.length - 1, Math.floor(start)))
  const b = Math.max(a + 1, Math.min(data.length, Math.floor(end)))
  let sum = 0
  for (let i = a; i < b; i += 1) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, b - a))
}
function diffRms(a: Float32Array, b: Float32Array, start: number, end: number) {
  const from = Math.max(0, Math.min(a.length, b.length, Math.floor(start)))
  const to = Math.max(from, Math.min(a.length, b.length, Math.floor(end)))
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i += 1) { const delta = b[i] - a[i]; sum += delta * delta }
  return Math.sqrt(sum / (to - from))
}
function coefficientOfVariation(data: Float32Array, sampleRate: number, startSeconds: number, endSeconds: number) {
  const width = Math.max(32, Math.floor(sampleRate * 0.05)), windows: number[] = []
  for (let at = Math.floor(startSeconds * sampleRate); at + width <= Math.min(data.length, endSeconds * sampleRate); at += width) windows.push(rms(data, at, at + width))
  if (!windows.length) return 1
  const mean = windows.reduce((a, b) => a + b, 0) / windows.length
  const variance = windows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / windows.length
  return Math.sqrt(variance) / Math.max(1e-6, mean)
}
function spectralCentroid(data: Float32Array, sampleRate: number, centerSeconds: number) {
  if (!data.length) return 0
  const n = Math.min(512, data.length), center = Math.floor(centerSeconds * sampleRate), start = Math.max(0, Math.min(data.length - n, center - n / 2))
  let weighted = 0, magnitudeSum = 0
  for (let k = 1; k < n / 2; k += 1) {
    let real = 0, imag = 0
    for (let t = 0; t < n; t += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / Math.max(1, n - 1)), x = (data[start + t] ?? 0) * window, phase = (2 * Math.PI * k * t) / n
      real += x * Math.cos(phase); imag -= x * Math.sin(phase)
    }
    const magnitude = Math.hypot(real, imag), hz = (k * sampleRate) / n
    magnitudeSum += magnitude; weighted += hz * magnitude
  }
  return weighted / Math.max(1e-9, magnitudeSum)
}
function metricsAt(a: Float32Array, b: Float32Array, sampleRate: number, offset: number): Record<HybridAbMetricId, number> {
  const attacks = [0, 2, 4, 6].map(value => offset + value)
  const transient = attacks.reduce((sum, seconds) => {
    const start = seconds * sampleRate, end = (seconds + 0.09) * sampleRate, base = rms(a, start, end)
    return sum + clamp01(1 - diffRms(a, b, start, end) / Math.max(1e-6, base))
  }, 0) / attacks.length
  const cvA = coefficientOfVariation(a, sampleRate, offset + 4.25, offset + 5.35), cvB = coefficientOfVariation(b, sampleRate, offset + 4.25, offset + 5.35)
  const continuity = clamp01(0.5 + (cvA - cvB) / Math.max(0.08, cvA + cvB))
  const softA = rms(a, (offset + 0.18) * sampleRate, (offset + 0.72) * sampleRate), loudA = rms(a, (offset + 2.18) * sampleRate, (offset + 2.72) * sampleRate)
  const softB = rms(b, (offset + 0.18) * sampleRate, (offset + 0.72) * sampleRate), loudB = rms(b, (offset + 2.18) * sampleRate, (offset + 2.72) * sampleRate)
  const contrastA = 20 * Math.log10(Math.max(1e-6, loudA) / Math.max(1e-6, softA)), contrastB = 20 * Math.log10(Math.max(1e-6, loudB) / Math.max(1e-6, softB))
  const dynamic = clamp01(1 - Math.abs(contrastB - contrastA) / Math.max(6, Math.abs(contrastA)))
  const centroidA = spectralCentroid(a, sampleRate, offset + 4.8), centroidB = spectralCentroid(b, sampleRate, offset + 4.8)
  const spectral = clamp01(Math.abs(centroidB - centroidA) / Math.max(1, centroidA))
  const active = rms(a, (offset + 4.2) * sampleRate, (offset + 5.4) * sampleRate), tailA = rms(a, (offset + 7.0) * sampleRate, (offset + 7.75) * sampleRate), tailB = rms(b, (offset + 7.0) * sampleRate, (offset + 7.75) * sampleRate)
  const tail = clamp01(Math.max(0, tailB - tailA) / Math.max(1e-6, active) * 12)
  return { "transient-preservation": transient, "sustain-continuity": continuity, "dynamic-response": dynamic, "spectral-deviation": spectral, "tail-naturalness": tail }
}

export async function runHybridAbCalibration(source: CalibratedHybridSource, signal?: AbortSignal): Promise<HybridAbCalibrationResult> {
  const compiled = compileTloqueScore(probeScore(source))
  if (!compiled.ok || compiled.recipe.version !== 2) throw new Error(`No se pudo compilar probe A/B: ${compiled.ok ? "versión inválida" : compiled.diagnostics.map(item => item.message).join(" · ")}`)
  const recipe = compiled.recipe, moduleId = preferredNativeModuleForInstrument(source.instrumentId)
  if (!moduleId) throw new Error(`No existe sample base para ${source.instrumentId}`)

  const preflight = await preflightNativeSamplePacks(recipe, "/api/audio/sample-packs/modules/native-auto.json", signal)
  const sourceItem = preflight.items.find(item => item.moduleId === moduleId)
  if (!preflight.ready || sourceItem?.status !== "ready") {
    throw new Error(`Calibración A/B cancelada: el banco real ${moduleId} no está listo. No se usará síntesis fallback.`)
  }

  const sampled = await renderTloqueScoreWithNativeSamplePackToWav(recipe, "/api/audio/sample-packs/modules/native-auto.json", { quality: "studio", signal, hybridMode: "none" })
  if (signal?.aborted) throw new DOMException("Calibración cancelada", "AbortError")
  const hybrid = await renderTloqueScoreWithNativeSamplePackToWav(recipe, "/api/audio/sample-packs/modules/native-auto.json", { quality: "studio", signal, hybridMode: "quality", ...(source.calibrationTuning ? { hybridCalibrationSource: source } : {}) })
  if (signal?.aborted) throw new DOMException("Calibración cancelada", "AbortError")

  // Metrics compare two complete production renders. Both have the same sample path,
  // stage, room and mastering; hybridMode is the only deliberate variable.
  const decoderA = new OfflineAudioContext(2, 1, 48_000)
  const decoderB = new OfflineAudioContext(2, 1, 48_000)
  const sampledBuffer = await decoderA.decodeAudioData(await sampled.arrayBuffer())
  const hybridBuffer = await decoderB.decodeAudioData(await hybrid.arrayBuffer())
  const a = mono(sampledBuffer), b = mono(hybridBuffer), sampleRate = sampledBuffer.sampleRate
  const cellValues: HybridAbCellValues[] = []
  let index = 0
  for (const register of REGISTERS) for (const gesture of GESTURES) {
    const profile = gestureProfile(source, gesture)
    cellValues.push({ register, gesture, gestureLabel: profile.label, midi: registerMidi(source, register), values: metricsAt(a, b, sampleRate, index * CELL_SECONDS) })
    index += 1
  }
  return { report: buildHybridAbReport(source, moduleId, cellValues), sampled, hybrid }
}
