import type { CuratedSamplePackSource } from "./curated-sample-packs"

export type ExternalPcmMappingProfile = "iowa-bass-clarinet-ff" | "iowa-bass-trombone-ff" | "sampled-celesta-tuned-denoised-mix"

export interface CuratedExternalPcmPackSource extends CuratedSamplePackSource {
  sourceKind: "external-pcm-static"
  inputFormat: "aiff-pcm" | "wav"
  externalBaseUrl: string
  externalPaths: readonly string[]
  mappingProfile: ExternalPcmMappingProfile
  gitlabProjectId?: number
}

const IOWA_REVISION = "MIS-Pitches-2014"
const IOWA_LICENSE = "University-of-Iowa-MIS-free-use"
const IOWA_LIBRARY = "University of Iowa Musical Instrument Samples"
const IOWA_ACK = "University of Iowa Electronic Music Studios states that the Musical Instrument Samples recordings may be freely used for any purpose without restriction. Tloque installs only the fixed chromatic files declared in its curated catalog, converts uncompressed AIFF PCM locally to WAV, hashes the installed WAV and keeps the institutional provenance."

const FLAT_PITCH_CLASS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const
const SHARP_PITCH_CLASS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
function midiName(midi: number, names: readonly string[] = FLAT_PITCH_CLASS) {
  const pitch = names[((midi % 12) + 12) % 12]
  return `${pitch}${Math.floor(midi / 12) - 1}`
}
function chromaticFiles(prefix: string, firstMidi: number, lastMidi: number) {
  return Array.from({ length: lastMidi - firstMidi + 1 }, (_, index) => `${prefix}.ff.${midiName(firstMidi + index)}.stereo.aif`)
}
function finalize(input: Omit<CuratedExternalPcmPackSource, "samplePackInstall">): CuratedExternalPcmPackSource {
  return {
    ...input,
    samplePackInstall: {
      moduleId: input.moduleId,
      manifestId: input.manifestId,
      version: input.version,
      pinnedCommit: input.pinnedCommit,
      sfzPath: input.sfzPath,
      estimatedMegabytes: input.estimatedMegabytes,
      acknowledgement: input.acknowledgement,
      tags: input.tags,
    },
  }
}

export const IOWA_BASS_CLARINET_FF_PACK = finalize({
  id: "iowa-mis-bass-clarinet-ff", name: IOWA_LIBRARY, libraryName: IOWA_LIBRARY, displayName: "Bass Clarinet · chromatic ff",
  instrumentId: "woodwinds.bass-clarinet", moduleId: "iowa-mis-bass-clarinet-ff", manifestId: "iowa-mis-bass-clarinet-ff", version: "mis-pitches-2014", license: IOWA_LICENSE,
  repositoryUrl: "https://theremin.music.uiowa.edu/MIS-Pitches-2012/MISBbBassClarinet2012.html", pinnedCommit: IOWA_REVISION,
  sfzPath: "generated:iowa-bass-clarinet-ff", sfzPaths: ["generated:iowa-bass-clarinet-ff"], estimatedMegabytes: 30, acknowledgement: IOWA_ACK,
  tags: ["native-samples", "woodwinds", "bass-clarinet", "iowa-mis", "chromatic", "aiff-source", "institutional-free-use"], sourceKind: "external-pcm-static", inputFormat: "aiff-pcm",
  externalBaseUrl: "https://theremin.music.uiowa.edu/sound%20files/MIS%20Pitches%20-%202014/Woodwinds/Bass%20Clarinet/", externalPaths: chromaticFiles("BassClarinet", 37, 82), mappingProfile: "iowa-bass-clarinet-ff",
})

export const IOWA_BASS_TROMBONE_FF_PACK = finalize({
  id: "iowa-mis-bass-trombone-ff", name: IOWA_LIBRARY, libraryName: IOWA_LIBRARY, displayName: "Bass Trombone · chromatic ff",
  instrumentId: "brass.bass-trombone", moduleId: "iowa-mis-bass-trombone-ff", manifestId: "iowa-mis-bass-trombone-ff", version: "mis-pitches-2014", license: IOWA_LICENSE,
  repositoryUrl: "https://theremin.music.uiowa.edu/MIS-Pitches-2012/MISBassTrombone2012.html", pinnedCommit: IOWA_REVISION,
  sfzPath: "generated:iowa-bass-trombone-ff", sfzPaths: ["generated:iowa-bass-trombone-ff"], estimatedMegabytes: 18, acknowledgement: IOWA_ACK,
  tags: ["native-samples", "brass", "bass-trombone", "iowa-mis", "chromatic", "aiff-source", "institutional-free-use"], sourceKind: "external-pcm-static", inputFormat: "aiff-pcm",
  externalBaseUrl: "https://theremin.music.uiowa.edu/sound%20files/MIS%20Pitches%20-%202014/Brass/Bass%20Trombone/", externalPaths: chromaticFiles("BassTrombone", 25, 51), mappingProfile: "iowa-bass-trombone-ff",
})

const CELESTA_COMMIT = "934c7fd6"
const CELESTA_PREFIX = "Samples/Tuned/Denoised Mix/"
const CELESTA_PATHS = Array.from({ length: 49 }, (_, index) => 60 + index)
  .filter(midi => midi !== 77) // F5 del instrumento original tiene un timbre anómalo; el pack oficial también evita depender de esa toma.
  .map(midi => `${CELESTA_PREFIX}${midiName(midi, SHARP_PITCH_CLASS)} rr1.wav`)
const CELESTA_ACK = `A Sampled Celesta de Neil Bickford publica audio y presets bajo CC0-1.0. Tloque instalará únicamente las tomas rr1 de Tuned + Denoised + Mix desde la revisión GitLab ${CELESTA_COMMIT}, resolverá Git LFS mediante la API oficial, verificará WAV RIFF y conservará SHA-256 en App Storage. F5 se cubre desde una raíz vecina, siguiendo la precaución documentada por el propio banco sobre esa tecla física.`
export const SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK = finalize({
  id: "sampled-celesta-tuned-denoised-mix", name: "A Sampled Celesta", libraryName: "A Sampled Celesta", displayName: "Mustel Celesta · Tuned Denoised Mix",
  instrumentId: "keys.celesta", moduleId: "sampled-celesta-tuned-denoised-mix", manifestId: "sampled-celesta-tuned-denoised-mix", version: "gitlab-934c7fd6", license: "CC0-1.0",
  repositoryUrl: "https://gitlab.com/echoparallax/a-sampled-celesta", pinnedCommit: CELESTA_COMMIT,
  sfzPath: "generated:sampled-celesta-tuned-denoised-mix", sfzPaths: ["generated:sampled-celesta-tuned-denoised-mix"], estimatedMegabytes: 110, acknowledgement: CELESTA_ACK,
  tags: ["native-samples", "keys", "celesta", "mustel", "cc0", "gitlab-lfs", "tuned", "denoised", "mixed-mics"], sourceKind: "external-pcm-static", inputFormat: "wav",
  externalBaseUrl: "https://gitlab.com/api/v4/projects/18547990/repository/files/", externalPaths: CELESTA_PATHS, mappingProfile: "sampled-celesta-tuned-denoised-mix", gitlabProjectId: 18547990,
})

export const CURATED_EXTERNAL_PCM_PACKS = [IOWA_BASS_CLARINET_FF_PACK, IOWA_BASS_TROMBONE_FF_PACK, SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK] as const

export function curatedExternalPcmPackById(id: string | null | undefined): CuratedExternalPcmPackSource | null {
  if (!id) return null
  return CURATED_EXTERNAL_PCM_PACKS.find(pack => pack.id === id) ?? null
}

export function isCuratedExternalPcmPackSource(source: CuratedSamplePackSource): source is CuratedExternalPcmPackSource {
  return (source as Partial<CuratedExternalPcmPackSource>).sourceKind === "external-pcm-static"
}
