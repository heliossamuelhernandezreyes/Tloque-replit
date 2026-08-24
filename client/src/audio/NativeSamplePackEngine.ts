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

function dbToGain(db: number) { return 10 ** (db / 20) }
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
  // True sampled legato is a physical previous-note -> destination-note recording.
  // Never accept an unqualified/generic transition when the score requests an exact pair.
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

  const by = (targetArticulation: TloqueArticulation, allowEdgeTranspose: boolean) => pack.zones.filter(zone => {
    const colour = zoneTimbre(zone)
    const noteMatches = zoneContainsNote(zone, note)
      || (allowEdgeTranspose
        && requestedTrigger === "attack"
        && noteDistanceToZone(zone, note) <= MAX_EDGE_TRANSPOSE_SEMITONES)
    return noteMatches
      && zoneMatchesVelocity(zone, midiVelocity)
      && zone.articulation === targetArticulation
      && colour.vibratoColour === requestedVibrato
      && colour.mute === requestedMute
      && (zone.trigger ?? "attack") === requestedTrigger
      && (zone.micPosition ?? pack.defaultMicPosition ?? "default") === requestedMic
      && transitionMatches(zone, timbre)
  })

  // First preserve the physical mapping declared by the source pack. Sparse public
  // sample libraries sometimes end a mapped zone a few semitones before the playable
  // range. For attack samples only, a bounded edge transposition is preferable to
  // rejecting a valid orchestral note; true-legato, release, timbre, mute and mic
  // semantics remain strict.
  const exact = by(articulation, false)
  const neutralAttack = articulation === "normal" || requestedTrigger !== "attack" ? [] : by("normal", false)
  let candidates = exact.length ? exact : neutralAttack
  if (!candidates.length && requestedTrigger === "attack") {
    const edgeExact = by(articulation, true)
    const edgeNeutral = articulation === "normal" ? [] : by("normal", true)
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
    const bestRangeDistance = noteDistanceToZone(best, note)
    const candidateRangeDistance = noteDistanceToZone(candidate, note)
    if (candidateRangeDistance !== bestRangeDistance) return candidateRangeDistance < bestRangeDistance ? candidate : best
    return Math.abs(note - candidate.rootMidi) < Math.abs(note - best.rootMidi) ? candidate : best
  })
  const semitones = note - zone.rootMidi + zone.tuneCents / 100
  return { zone, playbackRate: 2 ** (semitones / 12), gain: dbToGain(zone.gainDb) * Math.max(0, Math.min(1, midiVelocity / 127)) }
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
    const stopAt = startAt + Math.max(0.01, durationSeconds)
    const fadeIn = Math.max(0, Math.min(durationSeconds * 0.75, envelope.fadeInSeconds ?? 0))
    const fadeOut = Math.max(0, Math.min(durationSeconds * 0.75, envelope.fadeOutSeconds ?? 0))
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, startAt)
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
