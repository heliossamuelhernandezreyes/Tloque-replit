import type { CuratedSamplePackSource } from "./curated-sample-packs"

export type RawWavProfile = "vcsl-grand-piano-sus-close" | "vcsl-pipe-organ-rode-man3-open" | "vcsl-italian-harpsichord-stop1"

export interface CuratedRawWavPackSource extends CuratedSamplePackSource {
  sourceKind: "raw-wav-index" | "raw-wav-static"
  rawWavIndexPath?: string
  rawWavBank?: string
  rawWavStaticPaths?: readonly string[]
  rawWavProfile: RawWavProfile
}

const ESTUARY_REPOSITORY = "https://github.com/carltesta/vcsl_for_estuary"
const ESTUARY_COMMIT = "35ecc3ec55acb0448c86cea70d4e268d257f807b"
const ESTUARY_VERSION = "estuary-35ecc3e"
const LICENSE = "CC0-1.0"

function indexPack(input: {
  id: string
  displayName: string
  instrumentId: string
  manifestId: string
  bank: string
  profile: RawWavProfile
  estimatedMegabytes: number
  tags: readonly string[]
}): CuratedRawWavPackSource {
  const acknowledgement = `VCSL para Estuary se publica bajo CC0-1.0. Tloque instalará únicamente ${input.displayName} desde el commit ${ESTUARY_COMMIT}, verificará cada WAV RIFF y lo copiará a App Storage antes de reproducirlo.`
  return {
    id: input.id,
    name: "VCSL for Estuary",
    libraryName: "Versilian Community Sample Library · Estuary",
    displayName: input.displayName,
    instrumentId: input.instrumentId,
    moduleId: input.id,
    manifestId: input.manifestId,
    version: ESTUARY_VERSION,
    license: LICENSE,
    repositoryUrl: ESTUARY_REPOSITORY,
    pinnedCommit: ESTUARY_COMMIT,
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
      version: ESTUARY_VERSION,
      pinnedCommit: ESTUARY_COMMIT,
      sfzPath: "estuary.json",
      estimatedMegabytes: input.estimatedMegabytes,
      acknowledgement,
      tags: input.tags,
    },
  }
}

export const VCSL_ESTUARY_GRAND_PIANO_PACK = indexPack({
  id: "vcsl-estuary-grand-piano",
  displayName: "Grand Piano · sustained close mic",
  instrumentId: "piano.grand",
  manifestId: "vcsl-estuary-grand-piano",
  bank: "grandpiano",
  profile: "vcsl-grand-piano-sus-close",
  estimatedMegabytes: 165,
  tags: ["native-samples", "piano", "grand-piano", "cc0", "velocity-layers", "close-mic", "raw-wav"],
})

export const VCSL_ESTUARY_PIPE_ORGAN_PACK = indexPack({
  id: "vcsl-estuary-pipe-organ",
  displayName: "Pipe Organ · Rode Man3 Open",
  instrumentId: "keys.pipe-organ",
  manifestId: "vcsl-estuary-pipe-organ",
  bank: "pipeorgan",
  profile: "vcsl-pipe-organ-rode-man3-open",
  estimatedMegabytes: 18,
  tags: ["native-samples", "pipe-organ", "organ", "keys", "cc0", "raw-wav"],
})

const VCSL_REPOSITORY = "https://github.com/sgossner/VCSL"
const VCSL_COMMIT = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"
const HARPSICHORD_SUSTAIN_NOTES = ["A#0", "A#1", "A#2", "A#3", "A#4", "B0", "B1", "B2", "B3", "B4", "C#1", "C#2", "C#3", "C#4", "D#1", "D#2", "D#3", "D#4", "E1", "E2", "E3", "E4", "F#0", "F#1", "F#2", "F#3", "F#4", "G#0", "G#1", "G#2", "G#3", "G#4"] as const
const HARPSICHORD_RELEASE_NOTES = ["A#0", "A#1", "A#2", "A#3", "B0", "B1", "B2", "B3", "B4", "C#1", "C#2", "C#3", "C#4", "D#1", "D#2", "D#3", "D#4", "E1", "E2", "E3", "E4", "F#0", "F#1", "F#2", "F#3", "F#4", "G#0", "G#1", "G#2", "G#3", "G#4"] as const
const HARPSICHORD_STATIC_PATHS = [
  ...HARPSICHORD_SUSTAIN_NOTES.map(note => `Chordophones/Zithers/Harpsichord, Italian/Sustains/stop1/Harpsichord_stop1_${note}_1.wav`),
  ...HARPSICHORD_RELEASE_NOTES.map(note => `Chordophones/Zithers/Harpsichord, Italian/Releases/stop1/Harpsichord_stop1-rel_${note}_1.wav`),
] as const
const HARPSICHORD_ACK = `Versilian Community Sample Library se publica bajo CC0-1.0. Tloque instalará únicamente el Harpsichord, Italian · stop1 y sus release samples desde el commit ${VCSL_COMMIT}, validará cada WAV RIFF y lo copiará a App Storage.`

export const VCSL_ITALIAN_HARPSICHORD_PACK: CuratedRawWavPackSource = {
  id: "vcsl-italian-harpsichord-stop1",
  name: "Versilian Community Sample Library",
  libraryName: "Versilian Community Sample Library",
  displayName: "Italian Harpsichord · Stop 1",
  instrumentId: "keys.harpsichord",
  moduleId: "vcsl-italian-harpsichord-stop1",
  manifestId: "vcsl-italian-harpsichord-stop1",
  version: "vcsl-c1ea7bc",
  license: LICENSE,
  repositoryUrl: VCSL_REPOSITORY,
  pinnedCommit: VCSL_COMMIT,
  sfzPath: "generated:harpsichord-stop1",
  sfzPaths: ["generated:harpsichord-stop1"],
  estimatedMegabytes: 72,
  acknowledgement: HARPSICHORD_ACK,
  tags: ["native-samples", "harpsichord", "baroque", "keys", "cc0", "raw-wav", "release-samples"],
  sourceKind: "raw-wav-static",
  rawWavStaticPaths: HARPSICHORD_STATIC_PATHS,
  rawWavProfile: "vcsl-italian-harpsichord-stop1",
  samplePackInstall: {
    moduleId: "vcsl-italian-harpsichord-stop1",
    manifestId: "vcsl-italian-harpsichord-stop1",
    version: "vcsl-c1ea7bc",
    pinnedCommit: VCSL_COMMIT,
    sfzPath: "generated:harpsichord-stop1",
    estimatedMegabytes: 72,
    acknowledgement: HARPSICHORD_ACK,
    tags: ["native-samples", "harpsichord", "baroque", "keys", "cc0", "raw-wav", "release-samples"],
  },
}

export const CURATED_RAW_WAV_PACKS: readonly CuratedRawWavPackSource[] = [
  VCSL_ESTUARY_GRAND_PIANO_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_PACK,
  VCSL_ITALIAN_HARPSICHORD_PACK,
]

export function curatedRawWavPackById(id: string | null | undefined): CuratedRawWavPackSource | null {
  if (!id) return null
  return CURATED_RAW_WAV_PACKS.find(pack => pack.id === id) ?? null
}

export function isCuratedRawWavPackSource(source: CuratedSamplePackSource): source is CuratedRawWavPackSource {
  const kind = (source as Partial<CuratedRawWavPackSource>).sourceKind
  return kind === "raw-wav-index" || kind === "raw-wav-static"
}
