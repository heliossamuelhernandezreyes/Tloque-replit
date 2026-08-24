import type { CuratedSamplePackSource } from "./curated-sample-packs"

const COMMIT = "b4920dc662fd9cad6dcaccdeecffdd91c8725d8c"
const REPOSITORY = "https://github.com/sfzinstruments/karoryfer.emilyguitar"

export const KARORYFER_EMILY_GUITAR_PACK: CuratedSamplePackSource = {
  id: "karoryfer-emily-guitar",
  name: "Karoryfer Emilyguitar",
  libraryName: "Karoryfer Emilyguitar",
  displayName: "Emilyguitar · Clean Electric Guitar",
  instrumentId: "guitar.electric-clean",
  moduleId: "karoryfer-emily-guitar",
  manifestId: "karoryfer-emily-guitar",
  version: "b4920dc",
  license: "CC0-1.0",
  repositoryUrl: REPOSITORY,
  pinnedCommit: COMMIT,
  sfzPath: "emily_basic.sfz",
  sfzPaths: ["emily_basic.sfz"],
  estimatedMegabytes: 100,
  acknowledgement: `Karoryfer Emilyguitar se distribuye bajo CC0-1.0. Tloque instalará emily_basic.sfz y sus WAV desde el commit ${COMMIT}, verificará cada WAV y lo copiará a App Storage. El banco contiene cuatro capas de velocidad, tres round robins de notas y muestras físicas de release/ruido; Tloque no inventará técnicas que no estén grabadas.`,
  tags: ["native-samples", "guitar", "electric-guitar", "clean", "cc0", "velocity-layers", "round-robin", "release-samples"],
  samplePackInstall: {
    moduleId: "karoryfer-emily-guitar",
    manifestId: "karoryfer-emily-guitar",
    version: "b4920dc",
    pinnedCommit: COMMIT,
    sfzPath: "emily_basic.sfz",
    estimatedMegabytes: 100,
    acknowledgement: `Karoryfer Emilyguitar se distribuye bajo CC0-1.0. Tloque instalará emily_basic.sfz y sus WAV desde el commit ${COMMIT}, verificará cada WAV y lo copiará a App Storage.`,
    tags: ["native-samples", "guitar", "electric-guitar", "clean", "cc0", "velocity-layers", "round-robin", "release-samples"],
  },
}
