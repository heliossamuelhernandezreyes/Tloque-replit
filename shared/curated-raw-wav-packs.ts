import type { CuratedSamplePackSource } from "./curated-sample-packs"

export type RawWavProfile =
  | "vcsl-grand-piano-sus-close"
  | "vcsl-pipe-organ-rode-man3-open"
  | "vcsl-pipe-organ-nt5-man3-quiet"
  | "vcsl-pipe-organ-rode-pedal"
  | "vcsl-ocarina"
  | "vcsl-alto-recorder"
  | "vcsl-italian-harpsichord-stop1"
  | "vcsl-concert-harp"

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

function indexPack(input: { id: string; displayName: string; instrumentId: string; manifestId: string; bank: string; profile: RawWavProfile; estimatedMegabytes: number; tags: readonly string[] }): CuratedRawWavPackSource {
  const acknowledgement = `VCSL para Estuary se publica bajo CC0-1.0. Tloque instalará únicamente ${input.displayName} desde el commit ${ESTUARY_COMMIT}, verificará cada WAV RIFF y lo copiará a App Storage antes de reproducirlo.`
  return {
    id: input.id, name: "VCSL for Estuary", libraryName: "Versilian Community Sample Library · Estuary", displayName: input.displayName,
    instrumentId: input.instrumentId, moduleId: input.id, manifestId: input.manifestId, version: ESTUARY_VERSION, license: LICENSE,
    repositoryUrl: ESTUARY_REPOSITORY, pinnedCommit: ESTUARY_COMMIT, sfzPath: "estuary.json", sfzPaths: ["estuary.json"],
    estimatedMegabytes: input.estimatedMegabytes, acknowledgement, tags: input.tags, sourceKind: "raw-wav-index", rawWavIndexPath: "estuary.json",
    rawWavBank: input.bank, rawWavProfile: input.profile,
    samplePackInstall: { moduleId: input.id, manifestId: input.manifestId, version: ESTUARY_VERSION, pinnedCommit: ESTUARY_COMMIT, sfzPath: "estuary.json", estimatedMegabytes: input.estimatedMegabytes, acknowledgement, tags: input.tags },
  }
}

export const VCSL_ESTUARY_GRAND_PIANO_PACK = indexPack({ id: "vcsl-estuary-grand-piano", displayName: "Grand Piano · sustained close mic", instrumentId: "piano.grand", manifestId: "vcsl-estuary-grand-piano", bank: "grandpiano", profile: "vcsl-grand-piano-sus-close", estimatedMegabytes: 165, tags: ["native-samples", "piano", "grand-piano", "cc0", "velocity-layers", "close-mic", "raw-wav"] })
export const VCSL_ESTUARY_PIPE_ORGAN_PACK = indexPack({ id: "vcsl-estuary-pipe-organ", displayName: "Pipe Organ · Rode Man3 Open", instrumentId: "keys.pipe-organ", manifestId: "vcsl-estuary-pipe-organ", bank: "pipeorgan", profile: "vcsl-pipe-organ-rode-man3-open", estimatedMegabytes: 18, tags: ["native-samples", "pipe-organ", "organ", "manual", "open", "keys", "cc0", "raw-wav"] })
export const VCSL_ESTUARY_PIPE_ORGAN_SOFT_PACK = indexPack({ id: "vcsl-estuary-pipe-organ-soft", displayName: "Pipe Organ · NT5 Man3 Quiet", instrumentId: "keys.pipe-organ-soft", manifestId: "vcsl-estuary-pipe-organ-soft", bank: "pipeorgan", profile: "vcsl-pipe-organ-nt5-man3-quiet", estimatedMegabytes: 14, tags: ["native-samples", "pipe-organ", "organ", "manual", "quiet", "keys", "cc0", "raw-wav"] })
export const VCSL_ESTUARY_PIPE_ORGAN_PEDAL_PACK = indexPack({ id: "vcsl-estuary-pipe-organ-pedal", displayName: "Pipe Organ · Rode Pedal", instrumentId: "keys.pipe-organ-pedal", manifestId: "vcsl-estuary-pipe-organ-pedal", bank: "pipeorgan", profile: "vcsl-pipe-organ-rode-pedal", estimatedMegabytes: 8, tags: ["native-samples", "pipe-organ", "organ", "pedal", "low-register", "keys", "cc0", "raw-wav"] })
export const VCSL_ESTUARY_OCARINA_PACK = indexPack({ id: "vcsl-estuary-ocarina", displayName: "Ocarina · sustain + staccato", instrumentId: "woodwinds.ocarina", manifestId: "vcsl-estuary-ocarina", bank: "ocarina", profile: "vcsl-ocarina", estimatedMegabytes: 9, tags: ["native-samples", "ocarina", "woodwinds", "cc0", "sustain", "staccato", "raw-wav"] })
export const VCSL_ESTUARY_ALTO_RECORDER_PACK = indexPack({ id: "vcsl-estuary-alto-recorder", displayName: "Alto Recorder · sustain + staccato", instrumentId: "woodwinds.alto-recorder", manifestId: "vcsl-estuary-alto-recorder", bank: "altorecorder", profile: "vcsl-alto-recorder", estimatedMegabytes: 9, tags: ["native-samples", "alto-recorder", "recorder", "woodwinds", "cc0", "sustain", "staccato", "raw-wav"] })

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
  id: "vcsl-italian-harpsichord-stop1", name: "Versilian Community Sample Library", libraryName: "Versilian Community Sample Library", displayName: "Italian Harpsichord · Stop 1",
  instrumentId: "keys.harpsichord", moduleId: "vcsl-italian-harpsichord-stop1", manifestId: "vcsl-italian-harpsichord-stop1", version: "vcsl-c1ea7bc", license: LICENSE,
  repositoryUrl: VCSL_REPOSITORY, pinnedCommit: VCSL_COMMIT, sfzPath: "generated:harpsichord-stop1", sfzPaths: ["generated:harpsichord-stop1"], estimatedMegabytes: 72,
  acknowledgement: HARPSICHORD_ACK, tags: ["native-samples", "harpsichord", "baroque", "keys", "cc0", "raw-wav", "release-samples"], sourceKind: "raw-wav-static",
  rawWavStaticPaths: HARPSICHORD_STATIC_PATHS, rawWavProfile: "vcsl-italian-harpsichord-stop1",
  samplePackInstall: { moduleId: "vcsl-italian-harpsichord-stop1", manifestId: "vcsl-italian-harpsichord-stop1", version: "vcsl-c1ea7bc", pinnedCommit: VCSL_COMMIT, sfzPath: "generated:harpsichord-stop1", estimatedMegabytes: 72, acknowledgement: HARPSICHORD_ACK, tags: ["native-samples", "harpsichord", "baroque", "keys", "cc0", "raw-wav", "release-samples"] },
}

const CONCERT_HARP_FILES = [
  "KSHarp_A2_f1.wav", "KSHarp_A2_mf1.wav", "KSHarp_A4_f1.wav", "KSHarp_A4_mf1.wav", "KSHarp_A6_f1.wav", "KSHarp_A6_mf1.wav",
  "KSHarp_B1_f1.wav", "KSHarp_B1_mf1.wav", "KSHarp_B3_f1.wav", "KSHarp_B3_mf1.wav", "KSHarp_B5_f1.wav", "KSHarp_B5_mf1.wav", "KSHarp_B6_f1.wav", "KSHarp_B6_mf1.wav",
  "KSHarp_C3_f2.wav", "KSHarp_C3_mf3.wav", "KSHarp_C5_f1.wav", "KSHarp_C5_mf1.wav",
  "KSHarp_D2_f1.wav", "KSHarp_D2_mf1.wav", "KSHarp_D4_f1.wav", "KSHarp_D4_mf1.wav", "KSHarp_D6_f1.wav", "KSHarp_D6_mf1.wav", "KSHarp_D7_f1.wav", "KSHarp_D7_p1.wav",
  "KSHarp_E1_f1.wav", "KSHarp_E3_f1.wav", "KSHarp_E3_mf1.wav", "KSHarp_E5_f1.wav", "KSHarp_E5_mf1.wav",
  "KSHarp_F2_f1.wav", "KSHarp_F2_mf1.wav", "KSHarp_F4_f1.wav", "KSHarp_F4_mf1.wav", "KSHarp_F6_f1.wav", "KSHarp_F6_mf1.wav", "KSHarp_F7_f1.wav", "KSHarp_F7_p1.wav",
  "KSHarp_G1_f1.wav", "KSHarp_G1_mp1.wav", "KSHarp_G3_f1.wav", "KSHarp_G3_mf1.wav", "KSHarp_G5_f1.wav", "KSHarp_G5_mf1.wav",
] as const
const CONCERT_HARP_PATHS = CONCERT_HARP_FILES.map(file => `Chordophones/Composite Chordophones/Concert Harp/${file}`)
const CONCERT_HARP_ACK = `Versilian Community Sample Library se publica bajo CC0-1.0. Tloque instalará únicamente las 45 tomas verificadas del Concert Harp desde el commit ${VCSL_COMMIT}. El banco conserva sus capas dinámicas grabadas y cada WAV RIFF se valida antes de copiarlo a App Storage.`
export const VCSL_CONCERT_HARP_PACK: CuratedRawWavPackSource = {
  id: "vcsl-concert-harp", name: "Versilian Community Sample Library", libraryName: "Versilian Community Sample Library", displayName: "Concert Harp · 2 capas dinámicas",
  instrumentId: "strings.harp", moduleId: "vcsl-concert-harp", manifestId: "vcsl-concert-harp", version: "vcsl-c1ea7bc", license: LICENSE,
  repositoryUrl: VCSL_REPOSITORY, pinnedCommit: VCSL_COMMIT, sfzPath: "generated:concert-harp", sfzPaths: ["generated:concert-harp"], estimatedMegabytes: 74,
  acknowledgement: CONCERT_HARP_ACK, tags: ["native-samples", "concert-harp", "harp", "strings", "cc0", "raw-wav", "velocity-layers", "whole-tone-sampling"],
  sourceKind: "raw-wav-static", rawWavStaticPaths: CONCERT_HARP_PATHS, rawWavProfile: "vcsl-concert-harp",
  samplePackInstall: { moduleId: "vcsl-concert-harp", manifestId: "vcsl-concert-harp", version: "vcsl-c1ea7bc", pinnedCommit: VCSL_COMMIT, sfzPath: "generated:concert-harp", estimatedMegabytes: 74, acknowledgement: CONCERT_HARP_ACK, tags: ["native-samples", "concert-harp", "harp", "strings", "cc0", "raw-wav", "velocity-layers", "whole-tone-sampling"] },
}

export const CURATED_RAW_WAV_PACKS: readonly CuratedRawWavPackSource[] = [
  VCSL_ESTUARY_GRAND_PIANO_PACK, VCSL_ESTUARY_PIPE_ORGAN_PACK, VCSL_ESTUARY_PIPE_ORGAN_SOFT_PACK, VCSL_ESTUARY_PIPE_ORGAN_PEDAL_PACK,
  VCSL_ESTUARY_OCARINA_PACK, VCSL_ESTUARY_ALTO_RECORDER_PACK, VCSL_ITALIAN_HARPSICHORD_PACK, VCSL_CONCERT_HARP_PACK,
]
export function curatedRawWavPackById(id: string | null | undefined): CuratedRawWavPackSource | null { if (!id) return null; return CURATED_RAW_WAV_PACKS.find(pack => pack.id === id) ?? null }
export function isCuratedRawWavPackSource(source: CuratedSamplePackSource): source is CuratedRawWavPackSource { const kind = (source as Partial<CuratedRawWavPackSource>).sourceKind; return kind === "raw-wav-index" || kind === "raw-wav-static" }
