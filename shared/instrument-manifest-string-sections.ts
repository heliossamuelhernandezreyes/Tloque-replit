import type { InstrumentManifest } from "./instrument-manifest"

/** Dedicated ensemble identity for tutti writing; kept separate from the solo violin. */
export const VSCO2_CE_VIOLIN_SECTION_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-violin-section",
  family: "strings",
  name: "VSCO 2 CE Violin Section",
  instruments: ["strings.violin-section"],
  basePrograms: [40],
  capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [
    { articulation: "normal", keyswitch: 36, velocityLayers: 2 },
    { articulation: "tremolo", keyswitch: 37, velocityLayers: 2 },
    { articulation: "spiccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 },
    { articulation: "pizzicato", keyswitch: 39, velocityLayers: 2, roundRobins: 2 },
  ],
}

export const VSCO2_CE_STRING_SECTION_MANIFESTS = [VSCO2_CE_VIOLIN_SECTION_MANIFEST] as const
