import type { TloqueArticulation } from "@shared/instrument-manifest"
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

export interface NativeSampleSelection { zone: TloqueSampleZone; playbackRate: number; gain: number }
export interface NativeSampleTimbreRequest {
  vibrato?: boolean
  vibratoColour?: TloqueVibratoColour
  mute?: TloqueMute
  trigger?: TloqueSampleTrigger
  micPosition?: TloqueMicPosition
  transitionFromMidi?: number
  transitionToMidi?: number
}
export interface NativeSamplePlaybackEnvelope {
  fadeInSeconds?: number
  fadeOutSeconds?: number
}

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
  return { zone, playbackRate: 2 ** (semitones / 12), gain: dbToGain(zone.gainDb) * velocityAmplitude(zone, midiVelocity) }
}

function adaptivePhraseEnvelope(durationSeconds: number, oneShot: boolean, requested: NativeSamplePlaybackEnvelope) {
  if (oneShot) return { fadeIn: Math.max(0, requested.fadeInSeconds ?? 0), fadeOut: Math.max(0, requested.fadeOutSeconds ?? 0), overlapTail: 0 }
  const sustained = durationSeconds >= 0.22
  const defaultFadeIn = sustained ? Math.min(0.014, durationSeconds * 0.08) : Math.min(0.006, durationSeconds * 0.06)
  const defaultFadeOut = sustained ? Math.min(0.045, durationSeconds * 0.16) : Math.min(0.014, durationSeconds * 0.10)
  const fadeIn = Math.max(0, requested.fadeInSeconds ?? defaultFadeIn)
  const fadeOut = Math.max(0, requested.fadeOutSeconds ?? defaultFadeOut)
  const overlapTail = requested.fadeOutSeconds === undefined ? fadeOut : Math.max(0, requested.fadeOutSeconds)
  return { fadeIn, fadeOut, overlapTail }
}

export class NativeSamplePackPlayer {
  private readonly buffers = new Map<string, Promise<AudioBuffer>>()
  constructor(private readonly context: BaseAudioContext, preloaded?: ReadonlyMap<string, AudioBuffer>) {
    for (const [url, buffer] of preloaded ?? []) this.buffers.set(url, Promise.resolve(buffer))
  }

  async loadPack(url: string): Promise<TloqueSamplePack> {
    if (!url.startsWith("/api/audio/sample-packs/")) throw new Error("Paquete de muestras fuera del almacenamiento interno")
    const response = await fetchAudioResource(url)
    if (!response.ok) throw new Error(`Paquete de muestras ${response.status}`)
    return validateTloqueSamplePack(await response.json())
  }
  preload(zones: readonly TloqueSampleZone[]) { return Promise.all(zones.map(zone => this.buffer(zone))) }

  /** Drop only the player's retained decode reference. Already-created WebAudio
   * sources keep their own AudioBuffer reference, so evicting after last use does
   * not truncate an active voice. */
  evictSampleUrl(sampleUrl: string) { return this.buffers.delete(sampleUrl) }
  clearRetainedSamples() { this.buffers.clear() }
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
    let tail: AudioNode = gain; let panner: StereoPannerNode | null = null
    if (typeof this.context.createStereoPanner === "function") { panner = this.context.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan)); gain.connect(panner); tail = panner }
    tail.connect(destination); source.connect(gain)
    const loopStart = selection.zone.loopStartSeconds, loopEnd = selection.zone.loopEndSeconds
    if (loopStart !== undefined && loopEnd !== undefined && loopEnd > loopStart) { source.loop = true; source.loopStart = loopStart; source.loopEnd = loopEnd }
    const startAt = Math.max(this.context.currentTime, startTime)
    const sourceEnvelope = {
      fadeInSeconds: envelope.fadeInSeconds ?? selection.zone.amplitudeAttackSeconds,
      fadeOutSeconds: envelope.fadeOutSeconds ?? selection.zone.amplitudeReleaseSeconds,
    }
    const shaped = adaptivePhraseEnvelope(durationSeconds, oneShot, sourceEnvelope)
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
    source.addEventListener("ended", () => { source.disconnect(); gain.disconnect(); panner?.disconnect() }, { once: true })
    return source
  }

  private buffer(zone: TloqueSampleZone): Promise<AudioBuffer> {
    const existing = this.buffers.get(zone.sampleUrl); if (existing) return existing
    const promise = fetchAudioResource(zone.sampleUrl).then(response => { if (!response.ok) throw new Error(`Muestra ${response.status}`); return response.arrayBuffer() }).then(bytes => this.context.decodeAudioData(bytes.slice(0)))
    this.buffers.set(zone.sampleUrl, promise); return promise
  }
}
