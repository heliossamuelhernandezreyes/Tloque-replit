import { CURATED_SAMPLE_PACKS, type CuratedSamplePackSource } from "./curated-sample-packs"
import { CURATED_RAW_WAV_PACKS } from "./curated-raw-wav-packs"
import { instrumentManifestById } from "./instrument-manifest"

export interface NativeLibraryIndexEntry {
  instrumentId: string
  family: "strings" | "woodwinds" | "brass" | "keys" | "guitar" | "percussion" | "voice"
  priority: "core" | "extended" | "specialist"
  moduleId: string | null
  manifestId: string | null
  sourceId: string | null
  status: "curated" | "missing-source"
}

const ALL_CURATED_PACKS: readonly CuratedSamplePackSource[] = [...CURATED_SAMPLE_PACKS, ...CURATED_RAW_WAV_PACKS]
const packByInstrument = new Map(ALL_CURATED_PACKS.map(pack => [pack.instrumentId, pack]))

const TARGETS = [
  ["strings.violin", "strings", "core"],
  ["strings.violin-section", "strings", "core"],
  ["strings.viola", "strings", "core"],
  ["strings.cello", "strings", "core"],
  ["strings.contrabass", "strings", "core"],
  ["strings.harp", "strings", "extended"],
  ["woodwinds.flute", "woodwinds", "core"],
  ["woodwinds.piccolo", "woodwinds", "extended"],
  ["woodwinds.oboe", "woodwinds", "core"],
  ["woodwinds.english-horn", "woodwinds", "extended"],
  ["woodwinds.clarinet", "woodwinds", "core"],
  ["woodwinds.bass-clarinet", "woodwinds", "extended"],
  ["woodwinds.bassoon", "woodwinds", "core"],
  ["woodwinds.contrabassoon", "woodwinds", "extended"],
  ["woodwinds.ocarina", "woodwinds", "specialist"],
  ["woodwinds.alto-recorder", "woodwinds", "specialist"],
  ["brass.trumpet", "brass", "core"],
  ["brass.horn", "brass", "core"],
  ["brass.trombone", "brass", "core"],
  ["brass.bass-trombone", "brass", "extended"],
  ["brass.tuba", "brass", "core"],
  ["piano.grand", "keys", "core"],
  ["keys.pipe-organ", "keys", "core"],
  ["keys.pipe-organ-soft", "keys", "extended"],
  ["keys.pipe-organ-pedal", "keys", "extended"],
  ["keys.harpsichord", "keys", "extended"],
  ["keys.celesta", "keys", "extended"],
  ["guitar.electric-clean", "guitar", "extended"],
  ["guitar.acoustic", "guitar", "extended"],
  ["percussion.timpani", "percussion", "core"],
  ["percussion.orchestral-kit", "percussion", "core"],
  ["percussion.glockenspiel", "percussion", "extended"],
  ["percussion.marimba", "percussion", "extended"],
  ["percussion.xylophone", "percussion", "extended"],
  ["percussion.tubular-bells", "percussion", "extended"],
  ["voice.legato-a", "voice", "specialist"],
] as const satisfies readonly (readonly [string, NativeLibraryIndexEntry["family"], NativeLibraryIndexEntry["priority"]])[]

export const NATIVE_LIBRARY_INDEX: readonly NativeLibraryIndexEntry[] = TARGETS.map(([instrumentId, family, priority]) => {
  const pack = packByInstrument.get(instrumentId)
  return {
    instrumentId,
    family,
    priority,
    moduleId: pack?.moduleId ?? null,
    manifestId: pack?.manifestId ?? null,
    sourceId: pack?.id ?? null,
    status: pack ? "curated" : "missing-source",
  }
})

export const NATIVE_LIBRARY_MISSING = NATIVE_LIBRARY_INDEX.filter(entry => entry.status === "missing-source")
export const NATIVE_LIBRARY_CURATED = NATIVE_LIBRARY_INDEX.filter(entry => entry.status === "curated")

/**
 * Static integrity audit. Runtime coverage still depends on the installed App Storage
 * manifests, but every curated source must have a matching semantic manifest before
 * it can be considered safe for native-auto routing.
 */
export function nativeLibraryIntegrityIssues(): string[] {
  const issues: string[] = []
  const seenModules = new Set<string>()
  for (const pack of ALL_CURATED_PACKS) {
    if (seenModules.has(pack.moduleId)) issues.push(`moduleId duplicado: ${pack.moduleId}`)
    seenModules.add(pack.moduleId)
    if (pack.moduleId !== pack.manifestId) issues.push(`${pack.id}: moduleId y manifestId divergen`)
    const manifest = instrumentManifestById(pack.manifestId)
    if (!manifest) {
      issues.push(`${pack.id}: falta InstrumentManifest ${pack.manifestId}`)
      continue
    }
    if (!manifest.instruments.includes(pack.instrumentId)) issues.push(`${pack.id}: InstrumentManifest no declara ${pack.instrumentId}`)
  }
  return issues
}
