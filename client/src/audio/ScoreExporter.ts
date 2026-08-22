import { linearScoreRecipeFor, type LinearScoreRecipe, type LinearScoreTrack } from "@shared/audio"
import {
  TLOQUE_SCORE_AUDIO_PROFILE, articulationDurationFactor, midiNoteToFrequency, scoreTrackEnvelope,
  scoreRenderProfile, scoreTrackTimbre, scoreVelocityGain,
} from "./ScoreAudioMath"

export type ScoreExportQuality = "preview" | "studio" | "master"

export interface ScoreExportEstimate {
  audioProfile: typeof TLOQUE_SCORE_AUDIO_PROFILE
  quality: ScoreExportQuality
  sampleRate: number
  bitDepth: 16 | 24
  durationSeconds: number
  bytes: number
}

export interface ScoreExportOptions {
  quality?: ScoreExportQuality
  onProgress?: (value: number) => void
  signal?: AbortSignal
}

const QUALITY = {
  preview: { sampleRate: 32_000, bitDepth: 16 as const },
  studio: { sampleRate: 48_000, bitDepth: 16 as const },
  master: { sampleRate: 48_000, bitDepth: 24 as const },
}

const MAX_EXPORT_BYTES = 750_000_000
const TAIL_SECONDS = 3

function defaultQuality(recipe: LinearScoreRecipe): ScoreExportQuality {
  if (recipe.version === 2) return recipe.plan.quality === "core" ? "preview" : recipe.plan.quality
  return "studio"
}

export function estimateScoreExport(value: unknown, requested?: ScoreExportQuality): ScoreExportEstimate {
  const recipe = linearScoreRecipeFor(value)
  const quality = requested ?? defaultQuality(recipe)
  const profile = QUALITY[quality]
  const durationSeconds = ("totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * 60 / recipe.plan.bpm) + TAIL_SECONDS
  const bytes = 44 + Math.ceil(durationSeconds * profile.sampleRate) * 2 * (profile.bitDepth / 8)
  return { audioProfile: TLOQUE_SCORE_AUDIO_PROFILE, quality, sampleRate: profile.sampleRate, bitDepth: profile.bitDepth, durationSeconds, bytes }
}

function partial(phase: number, multiple: number, frequency: number, sampleRate: number) {
  return frequency * multiple < sampleRate * 0.46 ? Math.sin(phase * multiple) : 0
}

function oscillator(synth: LinearScoreTrack["synth"], phase: number, elapsed: number, frequency: number, sampleRate: number) {
  if (synth === "pad") {
    const motion = 0.96 + Math.sin(elapsed * Math.PI * 0.34) * 0.04
    return motion * (
      Math.sin(phase * 0.994) * 0.27
      + Math.sin(phase) * 0.34
      + Math.sin(phase * 1.006) * 0.27
      + partial(phase, 2, frequency, sampleRate) * 0.08
      + partial(phase, 3, frequency, sampleRate) * 0.04
    )
  }
  if (synth === "bell") {
    const shimmer = Math.exp(-elapsed * 0.72)
    return Math.sin(phase) * 0.44
      + partial(phase, 2.01, frequency, sampleRate) * 0.24 * shimmer
      + partial(phase, 3.99, frequency, sampleRate) * 0.2 * shimmer
      + partial(phase, 6.02, frequency, sampleRate) * 0.12 * shimmer
  }
  if (synth === "pluck") {
    const decay = 0.3 + Math.exp(-elapsed * 3.4) * 0.7
    return decay * (
      Math.sin(phase) * 0.5
      + partial(phase, 2, frequency, sampleRate) * 0.25
      + partial(phase, 3, frequency, sampleRate) * 0.14
      + partial(phase, 4, frequency, sampleRate) * 0.07
      + partial(phase, 5, frequency, sampleRate) * 0.04
    )
  }
  if (synth === "bass") {
    return Math.sin(phase) * 0.72
      + partial(phase, 2, frequency, sampleRate) * 0.12
      + partial(phase, 3, frequency, sampleRate) * 0.11
      + partial(phase, 5, frequency, sampleRate) * 0.05
  }
  const hammer = Math.exp(-elapsed * 5.2)
  return Math.sin(phase) * 0.56
    + partial(phase, 2, frequency, sampleRate) * (0.18 + hammer * 0.08)
    + partial(phase, 3, frequency, sampleRate) * 0.1
    + partial(phase, 4.02, frequency, sampleRate) * 0.05
    + partial(phase, 5.98, frequency, sampleRate) * 0.03
}

function writeHeader(dataBytes: number, sampleRate: number, bitDepth: 16 | 24) {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const write = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  const blockAlign = 2 * bitDepth / 8
  write(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  write(36, "data")
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(header)
}

function encodePcm(left: Float32Array, right: Float32Array, bitDepth: 16 | 24) {
  const bytesPerSample = bitDepth / 8
  const bytes = new Uint8Array(left.length * 2 * bytesPerSample)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let index = 0; index < left.length; index += 1) {
    for (const raw of [left[index], right[index]]) {
      const sample = Math.max(-1, Math.min(1, raw))
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      } else {
        let value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff)
        if (value < 0) value += 0x1000000
        bytes[offset] = value & 0xff
        bytes[offset + 1] = (value >> 8) & 0xff
        bytes[offset + 2] = (value >> 16) & 0xff
        offset += 3
      }
    }
  }
  return bytes
}

function nextFrame() {
  return new Promise<void>(resolve => setTimeout(resolve, 0))
}

export async function renderTloqueScoreToWav(value: unknown, options: ScoreExportOptions = {}): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  const estimate = estimateScoreExport(recipe, options.quality)
  if (estimate.bytes > MAX_EXPORT_BYTES) throw new Error("El WAV superaría 750 MB; exporta la obra por movimientos")
  const { sampleRate, bitDepth } = estimate
  const render = scoreRenderProfile(estimate.quality === "preview" ? "core" : estimate.quality)
  const totalFrames = Math.ceil(estimate.durationSeconds * sampleRate)
  const dataBytes = totalFrames * 2 * (bitDepth / 8)
  const parts: BlobPart[] = [writeHeader(dataBytes, sampleRate, bitDepth)]
  const beatSeconds = 60 / recipe.plan.bpm
  const tracks = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const voices = recipe.plan.events.flatMap(event => {
    const track = tracks.get(event.trackId)
    if (!track) return []
    const envelope = scoreTrackEnvelope(track)
    const timbre = scoreTrackTimbre(track)
    const articulation = "articulation" in event ? event.articulation : "normal"
    const durationFactor = articulationDurationFactor(articulation)
    const start = "timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds
    const duration = ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds) * durationFactor
    const chordGain = track.gain * timbre.level * scoreVelocityGain(event.velocity) / Math.sqrt(event.notes.length)
    const angle = (track.pan + 1) * Math.PI / 4
    return event.notes.map(note => ({
      synth: track.synth, frequency: midiNoteToFrequency(note), start,
      end: start + duration, releaseEnd: start + duration + envelope.release,
      attack: envelope.attack, decay: envelope.decay, sustain: envelope.sustain,
      release: envelope.release, gain: chordGain,
      left: Math.cos(angle), right: Math.sin(angle),
    }))
  })

  const chunkFrames = 65_536
  const delayFrames = Math.max(1, Math.round(sampleRate * 0.089))
  const delayLeft = new Float32Array(delayFrames)
  const delayRight = new Float32Array(delayFrames)
  const earlyFrames = Math.max(1, Math.round(sampleRate * 0.031))
  const earlyLeft = new Float32Array(earlyFrames)
  const earlyRight = new Float32Array(earlyFrames)
  let delayIndex = 0
  let earlyIndex = 0
  let previousInputLeft = 0
  let previousInputRight = 0
  let previousOutputLeft = 0
  let previousOutputRight = 0
  options.onProgress?.(0)

  for (let frameStart = 0; frameStart < totalFrames; frameStart += chunkFrames) {
    if (options.signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError")
    const length = Math.min(chunkFrames, totalFrames - frameStart)
    const left = new Float32Array(length)
    const right = new Float32Array(length)
    const chunkStart = frameStart / sampleRate
    const chunkEnd = (frameStart + length) / sampleRate
    const active = voices.filter(voice => voice.start < chunkEnd && voice.releaseEnd > chunkStart)

    for (const voice of active) {
      const first = Math.max(0, Math.floor((voice.start - chunkStart) * sampleRate))
      const last = Math.min(length, Math.ceil((voice.releaseEnd - chunkStart) * sampleRate))
      for (let index = first; index < last; index += 1) {
        const absolute = (frameStart + index) / sampleRate
        const elapsed = absolute - voice.start
        if (elapsed < 0) continue
        const attackGain = Math.min(1, elapsed / voice.attack)
        const decayElapsed = Math.max(0, elapsed - voice.attack)
        const decayGain = voice.sustain + (1 - voice.sustain) * Math.exp(-decayElapsed / Math.max(0.001, voice.decay))
        const releaseGain = absolute <= voice.end ? 1 : Math.max(0, 1 - (absolute - voice.end) / voice.release)
        const phase = Math.PI * 2 * voice.frequency * elapsed
        const sample = oscillator(voice.synth, phase, elapsed, voice.frequency, sampleRate) * attackGain * decayGain * releaseGain * voice.gain
        left[index] += sample * voice.left
        right[index] += sample * voice.right
      }
    }

    for (let index = 0; index < length; index += 1) {
      const delayedLeft = delayLeft[delayIndex]
      const delayedRight = delayRight[delayIndex]
      const reflectedLeft = earlyLeft[earlyIndex]
      const reflectedRight = earlyRight[earlyIndex]
      earlyLeft[earlyIndex] = left[index] + reflectedRight * 0.16
      earlyRight[earlyIndex] = right[index] + reflectedLeft * 0.16
      delayLeft[delayIndex] = left[index] + delayedRight * 0.31
      delayRight[delayIndex] = right[index] + delayedLeft * 0.31
      const mixedLeft = left[index] + reflectedLeft * 0.09 + delayedLeft * render.reverbWet
      const mixedRight = right[index] + reflectedRight * 0.09 + delayedRight * render.reverbWet
      const highPassedLeft = mixedLeft - previousInputLeft + 0.995 * previousOutputLeft
      const highPassedRight = mixedRight - previousInputRight + 0.995 * previousOutputRight
      previousInputLeft = mixedLeft
      previousInputRight = mixedRight
      previousOutputLeft = highPassedLeft
      previousOutputRight = highPassedRight
      left[index] = Math.tanh(highPassedLeft * render.masterDrive) * 0.96
      right[index] = Math.tanh(highPassedRight * render.masterDrive) * 0.96
      delayIndex = (delayIndex + 1) % delayFrames
      earlyIndex = (earlyIndex + 1) % earlyFrames
    }

    parts.push(encodePcm(left, right, bitDepth))
    options.onProgress?.(Math.min(1, (frameStart + length) / totalFrames))
    await nextFrame()
  }

  return new Blob(parts, { type: "audio/wav" })
}

export function downloadWav(blob: Blob, title: string) {
  const safe = title.trim().replace(/[^a-z0-9áéíóúüñ_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "tloque-score"
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${safe}.wav`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
