import type { ScoreTimbre } from "./tloque-score-v2"
import type { TloqueMute, TloqueVibratoColour } from "./native-sample-pack"

export type ExplicitRecordedTimbre = Exclude<ScoreTimbre, "natural">

export interface RecordedTimbreProfile {
  moduleId: string
  /** Physical colour used when an old/new score asks for timbre=natural. */
  defaultTimbre: ExplicitRecordedTimbre
  /** Only variants verified in the pinned upstream library belong here. */
  availableTimbres: readonly ExplicitRecordedTimbre[]
}

export const RECORDED_TIMBRE_PROFILES: readonly RecordedTimbreProfile[] = [
  { moduleId: "vsco2-ce-solo-violin", defaultTimbre: "vibrato", availableTimbres: ["vibrato"] },
  { moduleId: "vsco2-ce-viola-section", defaultTimbre: "vibrato", availableTimbres: ["vibrato"] },
  { moduleId: "vsco2-ce-cello-section", defaultTimbre: "vibrato", availableTimbres: ["vibrato"] },
  { moduleId: "vsco2-ce-solo-contrabass", defaultTimbre: "vibrato", availableTimbres: ["non-vibrato", "vibrato"] },
  { moduleId: "vsco2-ce-flute", defaultTimbre: "non-vibrato", availableTimbres: ["non-vibrato", "vibrato", "expression-vibrato"] },
  { moduleId: "vsco2-ce-oboe", defaultTimbre: "non-vibrato", availableTimbres: ["non-vibrato", "vibrato"] },
  { moduleId: "vsco2-ce-bassoon", defaultTimbre: "non-vibrato", availableTimbres: ["non-vibrato", "vibrato"] },
  { moduleId: "vsco2-ce-trumpet", defaultTimbre: "non-vibrato", availableTimbres: ["non-vibrato", "vibrato", "straight-mute", "harmon-mute"] },
  { moduleId: "vsco2-ce-tenor-trombone", defaultTimbre: "non-vibrato", availableTimbres: ["non-vibrato", "vibrato"] },
  { moduleId: "vsco2-ce-f-horn", defaultTimbre: "non-vibrato", availableTimbres: ["non-vibrato", "mute"] },
] as const

export function recordedTimbreProfileFor(moduleId: string | null | undefined): RecordedTimbreProfile | null {
  if (!moduleId) return null
  return RECORDED_TIMBRE_PROFILES.find(profile => profile.moduleId === moduleId) ?? null
}

/**
 * `natural` is compatibility-preserving: it means the module's established
 * recorded default, not universally "non-vibrato". Explicit colours never
 * silently downgrade to another physical recording.
 */
export function resolveRecordedTimbre(moduleId: string, requested: ScoreTimbre): ExplicitRecordedTimbre {
  const profile = recordedTimbreProfileFor(moduleId)
  if (requested === "natural") return profile?.defaultTimbre ?? "non-vibrato"
  if (profile && !profile.availableTimbres.includes(requested)) {
    throw new Error(`El módulo ${moduleId} no contiene timbre=${requested}`)
  }
  return requested
}

export function physicalRecordedTimbre(timbre: ExplicitRecordedTimbre): { vibratoColour: TloqueVibratoColour; mute: TloqueMute } {
  switch (timbre) {
    case "vibrato": return { vibratoColour: "vibrato", mute: "none" }
    case "expression-vibrato": return { vibratoColour: "expression", mute: "none" }
    case "mute": return { vibratoColour: "none", mute: "mute" }
    case "harmon-mute": return { vibratoColour: "none", mute: "harmon" }
    case "straight-mute": return { vibratoColour: "none", mute: "straight" }
    case "non-vibrato":
    default: return { vibratoColour: "none", mute: "none" }
  }
}
