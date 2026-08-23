import type { TloqueArticulation } from "../shared/instrument-manifest"
import {
  validateTloqueSamplePack,
  type TloqueMicPosition,
  type TloqueMute,
  type TloqueSamplePack,
  type TloqueSampleTrigger,
  type TloqueVibratoColour,
} from "../shared/native-sample-pack"

export interface CompiledSfzZone {
  articulation: TloqueArticulation
  vibrato: boolean
  vibratoColour: TloqueVibratoColour
  mute: TloqueMute
  trigger: TloqueSampleTrigger
  micPosition: TloqueMicPosition
  transitionFromMidi?: number
  transitionToMidi?: number
  samplePath: string
  rootMidi: number
  loMidi: number
  hiMidi: number
  loVelocity: number
  hiVelocity: number
  roundRobin: number
  velocityLayer: number
  gainDb: number
  tuneCents: number
}

export interface SfzSamplePackCompileOptions {
  id: string
  name: string
  instrumentManifestId?: string
  instrument?: string
  license?: string
  sourceLicense?: string
  sourceName: string
  sourceUrl?: string
  sourceCommit?: string
  micPositions?: readonly TloqueMicPosition[]
  defaultMicPosition?: TloqueMicPosition
  sampleUrlForPath(path: string): string
  sampleSha256ForPath?(path: string): string | undefined
}

interface GroupState {
  articulation: TloqueArticulation
  vibrato: boolean
  vibratoColour: TloqueVibratoColour
  mute: TloqueMute
  trigger: TloqueSampleTrigger
  micPosition: TloqueMicPosition
  defaultPath: string
  seqLength: number
  seqPosition: number
  groupRoundRobin: number
}

const NOTE = /^([a-gA-G])([#b]?)(-?\d+)$/
const PITCH_CLASS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

export function sfzNoteToMidi(value: string): number {
  const match = NOTE.exec(value.trim())
  if (!match) throw new Error(`Nota SFZ inválida: ${value}`)
  let semitone = PITCH_CLASS[match[1].toLowerCase()]
  if (match[2] === "#") semitone += 1
  if (match[2] === "b") semitone -= 1
  return (Number(match[3]) + 1) * 12 + semitone
}

function normalizeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  if (!parts.length || parts.some(part => part === "." || part === "..")) throw new Error("Ruta SFZ insegura")
  const path = parts.join("/")
  if (!/\.wav$/i.test(path)) throw new Error("El paquete curado sólo admite WAV")
  return path
}

function normalizeDefaultPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.some(part => part === "." || part === "..")) throw new Error("Ruta SFZ insegura")
  return parts.join("/")
}

function articulationForGroup(label: string | undefined, defaultPath = ""): TloqueArticulation {
  const normalized = `${label || ""} ${defaultPath}`.toLowerCase()
  if (/pizz/.test(normalized)) return "pizzicato"
  if (/spic/.test(normalized)) return "spiccato"
  if (/trem|(?:^|[\s/_-])rolls?(?:$|[\s/_-])/.test(normalized)) return "tremolo"
  if (/stacc?/.test(normalized)) return "staccato"
  if (/harmonic/.test(normalized)) return "harmonic"
  if (/legato|transition/.test(normalized)) return "legato"
  return "normal"
}

function timbreForGroup(label: string | undefined, defaultPath = ""): { vibratoColour: TloqueVibratoColour; mute: TloqueMute } {
  const normalized = `${label || ""} ${defaultPath}`.toLowerCase()
  const vibratoColour: TloqueVibratoColour = /expression[\s_-]*vibrato|expvib/.test(normalized)
    ? "expression"
    : /non[\s_-]*vibrato|susnv/.test(normalized)
      ? "none"
      : /(?:^|[\s/_-])(?:vib|vibrato)(?:$|[\s/_-])|susvib/.test(normalized)
        ? "vibrato"
        : "none"
  const mute: TloqueMute = /harmonm|harmon[\s/_-]*mute/.test(normalized)
    ? "harmon"
    : /straightm|straight[\s/_-]*mute/.test(normalized)
      ? "straight"
      : /(?:^|[\s/_-])mute(?:$|[\s/_-])/.test(normalized)
        ? "mute"
        : "none"
  return { vibratoColour, mute }
}

function triggerFor(value: string | undefined, fallback: TloqueSampleTrigger = "attack"): TloqueSampleTrigger {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "release" || normalized === "release_key") return "release"
  if (normalized === "legato") return "legato-transition"
  if (!normalized || normalized === "attack" || normalized === "first") return fallback
  return fallback
}
function micPositionFor(value: string | undefined, defaultPath = ""): TloqueMicPosition {
  const normalized = `${value || ""} ${defaultPath}`.toLowerCase()
  if (/(?:^|[\s/_-])close(?:$|[\s/_-])|closemic/.test(normalized)) return "close"
  if (/(?:^|[\s/_-])room(?:$|[\s/_-])|ambient|ambience/.test(normalized)) return "room"
  if (/(?:^|[\s/_-])far(?:$|[\s/_-])|distant/.test(normalized)) return "far"
  if (/(?:^|[\s/_-])main(?:$|[\s/_-])|tree|decca/.test(normalized)) return "main"
  return "default"
}
function optionalMidi(value: string | undefined): number | undefined {
  if (!value) return undefined
  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 127) return numeric
  try { const midi = sfzNoteToMidi(value); return midi >= 0 && midi <= 127 ? midi : undefined } catch { return undefined }
}
function requiredMidi(value: string | undefined, label: string): number {
  const midi = optionalMidi(value)
  if (midi === undefined) throw new Error(`Región SFZ incompleta: ${label}`)
  return midi
}

function opcodes(text: string) {
  const map = new Map<string, string>()
  const cleaned = text.replace(/\/\/.*$/gm, " ")
  const regex = /([A-Za-z_][\w]*)\s*=\s*(.*?)(?=\s+[A-Za-z_][\w]*\s*=|\s*<|$)/gs
  for (const match of cleaned.matchAll(regex)) map.set(match[1].toLowerCase(), match[2].trim())
  return map
}

function assertSafeSfz(source: string) {
  if (source.length > 2_000_000) throw new Error("SFZ demasiado grande")
  if (/^\s*#(?:include|define)/mi.test(source)) throw new Error("El SFZ curado no puede usar preprocesador")
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(source)) throw new Error("El SFZ curado no puede navegar fuera del paquete")
  if (/\b(?:sample|default_path)\s*=\s*(?:https?:|file:|\/)/i.test(source)) throw new Error("El SFZ curado no puede usar rutas externas o absolutas")
}

function rrFromGroup(values: Map<string, string>): number {
  const groupLabel = values.get("group_label")?.match(/(?:^|[_-])(\d+)$/i)
  return groupLabel ? Math.max(0, Number(groupLabel[1]) - 1) : 0
}
function rrFromSample(sample: string): number | null {
  const match = sample.match(/(?:^|[_-])rr(\d+)(?=\D|$)/i)
  return match ? Math.max(0, Number(match[1]) - 1) : null
}

export function compileCuratedSfzZones(source: string): CompiledSfzZone[] {
  assertSafeSfz(source)
  const chunks = source.split(/(?=<(?:control|group|region)>)/gi)
  let defaultPath = ""
  let group: GroupState = { articulation: "normal", vibrato: false, vibratoColour: "none", mute: "none", trigger: "attack", micPosition: "default", defaultPath: "", seqLength: 1, seqPosition: 1, groupRoundRobin: 0 }
  const rawZones: Omit<CompiledSfzZone, "velocityLayer">[] = []

  for (const chunk of chunks) {
    const type = /^\s*<(control|group|region)>/i.exec(chunk)?.[1]?.toLowerCase()
    if (!type) continue
    const values = opcodes(chunk)
    if (type === "control") {
      const path = values.get("default_path")
      if (path) defaultPath = normalizeDefaultPath(path)
      continue
    }
    if (type === "group") {
      const label = values.get("sw_label")
      const timbre = timbreForGroup(label, defaultPath)
      group = {
        articulation: articulationForGroup(label, defaultPath),
        vibrato: timbre.vibratoColour !== "none",
        vibratoColour: timbre.vibratoColour,
        mute: timbre.mute,
        trigger: triggerFor(values.get("trigger"), "attack"),
        micPosition: micPositionFor(values.get("tloque_mic") ?? values.get("mic_position"), defaultPath),
        defaultPath,
        seqLength: Math.max(1, Number(values.get("seq_length") || 1)),
        seqPosition: Math.max(1, Number(values.get("seq_position") || 1)),
        groupRoundRobin: rrFromGroup(values),
      }
      continue
    }

    const sample = values.get("sample")
    if (!sample) continue
    const key = values.get("key")
    const loMidi = key ? requiredMidi(key, "key") : requiredMidi(values.get("lokey"), "lokey")
    const hiMidi = key ? loMidi : requiredMidi(values.get("hikey"), "hikey")
    const rootMidi = values.get("pitch_keycenter") ? requiredMidi(values.get("pitch_keycenter"), "pitch_keycenter") : loMidi
    const loVelocity = Number(values.get("lovel") || 0), hiVelocity = Number(values.get("hivel") || 127)
    if (![loVelocity, hiVelocity].every(Number.isFinite)) throw new Error("Región SFZ incompleta: velocity")
    const samplePath = normalizeRelativePath(`${group.defaultPath}/${sample}`)
    const sampleRoundRobin = rrFromSample(sample)
    const transitionFromMidi = optionalMidi(values.get("tloque_transition_from") ?? values.get("sw_previous"))
    const transitionToMidi = optionalMidi(values.get("tloque_transition_to") ?? values.get("key"))
    const inferredLegato = transitionFromMidi !== undefined && transitionToMidi !== undefined
    const trigger = inferredLegato ? "legato-transition" : triggerFor(values.get("trigger"), group.trigger)
    const micPosition = micPositionFor(values.get("tloque_mic") ?? values.get("mic_position"), group.defaultPath)
    rawZones.push({
      articulation: trigger === "legato-transition" ? "legato" : group.articulation,
      vibrato: group.vibrato,
      vibratoColour: group.vibratoColour,
      mute: group.mute,
      trigger,
      micPosition,
      transitionFromMidi: trigger === "legato-transition" ? transitionFromMidi : undefined,
      transitionToMidi: trigger === "legato-transition" ? transitionToMidi : undefined,
      samplePath,
      rootMidi,
      loMidi,
      hiMidi,
      loVelocity,
      hiVelocity,
      roundRobin: sampleRoundRobin ?? (group.seqLength > 1 ? group.seqPosition - 1 : group.groupRoundRobin),
      gainDb: Number(values.get("volume") || 0),
      tuneCents: Number(values.get("tune") || 0),
    })
  }

  if (!rawZones.length) throw new Error("El SFZ no produjo zonas")
  const velocityBands = new Map<string, { lo: number; hi: number }[]>()
  for (const zone of rawZones) {
    const key = `${zone.articulation}:${zone.vibratoColour}:${zone.mute}:${zone.trigger}:${zone.micPosition}`
    const bands = velocityBands.get(key) ?? []
    if (!bands.some(item => item.lo === zone.loVelocity && item.hi === zone.hiVelocity)) { bands.push({ lo: zone.loVelocity, hi: zone.hiVelocity }); bands.sort((a, b) => a.lo - b.lo); velocityBands.set(key, bands) }
  }
  return rawZones.map(zone => ({ ...zone, velocityLayer: Math.max(0, (velocityBands.get(`${zone.articulation}:${zone.vibratoColour}:${zone.mute}:${zone.trigger}:${zone.micPosition}`) ?? []).findIndex(item => item.lo === zone.loVelocity && item.hi === zone.hiVelocity)) }))
}

export function samplePathsFromSfz(source: string): string[] { return [...new Set(compileCuratedSfzZones(source).map(zone => zone.samplePath))] }
function packMetadata(options: SfzSamplePackCompileOptions) { const manifestId = options.instrumentManifestId || options.id; const license = options.license || options.sourceLicense; if (!license) throw new Error("El paquete curado no declara licencia"); return { manifestId, license } }
export function compileSfzToTloqueSamplePack(source: string, options: SfzSamplePackCompileOptions): TloqueSamplePack { return compileSfzBundleToTloqueSamplePack([source], options) }

export function compileSfzBundleToTloqueSamplePack(sources: readonly string[], options: SfzSamplePackCompileOptions): TloqueSamplePack {
  if (!sources.length) throw new Error("El paquete curado no contiene SFZ")
  const { manifestId, license } = packMetadata(options)
  const zones = sources.flatMap((source, sourceIndex) => compileCuratedSfzZones(source).map((zone, zoneIndex) => ({
    id: `${sourceIndex}:${zoneIndex}:${zone.samplePath}`,
    articulation: zone.articulation,
    vibrato: zone.vibrato,
    vibratoColour: zone.vibratoColour,
    mute: zone.mute,
    trigger: zone.trigger,
    micPosition: zone.micPosition,
    transitionFromMidi: zone.transitionFromMidi,
    transitionToMidi: zone.transitionToMidi,
    sampleUrl: options.sampleUrlForPath(zone.samplePath),
    sha256: options.sampleSha256ForPath?.(zone.samplePath),
    rootMidi: zone.rootMidi, loMidi: zone.loMidi, hiMidi: zone.hiMidi, loVelocity: zone.loVelocity, hiVelocity: zone.hiVelocity,
    velocityLayer: zone.velocityLayer, roundRobin: zone.roundRobin, gainDb: zone.gainDb, tuneCents: zone.tuneCents,
  })))
  const inferredMics = [...new Set(zones.map(zone => zone.micPosition ?? "default"))]
  return validateTloqueSamplePack({
    version: 1, id: options.id, name: options.name, instrumentManifestId: manifestId, license,
    sourceName: options.sourceName, sourceUrl: options.sourceUrl || "", sourceCommit: options.sourceCommit,
    micPositions: options.micPositions ?? inferredMics,
    defaultMicPosition: options.defaultMicPosition ?? (inferredMics.includes("default") ? "default" : inferredMics[0] ?? "default"),
    zones,
  })
}
