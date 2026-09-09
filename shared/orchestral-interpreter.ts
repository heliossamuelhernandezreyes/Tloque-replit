export const ORCHESTRAL_INTERPRETER_VERSION = "tloque-orchestral-interpreter-v1" as const
export const ORCHESTRAL_INTERPRETER_RULE_VERSION = "tloque-orchestral-interpreter-rules-v1-phrase-harmony-expression" as const

export type OrchestralPhrasePhase = "entry" | "direction" | "climax" | "arrival" | "release"
export type OrchestralArticulationIntent = "connected" | "sustained" | "separated" | "impulse" | "release"
export type OrchestralInterpretationBasis = "music-design-heuristic"

export interface OrchestralInterpretationEnvelope {
  startScale: number
  peakScale: number
  endScale: number
  peakPosition: number
}

/**
 * Renderer-neutral interpretation of one authored score event. The contract is
 * deliberately descriptive and bounded: it never rewrites pitch, rhythm,
 * articulation or timbre, and it does not claim a sample capability that the
 * selected instrument bank does not actually contain.
 */
export interface OrchestralInterpretationGesture {
  contractVersion: typeof ORCHESTRAL_INTERPRETER_VERSION
  ruleVersion: typeof ORCHESTRAL_INTERPRETER_RULE_VERSION
  basis: OrchestralInterpretationBasis
  phrasePhase: OrchestralPhrasePhase
  articulationIntent: OrchestralArticulationIntent
  harmonicTension: number
  melodicWeight: number
  arrivalStrength: number
  dynamic: OrchestralInterpretationEnvelope
  vibrato: OrchestralInterpretationEnvelope
  sampleDynamicsScale: number
  attackTimeScale: number
  releaseTimeScale: number
  breathReset: boolean
  bowDirection: "down" | "up" | null
  reasons: readonly string[]
}

/** Stable per-track adjustment layered on top of the physical orchestra seating. */
export interface OrchestralStageIntent {
  contractVersion: typeof ORCHESTRAL_INTERPRETER_VERSION
  ruleVersion: typeof ORCHESTRAL_INTERPRETER_RULE_VERSION
  depthScale: number
  roomSendScale: number
  presenceScale: number
  panOffset: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum))
}

/** Piecewise-linear envelope with an explicit, bounded musical peak. */
export function orchestralInterpretationEnvelopeAt(
  envelope: OrchestralInterpretationEnvelope,
  progress: number,
) {
  const x = clamp(progress, 0, 1)
  const peak = clamp(envelope.peakPosition, 0.05, 0.95)
  if (x <= peak) {
    const amount = x / peak
    return envelope.startScale + (envelope.peakScale - envelope.startScale) * amount
  }
  const amount = (x - peak) / (1 - peak)
  return envelope.peakScale + (envelope.endScale - envelope.peakScale) * amount
}

export const NEUTRAL_ORCHESTRAL_INTERPRETATION: OrchestralInterpretationGesture = Object.freeze({
  contractVersion: ORCHESTRAL_INTERPRETER_VERSION,
  ruleVersion: ORCHESTRAL_INTERPRETER_RULE_VERSION,
  basis: "music-design-heuristic",
  phrasePhase: "direction",
  articulationIntent: "sustained",
  harmonicTension: 0,
  melodicWeight: 0.5,
  arrivalStrength: 0,
  dynamic: Object.freeze({ startScale: 1, peakScale: 1, endScale: 1, peakPosition: 0.58 }),
  vibrato: Object.freeze({ startScale: 1, peakScale: 1, endScale: 1, peakPosition: 0.62 }),
  sampleDynamicsScale: 1,
  attackTimeScale: 1,
  releaseTimeScale: 1,
  breathReset: false,
  bowDirection: null,
  reasons: Object.freeze([]),
})
