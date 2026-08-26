import type { TloqueArticulation } from "./instrument-manifest"

export const TLOQUE_SAMPLE_PACK_VERSION = 1 as const

export type TloqueMute = "none" | "straight" | "harmon" | "mute"
export type TloqueVibratoColour = "none" | "vibrato" | "expression"
export type TloqueSampleTrigger = "attack" | "release" | "legato-transition"
export type TloqueMicPosition = "default" | "close" | "main" | "room" | "far"

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
  /** SFZ amplitude-envelope attack preserved from the curated source. */
  amplitudeAttackSeconds?: number
  /** SFZ amplitude-envelope release preserved from the curated source. */
  amplitudeReleaseSeconds?: number
  /** Whether the source explicitly requests velocity-driven amplitude dynamics. */
  amplitudeDynamic?: boolean
  /** Backwards-compatible marker; true for any explicitly vibrato-coloured recording. */
  vibrato?: boolean
  /** Physical vibrato colour recorded upstream. */
  vibratoColour?: TloqueVibratoColour
  /** Physical mute colour recorded upstream; never synthesized from filtering. */
  mute?: TloqueMute
  /** Physical event represented by this WAV. Defaults to the historical attack sample. */
  trigger?: TloqueSampleTrigger
  /** Microphone perspective physically recorded in this WAV. */
  micPosition?: TloqueMicPosition
  /** Exact true-legato transition endpoints; both are mandatory for transition zones. */
  transitionFromMidi?: number
  transitionToMidi?: number
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
  /** Available physical microphone perspectives. Omitted legacy packs behave as [default]. */
  micPositions?: readonly TloqueMicPosition[]
  defaultMicPosition?: TloqueMicPosition
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
  const triggers = new Set<TloqueSampleTrigger>(["attack", "release", "legato-transition"])
  const microphones = new Set<TloqueMicPosition>(["default", "close", "main", "room", "far"])
  const declaredMicPositions = pack.micPositions === undefined
    ? ["default"] as TloqueMicPosition[]
    : Array.isArray(pack.micPositions) && pack.micPositions.length
      ? [...new Set(pack.micPositions.map(item => {
          if (typeof item !== "string" || !microphones.has(item as TloqueMicPosition)) throw new Error("Posición de micrófono inválida")
          return item as TloqueMicPosition
        }))]
      : (() => { throw new Error("micPositions debe contener al menos una posición") })()
  const defaultMicPosition = pack.defaultMicPosition === undefined ? declaredMicPositions[0] : pack.defaultMicPosition
  if (typeof defaultMicPosition !== "string" || !microphones.has(defaultMicPosition as TloqueMicPosition) || !declaredMicPositions.includes(defaultMicPosition as TloqueMicPosition)) throw new Error("Micrófono predeterminado inválido")

  const zones: TloqueSampleZone[] = pack.zones.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Zona ${index} inválida`)
    const zone = raw as Record<string, unknown>
    if (typeof zone.id !== "string" || !zone.id) throw new Error(`Zona ${index} sin id`)
    if (typeof zone.articulation !== "string" || !articulations.has(zone.articulation)) throw new Error(`Zona ${index}: articulación inválida`)
    if (typeof zone.sampleUrl !== "string" || !zone.sampleUrl.startsWith("/api/audio/sample-packs/")) throw new Error(`Zona ${index}: URL de muestra fuera del almacenamiento interno`)
    for (const key of ["rootMidi", "loMidi", "hiMidi", "loVelocity", "hiVelocity", "velocityLayer", "roundRobin", "gainDb", "tuneCents"] as const) {
      if (!finite(zone[key])) throw new Error(`Zona ${index}: ${key} inválido`)
    }
    if (zone.amplitudeAttackSeconds !== undefined && (!finite(zone.amplitudeAttackSeconds) || zone.amplitudeAttackSeconds < 0 || zone.amplitudeAttackSeconds > 30)) throw new Error(`Zona ${index}: amplitudeAttackSeconds inválido`)
    if (zone.amplitudeReleaseSeconds !== undefined && (!finite(zone.amplitudeReleaseSeconds) || zone.amplitudeReleaseSeconds < 0 || zone.amplitudeReleaseSeconds > 30)) throw new Error(`Zona ${index}: amplitudeReleaseSeconds inválido`)
    if (zone.amplitudeDynamic !== undefined && typeof zone.amplitudeDynamic !== "boolean") throw new Error(`Zona ${index}: amplitudeDynamic inválido`)
    const mute = zone.mute === undefined ? "none" : zone.mute
    if (typeof mute !== "string" || !mutes.has(mute as TloqueMute)) throw new Error(`Zona ${index}: mute inválido`)
    if (zone.vibrato !== undefined && typeof zone.vibrato !== "boolean") throw new Error(`Zona ${index}: vibrato inválido`)
    const vibratoColour = zone.vibratoColour === undefined ? (zone.vibrato === true ? "vibrato" : "none") : zone.vibratoColour
    if (typeof vibratoColour !== "string" || !vibratoColours.has(vibratoColour as TloqueVibratoColour)) throw new Error(`Zona ${index}: color de vibrato inválido`)
    const trigger = zone.trigger === undefined ? "attack" : zone.trigger
    if (typeof trigger !== "string" || !triggers.has(trigger as TloqueSampleTrigger)) throw new Error(`Zona ${index}: trigger inválido`)
    const micPosition = zone.micPosition === undefined ? defaultMicPosition : zone.micPosition
    if (typeof micPosition !== "string" || !microphones.has(micPosition as TloqueMicPosition) || !declaredMicPositions.includes(micPosition as TloqueMicPosition)) throw new Error(`Zona ${index}: micrófono no declarado`)
    if (zone.transitionFromMidi !== undefined && (!finite(zone.transitionFromMidi) || zone.transitionFromMidi < 0 || zone.transitionFromMidi > 127)) throw new Error(`Zona ${index}: transitionFromMidi inválido`)
    if (zone.transitionToMidi !== undefined && (!finite(zone.transitionToMidi) || zone.transitionToMidi < 0 || zone.transitionToMidi > 127)) throw new Error(`Zona ${index}: transitionToMidi inválido`)
    if (trigger !== "legato-transition" && (zone.transitionFromMidi !== undefined || zone.transitionToMidi !== undefined)) throw new Error(`Zona ${index}: transición declarada fuera de true legato`)
    if (trigger === "legato-transition" && (!finite(zone.transitionFromMidi) || !finite(zone.transitionToMidi))) throw new Error(`Zona ${index}: true legato requiere transitionFromMidi y transitionToMidi exactos`)
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
      amplitudeAttackSeconds: finite(zone.amplitudeAttackSeconds) ? zone.amplitudeAttackSeconds : undefined,
      amplitudeReleaseSeconds: finite(zone.amplitudeReleaseSeconds) ? zone.amplitudeReleaseSeconds : undefined,
      amplitudeDynamic: typeof zone.amplitudeDynamic === "boolean" ? zone.amplitudeDynamic : undefined,
      vibrato: vibratoColour !== "none",
      vibratoColour: vibratoColour as TloqueVibratoColour,
      mute: mute as TloqueMute,
      trigger: trigger as TloqueSampleTrigger,
      micPosition: micPosition as TloqueMicPosition,
      transitionFromMidi: finite(zone.transitionFromMidi) ? zone.transitionFromMidi : undefined,
      transitionToMidi: finite(zone.transitionToMidi) ? zone.transitionToMidi : undefined,
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
    micPositions: declaredMicPositions,
    defaultMicPosition: defaultMicPosition as TloqueMicPosition,
    zones,
  }
}
