import type { InstrumentManifest } from "./instrument-manifest"

/**
 * CC0 keyboard references sourced from the VCSL-derived Estuary sample set.
 * These manifests deliberately declare only capabilities visible in the physical files.
 */
export const VCSL_ESTUARY_GRAND_PIANO_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vcsl-estuary-grand-piano",
  family: "piano",
  name: "VCSL Grand Piano (Estuary WAV set)",
  instruments: ["piano.grand"],
  basePrograms: [0],
  capabilities: ["velocity-layers", "mic-positions"],
  articulations: [{ articulation: "normal", velocityLayers: 3 }],
}

export const VCSL_ESTUARY_PIPE_ORGAN_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vcsl-estuary-pipe-organ",
  family: "keys",
  name: "VCSL Pipe Organ (Estuary WAV set)",
  instruments: ["keys.pipe-organ"],
  basePrograms: [19],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const VCSL_ESTUARY_KEYS_MANIFESTS = [
  VCSL_ESTUARY_GRAND_PIANO_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_MANIFEST,
] as const
