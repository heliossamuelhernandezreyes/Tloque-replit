export type TloqueArticulation =
  | "normal"
  | "legato"
  | "staccato"
  | "tenuto"
  | "accent"
  | "spiccato"
  | "pizzicato"
  | "tremolo"
  | "harmonic"

export type PerformanceCapability =
  | "dedicated-articulation"
  | "velocity-layers"
  | "round-robin"
  | "true-legato"
  | "release-samples"
  | "mic-positions"

export interface InstrumentArticulationRoute {
  articulation: TloqueArticulation
  /** General MIDI program or module-local preset used by SF2/SF3/DLS renderers. */
  program?: number
  /** Optional future keyswitch for samplers that expose articulations in one preset. */
  keyswitch?: number
  /** Optional future CC selector for samplers that expose articulations by controller. */
  controller?: { cc: number; value: number }
  /** Number of discrete recorded dynamics, when known. */
  velocityLayers?: number
  /** Number of alternate attacks for repeated notes, when known. */
  roundRobins?: number
  /** Whether the articulation may use recorded interval transitions. */
  trueLegato?: boolean
  /** Whether note-off can trigger a dedicated release sample. */
  releaseSamples?: boolean
}

export interface InstrumentManifest {
  version: 1
  id: string
  family: "strings" | "piano" | "woodwinds" | "brass" | "percussion" | "keys" | "synth" | "other"
  name: string
  /** Semantic Tloque instrument ids this manifest may satisfy. */
  instruments: readonly string[]
  /** GM-compatible programs that may fall back to this manifest. */
  basePrograms: readonly number[]
  capabilities: readonly PerformanceCapability[]
  articulations: readonly InstrumentArticulationRoute[]
}

/**
 * Compatibility manifest for ordinary GM orchestral-string banks.
 * It deliberately claims only what General MIDI really standardizes:
 * sustained strings plus dedicated tremolo (44) and pizzicato (45) programs.
 * Legato, spiccato, harmonics, round-robin and release samples are NOT claimed.
 */
export const GM_ORCHESTRAL_STRINGS_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "gm-orchestral-strings",
  family: "strings",
  name: "General MIDI orchestral strings",
  instruments: ["strings.violin", "strings.viola", "strings.cello", "strings.contrabass"],
  basePrograms: [40, 41, 42, 43],
  capabilities: ["dedicated-articulation"],
  articulations: [
    { articulation: "tremolo", program: 44 },
    { articulation: "pizzicato", program: 45 },
  ],
}

export const BUILTIN_INSTRUMENT_MANIFESTS: readonly InstrumentManifest[] = [
  GM_ORCHESTRAL_STRINGS_MANIFEST,
]
