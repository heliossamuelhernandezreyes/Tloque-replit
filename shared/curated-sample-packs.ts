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
  sfzPaths: readonly string[]
  /** Optional base used to canonicalize sample= paths before the inert SFZ parser sees them. */
  sfzSampleBasePath?: string
  estimatedMegabytes: number
  acknowledgement: string
  tags: readonly string[]
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

function finalizePack(input: Omit<CuratedSamplePackSource, "samplePackInstall">): CuratedSamplePackSource {
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

function vscoPack(input: VscoInput): CuratedSamplePackSource {
  const libraryName = "VSCO 2 Community Edition"
  const sfzPaths = input.sfzPaths?.length ? [...input.sfzPaths] : [input.sfzPath]
  const acknowledgement = `VSCO 2 Community Edition se distribuye bajo CC0-1.0. Tloque instalará únicamente ${input.displayName} desde el commit ${VSCO_COMMIT}, verificará cada WAV y lo copiará a App Storage antes de reproducirlo.`
  return finalizePack({
    ...input,
    sfzPaths,
    name: libraryName,
    libraryName,
    version: VSCO_VERSION,
    license: VSCO_LICENSE,
    repositoryUrl: VSCO_REPOSITORY,
    pinnedCommit: VSCO_COMMIT,
    acknowledgement,
  })
}

const VSCO_PACKS: readonly CuratedSamplePackSource[] = [
  vscoPack({ id: "vsco2-ce-solo-violin", displayName: "Solo Violin", instrumentId: "strings.violin", moduleId: "vsco2-ce-solo-violin", manifestId: "vsco2-ce-solo-violin", sfzPath: "SViolin-KS.sfz", estimatedMegabytes: 118, tags: ["native-samples", "solo", "violin", "strings", "cc0", "velocity-layers", "round-robin"] }),
  vscoPack({ id: "vsco2-ce-violin-section", displayName: "Violin Section", instrumentId: "strings.violin-section", moduleId: "vsco2-ce-violin-section", manifestId: "vsco2-ce-violin-section", sfzPath: "ViolinEns-KS.sfz", estimatedMegabytes: 120, tags: ["native-samples", "section", "violin", "strings", "cc0", "velocity-layers", "round-robin"] }),
  vscoPack({ id: "vsco2-ce-viola-section", displayName: "Viola Section", instrumentId: "strings.viola", moduleId: "vsco2-ce-viola-section", manifestId: "vsco2-ce-viola-section", sfzPath: "ViolaEns-KS.sfz", estimatedMegabytes: 120, tags: ["native-samples", "section", "viola", "strings", "cc0", "velocity-layers", "round-robin"] }),
  vscoPack({ id: "vsco2-ce-cello-section", displayName: "Cello Section", instrumentId: "strings.cello", moduleId: "vsco2-ce-cello-section", manifestId: "vsco2-ce-cello-section", sfzPath: "CelloEns-KS.sfz", estimatedMegabytes: 125, tags: ["native-samples", "section", "cello", "strings", "cc0", "velocity-layers", "round-robin"] }),
  vscoPack({ id: "vsco2-ce-solo-contrabass", displayName: "Solo Contrabass", instrumentId: "strings.contrabass", moduleId: "vsco2-ce-solo-contrabass", manifestId: "vsco2-ce-solo-contrabass", sfzPath: "Contrabass-KS.sfz", estimatedMegabytes: 120, tags: ["native-samples", "solo", "contrabass", "strings", "cc0", "velocity-layers", "round-robin", "recorded-vibrato"] }),
  vscoPack({ id: "vsco2-ce-flute", displayName: "Flute", instrumentId: "woodwinds.flute", moduleId: "vsco2-ce-flute", manifestId: "vsco2-ce-flute", sfzPath: "Flute-KS.sfz", estimatedMegabytes: 85, tags: ["native-samples", "solo", "flute", "woodwinds", "cc0", "velocity-layers", "round-robin", "recorded-vibrato"] }),
  vscoPack({ id: "vsco2-ce-clarinet", displayName: "Clarinet", instrumentId: "woodwinds.clarinet", moduleId: "vsco2-ce-clarinet", manifestId: "vsco2-ce-clarinet", sfzPath: "Clarinet-KS.sfz", estimatedMegabytes: 70, tags: ["native-samples", "solo", "clarinet", "woodwinds", "cc0", "velocity-layers", "round-robin"] }),
  vscoPack({ id: "vsco2-ce-oboe", displayName: "Oboe", instrumentId: "woodwinds.oboe", moduleId: "vsco2-ce-oboe", manifestId: "vsco2-ce-oboe", sfzPath: "OboeSusNV.sfz", sfzPaths: ["OboeSusNV.sfz", "OboeSusVib.sfz", "OboeStac.sfz"], estimatedMegabytes: 70, tags: ["native-samples", "solo", "oboe", "woodwinds", "cc0", "multi-sfz", "velocity-layers", "round-robin", "recorded-vibrato"] }),
  vscoPack({ id: "vsco2-ce-bassoon", displayName: "Bassoon", instrumentId: "woodwinds.bassoon", moduleId: "vsco2-ce-bassoon", manifestId: "vsco2-ce-bassoon", sfzPath: "BassoonSus.sfz", sfzPaths: ["BassoonSus.sfz", "BassoonVib.sfz", "BassoonStac.sfz"], estimatedMegabytes: 70, tags: ["native-samples", "solo", "bassoon", "woodwinds", "cc0", "multi-sfz", "velocity-layers", "round-robin", "recorded-vibrato"] }),
  vscoPack({ id: "vsco2-ce-trumpet", displayName: "Trumpet", instrumentId: "brass.trumpet", moduleId: "vsco2-ce-trumpet", manifestId: "vsco2-ce-trumpet", sfzPath: "TrumpetSus.sfz", sfzPaths: ["TrumpetSus.sfz", "TrumpetSusVib.sfz", "TrumpetStac.sfz", "TrumpetStraightMuteSus.sfz", "TrumpetHarmonMuteSus.sfz"], estimatedMegabytes: 125, tags: ["native-samples", "solo", "trumpet", "brass", "cc0", "multi-sfz", "velocity-layers", "round-robin", "recorded-vibrato", "recorded-mutes"] }),
  vscoPack({ id: "vsco2-ce-tenor-trombone", displayName: "Tenor Trombone", instrumentId: "brass.trombone", moduleId: "vsco2-ce-tenor-trombone", manifestId: "vsco2-ce-tenor-trombone", sfzPath: "TromboneSus.sfz", sfzPaths: ["TromboneSus.sfz", "TromboneVib.sfz", "TromboneStac.sfz"], estimatedMegabytes: 80, tags: ["native-samples", "solo", "tenor-trombone", "brass", "cc0", "multi-sfz", "velocity-layers", "round-robin", "recorded-vibrato"] }),
  vscoPack({ id: "vsco2-ce-f-horn", displayName: "F Horn", instrumentId: "brass.horn", moduleId: "vsco2-ce-f-horn", manifestId: "vsco2-ce-f-horn", sfzPath: "FHornSus.sfz", sfzPaths: ["FHornSus.sfz", "FHornStac.sfz", "FHornMute.sfz"], estimatedMegabytes: 85, tags: ["native-samples", "solo", "f-horn", "brass", "cc0", "multi-sfz", "velocity-layers", "round-robin", "recorded-mutes"] }),
  vscoPack({ id: "vsco2-ce-tuba", displayName: "Tuba", instrumentId: "brass.tuba", moduleId: "vsco2-ce-tuba", manifestId: "vsco2-ce-tuba", sfzPath: "Tuba-KS.sfz", estimatedMegabytes: 80, tags: ["native-samples", "solo", "tuba", "brass", "cc0", "velocity-layers", "round-robin"] }),
  vscoPack({ id: "vsco2-ce-timpani", displayName: "Timpani", instrumentId: "percussion.timpani", moduleId: "vsco2-ce-timpani", manifestId: "vsco2-ce-timpani", sfzPath: "Timpani.sfz", sfzPaths: ["Timpani.sfz", "TimpaniRolls.sfz"], estimatedMegabytes: 90, tags: ["native-samples", "tuned-percussion", "timpani", "percussion", "cc0", "multi-sfz", "velocity-layers", "round-robin", "recorded-rolls"] }),
  vscoPack({ id: "vsco2-ce-glockenspiel", displayName: "Glockenspiel", instrumentId: "percussion.glockenspiel", moduleId: "vsco2-ce-glockenspiel", manifestId: "vsco2-ce-glockenspiel", sfzPath: "Glockenspiel.sfz", estimatedMegabytes: 12, tags: ["native-samples", "tuned-percussion", "glockenspiel", "percussion", "cc0"] }),
  vscoPack({ id: "vsco2-ce-marimba", displayName: "Marimba", instrumentId: "percussion.marimba", moduleId: "vsco2-ce-marimba", manifestId: "vsco2-ce-marimba", sfzPath: "Marimba.sfz", estimatedMegabytes: 24, tags: ["native-samples", "tuned-percussion", "marimba", "percussion", "cc0"] }),
  vscoPack({ id: "vsco2-ce-xylophone", displayName: "Xylophone", instrumentId: "percussion.xylophone", moduleId: "vsco2-ce-xylophone", manifestId: "vsco2-ce-xylophone", sfzPath: "Xylophone.sfz", estimatedMegabytes: 18, tags: ["native-samples", "tuned-percussion", "xylophone", "percussion", "cc0"] }),
  vscoPack({ id: "vsco2-ce-tubular-bells", displayName: "Tubular Bells", instrumentId: "percussion.tubular-bells", moduleId: "vsco2-ce-tubular-bells", manifestId: "vsco2-ce-tubular-bells", sfzPath: "TubularBells.sfz", estimatedMegabytes: 10, tags: ["native-samples", "tuned-percussion", "tubular-bells", "percussion", "cc0"] }),
  vscoPack({ id: "vsco2-ce-orchestral-percussion", displayName: "Orchestral Percussion", instrumentId: "percussion.orchestral-kit", moduleId: "vsco2-ce-orchestral-percussion", manifestId: "vsco2-ce-orchestral-percussion", sfzPath: "GM-StylePerc.sfz", estimatedMegabytes: 180, tags: ["native-samples", "orchestral-percussion", "semantic-hits", "percussion", "cc0", "velocity-layers", "round-robin"] }),
]

const EMILY_GUITAR_COMMIT = "b4920dc662fd9cad6dcaccdeecffdd91c8725d8c"
const EMILY_GUITAR_ACK = `Karoryfer Emilyguitar se distribuye bajo CC0-1.0. Tloque instalará emily_basic.sfz y sus WAV desde el commit ${EMILY_GUITAR_COMMIT}, verificará cada WAV y lo copiará a App Storage. El banco contiene cuatro capas de velocidad, tres round robins de notas y muestras físicas de release/ruido.`
const EMILY_GUITAR_PACK = finalizePack({
  id: "karoryfer-emily-guitar",
  name: "Karoryfer Emilyguitar",
  libraryName: "Karoryfer Emilyguitar",
  displayName: "Emilyguitar · Clean Electric Guitar",
  instrumentId: "guitar.electric-clean",
  moduleId: "karoryfer-emily-guitar",
  manifestId: "karoryfer-emily-guitar",
  version: "b4920dc",
  license: "CC0-1.0",
  repositoryUrl: "https://github.com/sfzinstruments/karoryfer.emilyguitar",
  pinnedCommit: EMILY_GUITAR_COMMIT,
  sfzPath: "emily_basic.sfz",
  sfzPaths: ["emily_basic.sfz"],
  estimatedMegabytes: 100,
  acknowledgement: EMILY_GUITAR_ACK,
  tags: ["native-samples", "guitar", "electric-guitar", "clean", "cc0", "velocity-layers", "round-robin", "release-samples"],
})

const LEGATO_VOCAL_COMMIT = "fac6461ee4c7f498b23246eced644616fa58d2ec"
const LEGATO_VOCAL_ACK = `SFZ Instruments Legato Vocal Tutorial se publica bajo CC0-1.0. Tloque instalará únicamente el sustain A y sus transiciones true-legato desde el commit ${LEGATO_VOCAL_COMMIT}, verificará cada WAV y lo copiará a App Storage.`
const LEGATO_VOCAL_PACK = finalizePack({
  id: "sfzinstruments-legato-vocal-a",
  name: "SFZ Instruments Legato Vocal Tutorial",
  libraryName: "SFZ Instruments Legato Vocal Tutorial",
  displayName: "Legato Vocal A · CC0 reference",
  instrumentId: "voice.legato-a",
  moduleId: "sfzinstruments-legato-vocal-a",
  manifestId: "sfzinstruments-legato-vocal-a",
  version: "fac6461",
  license: "CC0-1.0",
  repositoryUrl: "https://github.com/sfzinstruments/legato_vocal_tutorial",
  pinnedCommit: LEGATO_VOCAL_COMMIT,
  sfzPath: "Programs/modules/vowel_sustain_a.sfz",
  sfzPaths: ["Programs/modules/vowel_sustain_a.sfz", "Programs/modules/vowel_transition_a.sfz"],
  sfzSampleBasePath: "Programs",
  estimatedMegabytes: 165,
  acknowledgement: LEGATO_VOCAL_ACK,
  tags: ["native-samples", "voice", "cc0", "true-legato", "recorded-transitions", "reference-pack"],
})

export const CURATED_SAMPLE_PACKS: readonly CuratedSamplePackSource[] = [...VSCO_PACKS, EMILY_GUITAR_PACK, LEGATO_VOCAL_PACK]

export function curatedSamplePackById(id: string | null | undefined): CuratedSamplePackSource | null {
  if (!id) return null
  if (id === "vsco2-ce") return VSCO_PACKS[0]
  return CURATED_SAMPLE_PACKS.find(pack => pack.id === id) ?? null
}

export function curatedSamplePackByModuleId(moduleId: string | null | undefined): CuratedSamplePackSource | null {
  if (!moduleId) return null
  // `native-auto` is a virtual routing module. Returning any curated native pack here
  // only marks the score as native for the export router; the native exporter resolves
  // the real package independently for every semantic instrument track.
  if (moduleId === "native-auto") return VSCO_PACKS[0]
  return CURATED_SAMPLE_PACKS.find(pack => pack.moduleId === moduleId) ?? null
}
