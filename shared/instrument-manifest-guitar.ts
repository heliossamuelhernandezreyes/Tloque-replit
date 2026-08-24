import type { InstrumentManifest } from "./instrument-manifest"

/**
 * Karoryfer Emilyguitar: clean electric guitar recorded direct.
 * The curated SFZ exposes four velocity layers, three round robins for notes,
 * and physical release/noise samples. Tloque does not invent strumming or
 * articulations that are not represented in the source bank.
 */
export const KARORYFER_EMILY_GUITAR_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "karoryfer-emily-guitar",
  family: "other",
  name: "Karoryfer Emilyguitar",
  instruments: ["guitar.electric-clean"],
  basePrograms: [27],
  capabilities: ["velocity-layers", "round-robin", "release-samples"],
  articulations: [
    { articulation: "normal", velocityLayers: 4, roundRobins: 3, releaseSamples: true },
    { articulation: "accent", velocityLayers: 4, roundRobins: 3, releaseSamples: true },
  ],
}
