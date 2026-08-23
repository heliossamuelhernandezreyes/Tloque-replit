import type { TloqueArticulation } from "./instrument-manifest"

export const TLOQUE_SAMPLE_PACK_VERSION = 1 as const

export type TloqueMute = "none" | "straight" | "harmon" | "mute"
export type TloqueVibratoColour = "none" | "vibrato" | "expression"

export interface TloqueSampleZone {
  id: string
  articulation: TloqueArticulation
  sampleUrl: string
  sha256?: string
  rootMidi: number
  loMidi: number
  hiMidi: number
  loVelocity: number
  hiVelocity: number
  velocityLayer: number
  roundRobin: number
  gainDb: number
  tuneCents: number
  /** Backwards-compatible marker; true for any explicitly vibrato-coloured recording. */
  vibrato?: boolean
  /** Physical vibrato colour recorded upstream. */
  vibratoColour?: TloqueVibratoColour
  /** Physical mute colour recorded upstream; never synthesized from filtering. */
  mute?: TloqueMute
  loopStartSeconds?: number
  loopEndSeconds?: number
}

export interface TloqueSamplePack {
  version: typeof TLOQUE_SAMPLE_PACK_VERSION
  id: string
  name: string
  instrumentManifestId: string
  license: string
  sourceName: string
  sourceUrl: string
  sourceCommit?: string
  zones: readonly TloqueSampleZone[]
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function validateTloqueSamplePack(value: unknown): TloqueSamplePack {
  if (!value || typeof value !== "object") throw new Error("Paquete de muestras inválido")
  const pack = value as Record<string, unknown>
  if (pack.version !== TLOQUE_SAMPLE_PACK_VERSION) throw new Error("Versión de paquete de muestras no soportada")
  if (typeof pack.id !== "string" || !pack.id) throw new Error("El paquete no tiene id")
  if (typeof pack.name !== "string" || !pack.name) throw new Error("El paquete no tiene nombre")
  if (typeof pack.instrumentManifestId !== "string" || !pack.instrumentManifestId) throw new Error("El paquete no declara InstrumentManifest")
  if (typeof pack.license !== "string" || !pack.license) throw new Error("El paquete no declara licencia")
  if (typeof pack.sourceName !== "string" || typeof pack.sourceUrl !== "string") throw new Error("El paquete no declara procedencia")
  if (!Array.isArray(pack.zones) || !pack.zones.length) throw new Error("El paquete no contiene zonas")

  const articulations = new Set(["normal", "legato", "staccato", "tenuto", "accent", "spiccato", "pizzicato", "tremolo", "harmonic"])
  const mutes = new Set<TloqueMute>(["none", "straight", "harmon", "mute"])
  const vibratoColours = new Set<TloqueVibratoColour>(["none", "vibrato", "expression"])
  const zones: TloqueSampleZone[] = pack.zones.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Zona ${index} inválida`)
    const zone = raw as Record<string, unknown>
    if (typeof zone.id !== "string" || !zone.id) throw new Error(`Zona ${index} sin id`)
    if (typeof zone.articulation !== "string" || !articulations.has(zone.articulation)) throw new Error(`Zona ${index}: articulación inválida`)
    if (typeof zone.sampleUrl !== "string" || !zone.sampleUrl.startsWith("/api/audio/sample-packs/")) throw new Error(`Zona ${index}: URL de muestra fuera del almacenamiento interno`)
    for (const key of ["rootMidi", "loMidi", "hiMidi", "loVelocity", "hiVelocity", "velocityLayer", "roundRobin", "gainDb", "tuneCents"] as const) {
      if (!finite(zone[key])) throw new Error(`Zona ${index}: ${key} inválido`)
    }
    const mute = zone.mute === undefined ? "none" : zone.mute
    if (typeof mute !== "string" || !mutes.has(mute as TloqueMute)) throw new Error(`Zona ${index}: mute inválido`)
    if (zone.vibrato !== undefined && typeof zone.vibrato !== "boolean") throw new Error(`Zona ${index}: vibrato inválido`)
    const vibratoColour = zone.vibratoColour === undefined
      ? (zone.vibrato === true ? "vibrato" : "none")
      : zone.vibratoColour
    if (typeof vibratoColour !== "string" || !vibratoColours.has(vibratoColour as TloqueVibratoColour)) throw new Error(`Zona ${index}: color de vibrato inválido`)
    const result: TloqueSampleZone = {
      id: zone.id,
      articulation: zone.articulation as TloqueArticulation,
      sampleUrl: zone.sampleUrl,
      sha256: typeof zone.sha256 === "string" ? zone.sha256 : undefined,
      rootMidi: zone.rootMidi as number,
      loMidi: zone.loMidi as number,
      hiMidi: zone.hiMidi as number,
      loVelocity: zone.loVelocity as number,
      hiVelocity: zone.hiVelocity as number,
      velocityLayer: zone.velocityLayer as number,
      roundRobin: zone.roundRobin as number,
      gainDb: zone.gainDb as number,
      tuneCents: zone.tuneCents as number,
      vibrato: vibratoColour !== "none",
      vibratoColour: vibratoColour as TloqueVibratoColour,
      mute: mute as TloqueMute,
      loopStartSeconds: finite(zone.loopStartSeconds) ? zone.loopStartSeconds : undefined,
      loopEndSeconds: finite(zone.loopEndSeconds) ? zone.loopEndSeconds : undefined,
    }
    if (result.rootMidi < 0 || result.rootMidi > 127 || result.loMidi < 0 || result.hiMidi > 127 || result.loMidi > result.hiMidi) throw new Error(`Zona ${index}: rango MIDI inválido`)
    if (result.loVelocity < 0 || result.hiVelocity > 127 || result.loVelocity > result.hiVelocity) throw new Error(`Zona ${index}: rango de velocidad inválido`)
    return result
  })

  return {
    version: TLOQUE_SAMPLE_PACK_VERSION,
    id: pack.id,
    name: pack.name,
    instrumentManifestId: pack.instrumentManifestId,
    license: pack.license,
    sourceName: pack.sourceName,
    sourceUrl: pack.sourceUrl,
    sourceCommit: typeof pack.sourceCommit === "string" ? pack.sourceCommit : undefined,
    zones,
  }
}
