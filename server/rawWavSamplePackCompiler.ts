import { sfzNoteToMidi } from "./sfzSamplePackCompiler"
import type { CuratedRawWavPackSource } from "../shared/curated-raw-wav-packs"

interface IndexEntry {
  bank?: unknown
  type?: unknown
  url?: unknown
}

interface ParsedRawZone {
  samplePath: string
  rootMidi: number
  velocityLayer: number
  roundRobin: number
  mic: "default" | "close"
}

function parseIndex(text: string, source: CuratedRawWavPackSource): string[] {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error("El índice WAV curado no contiene JSON válido") }
  if (!Array.isArray(value)) throw new Error("El índice WAV curado no contiene una lista")
  const paths = value.flatMap((raw): string[] => {
    if (!raw || typeof raw !== "object") return []
    const entry = raw as IndexEntry
    if (entry.bank !== source.rawWavBank || entry.type !== "audio" || typeof entry.url !== "string") return []
    const path = entry.url.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!path || path.includes("..") || !/\.wav$/i.test(path)) return []
    return [path]
  })
  if (!paths.length) throw new Error(`El índice WAV no contiene el banco ${source.rawWavBank}`)
  return paths
}

function pianoZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap(samplePath => {
    const match = /_JHPiano_Sus_Close_([A-Ga-g](?:#|b)?-?\d+)_vl(\d+)_rr(\d+)\.wav$/i.exec(samplePath)
    if (!match) return []
    const rootMidi = sfzNoteToMidi(match[1])
    const physicalLayer = Number(match[2])
    const velocityLayer = physicalLayer <= 2 ? 0 : physicalLayer === 3 ? 1 : 2
    return [{ samplePath, rootMidi, velocityLayer, roundRobin: Math.max(0, Number(match[3]) - 1), mic: "close" as const }]
  })
}

function organZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap(samplePath => {
    const match = /_Rode_Man3Open_([A-Ga-g](?:#|b)?-?\d+)\.wav$/i.exec(samplePath)
    if (!match) return []
    return [{ samplePath, rootMidi: sfzNoteToMidi(match[1]), velocityLayer: 0, roundRobin: 0, mic: "default" as const }]
  })
}

function velocityRange(layer: number, profile: CuratedRawWavPackSource["rawWavProfile"]) {
  if (profile !== "vcsl-grand-piano-sus-close") return { lo: 0, hi: 127 }
  if (layer === 0) return { lo: 0, hi: 50 }
  if (layer === 1) return { lo: 51, hi: 94 }
  return { lo: 95, hi: 127 }
}

function rangesForRoots(roots: readonly number[]) {
  const unique = [...new Set(roots)].sort((a, b) => a - b)
  const map = new Map<number, { lo: number; hi: number }>()
  for (let i = 0; i < unique.length; i++) {
    const root = unique[i]
    const previous = unique[i - 1]
    const next = unique[i + 1]
    const lo = previous === undefined ? 0 : Math.floor((previous + root) / 2) + 1
    const hi = next === undefined ? 127 : Math.floor((root + next) / 2)
    map.set(root, { lo: Math.max(0, lo), hi: Math.min(127, hi) })
  }
  return map
}

export function compileRawWavIndexToSfz(indexText: string, source: CuratedRawWavPackSource) {
  const paths = parseIndex(indexText, source)
  const zones = source.rawWavProfile === "vcsl-grand-piano-sus-close" ? pianoZones(paths) : organZones(paths)
  if (!zones.length) throw new Error(`El perfil ${source.rawWavProfile} no encontró WAV compatibles`)
  const rootRanges = rangesForRoots(zones.map(zone => zone.rootMidi))
  const selectedPaths = [...new Set(zones.map(zone => zone.samplePath))]
  const groups = new Map<string, ParsedRawZone[]>()
  for (const zone of zones) {
    const key = `${zone.velocityLayer}:${zone.mic}`
    const list = groups.get(key) ?? []
    list.push(zone)
    groups.set(key, list)
  }

  const chunks: string[] = ["<control> default_path="]
  for (const [key, groupZones] of groups) {
    const [layerText, mic] = key.split(":")
    const layer = Number(layerText)
    const velocity = velocityRange(layer, source.rawWavProfile)
    chunks.push(`<group> sw_label=normal tloque_mic=${mic}`)
    for (const zone of groupZones.sort((a, b) => a.rootMidi - b.rootMidi)) {
      const range = rootRanges.get(zone.rootMidi)!
      chunks.push(`<region> sample=${zone.samplePath} pitch_keycenter=${zone.rootMidi} lokey=${range.lo} hikey=${range.hi} lovel=${velocity.lo} hivel=${velocity.hi} seq_length=1 seq_position=${zone.roundRobin + 1}`)
    }
  }
  return { sfzText: chunks.join("\n"), samplePaths: selectedPaths }
}
