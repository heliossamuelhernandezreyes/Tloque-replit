import { compileTloqueScore } from "@shared/audio"
import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { buildHybridAbReport, type HybridAbMetricId } from "@shared/native-hybrid-validation"
import { preferredNativeModuleForInstrument } from "./NativeAutoModule"
import { renderTloqueScoreWithNativeSamplePackToWav } from "./NativeSampleScoreExporter"
import { scheduleBowedStringOverlay } from "./PhysicalBowedStringOverlay"
import { scheduleAirColumnOverlay } from "./PhysicalAirColumnOverlay"

export interface HybridAbCalibrationResult {
  report: ReturnType<typeof buildHybridAbReport>
  sampled: Blob
  hybrid: Blob
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function midiNote(midi: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}
function probeScore(source: NativeHybridSource) {
  const center = Math.max(source.midiMin, Math.min(source.midiMax, Math.round((source.midiMin + source.midiMax) / 2)))
  const upper = Math.min(source.midiMax, center + 2)
  const note = midiNote(center), note2 = midiNote(upper)
  const pedalControls = source.physicalLayer === "sympathetic-resonance"
    ? "control 3:1 pedal=down expression=0.70 brightness=0.58 ramp=0.15\ncontrol 4:3 pedal=up expression=0.48 brightness=0.46 ramp=0.18"
    : "control 3:1 expression=0.78 brightness=0.68 vibrato=0.10 ramp=0.35\ncontrol 4:2 expression=0.42 brightness=0.38 vibrato=0.04 ramp=0.35"
  return `TLOQUE_SCORE 2
title "Hybrid A-B probe ${source.instrumentId}"
tempo 120
meter 4/4
loop false
seed 20260824
humanize 0
quality studio
module native-auto
track probe synth=pad instrument=${source.instrumentId} program=0 role=melody gain=0.32 pan=0 attack=0.025 release=1 expression=0.55 brightness=0.52 vibrato=0.06
section probe form=development bars=4 repeat=1 fade=0 tempo=120 rubato=0
use probe
1:1 ${note} 2 velocity=0.32 articulation=normal
2:1 ${note} 2 velocity=0.84 articulation=normal
${pedalControls}
3:1 ${note} 3 velocity=0.62 articulation=normal
4:1 ${note2} 2 velocity=0.58 articulation=legato
end`
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
  const a = Math.max(0, Math.min(data.length, Math.floor(start))), b = Math.max(a + 1, Math.min(data.length, Math.floor(end)))
  let sum = 0
  for (let i = a; i < b; i += 1) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, b - a))
}
function diffRms(a: Float32Array, b: Float32Array, start: number, end: number) {
  const from = Math.max(0, Math.floor(start)), to = Math.min(a.length, b.length, Math.floor(end)); let sum = 0
  for (let i = from; i < to; i += 1) { const d = b[i] - a[i]; sum += d * d }
  return Math.sqrt(sum / Math.max(1, to - from))
}
function coefficientOfVariation(data: Float32Array, sampleRate: number, startSeconds: number, endSeconds: number) {
  const windows: number[] = [], width = Math.max(32, Math.floor(sampleRate * 0.05))
  for (let at = Math.floor(startSeconds * sampleRate); at + width <= Math.min(data.length, endSeconds * sampleRate); at += width) windows.push(rms(data, at, at + width))
  if (!windows.length) return 1
  const mean = windows.reduce((a, b) => a + b, 0) / windows.length
  const variance = windows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / windows.length
  return Math.sqrt(variance) / Math.max(1e-6, mean)
}
function spectralCentroid(data: Float32Array, sampleRate: number, centerSeconds: number) {
  const n = 512, center = Math.floor(centerSeconds * sampleRate), start = Math.max(0, Math.min(data.length - n, center - n / 2)); let weighted = 0, magnitudeSum = 0
  for (let k = 1; k < n / 2; k += 1) {
    let real = 0, imag = 0
    for (let t = 0; t < n; t += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (n - 1)), x = (data[start + t] ?? 0) * window, phase = (2 * Math.PI * k * t) / n
      real += x * Math.cos(phase); imag -= x * Math.sin(phase)
    }
    const mag = Math.hypot(real, imag), hz = (k * sampleRate) / n
    magnitudeSum += mag; weighted += hz * mag
  }
  return weighted / Math.max(1e-9, magnitudeSum)
}
function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels, frames = buffer.length, bytes = 2, view = new DataView(new ArrayBuffer(44 + frames * channels * bytes))
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, "RIFF"); view.setUint32(4, 36 + frames * channels * bytes, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * bytes, true); view.setUint16(32, channels * bytes, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, frames * channels * bytes, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) { const x = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame])); view.setInt16(offset, x < 0 ? x * 0x8000 : x * 0x7fff, true); offset += 2 }
  return new Blob([view.buffer], { type: "audio/wav" })
}

export async function runHybridAbCalibration(source: NativeHybridSource, signal?: AbortSignal): Promise<HybridAbCalibrationResult> {
  const compiled = compileTloqueScore(probeScore(source))
  if (!compiled.ok || compiled.recipe.version !== 2) throw new Error(`No se pudo compilar probe A/B: ${compiled.ok ? "versión inválida" : compiled.diagnostics.map(item => item.message).join(" · ")}`)
  const recipe = compiled.recipe
  const moduleId = preferredNativeModuleForInstrument(source.instrumentId)
  if (!moduleId) throw new Error(`No existe sample base para ${source.instrumentId}`)
  const sampled = await renderTloqueScoreWithNativeSamplePackToWav(recipe, "/api/audio/sample-packs/modules/native-auto.json", { quality: "studio", signal })
  if (signal?.aborted) throw new DOMException("Calibración cancelada", "AbortError")

  const decoder = new OfflineAudioContext(2, 1, 48_000)
  const sampledBuffer = await decoder.decodeAudioData(await sampled.arrayBuffer())
  const context = new OfflineAudioContext(sampledBuffer.numberOfChannels, sampledBuffer.length, sampledBuffer.sampleRate)
  const base = context.createBufferSource(); base.buffer = sampledBuffer; base.connect(context.destination); base.start(0)
  const overlayBus = context.createGain(); overlayBus.gain.value = 0.32; overlayBus.connect(context.destination)
  const track = recipe.plan.tracks[0], controls = recipe.plan.controls
  if (!track) throw new Error("Probe A/B sin track")
  let previousEnd: number | undefined
  for (const event of recipe.plan.events) {
    const legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
    for (const midi of event.notes) {
      const options = { startAt: 0, event, track, midi, destination: overlayBus, controls, legatoFromPrevious }
      if (source.physicalLayer === "bowed-string-resonator") scheduleBowedStringOverlay(context, source, options)
      else scheduleAirColumnOverlay(context, source, options)
    }
    previousEnd = event.timeSeconds + event.durationSeconds
  }
  const hybridBuffer = await context.startRendering()
  const hybrid = encodeWav(hybridBuffer)

  const a = mono(sampledBuffer), b = mono(hybridBuffer), sr = sampledBuffer.sampleRate
  const attackTimes = recipe.plan.events.map(event => event.timeSeconds)
  const transient = attackTimes.reduce((sum, seconds) => {
    const start = seconds * sr, end = (seconds + 0.09) * sr, baseRms = rms(a, start, end)
    return sum + clamp01(1 - diffRms(a, b, start, end) / Math.max(1e-6, baseRms))
  }, 0) / Math.max(1, attackTimes.length)
  const cvA = coefficientOfVariation(a, sr, 4.25, 5.35), cvB = coefficientOfVariation(b, sr, 4.25, 5.35)
  const continuity = clamp01(0.5 + (cvA - cvB) / Math.max(0.08, cvA + cvB))
  const softA = rms(a, 0.2 * sr, 0.9 * sr), loudA = rms(a, 2.2 * sr, 2.9 * sr), softB = rms(b, 0.2 * sr, 0.9 * sr), loudB = rms(b, 2.2 * sr, 2.9 * sr)
  const contrastA = 20 * Math.log10(Math.max(1e-6, loudA) / Math.max(1e-6, softA)), contrastB = 20 * Math.log10(Math.max(1e-6, loudB) / Math.max(1e-6, softB))
  const dynamic = clamp01(1 - Math.abs(contrastB - contrastA) / Math.max(6, Math.abs(contrastA)))
  const centroidA = spectralCentroid(a, sr, 4.8), centroidB = spectralCentroid(b, sr, 4.8)
  const spectral = clamp01(Math.abs(centroidB - centroidA) / Math.max(1, centroidA))
  const active = rms(a, 4.2 * sr, 5.4 * sr), tailA = rms(a, 7.2 * sr, Math.min(a.length, 8.4 * sr)), tailB = rms(b, 7.2 * sr, Math.min(b.length, 8.4 * sr))
  const tail = clamp01(Math.max(0, tailB - tailA) / Math.max(1e-6, active) * 12)
  const values: Record<HybridAbMetricId, number> = {
    "transient-preservation": transient,
    "sustain-continuity": continuity,
    "dynamic-response": dynamic,
    "spectral-deviation": spectral,
    "tail-naturalness": tail,
  }
  const report = buildHybridAbReport(source, moduleId, values)
  return { report, sampled, hybrid }
}
