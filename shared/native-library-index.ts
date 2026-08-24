import { CURATED_EXTERNAL_PCM_PACKS } from "./curated-external-pcm-packs"
import { CURATED_SAMPLE_PACKS, type CuratedSamplePackSource } from "./curated-sample-packs"
import { CURATED_RAW_WAV_PACKS } from "./curated-raw-wav-packs"
import { blockedSourcesForInstrument, type NativeBlockedSourceCandidate } from "./native-library-blocked-sources"
import { instrumentManifestById } from "./instrument-manifest"
import { NATIVE_PHYSICAL_MODEL_SOURCES, nativePhysicalModelForInstrument } from "./native-acoustic-source"

export interface NativeLibraryIndexEntry {
  instrumentId: string
  family: "strings" | "woodwinds" | "brass" | "keys" | "guitar" | "percussion" | "voice"
  priority: "core" | "extended" | "specialist"
  moduleId: string | null
  manifestId: string | null
  sourceId: string | null
  sourceKind: "sample-pack" | "physical-model" | null
  masterApproved: boolean
  status: "curated" | "modeled-studio" | "license-blocked" | "missing-source"
  blockedCandidates: readonly NativeBlockedSourceCandidate[]
}

const ALL_CURATED_PACKS: readonly CuratedSamplePackSource[] = [...CURATED_SAMPLE_PACKS, ...CURATED_RAW_WAV_PACKS, ...CURATED_EXTERNAL_PCM_PACKS]
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
  const model = nativePhysicalModelForInstrument(instrumentId)
  const blockedCandidates = blockedSourcesForInstrument(instrumentId)
  const masterApproved = Boolean(pack || model?.masterApproved)
  return {
    instrumentId,
    family,
    priority,
    moduleId: pack?.moduleId ?? model?.moduleId ?? null,
    manifestId: pack?.manifestId ?? model?.moduleId ?? null,
    sourceId: pack?.id ?? model?.modelId ?? null,
    sourceKind: pack ? "sample-pack" : model ? "physical-model" : null,
    masterApproved,
    status: pack || model?.masterApproved ? "curated" : model ? "modeled-studio" : blockedCandidates.length ? "license-blocked" : "missing-source",
    blockedCandidates,
  }
})

export const NATIVE_LIBRARY_MISSING = NATIVE_LIBRARY_INDEX.filter(entry => entry.status === "missing-source" || entry.status === "license-blocked")
export const NATIVE_LIBRARY_LICENSE_BLOCKED = NATIVE_LIBRARY_INDEX.filter(entry => entry.status === "license-blocked")
export const NATIVE_LIBRARY_MODELED_STUDIO = NATIVE_LIBRARY_INDEX.filter(entry => entry.status === "modeled-studio")
export const NATIVE_LIBRARY_MASTER_PENDING = NATIVE_LIBRARY_INDEX.filter(entry => !entry.masterApproved)
export const NATIVE_LIBRARY_CURATED = NATIVE_LIBRARY_INDEX.filter(entry => entry.status === "curated")

/** Static integrity audit shared by sample packs and original Tloque acoustic models. */
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
  for (const model of NATIVE_PHYSICAL_MODEL_SOURCES) {
    if (seenModules.has(model.moduleId)) issues.push(`moduleId acústico duplicado: ${model.moduleId}`)
    seenModules.add(model.moduleId)
    const manifest = instrumentManifestById(model.moduleId)
    if (!manifest) issues.push(`${model.modelId}: falta InstrumentManifest ${model.moduleId}`)
    else if (!manifest.instruments.includes(model.instrumentId)) issues.push(`${model.modelId}: InstrumentManifest no declara ${model.instrumentId}`)
    if (model.midiMin >= model.midiMax) issues.push(`${model.modelId}: registro MIDI inválido`)
  }
  return issues
}
