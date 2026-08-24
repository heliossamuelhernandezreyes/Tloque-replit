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

/** VSCO 2 CE piccolo: five recorded sustain roots + five recorded staccato roots. */
export const VSCO2_CE_PICCOLO_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-piccolo",
  family: "woodwinds",
  name: "VSCO 2 CE Piccolo",
  instruments: ["woodwinds.piccolo"],
  basePrograms: [72],
  capabilities: ["dedicated-articulation"],
  articulations: [
    { articulation: "normal" },
    { articulation: "staccato" },
  ],
}

// Historical export name retained because instrument-manifest.ts already consumes it.
// It now represents all auxiliary/native wind manifests, not only the Estuary pair.
export const VCSL_ESTUARY_WORLD_WIND_MANIFESTS = [
  VCSL_ESTUARY_OCARINA_MANIFEST,
  VCSL_ESTUARY_ALTO_RECORDER_MANIFEST,
  VSCO2_CE_PICCOLO_MANIFEST,
] as const
