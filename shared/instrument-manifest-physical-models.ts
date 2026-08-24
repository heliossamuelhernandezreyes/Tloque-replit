import type { InstrumentManifest } from "./instrument-manifest"

export const TLOQUE_ENGLISH_HORN_MODEL_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "tloque-model-english-horn-v1",
  family: "woodwinds",
  name: "Tloque Physical Model · English Horn v1",
  instruments: ["woodwinds.english-horn"],
  basePrograms: [69],
  capabilities: ["dedicated-articulation"],
  articulations: [
    { articulation: "normal" },
    { articulation: "legato" },
    { articulation: "staccato" },
    { articulation: "tenuto" },
    { articulation: "accent" },
  ],
}

export const TLOQUE_CONTRABASSOON_MODEL_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "tloque-model-contrabassoon-v1",
  family: "woodwinds",
  name: "Tloque Physical Model · Contrabassoon v1",
  instruments: ["woodwinds.contrabassoon"],
  basePrograms: [70],
  capabilities: ["dedicated-articulation"],
  articulations: [
    { articulation: "normal" },
    { articulation: "legato" },
    { articulation: "staccato" },
    { articulation: "tenuto" },
    { articulation: "accent" },
  ],
}

export const TLOQUE_PHYSICAL_MODEL_MANIFESTS = [
  TLOQUE_ENGLISH_HORN_MODEL_MANIFEST,
  TLOQUE_CONTRABASSOON_MODEL_MANIFEST,
] as const
