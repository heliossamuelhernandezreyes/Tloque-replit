import type { TloqueArticulation } from "@shared/instrument-manifest"
import type { IntelligentPerformanceGesture } from "@shared/intelligent-performance"
import type { OrchestraConductorGesture } from "@shared/orchestra-conductor"
import {
  validateTloqueSamplePack,
  type TloqueMicPosition,
  type TloqueMute,
  type TloqueSamplePack,
  type TloqueSampleTrigger,
  type TloqueSampleZone,
  type TloqueVibratoColour,
} from "@shared/native-sample-pack"
import { fetchAudioResource } from "./AudioResourceCache"
import { orchestralExpressionCurve, type OrchestralNoteExpression } from "./OrchestralExpression"
import { orchestralDynamicCutoffCurve, type OrchestralContinuousDynamics } from "./OrchestralDynamics"

export interface NativeSampleSelection { zone: TloqueSampleZone; playbackRate: number; gain: number }
export interface NativeSampleTimbreRequest {
  vibrato?: boolean
  vibratoColour?: TloqueVibratoColour
  mute?: TloqueMute
  trigger?: TloqueSampleTrigger
  micPosition?: TloqueMicPosition
  transitionFromMidi?: number
  transitionToMidi?: number
  /** Select one recorded colour with midiVelocity while retaining the authored
   * amplitude response. This prevents expression-aware layer choice from being
   * counted twice in the gain stage. */
  amplitudeVelocity?: number
}
export interface NativeSamplePlaybackEnvelope {
  fadeInSeconds?: number
  fadeOutSeconds?: number
  expression?: OrchestralNoteExpression
  dynamics?: OrchestralContinuousDynamics
  performanceGesture?: IntelligentPerformanceGesture
  conductorGesture?: OrchestraConductorGesture
  /** Recorded-layer equal-power weights, independent of expression/amplitude. */
  layerGainCurve?: Float32Array
}

export { NATIVE_SAMPLE_PLAYER_VERSION } from "@shared/native-sample-pack"

const MAX_EDGE_TRANSPOSE_SEMITONES = 4
const NEIGHBOUR_ROOT_WINDOW_SEMITONES = 2

function dbToGain(db: number) { return 10 ** (db / 20) }
function velocityAmplitude(zone: TloqueSampleZone, midiVelocity: number) {
  return zone.amplitudeDynamic === false ? 1 : Math.max(0, Math.min(1, midiVelocity / 127))
}
function zoneMatchesVelocity(zone: TloqueSampleZone, midiVelocity: number) {
  return midiVelocity >= zone.loVelocity && midiVelocity <= zone.hiVelocity
}
function zoneContainsNote(zone: TloqueSampleZone, note: number) {
  return note >= zone.loMidi && note <= zone.hiMidi
}
function noteDistanceToZone(zone: TloqueSampleZone, note: number) {
  if (zoneContainsNote(zone, note)) return 0
  return note < zone.loMidi ? zone.loMidi - note : note - zone.hiMidi
}
function zoneTimbre(zone: TloqueSampleZone) {
  return {
    vibratoColour: zone.vibratoColour ?? (zone.vibrato === true ? "vibrato" : "none") as TloqueVibratoColour,
    mute: zone.mute ?? "none" as TloqueMute,
  }
}
function transitionMatches(zone: TloqueSampleZone, request: NativeSampleTimbreRequest) {
  if ((request.trigger ?? "attack") !== "legato-transition") return true
  if (request.transitionFromMidi !== undefined && zone.transitionFromMidi !== request.transitionFromMidi) return false
  if (request.transitionToMidi !== undefined && zone.transitionToMidi !== request.transitionToMidi) return false
  return true
}

export function selectNativeSampleZone(
  pack: TloqueSamplePack,
  articulation: TloqueArticulation,
  note: number,
  midiVelocity: number,
  roundRobin: number,
  timbre: NativeSampleTimbreRequest = {},
): NativeSampleSelection | null {
  const requestedVibrato = timbre.vibratoColour ?? (timbre.vibrato === true ? "vibrato" : "none")
  const requestedMute = timbre.mute ?? "none"
  const requestedTrigger = timbre.trigger ?? "attack"
  const requestedMic = timbre.micPosition ?? pack.defaultMicPosition ?? pack.micPositions?.[0] ?? "default"

  const by = (targetArticulation: TloqueArticulation, maxOutsideRange: number) => pack.zones.filter(zone => {
    const colour = zoneTimbre(zone)
    const noteMatches = zoneContainsNote(zone, note)
      || (requestedTrigger === "attack" && noteDistanceToZone(zone, note) <= maxOutsideRange)
    return noteMatches
      && zoneMatchesVelocity(zone, midiVelocity)
      && zone.articulation === targetArticulation
      && colour.vibratoColour === requestedVibrato
      && colour.mute === requestedMute
      && (zone.trigger ?? "attack") === requestedTrigger
      && (zone.micPosition ?? pack.defaultMicPosition ?? "default") === requestedMic
      && transitionMatches(zone, timbre)
  })

  const exact = by(articulation, requestedTrigger === "attack" ? NEIGHBOUR_ROOT_WINDOW_SEMITONES : 0)
  const neutralAttack = articulation === "normal" || requestedTrigger !== "attack"
    ? []
    : by("normal", NEIGHBOUR_ROOT_WINDOW_SEMITONES)
  let candidates = exact.length ? exact : neutralAttack

  if (!candidates.length && requestedTrigger === "attack") {
    const edgeExact = by(articulation, MAX_EDGE_TRANSPOSE_SEMITONES)
    const edgeNeutral = articulation === "normal" ? [] : by("normal", MAX_EDGE_TRANSPOSE_SEMITONES)
    candidates = edgeExact.length ? edgeExact : edgeNeutral
  }
  if (!candidates.length) return null

  const rrCandidates = candidates.filter(zone => zone.roundRobin === roundRobin)
  const pool = rrCandidates.length ? rrCandidates : candidates
  const zone = pool.reduce((best, candidate) => {
    if (requestedTrigger === "legato-transition") {
      const bestExact = Number(best.transitionFromMidi === timbre.transitionFromMidi) + Number(best.transitionToMidi === timbre.transitionToMidi)
      const candidateExact = Number(candidate.transitionFromMidi === timbre.transitionFromMidi) + Number(candidate.transitionToMidi === timbre.transitionToMidi)
      if (candidateExact !== bestExact) return candidateExact > bestExact ? candidate : best
    }
    const bestPitchShift = Math.abs(note - best.rootMidi + best.tuneCents / 100)
    const candidatePitchShift = Math.abs(note - candidate.rootMidi + candidate.tuneCents / 100)
    if (Math.abs(candidatePitchShift - bestPitchShift) > 1e-9) return candidatePitchShift < bestPitchShift ? candidate : best
    const bestRangeDistance = noteDistanceToZone(best, note)
    const candidateRangeDistance = noteDistanceToZone(candidate, note)
    if (candidateRangeDistance !== bestRangeDistance) return candidateRangeDistance < bestRangeDistance ? candidate : best
    return best
  })
  const semitones = note - zone.rootMidi + zone.tuneCents / 100
  return { zone, playbackRate: 2 ** (semitones / 12), gain: dbToGain(zone.gainDb) * velocityAmplitude(zone, timbre.amplitudeVelocity ?? midiVelocity) }
}

export function nativeSampleAdaptiveEnvelope(
  durationSeconds: number,
  oneShot: boolean,
  requested: NativeSamplePlaybackEnvelope,
  sourceAttackSeconds?: number,
  sourceReleaseSeconds?: number,
) {
  const explicitAttack = requested.fadeInSeconds !== undefined
  const explicitRelease = requested.fadeOutSeconds !== undefined
  if (oneShot) return {
    fadeIn: Math.max(0, requested.fadeInSeconds ?? sourceAttackSeconds ?? 0),
    fadeOut: Math.max(0, requested.fadeOutSeconds ?? sourceReleaseSeconds ?? 0),
    overlapTail: 0,
  }
  const sustained = durationSeconds >= 0.22
  const defaultFadeIn = sustained ? Math.min(0.014, durationSeconds * 0.08) : Math.min(0.006, durationSeconds * 0.06)
  const defaultFadeOut = sustained ? Math.min(0.045, durationSeconds * 0.16) : Math.min(0.014, durationSeconds * 0.10)
  const fadeIn = Math.max(0, (requested.fadeInSeconds ?? sourceAttackSeconds ?? defaultFadeIn)
    * (!explicitAttack
      ? (requested.performanceGesture?.attackTimeScale ?? 1) * (requested.conductorGesture?.attackCohesionScale ?? 1)
      : 1))
  const fadeOut = Math.max(0, (requested.fadeOutSeconds ?? sourceReleaseSeconds ?? defaultFadeOut)
    * (!explicitRelease
      ? (requested.performanceGesture?.releaseTimeScale ?? 1) * (requested.conductorGesture?.releaseCohesionScale ?? 1)
      : 1))
  const overlapTail = explicitRelease ? Math.max(0, requested.fadeOutSeconds ?? 0) : fadeOut
  return { fadeIn, fadeOut, overlapTail }
}

/** Shared by export modules: reserve decoded PCM before invoking the decoder. */
export class NativeDecodeBudget {
  private readonly reservations = new Map<string, number>()
  private bytes = 0
  constructor(private readonly maximum: number) {}
  reserve(url: string, bytes: number) {
    const next = this.bytes - (this.reservations.get(url) ?? 0) + bytes
    if (!Number.isFinite(next) || bytes < 0 || next > this.maximum) throw new Error("Las muestras exceden la memoria segura; reduce instrumentos o exporta por movimientos")
    this.reservations.set(url, bytes); this.bytes = next
  }
  release(url: string) { this.bytes -= this.reservations.get(url) ?? 0; this.reservations.delete(url) }
}

export function estimatedWavDecodeBytes(bytes: ArrayBuffer, targetRate: number): number {
  const view = new DataView(bytes), tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4))
  if (view.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('No se puede presupuestar una muestra sin cabecera WAV válida')
  let channels = 0, rate = 0, block = 0, data = 0
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const size = view.getUint32(offset + 4, true), end = offset + 8 + size
    if (end > view.byteLength) throw new Error('Muestra WAV truncada')
    if (tag(offset) === 'fmt ' && size >= 16) {
      const format = view.getUint16(offset + 8, true)
      if (![1, 3, 65534].includes(format)) throw new Error('Formato WAV no presupuestable')
      channels = view.getUint16(offset + 10, true); rate = view.getUint32(offset + 12, true); block = view.getUint16(offset + 20, true)
    }
    if (tag(offset) === 'data') data += size
    offset = end + size % 2
  }
  if (!channels || channels > 8 || !rate || !block || !data) throw new Error('Cabecera WAV incompleta')
  return Math.ceil(data / block * targetRate / rate + 1) * channels * 4
}

export class NativeSamplePackPlayer {
  private readonly buffers = new Map<string, Promise<AudioBuffer>>()
  constructor(private readonly context: BaseAudioContext, preloaded?: ReadonlyMap<string, AudioBuffer>, private readonly options: {signal?: AbortSignal; budget?: NativeDecodeBudget} = {}) {
    for (const [url, buffer] of preloaded ?? []) this.buffers.set(url, Promise.resolve(buffer))
  }

  async loadPack(url: string): Promise<TloqueSamplePack> {
    if (!url.startsWith("/api/audio/sample-packs/")) throw new Error("Paquete de muestras fuera del almacenamiento interno")
    const response = await fetchAudioResource(url, {signal: this.options.signal})
    if (!response.ok) throw new Error(`Paquete de muestras ${response.status}`)
    return validateTloqueSamplePack(await response.json())
  }
  async preload(zones: readonly TloqueSampleZone[]) {
    if (!this.options.budget) return Promise.all(zones.map(zone => this.buffer(zone)))
    const result: AudioBuffer[] = []
    for (const zone of zones) { this.options.signal?.throwIfAborted(); result.push(await this.buffer(zone)) }
    return result
  }
  /** Safe after the last scheduled source using this URL has already captured its AudioBuffer. */
  releaseSample(sampleUrl: string) { return this.buffers.delete(sampleUrl) }
  get retainedSampleCount() { return this.buffers.size }

  async play(params: {
    pack: TloqueSamplePack
    articulation: TloqueArticulation
    note: number
    velocity: number
    roundRobin: number
    vibrato?: boolean
    vibratoColour?: TloqueVibratoColour
    mute?: TloqueMute
    trigger?: TloqueSampleTrigger
    micPosition?: TloqueMicPosition
    transitionFromMidi?: number
    transitionToMidi?: number
    startTime: number
    durationSeconds: number
    destination: AudioNode
    pan?: number
    oneShot?: boolean
    envelope?: NativeSamplePlaybackEnvelope
  }): Promise<AudioBufferSourceNode | null> {
    const selection = selectNativeSampleZone(params.pack, params.articulation, params.note, params.velocity, params.roundRobin, {
      vibrato: params.vibrato,
      vibratoColour: params.vibratoColour,
      mute: params.mute,
      trigger: params.trigger,
      micPosition: params.micPosition,
      transitionFromMidi: params.transitionFromMidi,
      transitionToMidi: params.transitionToMidi,
    })
    if (!selection) return null
    return this.playSelection(selection, params.startTime, params.durationSeconds, params.destination, params.pan, params.oneShot, params.envelope)
  }

  async playSelection(selection: NativeSampleSelection, startTime: number, durationSeconds: number, destination: AudioNode, pan = 0, oneShot = false, envelope: NativeSamplePlaybackEnvelope = {}): Promise<AudioBufferSourceNode> {
    const buffer = await this.buffer(selection.zone)
    const source = this.context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = selection.playbackRate
    const gain = this.context.createGain()
    const startAt = Math.max(this.context.currentTime, startTime)
    let tail: AudioNode = gain; let panner: StereoPannerNode | null = null; let tone: BiquadFilterNode | null = null
    if (typeof this.context.createStereoPanner === "function") { panner = this.context.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan)); gain.connect(panner); tail = panner }
    const phrasing = this.context.createGain()
    tail.connect(destination); source.connect(phrasing)
    let layerGain: GainNode | null = null
    if (!oneShot && envelope.layerGainCurve) {
      layerGain = this.context.createGain()
      layerGain.gain.setValueCurveAtTime(envelope.layerGainCurve, startAt, Math.max(0.01, durationSeconds))
      phrasing.connect(layerGain)
    }
    const colourInput = layerGain ?? phrasing
    if (!oneShot && envelope.dynamics?.sustained) {
      tone = this.context.createBiquadFilter(); tone.type = "lowpass"; tone.Q.value = 0.24
      tone.frequency.setValueCurveAtTime(orchestralDynamicCutoffCurve(envelope.dynamics, this.context.sampleRate, "recorded"), startAt, Math.max(0.01, durationSeconds))
      colourInput.connect(tone); tone.connect(gain)
    } else colourInput.connect(gain)
    const loopStart = selection.zone.loopStartSeconds, loopEnd = selection.zone.loopEndSeconds
    if (loopStart !== undefined && loopEnd !== undefined && loopEnd > loopStart) { source.loop = true; source.loopStart = loopStart; source.loopEnd = loopEnd }
    if (!oneShot && envelope.expression) {
      const duration = Math.max(0.01, durationSeconds)
      if (envelope.expression.swell > 0 || envelope.expression.interpretation) phrasing.gain.setValueCurveAtTime(orchestralExpressionCurve(envelope.expression, duration, "gain"), startAt, duration)
      if (envelope.expression.vibratoCents > 0) source.detune.setValueCurveAtTime(orchestralExpressionCurve(envelope.expression, duration, "detune"), startAt, duration)
    }
    const shaped = nativeSampleAdaptiveEnvelope(
      durationSeconds,
      oneShot,
      envelope,
      selection.zone.amplitudeAttackSeconds,
      selection.zone.amplitudeReleaseSeconds,
    )
    const stopAt = startAt + Math.max(0.01, durationSeconds + shaped.overlapTail)
    const fadeIn = Math.max(0, Math.min(durationSeconds * 0.75, shaped.fadeIn))
    const fadeOut = Math.max(0, Math.min((durationSeconds + shaped.overlapTail) * 0.95, shaped.fadeOut))
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.linearRampToValueAtTime(selection.gain, startAt + fadeIn)
    } else gain.gain.setValueAtTime(selection.gain, startAt)
    if (fadeOut > 0) {
      const fadeStart = Math.max(startAt + fadeIn, stopAt - fadeOut)
      gain.gain.setValueAtTime(selection.gain, fadeStart)
      gain.gain.linearRampToValueAtTime(0.0001, stopAt)
    }
    source.start(startAt)
    if (!oneShot || source.loop) source.stop(stopAt)
    source.addEventListener("ended", () => { source.disconnect(); phrasing.disconnect(); layerGain?.disconnect(); tone?.disconnect(); gain.disconnect(); panner?.disconnect() }, { once: true })
    return source
  }

  private buffer(zone: TloqueSampleZone): Promise<AudioBuffer> {
    const existing = this.buffers.get(zone.sampleUrl); if (existing) return existing
    let promise: Promise<AudioBuffer>
    promise = fetchAudioResource(zone.sampleUrl, {signal: this.options.signal, expectedSha256: zone.sha256})
      .then(response => { if (!response.ok) throw new Error(`Muestra ${response.status}`); return response.arrayBuffer() })
      .then(async bytes => {
        this.options.signal?.throwIfAborted()
        this.options.budget?.reserve(zone.sampleUrl, estimatedWavDecodeBytes(bytes, this.context.sampleRate))
        const buffer = await this.context.decodeAudioData(bytes.slice(0))
        this.options.signal?.throwIfAborted()
        this.options.budget?.reserve(zone.sampleUrl, buffer.length * buffer.numberOfChannels * 4)
        return buffer
      })
      .catch(error => {
        // A transient fetch/decode failure must not poison this URL forever.
        if (this.buffers.get(zone.sampleUrl) === promise) this.buffers.delete(zone.sampleUrl)
        this.options.budget?.release(zone.sampleUrl)
        throw error
      })
    this.buffers.set(zone.sampleUrl, promise)
    return promise
  }
}
