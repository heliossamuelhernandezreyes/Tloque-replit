import { DISCORD_MARTIN_HD28_MANIFEST, KARORYFER_EMILY_GUITAR_MANIFEST } from "./instrument-manifest-guitar"
import { VCSL_CONCERT_HARP_MANIFEST } from "./instrument-manifest-harp"
import { VCSL_ESTUARY_KEYS_MANIFESTS } from "./instrument-manifest-keys"
import { VCSL_ESTUARY_WORLD_WIND_MANIFESTS } from "./instrument-manifest-worldwinds"
import { VSCO2_CE_PERCUSSION_MANIFESTS } from "./instrument-manifest-percussion"
import { VSCO2_CE_STRING_SECTION_MANIFESTS } from "./instrument-manifest-string-sections"
export { DISCORD_MARTIN_HD28_MANIFEST, FREEPATS_SPANISH_CLASSICAL_GUITAR_MANIFEST, KARORYFER_EMILY_GUITAR_MANIFEST, NATIVE_GUITAR_MANIFESTS } from "./instrument-manifest-guitar"
export { VCSL_CONCERT_HARP_MANIFEST } from "./instrument-manifest-harp"
export {
  VCSL_ESTUARY_GRAND_PIANO_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_SOFT_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_PEDAL_MANIFEST,
  VCSL_ESTUARY_KEYS_MANIFESTS,
} from "./instrument-manifest-keys"
export {
  VCSL_ESTUARY_OCARINA_MANIFEST,
  VCSL_ESTUARY_ALTO_RECORDER_MANIFEST,
  VCSL_ESTUARY_WORLD_WIND_MANIFESTS,
} from "./instrument-manifest-worldwinds"
export { VSCO2_CE_VIOLIN_SECTION_MANIFEST, VSCO2_CE_STRING_SECTION_MANIFESTS } from "./instrument-manifest-string-sections"
export {
  VSCO2_CE_GLOCKENSPIEL_MANIFEST,
  VSCO2_CE_MARIMBA_MANIFEST,
  VSCO2_CE_ORCHESTRAL_PERCUSSION_MANIFEST,
  VSCO2_CE_PERCUSSION_MANIFESTS,
  VSCO2_CE_TIMPANI_MANIFEST,
  VSCO2_CE_TUBULAR_BELLS_MANIFEST,
  VSCO2_CE_XYLOPHONE_MANIFEST,
  VSCO2_CE_TUNED_PERCUSSION_MANIFESTS,
} from "./instrument-manifest-percussion"

export type TloqueArticulation = "normal" | "legato" | "staccato" | "tenuto" | "accent" | "spiccato" | "pizzicato" | "tremolo" | "harmonic"
export type PerformanceCapability = "dedicated-articulation" | "velocity-layers" | "round-robin" | "true-legato" | "release-samples" | "mic-positions"

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
  version: 1, id: "gm-orchestral-strings", family: "strings", name: "General MIDI orchestral strings",
  instruments: ["strings.violin", "strings.viola", "strings.cello", "strings.contrabass"], basePrograms: [40, 41, 42, 43], capabilities: ["dedicated-articulation"],
  articulations: [{ articulation: "tremolo", program: 44 }, { articulation: "pizzicato", program: 45 }],
}
export const VSCO2_CE_SOLO_VIOLIN_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-solo-violin", family: "strings", name: "VSCO 2 CE Solo Violin", instruments: ["strings.violin"], basePrograms: [40], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 36, velocityLayers: 2 }, { articulation: "tremolo", keyswitch: 37, velocityLayers: 2 }, { articulation: "spiccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 }, { articulation: "pizzicato", keyswitch: 39, velocityLayers: 2, roundRobins: 2 }],
}
export const VSCO2_CE_VIOLA_SECTION_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-viola-section", family: "strings", name: "VSCO 2 CE Viola Section", instruments: ["strings.viola"], basePrograms: [41], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 36, velocityLayers: 2 }, { articulation: "tremolo", keyswitch: 37, velocityLayers: 2 }, { articulation: "spiccato", keyswitch: 38, velocityLayers: 2, roundRobins: 2 }, { articulation: "pizzicato", keyswitch: 39, velocityLayers: 2, roundRobins: 2 }],
}
export const VSCO2_CE_CELLO_SECTION_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-cello-section", family: "strings", name: "VSCO 2 CE Cello Section", instruments: ["strings.cello"], basePrograms: [42], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 84, velocityLayers: 2 }, { articulation: "tremolo", keyswitch: 85, velocityLayers: 2 }, { articulation: "spiccato", keyswitch: 86, velocityLayers: 2, roundRobins: 2 }, { articulation: "pizzicato", keyswitch: 87, velocityLayers: 2, roundRobins: 2 }],
}
export const VSCO2_CE_SOLO_CONTRABASS_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-solo-contrabass", family: "strings", name: "VSCO 2 CE Solo Contrabass", instruments: ["strings.contrabass"], basePrograms: [43], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 85, velocityLayers: 2 }, { articulation: "tremolo", keyswitch: 86, velocityLayers: 2 }, { articulation: "spiccato", keyswitch: 87, velocityLayers: 2, roundRobins: 2 }, { articulation: "pizzicato", keyswitch: 88, velocityLayers: 2, roundRobins: 2 }],
}
export const VSCO2_CE_FLUTE_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-flute", family: "woodwinds", name: "VSCO 2 CE Flute", instruments: ["woodwinds.flute"], basePrograms: [73], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 36 }, { articulation: "staccato", keyswitch: 39, roundRobins: 2 }],
}
export const VSCO2_CE_CLARINET_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-clarinet", family: "woodwinds", name: "VSCO 2 CE Clarinet", instruments: ["woodwinds.clarinet"], basePrograms: [71], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 36, velocityLayers: 3 }, { articulation: "staccato", keyswitch: 37, velocityLayers: 3, roundRobins: 2 }],
}
export const VSCO2_CE_OBOE_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-oboe", family: "woodwinds", name: "VSCO 2 CE Oboe", instruments: ["woodwinds.oboe"], basePrograms: [68], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", velocityLayers: 2 }, { articulation: "staccato", velocityLayers: 3, roundRobins: 2 }],
}
export const VSCO2_CE_BASSOON_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-bassoon", family: "woodwinds", name: "VSCO 2 CE Bassoon", instruments: ["woodwinds.bassoon"], basePrograms: [70], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", velocityLayers: 2 }, { articulation: "staccato", velocityLayers: 2, roundRobins: 2 }],
}
export const VSCO2_CE_TRUMPET_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-trumpet", family: "brass", name: "VSCO 2 CE Trumpet", instruments: ["brass.trumpet"], basePrograms: [56], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", velocityLayers: 2 }, { articulation: "staccato", velocityLayers: 3, roundRobins: 2 }],
}
export const VSCO2_CE_TENOR_TROMBONE_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-tenor-trombone", family: "brass", name: "VSCO 2 CE Tenor Trombone", instruments: ["brass.trombone"], basePrograms: [57], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", velocityLayers: 4 }, { articulation: "staccato", velocityLayers: 4, roundRobins: 2 }],
}
export const VSCO2_CE_F_HORN_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-f-horn", family: "brass", name: "VSCO 2 CE F Horn", instruments: ["brass.horn"], basePrograms: [60], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", velocityLayers: 4 }, { articulation: "staccato", velocityLayers: 3, roundRobins: 2 }],
}
export const VSCO2_CE_TUBA_MANIFEST: InstrumentManifest = {
  version: 1, id: "vsco2-ce-tuba", family: "brass", name: "VSCO 2 CE Tuba", instruments: ["brass.tuba"], basePrograms: [58], capabilities: ["dedicated-articulation", "velocity-layers", "round-robin"],
  articulations: [{ articulation: "normal", keyswitch: 84, velocityLayers: 3 }, { articulation: "staccato", keyswitch: 85, velocityLayers: 2, roundRobins: 4 }],
}
export const SFZINSTRUMENTS_LEGATO_VOCAL_A_MANIFEST: InstrumentManifest = {
  version: 1, id: "sfzinstruments-legato-vocal-a", family: "other", name: "SFZ Instruments Legato Vocal A", instruments: ["voice.legato-a"], basePrograms: [52], capabilities: ["dedicated-articulation", "true-legato"],
  articulations: [{ articulation: "normal" }, { articulation: "legato", trueLegato: true }],
}

export const BUILTIN_INSTRUMENT_MANIFESTS: readonly InstrumentManifest[] = [GM_ORCHESTRAL_STRINGS_MANIFEST]
export const INSTRUMENT_MANIFEST_REGISTRY: readonly InstrumentManifest[] = [
  GM_ORCHESTRAL_STRINGS_MANIFEST,
  KARORYFER_EMILY_GUITAR_MANIFEST,
  DISCORD_MARTIN_HD28_MANIFEST,
  VSCO2_CE_SOLO_VIOLIN_MANIFEST,
  ...VSCO2_CE_STRING_SECTION_MANIFESTS,
  VSCO2_CE_VIOLA_SECTION_MANIFEST,
  VSCO2_CE_CELLO_SECTION_MANIFEST,
  VSCO2_CE_SOLO_CONTRABASS_MANIFEST,
  VCSL_CONCERT_HARP_MANIFEST,
  VSCO2_CE_FLUTE_MANIFEST,
  VSCO2_CE_CLARINET_MANIFEST,
  VSCO2_CE_OBOE_MANIFEST,
  VSCO2_CE_BASSOON_MANIFEST,
  ...VCSL_ESTUARY_WORLD_WIND_MANIFESTS,
  VSCO2_CE_TRUMPET_MANIFEST,
  VSCO2_CE_TENOR_TROMBONE_MANIFEST,
  VSCO2_CE_F_HORN_MANIFEST,
  VSCO2_CE_TUBA_MANIFEST,
  SFZINSTRUMENTS_LEGATO_VOCAL_A_MANIFEST,
  ...VCSL_ESTUARY_KEYS_MANIFESTS,
  ...VSCO2_CE_PERCUSSION_MANIFESTS,
]
export function instrumentManifestById(id: string | null | undefined): InstrumentManifest | null { if (!id) return null; return INSTRUMENT_MANIFEST_REGISTRY.find(manifest => manifest.id === id) ?? null }
export function manifestsForModule(id: string | null | undefined): readonly InstrumentManifest[] { const selected = instrumentManifestById(id); return selected ? [selected, ...BUILTIN_INSTRUMENT_MANIFESTS.filter(item => item.id !== selected.id)] : BUILTIN_INSTRUMENT_MANIFESTS }
