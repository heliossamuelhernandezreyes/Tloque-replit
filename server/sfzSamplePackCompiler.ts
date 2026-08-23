import type { TloqueArticulation } from "../shared/instrument-manifest"

export interface CompiledSfzZone {
  articulation: TloqueArticulation
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

interface GroupState {
  articulation: TloqueArticulation
  defaultPath: string
  seqLength: number
  seqPosition: number
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
  return parts.join("/")
}

function articulationForSwitch(value: string | undefined): TloqueArticulation {
  if (!value) return "normal"
  const midi = /^\d+$/.test(value) ? Number(value) : sfzNoteToMidi(value)
  if (midi === 37) return "tremolo"
  if (midi === 38) return "spiccato"
  if (midi === 39) return "pizzicato"
  return "normal"
}

function opcodes(text: string) {
  const map = new Map<string, string>()
  const cleaned = text.replace(/\/\/.*$/gm, " ")
  const regex = /([A-Za-z_][\w]*)\s*=\s*([^\s<]+)/g
  for (const match of cleaned.matchAll(regex)) map.set(match[1].toLowerCase(), match[2])
  return map
}

/**
 * Parses the deliberately small SFZ subset used by the curated VSCO solo violin.
 * It does not execute macros/includes/scripts and produces inert zone data only.
 */
export function compileCuratedSfzZones(source: string): CompiledSfzZone[] {
  if (source.length > 2_000_000) throw new Error("SFZ demasiado grande")
  if (/^\s*#(?:include|define)/mi.test(source)) throw new Error("El SFZ curado no puede usar preprocesador")

  const chunks = source.split(/(?=<(?:control|group|region)>)/gi)
  let defaultPath = ""
  let group: GroupState = { articulation: "normal", defaultPath: "", seqLength: 1, seqPosition: 1 }
  const rawZones: Omit<CompiledSfzZone, "velocityLayer">[] = []

  for (const chunk of chunks) {
    const type = /^\s*<(control|group|region)>/i.exec(chunk)?.[1]?.toLowerCase()
    if (!type) continue
    const values = opcodes(chunk)
    if (type === "control") {
      const path = values.get("default_path")
      if (path) defaultPath = normalizeRelativePath(path)
      continue
    }
    if (type === "group") {
      group = {
        articulation: articulationForSwitch(values.get("sw_last")),
        defaultPath,
        seqLength: Math.max(1, Number(values.get("seq_length") || 1)),
        seqPosition: Math.max(1, Number(values.get("seq_position") || 1)),
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
    rawZones.push({
      articulation: group.articulation,
      samplePath,
      rootMidi,
      loMidi,
      hiMidi,
      loVelocity,
      hiVelocity,
      roundRobin: Math.max(0, group.seqLength > 1 ? group.seqPosition - 1 : 0),
      gainDb: Number(values.get("volume") || 0),
      tuneCents: Number(values.get("tune") || 0),
    })
  }

  if (!rawZones.length) throw new Error("El SFZ no produjo zonas")
  const velocityBands = new Map<string, { lo: number; hi: number }[]>()
  for (const zone of rawZones) {
    const key = zone.articulation
    const bands = velocityBands.get(key) ?? []
    if (!bands.some(item => item.lo === zone.loVelocity && item.hi === zone.hiVelocity)) {
      bands.push({ lo: zone.loVelocity, hi: zone.hiVelocity })
      bands.sort((a, b) => a.lo - b.lo)
      velocityBands.set(key, bands)
    }
  }

  return rawZones.map(zone => ({
    ...zone,
    velocityLayer: Math.max(0, (velocityBands.get(zone.articulation) ?? []).findIndex(item => item.lo === zone.loVelocity && item.hi === zone.hiVelocity)),
  }))
}
