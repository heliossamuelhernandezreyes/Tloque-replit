import type { ExternalPcmMappingProfile } from "../shared/curated-external-pcm-packs"
import { sfzNoteToMidi } from "./sfzSamplePackCompiler"

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
 * its own physical recording. No midpoint extension or pitch-shift is generated.
 */
export function compileExternalPcmPathsToSfz(paths: readonly string[], profile: ExternalPcmMappingProfile) {
  const prefix = profilePrefix(profile)
  const zones = paths.flatMap(path => {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!normalized || normalized.includes("..")) return []
    const rootMidi = parseIowaRoot(normalized, prefix)
    return rootMidi === null ? [] : [{ path: normalized, rootMidi }]
  }).sort((a, b) => a.rootMidi - b.rootMidi)
  if (!zones.length) throw new Error(`El perfil ${profile} no encontró AIFF cromáticos compatibles`)
  const uniqueRoots = new Set(zones.map(zone => zone.rootMidi))
  if (uniqueRoots.size !== zones.length) throw new Error(`El perfil ${profile} contiene raíces MIDI duplicadas`)

  const chunks = ["<control> default_path=", "<group> sw_label=normal"]
  for (const zone of zones) {
    chunks.push(`<region> sample=${zone.path} pitch_keycenter=${zone.rootMidi} lokey=${zone.rootMidi} hikey=${zone.rootMidi} lovel=0 hivel=127 tloque_mic=default trigger=attack seq_length=1 seq_position=1`)
  }
  return { sfzText: chunks.join("\n"), samplePaths: zones.map(zone => zone.path), roots: zones.map(zone => zone.rootMidi) }
}
