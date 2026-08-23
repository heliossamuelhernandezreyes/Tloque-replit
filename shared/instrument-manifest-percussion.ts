import type { InstrumentManifest } from "./instrument-manifest"

/**
 * VSCO timpani hits are pitched across MIDI 36..60 with physical velocity
 * layers and two recorded round robins. TimpaniRolls.sfz is kept as the real
 * tremolo/roll articulation instead of synthesizing repeated hits.
 */
export const VSCO2_CE_TIMPANI_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-timpani",
  family: "percussion",
  name: "VSCO 2 CE Timpani",
  instruments: ["percussion.timpani"],
  basePrograms: [47],
  capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [
    { articulation: "normal", velocityLayers: 3, roundRobins: 2 },
    { articulation: "tremolo", velocityLayers: 2 },
  ],
}

/** Tuned mallet instruments are separate upstream recordings and stay separate in Tloque. */
export const VSCO2_CE_GLOCKENSPIEL_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-glockenspiel",
  family: "percussion",
  name: "VSCO 2 CE Glockenspiel",
  instruments: ["percussion.glockenspiel"],
  basePrograms: [9],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const VSCO2_CE_MARIMBA_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-marimba",
  family: "percussion",
  name: "VSCO 2 CE Marimba",
  instruments: ["percussion.marimba"],
  basePrograms: [12],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const VSCO2_CE_XYLOPHONE_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-xylophone",
  family: "percussion",
  name: "VSCO 2 CE Xylophone",
  instruments: ["percussion.xylophone"],
  basePrograms: [13],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const VSCO2_CE_TUBULAR_BELLS_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-tubular-bells",
  family: "percussion",
  name: "VSCO 2 CE Tubular Bells",
  instruments: ["percussion.tubular-bells"],
  basePrograms: [14],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

/**
 * GM-StylePerc.sfz is treated as a semantic hit kit, not as a pitched keyboard.
 * MIDI keys are internal sample selectors only. Its regions contain real
 * velocity splits and, where upstream supplies them, alternate round robins.
 */
export const VSCO2_CE_ORCHESTRAL_PERCUSSION_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-orchestral-percussion",
  family: "percussion",
  name: "VSCO 2 CE Orchestral Percussion",
  instruments: ["percussion.orchestral-kit"],
  basePrograms: [],
  capabilities: ["velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", roundRobins: 2 }],
}

export const VSCO2_CE_TUNED_PERCUSSION_MANIFESTS = [
  VSCO2_CE_TIMPANI_MANIFEST,
  VSCO2_CE_GLOCKENSPIEL_MANIFEST,
  VSCO2_CE_MARIMBA_MANIFEST,
  VSCO2_CE_XYLOPHONE_MANIFEST,
  VSCO2_CE_TUBULAR_BELLS_MANIFEST,
] as const

export const VSCO2_CE_PERCUSSION_MANIFESTS = [
  ...VSCO2_CE_TUNED_PERCUSSION_MANIFESTS,
  VSCO2_CE_ORCHESTRAL_PERCUSSION_MANIFEST,
] as const
