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

/**
 * FreePats Spanish Classical Guitar. The upstream bank is a CC0 multisample
 * instrument recorded from a real nylon-string classical guitar. Tloque keeps
 * the physical SFZ mapping strict and does not synthesize strums or articulations
 * absent from the source.
 */
export const FREEPATS_SPANISH_CLASSICAL_GUITAR_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "freepats-spanish-classical-guitar",
  family: "other",
  name: "FreePats Spanish Classical Guitar",
  instruments: ["guitar.acoustic"],
  basePrograms: [24],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const NATIVE_GUITAR_MANIFESTS = [
  KARORYFER_EMILY_GUITAR_MANIFEST,
  FREEPATS_SPANISH_CLASSICAL_GUITAR_MANIFEST,
] as const
