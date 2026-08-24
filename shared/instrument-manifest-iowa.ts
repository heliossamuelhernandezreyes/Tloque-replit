import type { InstrumentManifest } from "./instrument-manifest"

/** Iowa MIS chromatic ff bass clarinet. One physical recording per semitone. */
export const IOWA_BASS_CLARINET_FF_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "iowa-mis-bass-clarinet-ff",
  family: "woodwinds",
  name: "University of Iowa MIS Bass Clarinet · ff",
  instruments: ["woodwinds.bass-clarinet"],
  basePrograms: [71],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

/** Iowa MIS chromatic ff bass trombone. One physical recording per semitone. */
export const IOWA_BASS_TROMBONE_FF_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "iowa-mis-bass-trombone-ff",
  family: "brass",
  name: "University of Iowa MIS Bass Trombone · ff",
  instruments: ["brass.bass-trombone"],
  basePrograms: [57],
  capabilities: [],
  articulations: [{ articulation: "normal" }],
}

export const IOWA_MIS_MANIFESTS = [IOWA_BASS_CLARINET_FF_MANIFEST, IOWA_BASS_TROMBONE_FF_MANIFEST] as const
