import type { CuratedSamplePackSource } from "./curated-sample-packs"

export type RawWavProfile = "vcsl-grand-piano-sus-close" | "vcsl-pipe-organ-rode-man3-open"

export interface CuratedRawWavPackSource extends CuratedSamplePackSource {
  sourceKind: "raw-wav-index"
  rawWavIndexPath: string
  rawWavBank: string
  rawWavProfile: RawWavProfile
}

const REPOSITORY = "https://github.com/carltesta/vcsl_for_estuary"
const COMMIT = "35ecc3ec55acb0448c86cea70d4e268d257f807b"
const VERSION = "estuary-35ecc3e"
const LICENSE = "CC0-1.0"

function pack(input: {
  id: string
  displayName: string
  instrumentId: string
  manifestId: string
  bank: string
  profile: RawWavProfile
  estimatedMegabytes: number
  tags: readonly string[]
}): CuratedRawWavPackSource {
  const acknowledgement = `VCSL para Estuary se publica bajo CC0-1.0. Tloque instalará únicamente ${input.displayName} desde el commit ${COMMIT}, verificará cada WAV RIFF y lo copiará a App Storage antes de reproducirlo.`
  return {
    id: input.id,
    name: "VCSL for Estuary",
    libraryName: "Versilian Community Sample Library · Estuary",
    displayName: input.displayName,
    instrumentId: input.instrumentId,
    moduleId: input.id,
    manifestId: input.manifestId,
    version: VERSION,
    license: LICENSE,
    repositoryUrl: REPOSITORY,
    pinnedCommit: COMMIT,
    // Compatibility field. Raw-WAV packs use rawWavIndexPath instead of parsing this as SFZ.
    sfzPath: "estuary.json",
    sfzPaths: ["estuary.json"],
    estimatedMegabytes: input.estimatedMegabytes,
    acknowledgement,
    tags: input.tags,
    sourceKind: "raw-wav-index",
    rawWavIndexPath: "estuary.json",
    rawWavBank: input.bank,
    rawWavProfile: input.profile,
    samplePackInstall: {
      moduleId: input.id,
      manifestId: input.manifestId,
      version: VERSION,
      pinnedCommit: COMMIT,
      sfzPath: "estuary.json",
      estimatedMegabytes: input.estimatedMegabytes,
      acknowledgement,
      tags: input.tags,
    },
  }
}

export const VCSL_ESTUARY_GRAND_PIANO_PACK = pack({
  id: "vcsl-estuary-grand-piano",
  displayName: "Grand Piano · sustained close mic",
  instrumentId: "piano.grand",
  manifestId: "vcsl-estuary-grand-piano",
  bank: "grandpiano",
  profile: "vcsl-grand-piano-sus-close",
  estimatedMegabytes: 165,
  tags: ["native-samples", "piano", "grand-piano", "cc0", "velocity-layers", "close-mic", "raw-wav"],
})

export const VCSL_ESTUARY_PIPE_ORGAN_PACK = pack({
  id: "vcsl-estuary-pipe-organ",
  displayName: "Pipe Organ · Rode Man3 Open",
  instrumentId: "keys.pipe-organ",
  manifestId: "vcsl-estuary-pipe-organ",
  bank: "pipeorgan",
  profile: "vcsl-pipe-organ-rode-man3-open",
  estimatedMegabytes: 18,
  tags: ["native-samples", "pipe-organ", "organ", "keys", "cc0", "raw-wav"],
})

export const CURATED_RAW_WAV_PACKS: readonly CuratedRawWavPackSource[] = [
  VCSL_ESTUARY_GRAND_PIANO_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_PACK,
]

export function curatedRawWavPackById(id: string | null | undefined): CuratedRawWavPackSource | null {
  if (!id) return null
  return CURATED_RAW_WAV_PACKS.find(pack => pack.id === id) ?? null
}

export function isCuratedRawWavPackSource(source: CuratedSamplePackSource): source is CuratedRawWavPackSource {
  return (source as Partial<CuratedRawWavPackSource>).sourceKind === "raw-wav-index"
}
