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
  sfzPath: string
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
  "name" | "libraryName" | "version" | "license" | "repositoryUrl" | "pinnedCommit" | "acknowledgement" | "samplePackInstall"
>

function vscoPack(input: VscoInput): CuratedSamplePackSource {
  const libraryName = "VSCO 2 Community Edition"
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
 * presented as solo instruments.
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
]

export function curatedSamplePackById(id: string | null | undefined): CuratedSamplePackSource | null {
  if (!id) return null
  return CURATED_SAMPLE_PACKS.find(pack => pack.id === id) ?? null
}

export function curatedSamplePackByModuleId(moduleId: string | null | undefined): CuratedSamplePackSource | null {
  if (!moduleId) return null
  return CURATED_SAMPLE_PACKS.find(pack => pack.moduleId === moduleId) ?? null
}
