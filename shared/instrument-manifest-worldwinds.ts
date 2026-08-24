import type { InstrumentManifest } from "./instrument-manifest"

/** CC0 colour winds from VCSL for Estuary. Capabilities only reflect selected physical WAVs. */
export const VCSL_ESTUARY_OCARINA_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vcsl-estuary-ocarina",
  family: "woodwinds",
  name: "VCSL Ocarina (Estuary WAV set)",
  instruments: ["woodwinds.ocarina"],
  basePrograms: [79],
  capabilities: ["dedicated-articulation"],
  articulations: [
    { articulation: "normal" },
    { articulation: "staccato" },
  ],
}

export const VCSL_ESTUARY_ALTO_RECORDER_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vcsl-estuary-alto-recorder",
  family: "woodwinds",
  name: "VCSL Alto Recorder (Estuary WAV set)",
  instruments: ["woodwinds.alto-recorder"],
  basePrograms: [74],
  capabilities: ["dedicated-articulation"],
  articulations: [
    { articulation: "normal" },
    { articulation: "staccato" },
  ],
}

export const VCSL_ESTUARY_WORLD_WIND_MANIFESTS = [
  VCSL_ESTUARY_OCARINA_MANIFEST,
  VCSL_ESTUARY_ALTO_RECORDER_MANIFEST,
] as const
