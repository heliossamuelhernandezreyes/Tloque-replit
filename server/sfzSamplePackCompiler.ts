import type { TloqueArticulation } from "../shared/instrument-manifest"
import { validateTloqueSamplePack, type TloqueMute, type TloqueSamplePack } from "../shared/native-sample-pack"

export interface CompiledSfzZone {
  articulation: TloqueArticulation
  vibrato: boolean
  mute: TloqueMute
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
  /** Compatibility alias used by the first installer draft. */
  instrument?: string
  license?: string
  /** Compatibility alias used by the first installer draft. */
  sourceLicense?: string
  sourceName: string
  sourceUrl?: string
  sourceCommit?: string
  sampleUrlForPath(path: string): string
  sampleSha256ForPath?(path: string): string | undefined
}

interface GroupState {
  articulation: TloqueArticulation
  vibrato: boolean
  mute: TloqueMute
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

/**
 * Keyswitch pitches are library-local, so never infer an articulation from a
 * fixed MIDI number. Prefer sw_label; for older/lean SFZ patches without it,
 * infer only from semantic path names such as /spic/, /pizz/, /stacc/ or a
 * recorded percussion /rolls/ directory. A roll is exposed as Tloque tremolo
 * because it is the actual sustained repeated-strike recording, not an effect.
 */
function articulationForGroup(label: string | undefined, defaultPath = ""): TloqueArticulation {
  const normalized = `${label || ""} ${defaultPath}`.toLowerCase()
  if (/pizz/.test(normalized)) return "pizzicato"
  if (/spic/.test(normalized)) return "spiccato"
  if (/trem|(?:^|[\s/_-])rolls?(?:$|[\s/_-])/.test(normalized)) return "tremolo"
  if (/stacc?/.test(normalized)) return "staccato"
  if (/harmonic/.test(normalized)) return "harmonic"
  return "normal"
}

/** Recorded colour dimensions stay independent from articulation. */
function timbreForGroup(label: string | undefined, defaultPath = ""): { vibrato: boolean; mute: TloqueMute } {
  const normalized = `${label || ""} ${defaultPath}`.toLowerCase()
  const vibrato = /(?:^|[\s/_-])(?:vib|vibrato)(?:$|[\s/_-])|susvib|expression vibrato/.test(normalized)
  const mute: TloqueMute = /harmonm|harmon[\s/_-]*mute/.test(normalized)
    ? "harmon"
    : /straightm|straight[\s/_-]*mute/.test(normalized)
      ? "straight"
      : /(?:^|[\s/_-])mute(?:$|[\s/_-])/.test(normalized)
        ? "mute"
        : "none"
  return { vibrato, mute }
}

/** SFZ opcodes may contain spaces (notably default_path). Read until the next key=. */
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
  if (groupLabel) return Math.max(0, Number(groupLabel[1]) - 1)
  return 0
}

function rrFromSample(sample: string): number | null {
  const match = sample.match(/(?:^|[_-])rr(\d+)(?=\D|$)/i)
  return match ? Math.max(0, Number(match[1]) - 1) : null
}

export function compileCuratedSfzZones(source: string): CompiledSfzZone[] {
  assertSafeSfz(source)
  const chunks = source.split(/(?=<(?:control|group|region)>)/gi)
  let defaultPath = ""
  let group: GroupState = { articulation: "normal", vibrato: false, mute: "none", defaultPath: "", seqLength: 1, seqPosition: 1, groupRoundRobin: 0 }
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
        vibrato: timbre.vibrato,
        mute: timbre.mute,
        defaultPath,
        seqLength: Math.max(1, Number(values.get("seq_length") || 1)),
        seqPosition: Math.max(1, Number(values.get("seq_position") || 1)),
        groupRoundRobin: rrFromGroup(values),
      }
      continue
    }

    const sample = values.get("sample")
    if (!sample) continue
    const loMidi = Number(values.get("lokey"))
    const hiMidi = Number(values.get("hikey"))
    const rootMidi = Number(values.get("pitch_keycenter"))
    const loVelocity = Number(values.get("lovel") || 0)
    const hiVelocity = Number(values.get("hivel") || 127)
    if (![loMidi, hiMidi, rootMidi, loVelocity, hiVelocity].every(Number.isFinite)) throw new Error("Región SFZ incompleta")
    const samplePath = normalizeRelativePath(`${group.defaultPath}/${sample}`)
    const sampleRoundRobin = rrFromSample(sample)
    rawZones.push({
      articulation: group.articulation,
      vibrato: group.vibrato,
      mute: group.mute,
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
    const key = `${zone.articulation}:${zone.vibrato ? "vib" : "nv"}:${zone.mute}`
    const bands = velocityBands.get(key) ?? []
    if (!bands.some(item => item.lo === zone.loVelocity && item.hi === zone.hiVelocity)) {
      bands.push({ lo: zone.loVelocity, hi: zone.hiVelocity })
      bands.sort((a, b) => a.lo - b.lo)
      velocityBands.set(key, bands)
    }
  }

  return rawZones.map(zone => {
    const key = `${zone.articulation}:${zone.vibrato ? "vib" : "nv"}:${zone.mute}`
    return {
      ...zone,
      velocityLayer: Math.max(0, (velocityBands.get(key) ?? []).findIndex(item => item.lo === zone.loVelocity && item.hi === zone.hiVelocity)),
    }
  })
}

export function samplePathsFromSfz(source: string): string[] {
  return [...new Set(compileCuratedSfzZones(source).map(zone => zone.samplePath))]
}

function packMetadata(options: SfzSamplePackCompileOptions) {
  const manifestId = options.instrumentManifestId || options.id
  const license = options.license || options.sourceLicense
  if (!license) throw new Error("El paquete curado no declara licencia")
  return { manifestId, license }
}

export function compileSfzToTloqueSamplePack(source: string, options: SfzSamplePackCompileOptions): TloqueSamplePack {
  return compileSfzBundleToTloqueSamplePack([source], options)
}

/**
 * Compiles multiple upstream SFZ patches into one inert TloqueSamplePack.
 * Articulation and recorded timbre dimensions are extracted independently;
 * no vibrato or mute is synthesized when the upstream sample is neutral.
 */
export function compileSfzBundleToTloqueSamplePack(sources: readonly string[], options: SfzSamplePackCompileOptions): TloqueSamplePack {
  if (!sources.length) throw new Error("El paquete curado no contiene SFZ")
  const { manifestId, license } = packMetadata(options)
  const zones = sources.flatMap((source, sourceIndex) => compileCuratedSfzZones(source).map((zone, zoneIndex) => ({
    id: `${sourceIndex}:${zoneIndex}:${zone.samplePath}`,
    articulation: zone.articulation,
    vibrato: zone.vibrato,
    mute: zone.mute,
    sampleUrl: options.sampleUrlForPath(zone.samplePath),
    sha256: options.sampleSha256ForPath?.(zone.samplePath),
    rootMidi: zone.rootMidi,
    loMidi: zone.loMidi,
    hiMidi: zone.hiMidi,
    loVelocity: zone.loVelocity,
    hiVelocity: zone.hiVelocity,
    velocityLayer: zone.velocityLayer,
    roundRobin: zone.roundRobin,
    gainDb: zone.gainDb,
    tuneCents: zone.tuneCents,
  })))
  return validateTloqueSamplePack({
    version: 1,
    id: options.id,
    name: options.name,
    instrumentManifestId: manifestId,
    license,
    sourceName: options.sourceName,
    sourceUrl: options.sourceUrl || "",
    sourceCommit: options.sourceCommit,
    zones,
  })
}
