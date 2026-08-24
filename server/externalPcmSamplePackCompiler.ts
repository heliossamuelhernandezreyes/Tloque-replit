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

function profilePrefix(profile: ExternalPcmMappingProfile) {
  if (profile === "iowa-bass-clarinet-ff") return "BassClarinet" as const
  if (profile === "iowa-bass-trombone-ff") return "BassTrombone" as const
  const neverProfile: never = profile
  throw new Error(`Perfil PCM externo desconocido: ${neverProfile}`)
}

/**
 * Iowa's curated 2014 files are chromatic, so every playable MIDI note maps to
 * its own physical recording. Source AIFF names are converted to logical WAV
 * names before entering the generic SFZ/sample-pack pipeline.
 */
export function compileExternalPcmPathsToSfz(paths: readonly string[], profile: ExternalPcmMappingProfile) {
  const prefix = profilePrefix(profile)
  const samples: ExternalPcmMappedSample[] = paths.flatMap(path => {
    const sourcePath = path.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!sourcePath || sourcePath.includes("..")) return []
    const rootMidi = parseIowaRoot(sourcePath, prefix)
    if (rootMidi === null) return []
    const samplePath = sourcePath.replace(/\.aif$/i, ".wav")
    return [{ sourcePath, samplePath, rootMidi }]
  }).sort((a, b) => a.rootMidi - b.rootMidi)
  if (!samples.length) throw new Error(`El perfil ${profile} no encontró AIFF cromáticos compatibles`)
  const uniqueRoots = new Set(samples.map(sample => sample.rootMidi))
  const uniquePaths = new Set(samples.map(sample => sample.samplePath.toLowerCase()))
  if (uniqueRoots.size !== samples.length) throw new Error(`El perfil ${profile} contiene raíces MIDI duplicadas`)
  if (uniquePaths.size !== samples.length) throw new Error(`El perfil ${profile} genera rutas WAV duplicadas`)

  const chunks = ["<control> default_path=", "<group> sw_label=normal"]
  for (const sample of samples) {
    chunks.push(`<region> sample=${sample.samplePath} pitch_keycenter=${sample.rootMidi} lokey=${sample.rootMidi} hikey=${sample.rootMidi} lovel=0 hivel=127 tloque_mic=default trigger=attack seq_length=1 seq_position=1`)
  }
  return {
    sfzText: chunks.join("\n"),
    samplePaths: samples.map(sample => sample.samplePath),
    sourcePaths: samples.map(sample => sample.sourcePath),
    roots: samples.map(sample => sample.rootMidi),
    samples,
  }
}
