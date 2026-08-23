import { linearScoreRecipeFor, type LinearScoreRecipe, type LinearScoreTrack } from "@shared/audio"
import { curatedSamplePackByModuleId } from "@shared/curated-sample-packs"
import {
  TLOQUE_SCORE_AUDIO_PROFILE, articulationDurationFactor, articulationVelocityFactor, midiNoteToFrequency, scoreTrackEnvelope,
  scoreExpressionStateAt, scorePedalReleaseTime, scoreRenderProfile, scoreTrackTimbre, scoreVelocityGain,
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
  studio: { sampleRate: 48_000, bitDepth: 24 as const },
  master: { sampleRate: 96_000, bitDepth: 24 as const },
}

const MAX_EXPORT_BYTES = 750_000_000
const TAIL_SECONDS: Record<ScoreExportQuality, number> = { preview: 2.5, studio: 5, master: 8 }

function defaultQuality(recipe: LinearScoreRecipe): ScoreExportQuality {
  if (recipe.version === 2) return recipe.plan.quality === "core" ? "preview" : recipe.plan.quality
  return "studio"
}

export function estimateScoreExport(value: unknown, requested?: ScoreExportQuality): ScoreExportEstimate {
  const recipe = linearScoreRecipeFor(value)
  const quality = requested ?? defaultQuality(recipe)
  const profile = QUALITY[quality]
  const durationSeconds = ("totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * 60 / recipe.plan.bpm) + TAIL_SECONDS[quality]
  const bytes = 44 + Math.ceil(durationSeconds * profile.sampleRate) * 2 * (profile.bitDepth / 8)
  return { audioProfile: TLOQUE_SCORE_AUDIO_PROFILE, quality, sampleRate: profile.sampleRate, bitDepth: profile.bitDepth, durationSeconds, bytes }
}

function partial(phase: number, multiple: number, frequency: number, sampleRate: number) {
  return frequency * multiple < sampleRate * 0.46 ? Math.sin(phase * multiple) : 0
}

function oscillator(
  synth: LinearScoreTrack["synth"],
  phase: number,
  elapsed: number,
  frequency: number,
  sampleRate: number,
  brightness: number,
  articulation: string,
) {
  const color = 0.42 + Math.max(0, Math.min(1, brightness)) * 1.08
  if (articulation === "harmonic") {
    return Math.sin(phase * 2) * 0.72
      + partial(phase, 4, frequency, sampleRate) * 0.18 * color
      + partial(phase, 6, frequency, sampleRate) * 0.1 * color
  }
  let sample: number
  if (synth === "pad") {
    const motion = 0.96 + Math.sin(elapsed * Math.PI * 0.34) * 0.04
    sample = motion * (
      Math.sin(phase * 0.994) * 0.27
      + Math.sin(phase) * 0.34
      + Math.sin(phase * 1.006) * 0.27
      + partial(phase, 2, frequency, sampleRate) * 0.08 * color
      + partial(phase, 3, frequency, sampleRate) * 0.04 * color
    )
  } else if (synth === "bell") {
    const shimmer = Math.exp(-elapsed * 0.72)
    sample = Math.sin(phase) * 0.44
      + partial(phase, 2.01, frequency, sampleRate) * 0.24 * shimmer * color
      + partial(phase, 3.99, frequency, sampleRate) * 0.2 * shimmer * color
      + partial(phase, 6.02, frequency, sampleRate) * 0.12 * shimmer * color
  } else if (synth === "pluck") {
    const decay = 0.3 + Math.exp(-elapsed * 3.4) * 0.7
    sample = decay * (
      Math.sin(phase) * 0.5
      + partial(phase, 2, frequency, sampleRate) * 0.25 * color
      + partial(phase, 3, frequency, sampleRate) * 0.14 * color
      + partial(phase, 4, frequency, sampleRate) * 0.07 * color
      + partial(phase, 5, frequency, sampleRate) * 0.04 * color
    )
  } else if (synth === "bass") {
    sample = Math.sin(phase) * 0.72
      + partial(phase, 2, frequency, sampleRate) * 0.12 * color
      + partial(phase, 3, frequency, sampleRate) * 0.11 * color
      + partial(phase, 5, frequency, sampleRate) * 0.05 * color
  } else {
    const hammer = Math.exp(-elapsed * 5.2)
    sample = Math.sin(phase) * 0.56
      + partial(phase, 2, frequency, sampleRate) * (0.18 + hammer * 0.08) * color
      + partial(phase, 3, frequency, sampleRate) * 0.1 * color
      + partial(phase, 4.02, frequency, sampleRate) * 0.05 * color
      + partial(phase, 5.98, frequency, sampleRate) * 0.03 * color
  }
  if (articulation === "pizzicato") sample *= 0.2 + Math.exp(-elapsed * 7.5) * 0.8
  if (articulation === "spiccato") sample *= 0.38 + Math.exp(-elapsed * 10) * 0.62
  if (articulation === "tremolo") sample *= 0.42 + Math.abs(Math.sin(elapsed * Math.PI * 15.5)) * 0.58
  return sample
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

function deterministicNoise(index: number, salt: number) {
  let value = (index + Math.imul(salt, 0x9e3779b1)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return (value >>> 0) / 0x1_0000_0000
}

function encodePcm(left: Float32Array, right: Float32Array, bitDepth: 16 | 24, frameStart: number) {
  const bytesPerSample = bitDepth / 8
  const bytes = new Uint8Array(left.length * 2 * bytesPerSample)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let index = 0; index < left.length; index += 1) {
    for (const [channel, raw] of [left[index], right[index]].entries()) {
      const absoluteSample = (frameStart + index) * 2 + channel
      const scale = bitDepth === 16 ? 0x7fff : 0x7fffff
      const dither = (deterministicNoise(absoluteSample, 11) - deterministicNoise(absoluteSample, 29)) / scale
      const sample = Math.max(-1, Math.min(1, raw + dither))
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

export async function encodeAudioBufferToWav(
  audio: AudioBuffer,
  bitDepth: 16 | 24,
  onProgress?: (value: number) => void,
): Promise<Blob> {
  const totalFrames = audio.length
  const bytesPerSample = bitDepth / 8
  const parts: BlobPart[] = [writeHeader(totalFrames * 2 * bytesPerSample, audio.sampleRate, bitDepth)]
  const leftSource = audio.getChannelData(0)
  const rightSource = audio.numberOfChannels > 1 ? audio.getChannelData(1) : leftSource
  const chunkFrames = 65_536
  for (let frameStart = 0; frameStart < totalFrames; frameStart += chunkFrames) {
    const end = Math.min(totalFrames, frameStart + chunkFrames)
    parts.push(encodePcm(leftSource.subarray(frameStart, end), rightSource.subarray(frameStart, end), bitDepth, frameStart))
    onProgress?.(Math.min(1, end / totalFrames))
    await nextFrame()
  }
  return new Blob(parts, { type: "audio/wav" })
}

export async function renderTloqueScoreToWav(value: unknown, options: ScoreExportOptions = {}): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version === 2 && recipe.plan.moduleId !== "builtin" && curatedSamplePackByModuleId(recipe.plan.moduleId)) {
    const { renderTloqueScoreWithNativeSamplePackToWav } = await import("./NativeSampleScoreExporter")
    return renderTloqueScoreWithNativeSamplePackToWav(
      recipe,
      `/api/audio/sample-packs/modules/${encodeURIComponent(recipe.plan.moduleId)}.json`,
      options,
    )
  }
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
    const originalEnd = start + duration
    const end = scorePedalReleaseTime(recipe, event.trackId, originalEnd)
    const expressionStart = scoreExpressionStateAt(recipe, track, start)
    const expressionEnd = scoreExpressionStateAt(recipe, track, end)
    const chordGain = track.gain * timbre.level
      * Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(articulation))
      / Math.sqrt(event.notes.length)
    const angle = (track.pan + 1) * Math.PI / 4
    return event.notes.map(note => ({
      synth: track.synth, frequency: midiNoteToFrequency(note), start,
      end, releaseEnd: end + envelope.release,
      attack: envelope.attack, decay: envelope.decay, sustain: envelope.sustain,
      release: envelope.release, gain: chordGain, articulation,
      expressionStart, expressionEnd,
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
  let dynamicsEnvelope = 0
  let dynamicsGain = 1
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
        const expressionProgress = Math.max(0, Math.min(1, elapsed / Math.max(0.001, voice.end - voice.start)))
        const interpolate = (start: number, end: number) => start + (end - start) * expressionProgress
        const expression = interpolate(voice.expressionStart.expression, voice.expressionEnd.expression)
        const brightness = interpolate(voice.expressionStart.brightness, voice.expressionEnd.brightness)
        const vibrato = interpolate(voice.expressionStart.vibrato, voice.expressionEnd.vibrato)
        const pitchBend = interpolate(voice.expressionStart.pitchBend, voice.expressionEnd.pitchBend)
        const frequency = voice.frequency * 2 ** (pitchBend / 12)
        const vibratoRate = 5.15
        const vibratoDepth = vibrato * 0.3
        const vibratoHz = frequency * (2 ** (vibratoDepth / 12) - 1)
        const phase = Math.PI * 2 * frequency * elapsed + vibratoHz / vibratoRate * Math.sin(Math.PI * 2 * vibratoRate * elapsed)
        const sample = oscillator(voice.synth, phase, elapsed, frequency, sampleRate, brightness, voice.articulation)
          * attackGain * decayGain * releaseGain * voice.gain * expression
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
      const mid = (mixedLeft + mixedRight) * 0.5
      const width = 0.82 + render.stereoWidth * 0.42
      const side = (mixedLeft - mixedRight) * 0.5 * width
      const widenedLeft = mid + side
      const widenedRight = mid - side
      const highPassedLeft = widenedLeft - previousInputLeft + 0.995 * previousOutputLeft
      const highPassedRight = widenedRight - previousInputRight + 0.995 * previousOutputRight
      previousInputLeft = widenedLeft
      previousInputRight = widenedRight
      previousOutputLeft = highPassedLeft
      previousOutputRight = highPassedRight
      const detector = Math.max(Math.abs(highPassedLeft), Math.abs(highPassedRight))
      const envelopeCoefficient = detector > dynamicsEnvelope ? 0.08 : 0.0018
      dynamicsEnvelope += (detector - dynamicsEnvelope) * envelopeCoefficient
      const threshold = 0.58
      const targetGain = dynamicsEnvelope <= threshold
        ? 1
        : (threshold + (dynamicsEnvelope - threshold) / 3.2) / Math.max(threshold, dynamicsEnvelope)
      dynamicsGain += (targetGain - dynamicsGain) * (targetGain < dynamicsGain ? 0.045 : 0.0012)
      const saturationScale = 0.985 / Math.tanh(render.masterDrive)
      left[index] = Math.tanh(highPassedLeft * dynamicsGain * render.masterDrive) * saturationScale
      right[index] = Math.tanh(highPassedRight * dynamicsGain * render.masterDrive) * saturationScale
      delayIndex = (delayIndex + 1) % delayFrames
      earlyIndex = (earlyIndex + 1) % earlyFrames
    }

    parts.push(encodePcm(left, right, bitDepth, frameStart))
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