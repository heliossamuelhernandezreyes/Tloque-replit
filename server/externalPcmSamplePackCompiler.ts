import type { ExternalPcmMappingProfile } from "../shared/curated-external-pcm-packs"
import { sfzNoteToMidi } from "./sfzSamplePackCompiler"

export interface ExternalPcmMappedSample {
  sourcePath: string
  samplePath: string
  rootMidi: number
}

function parseIowaRoot(path: string, prefix: "BassClarinet" | "BassTrombone") {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`(?:^|/)${escaped}\\.ff\\.([A-G](?:b|#)?-?\\d+)\\.stereo\\.aif$`, "i").exec(path)
  return match ? sfzNoteToMidi(match[1]) : null
}
function parseCelestaRoot(path: string) {
  const match = /(?:^|\/)([A-G](?:#)?-?\d+) rr1\.wav$/i.exec(path)
  return match ? sfzNoteToMidi(match[1]) : null
}

function nearestRanges(roots: readonly number[], loBound: number, hiBound: number) {
  const unique = [...new Set(roots)].sort((a, b) => a - b)
  const result = new Map<number, { lo: number; hi: number }>()
  for (let index = 0; index < unique.length; index += 1) {
    const root = unique[index]
    const previous = unique[index - 1]
    const next = unique[index + 1]
    const lo = previous === undefined ? loBound : Math.floor((previous + root) / 2) + 1
    const hi = next === undefined ? hiBound : Math.floor((root + next) / 2)
    result.set(root, { lo: Math.max(loBound, lo), hi: Math.min(hiBound, hi) })
  }
  return result
}

export function compileExternalPcmPathsToSfz(paths: readonly string[], profile: ExternalPcmMappingProfile) {
  const samples: ExternalPcmMappedSample[] = paths.flatMap(path => {
    const sourcePath = path.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!sourcePath || sourcePath.includes("..")) return []
    if (profile === "sampled-celesta-tuned-denoised-mix") {
      const rootMidi = parseCelestaRoot(sourcePath)
      return rootMidi === null ? [] : [{ sourcePath, samplePath: sourcePath, rootMidi }]
    }
    const prefix = profile === "iowa-bass-clarinet-ff" ? "BassClarinet" : "BassTrombone"
    const rootMidi = parseIowaRoot(sourcePath, prefix)
    if (rootMidi === null) return []
    return [{ sourcePath, samplePath: sourcePath.replace(/\.aif$/i, ".wav"), rootMidi }]
  }).sort((a, b) => a.rootMidi - b.rootMidi)

  if (!samples.length) throw new Error(`El perfil ${profile} no encontró muestras compatibles`)
  const uniqueRoots = new Set(samples.map(sample => sample.rootMidi))
  const uniquePaths = new Set(samples.map(sample => sample.samplePath.toLowerCase()))
  if (uniqueRoots.size !== samples.length) throw new Error(`El perfil ${profile} contiene raíces MIDI duplicadas`)
  if (uniquePaths.size !== samples.length) throw new Error(`El perfil ${profile} genera rutas WAV duplicadas`)

  const celesta = profile === "sampled-celesta-tuned-denoised-mix"
  const ranges = celesta ? nearestRanges(samples.map(sample => sample.rootMidi), 60, 108) : null
  const chunks = ["<control> default_path=", "<group> sw_label=normal"]
  for (const sample of samples) {
    const range = ranges?.get(sample.rootMidi) ?? { lo: sample.rootMidi, hi: sample.rootMidi }
    chunks.push(`<region> sample=${sample.samplePath} pitch_keycenter=${sample.rootMidi} lokey=${range.lo} hikey=${range.hi} lovel=0 hivel=127 tloque_mic=default trigger=attack seq_length=1 seq_position=1`)
  }
  return {
    sfzText: chunks.join("\n"),
    samplePaths: samples.map(sample => sample.samplePath),
    sourcePaths: samples.map(sample => sample.sourcePath),
    roots: samples.map(sample => sample.rootMidi),
    samples,
  }
}
