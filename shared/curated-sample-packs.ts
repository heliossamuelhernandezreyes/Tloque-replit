export interface CuratedSamplePackInstallCompat {
  moduleId: string
  manifestId: string
  version: string
  pinnedCommit: string
  sfzPath: string
  estimatedMegabytes: number
  acknowledgement: string
  tags: readonly string[]
}

export interface CuratedSamplePackSource {
  id: string
  /** Compatibility name used by the existing admin installer response. */
  name: string
  libraryName: string
  displayName: string
  instrumentId: string
  moduleId: string
  manifestId: string
  version: string
  license: string
  repositoryUrl: string
  pinnedCommit: string
  /** Primary SFZ kept for backwards compatibility and provenance displays. */
  sfzPath: string
  /** One or more SFZ patches compiled into the same native instrument. */
  sfzPaths: readonly string[]
  estimatedMegabytes: number
  acknowledgement: string
  tags: readonly string[]
  /** Transitional shape while the old endpoint is generalized. */
  samplePackInstall: CuratedSamplePackInstallCompat
}

const VSCO_REPOSITORY = "https://github.com/sgossner/VSCO-2-CE"
const VSCO_COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"
const VSCO_VERSION = "SFZ-6dd651d"
const VSCO_LICENSE = "CC0-1.0"

type VscoInput = Omit<
  CuratedSamplePackSource,
  "name" | "libraryName" | "version" | "license" | "repositoryUrl" | "pinnedCommit" | "acknowledgement" | "samplePackInstall" | "sfzPaths"
> & { sfzPaths?: readonly string[] }

function vscoPack(input: VscoInput): CuratedSamplePackSource {
  const libraryName = "VSCO 2 Community Edition"
  const sfzPaths = input.sfzPaths?.length ? [...input.sfzPaths] : [input.sfzPath]
  const acknowledgement = `VSCO 2 Community Edition se distribuye bajo CC0-1.0. Tloque instalará únicamente ${input.displayName} desde el commit ${VSCO_COMMIT}, verificará cada WAV y lo copiará a App Storage antes de reproducirlo.`
  const samplePackInstall: CuratedSamplePackInstallCompat = {
    moduleId: input.moduleId,
    manifestId: input.manifestId,
    version: VSCO_VERSION,
    pinnedCommit: VSCO_COMMIT,
    sfzPath: input.sfzPath,
    estimatedMegabytes: input.estimatedMegabytes,
    acknowledgement,
    tags: input.tags,
  }
  return {
    ...input,
    sfzPaths,
    name: libraryName,
    libraryName,
    version: VSCO_VERSION,
    license: VSCO_LICENSE,
    repositoryUrl: VSCO_REPOSITORY,
    pinnedCommit: VSCO_COMMIT,
    acknowledgement,
    samplePackInstall,
  }
}

/**
 * Curated native sample packs are intentionally independent downloads. Mobile
 * devices can keep only the instruments a reader/author actually uses.
 * Names reflect the upstream recording identity; section patches are never
 * presented as solo instruments. Multi-SFZ entries combine upstream patches
 * without inventing techniques that are not present in the recordings.
 */
export const CURATED_SAMPLE_PACKS: readonly CuratedSamplePackSource[] = [
  vscoPack({
    id: "vsco2-ce-solo-violin",
    displayName: "Solo Violin",
    instrumentId: "strings.violin",
    moduleId: "vsco2-ce-solo-violin",
    manifestId: "vsco2-ce-solo-violin",
    sfzPath: "SViolin-KS.sfz",
    estimatedMegabytes: 118,
    tags: ["native-samples", "solo", "violin", "strings", "cc0", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-viola-section",
    displayName: "Viola Section",
    instrumentId: "strings.viola",
    moduleId: "vsco2-ce-viola-section",
    manifestId: "vsco2-ce-viola-section",
    sfzPath: "ViolaEns-KS.sfz",
    estimatedMegabytes: 120,
    tags: ["native-samples", "section", "viola", "strings", "cc0", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-cello-section",
    displayName: "Cello Section",
    instrumentId: "strings.cello",
    moduleId: "vsco2-ce-cello-section",
    manifestId: "vsco2-ce-cello-section",
    sfzPath: "CelloEns-KS.sfz",
    estimatedMegabytes: 125,
    tags: ["native-samples", "section", "cello", "strings", "cc0", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-solo-contrabass",
    displayName: "Solo Contrabass",
    instrumentId: "strings.contrabass",
    moduleId: "vsco2-ce-solo-contrabass",
    manifestId: "vsco2-ce-solo-contrabass",
    sfzPath: "Contrabass-KS.sfz",
    estimatedMegabytes: 120,
    tags: ["native-samples", "solo", "contrabass", "strings", "cc0", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-flute",
    displayName: "Flute",
    instrumentId: "woodwinds.flute",
    moduleId: "vsco2-ce-flute",
    manifestId: "vsco2-ce-flute",
    sfzPath: "Flute-KS.sfz",
    estimatedMegabytes: 85,
    tags: ["native-samples", "solo", "flute", "woodwinds", "cc0", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-clarinet",
    displayName: "Clarinet",
    instrumentId: "woodwinds.clarinet",
    moduleId: "vsco2-ce-clarinet",
    manifestId: "vsco2-ce-clarinet",
    sfzPath: "Clarinet-KS.sfz",
    estimatedMegabytes: 70,
    tags: ["native-samples", "solo", "clarinet", "woodwinds", "cc0", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-oboe",
    displayName: "Oboe",
    instrumentId: "woodwinds.oboe",
    moduleId: "vsco2-ce-oboe",
    manifestId: "vsco2-ce-oboe",
    sfzPath: "OboeSusNV.sfz",
    sfzPaths: ["OboeSusNV.sfz", "OboeStac.sfz"],
    estimatedMegabytes: 55,
    tags: ["native-samples", "solo", "oboe", "woodwinds", "cc0", "multi-sfz", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-bassoon",
    displayName: "Bassoon",
    instrumentId: "woodwinds.bassoon",
    moduleId: "vsco2-ce-bassoon",
    manifestId: "vsco2-ce-bassoon",
    sfzPath: "BassoonSus.sfz",
    sfzPaths: ["BassoonSus.sfz", "BassoonStac.sfz"],
    estimatedMegabytes: 50,
    tags: ["native-samples", "solo", "bassoon", "woodwinds", "cc0", "multi-sfz", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-trumpet",
    displayName: "Trumpet",
    instrumentId: "brass.trumpet",
    moduleId: "vsco2-ce-trumpet",
    manifestId: "vsco2-ce-trumpet",
    sfzPath: "TrumpetSus.sfz",
    sfzPaths: ["TrumpetSus.sfz", "TrumpetStac.sfz"],
    estimatedMegabytes: 65,
    tags: ["native-samples", "solo", "trumpet", "brass", "cc0", "multi-sfz", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-tenor-trombone",
    displayName: "Tenor Trombone",
    instrumentId: "brass.trombone",
    moduleId: "vsco2-ce-tenor-trombone",
    manifestId: "vsco2-ce-tenor-trombone",
    sfzPath: "TromboneSus.sfz",
    sfzPaths: ["TromboneSus.sfz", "TromboneStac.sfz"],
    estimatedMegabytes: 65,
    tags: ["native-samples", "solo", "tenor-trombone", "brass", "cc0", "multi-sfz", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-f-horn",
    displayName: "F Horn",
    instrumentId: "brass.horn",
    moduleId: "vsco2-ce-f-horn",
    manifestId: "vsco2-ce-f-horn",
    sfzPath: "FHornSus.sfz",
    sfzPaths: ["FHornSus.sfz", "FHornStac.sfz"],
    estimatedMegabytes: 70,
    tags: ["native-samples", "solo", "f-horn", "brass", "cc0", "multi-sfz", "velocity-layers", "round-robin"],
  }),
  vscoPack({
    id: "vsco2-ce-tuba",
    displayName: "Tuba",
    instrumentId: "brass.tuba",
    moduleId: "vsco2-ce-tuba",
    manifestId: "vsco2-ce-tuba",
    sfzPath: "Tuba-KS.sfz",
    estimatedMegabytes: 80,
    tags: ["native-samples", "solo", "tuba", "brass", "cc0", "velocity-layers", "round-robin"],
  }),
]

export function curatedSamplePackById(id: string | null | undefined): CuratedSamplePackSource | null {
  if (!id) return null
  // Historical API id used by the first Solo Violin installer.
  if (id === "vsco2-ce") return CURATED_SAMPLE_PACKS[0]
  return CURATED_SAMPLE_PACKS.find(pack => pack.id === id) ?? null
}

export function curatedSamplePackByModuleId(moduleId: string | null | undefined): CuratedSamplePackSource | null {
  if (!moduleId) return null
  return CURATED_SAMPLE_PACKS.find(pack => pack.moduleId === moduleId) ?? null
}
