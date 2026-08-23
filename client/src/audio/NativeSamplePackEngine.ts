import type { TloqueArticulation } from "@shared/instrument-manifest"
import { validateTloqueSamplePack, type TloqueSamplePack, type TloqueSampleZone } from "@shared/native-sample-pack"
import { fetchAudioResource } from "./AudioResourceCache"

export interface NativeSampleSelection {
  zone: TloqueSampleZone
  playbackRate: number
  gain: number
}

function dbToGain(db: number) {
  return 10 ** (db / 20)
}

export function selectNativeSampleZone(
  pack: TloqueSamplePack,
  articulation: TloqueArticulation,
  note: number,
  midiVelocity: number,
  roundRobin: number,
): NativeSampleSelection | null {
  const exact = pack.zones.filter(zone =>
    zone.articulation === articulation
    && note >= zone.loMidi && note <= zone.hiMidi
    && midiVelocity >= zone.loVelocity && midiVelocity <= zone.hiVelocity,
  )
  const normal = articulation === "normal" ? exact : pack.zones.filter(zone =>
    zone.articulation === "normal"
    && note >= zone.loMidi && note <= zone.hiMidi
    && midiVelocity >= zone.loVelocity && midiVelocity <= zone.hiVelocity,
  )
  const candidates = exact.length ? exact : normal
  if (!candidates.length) return null
  const rrCandidates = candidates.filter(zone => zone.roundRobin === roundRobin)
  const pool = rrCandidates.length ? rrCandidates : candidates
  const zone = pool.reduce((best, candidate) => {
    const bestDistance = Math.abs(note - best.rootMidi)
    const distance = Math.abs(note - candidate.rootMidi)
    return distance < bestDistance ? candidate : best
  })
  const semitones = note - zone.rootMidi + zone.tuneCents / 100
  return {
    zone,
    playbackRate: 2 ** (semitones / 12),
    gain: dbToGain(zone.gainDb) * Math.max(0, Math.min(1, midiVelocity / 127)),
  }
}

export class NativeSamplePackPlayer {
  private readonly buffers = new Map<string, Promise<AudioBuffer>>()

  constructor(private readonly context: BaseAudioContext) {}

  async loadPack(url: string): Promise<TloqueSamplePack> {
    if (!url.startsWith("/api/audio/sample-packs/")) throw new Error("Paquete de muestras fuera del almacenamiento interno")
    const response = await fetchAudioResource(url)
    if (!response.ok) throw new Error(`Paquete de muestras ${response.status}`)
    return validateTloqueSamplePack(await response.json())
  }

  preload(zones: readonly TloqueSampleZone[]) {
    return Promise.all(zones.map(zone => this.buffer(zone)))
  }

  async play(params: {
    pack: TloqueSamplePack
    articulation: TloqueArticulation
    note: number
    velocity: number
    roundRobin: number
    startTime: number
    durationSeconds: number
    destination: AudioNode
    pan?: number
  }): Promise<AudioBufferSourceNode | null> {
    const selection = selectNativeSampleZone(params.pack, params.articulation, params.note, params.velocity, params.roundRobin)
    if (!selection) return null
    const buffer = await this.buffer(selection.zone)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = selection.playbackRate

    const gain = this.context.createGain()
    gain.gain.value = selection.gain
    let tail: AudioNode = gain
    let panner: StereoPannerNode | null = null
    if (typeof this.context.createStereoPanner === "function") {
      panner = this.context.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, params.pan ?? 0))
      gain.connect(panner)
      tail = panner
    }
    tail.connect(params.destination)
    source.connect(gain)

    const loopStart = selection.zone.loopStartSeconds
    const loopEnd = selection.zone.loopEndSeconds
    if (loopStart !== undefined && loopEnd !== undefined && loopEnd > loopStart) {
      source.loop = true
      source.loopStart = loopStart
      source.loopEnd = loopEnd
    }

    const startAt = Math.max(this.context.currentTime, params.startTime)
    source.start(startAt)
    source.stop(startAt + Math.max(0.01, params.durationSeconds))
    source.addEventListener("ended", () => {
      source.disconnect()
      gain.disconnect()
      panner?.disconnect()
    }, { once: true })
    return source
  }

  private buffer(zone: TloqueSampleZone): Promise<AudioBuffer> {
    const existing = this.buffers.get(zone.sampleUrl)
    if (existing) return existing
    const promise = fetchAudioResource(zone.sampleUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Muestra ${response.status}`)
        return response.arrayBuffer()
      })
      .then(bytes => this.context.decodeAudioData(bytes.slice(0)))
    this.buffers.set(zone.sampleUrl, promise)
    return promise
  }
}
