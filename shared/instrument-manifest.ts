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
  /** Sampler keyswitch used before the note when a premium module exposes one. */
  keyswitch?: number
  /** Sampler controller selector used before the note when a module exposes one. */
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

/**
 * Verified mapping for the VSCO 2 Community Edition solo-violin keyswitch SFZ.
 * Source: SViolin-KS.sfz on the upstream SFZ branch. The library is CC0.
 *
 * C2  (36) sustain vibrato
 * C#2 (37) tremolo
 * D2  (38) spiccato
 * D#2 (39) pizzicato
 *
 * Sustain/tremolo/spiccato/pizzicato expose two recorded velocity ranges.
 * Spiccato and pizzicato expose two alternate attacks. VSCO CE does not claim
 * recorded interval-legato here, so true-legato remains deliberately false.
 * This manifest is NOT part of BUILTIN_INSTRUMENT_MANIFESTS: it must be chosen
 * explicitly for a VSCO-derived module so ordinary GM banks never receive its
 * keyswitch protocol.
 */
export const VSCO2_CE_SOLO_VIOLIN_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-solo-violin",
  family: "strings",
  name: "VSCO 2 CE Solo Violin",
  instruments: ["strings.violin"],
  basePrograms: [40],
  capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [
    { articulation: "normal", keyswitch: 36, velocityLayers: 2 },
    { articulation: "legato", keyswitch: 36, velocityLayers: 2 },
    { articulation: "tenuto", keyswitch: 36, velocityLayers: 2 },
    { articulation: "tremolo", keyswitch: 37, velocityLayers: 2 },
    { articulation: "spiccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 },
    { articulation: "staccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 },
    { articulation: "pizzicato", keyswitch: 39, velocityLayers: 2, roundRobins: 2 },
  ],
}

export const BUILTIN_INSTRUMENT_MANIFESTS: readonly InstrumentManifest[] = [
  GM_ORCHESTRAL_STRINGS_MANIFEST,
]

export const INSTRUMENT_MANIFEST_REGISTRY: readonly InstrumentManifest[] = [
  GM_ORCHESTRAL_STRINGS_MANIFEST,
  VSCO2_CE_SOLO_VIOLIN_MANIFEST,
]

export function instrumentManifestById(id: string | null | undefined): InstrumentManifest | null {
  if (!id) return null
  return INSTRUMENT_MANIFEST_REGISTRY.find(manifest => manifest.id === id) ?? null
}

export function manifestsForModule(id: string | null | undefined): readonly InstrumentManifest[] {
  const selected = instrumentManifestById(id)
  return selected ? [selected, ...BUILTIN_INSTRUMENT_MANIFESTS.filter(item => item.id !== selected.id)] : BUILTIN_INSTRUMENT_MANIFESTS
}
