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

/** FreePats nylon-string candidate retained for a future FLAC-capable source adapter. */
export const FREEPATS_SPANISH_CLASSICAL_GUITAR_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "freepats-spanish-classical-guitar",
  family: "other",
  name: "FreePats Spanish Classical Guitar",
  instruments: ["guitar.acoustic-nylon"],
  basePrograms: [24],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

/**
 * Jeff Learman's Martin HD28 contribution to the Discord SFZ GM bank.
 * The source SFZ explicitly declares CC0 and uses fifteen physical WAV roots
 * spanning the guitar register. Tloque routes the generic acoustic-guitar role
 * here until a denser nylon/steel selector is introduced.
 */
export const DISCORD_MARTIN_HD28_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "discord-martin-hd28",
  family: "other",
  name: "Discord SFZ GM · Martin HD28",
  instruments: ["guitar.acoustic"],
  basePrograms: [25],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const NATIVE_GUITAR_MANIFESTS = [
  KARORYFER_EMILY_GUITAR_MANIFEST,
  DISCORD_MARTIN_HD28_MANIFEST,
  FREEPATS_SPANISH_CLASSICAL_GUITAR_MANIFEST,
] as const
