import type { OrchestralInterpretationGesture } from "./orchestral-interpreter"

export const INTELLIGENT_PERFORMER_VERSION = "tloque-intelligent-performer-v6-orchestral-interpreter" as const
export const INTELLIGENT_PERFORMER_RULE_VERSION = "tloque-intelligent-performer-rules-v2-score-aware-expression" as const

export type PerformanceMedium = "bow" | "breath" | "key" | "pluck" | "strike" | "sustain"
export type PerformanceConnection = "fresh-attack" | "phrase-carry" | "recorded-legato"
export type BowDirection = "down" | "up"

/**
 * Renderer-neutral instructions for how one authored event should be performed.
 * Values are deliberately bounded musical controls, not claims about a player's
 * physiology or a substitute for articulations actually present in a sample bank.
 */
export interface IntelligentPerformanceGesture {
  contractVersion: typeof INTELLIGENT_PERFORMER_VERSION
  ruleVersion: typeof INTELLIGENT_PERFORMER_RULE_VERSION
  medium: PerformanceMedium
  connection: PerformanceConnection
  attackTimeScale: number
  releaseTimeScale: number
  onsetEffort: number
  sustainEffort: number
  releaseEffort: number
  brightnessScale: number
  vibratoDepthScale: number
  vibratoDelaySeconds: number
  transitionSeconds: number
  bowDirection: BowDirection | null
  breathReset: boolean
  interpretation: OrchestralInterpretationGesture
}
