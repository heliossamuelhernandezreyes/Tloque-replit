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
  program?: number
  keyswitch?: number
  controller?: { cc: number; value: number }
  velocityLayers?: number
  roundRobins?: number
  trueLegato?: boolean
  releaseSamples?: boolean
}

export interface InstrumentManifest {
  version: 1
  id: string
  family: "strings" | "piano" | "woodwinds" | "brass" | "percussion" | "keys" | "synth" | "other"
  name: string
  instruments: readonly string[]
  basePrograms: readonly number[]
  capabilities: readonly PerformanceCapability[]
  articulations: readonly InstrumentArticulationRoute[]
}

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

/** Solo violin: C2 sustain, C#2 tremolo, D2 spiccato, D#2 pizzicato. */
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
    { articulation: "tremolo", keyswitch: 37, velocityLayers: 2 },
    { articulation: "spiccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 },
    { articulation: "pizzicato", keyswitch: 39, velocityLayers: 2, roundRobins: 2 },
  ],
}

/** Upstream recording is a viola section, not a solo viola. C2-D#2 keyswitches. */
export const VSCO2_CE_VIOLA_SECTION_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-viola-section",
  family: "strings",
  name: "VSCO 2 CE Viola Section",
  instruments: ["strings.viola"],
  basePrograms: [41],
  capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [
    { articulation: "normal", keyswitch: 36, velocityLayers: 2 },
    { articulation: "tremolo", keyswitch: 37, velocityLayers: 2 },
    { articulation: "spiccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 },
    { articulation: "pizzicato", keyswitch: 39, velocityLayers: 2, roundRobins: 2 },
  ],
}

/** Upstream recording is a cello section. C6-D#6 keyswitches. */
export const VSCO2_CE_CELLO_SECTION_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-cello-section",
  family: "strings",
  name: "VSCO 2 CE Cello Section",
  instruments: ["strings.cello"],
  basePrograms: [42],
  capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [
    { articulation: "normal", keyswitch: 84, velocityLayers: 2 },
    { articulation: "tremolo", keyswitch: 85, velocityLayers: 2 },
    { articulation: "spiccato", keyswitch: 86, velocityLayers: 2, roundRobins: 2 },
    { articulation: "pizzicato", keyswitch: 87, velocityLayers: 2, roundRobins: 2 },
  ],
}

/**
 * Solo contrabass exposes both non-vibrato and vibrato sustain upstream. Tloque
 * uses the vibrato sustain (C#6) as its current `normal` voice; C6 remains an
 * upstream alternate not falsely advertised as a separate articulation.
 * D6 tremolo, D#6 spiccato, E6 pizzicato.
 */
export const VSCO2_CE_SOLO_CONTRABASS_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "vsco2-ce-solo-contrabass",
  family: "strings",
  name: "VSCO 2 CE Solo Contrabass",
  instruments: ["strings.contrabass"],
  basePrograms: [43],
  capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [
    { articulation: "normal", keyswitch: 85, velocityLayers: 2 },
    { articulation: "tremolo", keyswitch: 86, velocityLayers: 2 },
    { articulation: "spiccato", keyswitch: 87, velocityLayers: 2, roundRobins: 2 },
    { articulation: "pizzicato", keyswitch: 88, velocityLayers: 2, roundRobins: 2 },
  ],
}

export const BUILTIN_INSTRUMENT_MANIFESTS: readonly InstrumentManifest[] = [
  GM_ORCHESTRAL_STRINGS_MANIFEST,
]

export const INSTRUMENT_MANIFEST_REGISTRY: readonly InstrumentManifest[] = [
  GM_ORCHESTRAL_STRINGS_MANIFEST,
  VSCO2_CE_SOLO_VIOLIN_MANIFEST,
  VSCO2_CE_VIOLA_SECTION_MANIFEST,
  VSCO2_CE_CELLO_SECTION_MANIFEST,
  VSCO2_CE_SOLO_CONTRABASS_MANIFEST,
]

export function instrumentManifestById(id: string | null | undefined): InstrumentManifest | null {
  if (!id) return null
  return INSTRUMENT_MANIFEST_REGISTRY.find(manifest => manifest.id === id) ?? null
}

export function manifestsForModule(id: string | null | undefined): readonly InstrumentManifest[] {
  const selected = instrumentManifestById(id)
  return selected ? [selected, ...BUILTIN_INSTRUMENT_MANIFESTS.filter(item => item.id !== selected.id)] : BUILTIN_INSTRUMENT_MANIFESTS
}
