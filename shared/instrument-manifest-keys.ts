import type { InstrumentManifest } from "./instrument-manifest"

/** CC0 keyboard references. Capabilities are limited to what Tloque actually installs. */
export const VCSL_ESTUARY_GRAND_PIANO_MANIFEST: InstrumentManifest = {
  version: 1, id: "vcsl-estuary-grand-piano", family: "piano", name: "VCSL Grand Piano (Estuary WAV set)",
  instruments: ["piano.grand"], basePrograms: [0], capabilities: ["velocity-layers", "mic-positions"], articulations: [{ articulation: "normal", velocityLayers: 3 }],
}
export const VCSL_ESTUARY_PIPE_ORGAN_MANIFEST: InstrumentManifest = {
  version: 1, id: "vcsl-estuary-pipe-organ", family: "keys", name: "VCSL Pipe Organ · Rode Man3 Open",
  instruments: ["keys.pipe-organ"], basePrograms: [19], capabilities: [], articulations: [{ articulation: "normal" }],
}
export const VCSL_ESTUARY_PIPE_ORGAN_SOFT_MANIFEST: InstrumentManifest = {
  version: 1, id: "vcsl-estuary-pipe-organ-soft", family: "keys", name: "VCSL Pipe Organ · NT5 Man3 Quiet",
  instruments: ["keys.pipe-organ-soft"], basePrograms: [19], capabilities: [], articulations: [{ articulation: "normal" }],
}
export const VCSL_ESTUARY_PIPE_ORGAN_PEDAL_MANIFEST: InstrumentManifest = {
  version: 1, id: "vcsl-estuary-pipe-organ-pedal", family: "keys", name: "VCSL Pipe Organ · Rode Pedal",
  instruments: ["keys.pipe-organ-pedal"], basePrograms: [19], capabilities: [], articulations: [{ articulation: "normal" }],
}
export const VCSL_ITALIAN_HARPSICHORD_MANIFEST: InstrumentManifest = {
  version: 1, id: "vcsl-italian-harpsichord-stop1", family: "keys", name: "VCSL Italian Harpsichord · Stop 1",
  instruments: ["keys.harpsichord"], basePrograms: [6], capabilities: ["release-samples"], articulations: [{ articulation: "normal", releaseSamples: true }],
}
export const SAMPLED_CELESTA_TUNED_DENOISED_MIX_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "sampled-celesta-tuned-denoised-mix",
  family: "keys",
  name: "A Sampled Celesta · Mustel Tuned Denoised Mix",
  instruments: ["keys.celesta"],
  basePrograms: [8],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const VCSL_ESTUARY_KEYS_MANIFESTS = [
  VCSL_ESTUARY_GRAND_PIANO_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_SOFT_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_PEDAL_MANIFEST,
  VCSL_ITALIAN_HARPSICHORD_MANIFEST,
  SAMPLED_CELESTA_TUNED_DENOISED_MIX_MANIFEST,
] as const
