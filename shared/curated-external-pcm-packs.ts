import type { CuratedSamplePackSource } from "./curated-sample-packs"

export type ExternalPcmMappingProfile = "iowa-bass-clarinet-ff" | "iowa-bass-trombone-ff"

export interface CuratedExternalPcmPackSource extends CuratedSamplePackSource {
  sourceKind: "external-pcm-static"
  inputFormat: "aiff-pcm"
  externalBaseUrl: string
  externalPaths: readonly string[]
  mappingProfile: ExternalPcmMappingProfile
}

const IOWA_REVISION = "MIS-Pitches-2014"
const IOWA_LICENSE = "University-of-Iowa-MIS-free-use"
const IOWA_LIBRARY = "University of Iowa Musical Instrument Samples"
const IOWA_ACK = "University of Iowa Electronic Music Studios states that the Musical Instrument Samples recordings may be freely used for any purpose without restriction. Tloque installs only the fixed chromatic files declared in its curated catalog, converts uncompressed AIFF PCM locally to WAV, hashes the installed WAV and keeps the institutional provenance."

const FLAT_PITCH_CLASS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const
function midiName(midi: number) {
  const pitch = FLAT_PITCH_CLASS[((midi % 12) + 12) % 12]
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
  id: "iowa-mis-bass-clarinet-ff",
  name: IOWA_LIBRARY,
  libraryName: IOWA_LIBRARY,
  displayName: "Bass Clarinet · chromatic ff",
  instrumentId: "woodwinds.bass-clarinet",
  moduleId: "iowa-mis-bass-clarinet-ff",
  manifestId: "iowa-mis-bass-clarinet-ff",
  version: "mis-pitches-2014",
  license: IOWA_LICENSE,
  repositoryUrl: "https://theremin.music.uiowa.edu/MIS-Pitches-2012/MISBbBassClarinet2012.html",
  pinnedCommit: IOWA_REVISION,
  sfzPath: "generated:iowa-bass-clarinet-ff",
  sfzPaths: ["generated:iowa-bass-clarinet-ff"],
  estimatedMegabytes: 30,
  acknowledgement: IOWA_ACK,
  tags: ["native-samples", "woodwinds", "bass-clarinet", "iowa-mis", "chromatic", "aiff-source", "institutional-free-use"],
  sourceKind: "external-pcm-static",
  inputFormat: "aiff-pcm",
  externalBaseUrl: "https://theremin.music.uiowa.edu/sound%20files/MIS%20Pitches%20-%202014/Woodwinds/Bass%20Clarinet/",
  externalPaths: chromaticFiles("BassClarinet", 37, 82),
  mappingProfile: "iowa-bass-clarinet-ff",
})

export const IOWA_BASS_TROMBONE_FF_PACK = finalize({
  id: "iowa-mis-bass-trombone-ff",
  name: IOWA_LIBRARY,
  libraryName: IOWA_LIBRARY,
  displayName: "Bass Trombone · chromatic ff",
  instrumentId: "brass.bass-trombone",
  moduleId: "iowa-mis-bass-trombone-ff",
  manifestId: "iowa-mis-bass-trombone-ff",
  version: "mis-pitches-2014",
  license: IOWA_LICENSE,
  repositoryUrl: "https://theremin.music.uiowa.edu/MIS-Pitches-2012/MISBassTrombone2012.html",
  pinnedCommit: IOWA_REVISION,
  sfzPath: "generated:iowa-bass-trombone-ff",
  sfzPaths: ["generated:iowa-bass-trombone-ff"],
  estimatedMegabytes: 18,
  acknowledgement: IOWA_ACK,
  tags: ["native-samples", "brass", "bass-trombone", "iowa-mis", "chromatic", "aiff-source", "institutional-free-use"],
  sourceKind: "external-pcm-static",
  inputFormat: "aiff-pcm",
  externalBaseUrl: "https://theremin.music.uiowa.edu/sound%20files/MIS%20Pitches%20-%202014/Brass/Bass%20Trombone/",
  externalPaths: chromaticFiles("BassTrombone", 25, 51),
  mappingProfile: "iowa-bass-trombone-ff",
})

export const CURATED_EXTERNAL_PCM_PACKS = [IOWA_BASS_CLARINET_FF_PACK, IOWA_BASS_TROMBONE_FF_PACK] as const

export function curatedExternalPcmPackById(id: string | null | undefined): CuratedExternalPcmPackSource | null {
  if (!id) return null
  return CURATED_EXTERNAL_PCM_PACKS.find(pack => pack.id === id) ?? null
}

export function isCuratedExternalPcmPackSource(source: CuratedSamplePackSource): source is CuratedExternalPcmPackSource {
  return (source as Partial<CuratedExternalPcmPackSource>).sourceKind === "external-pcm-static"
}
