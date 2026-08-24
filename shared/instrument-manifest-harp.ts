import type { InstrumentManifest } from "./instrument-manifest"

/** CC0 concert harp recorded in the original Versilian Community Sample Library. */
export const VCSL_CONCERT_HARP_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vcsl-concert-harp",
  family: "strings",
  name: "VCSL Concert Harp",
  instruments: ["strings.harp"],
  basePrograms: [46],
  capabilities: ["velocity-layers"],
  articulations: [{ articulation: "normal", velocityLayers: 2 }],
}
