export const ORCHESTRA_CONDUCTOR_VERSION = "tloque-orchestra-conductor-v7-acoustic-continuity" as const
export const ORCHESTRA_CONDUCTOR_RULE_VERSION = "tloque-orchestra-conductor-rules-v2-musical-onset-audible-gap" as const

export type OrchestraEnsemblePhase = "entry" | "build" | "crest" | "release"

/** Renderer-neutral ensemble intent. Values are deliberately bounded so the
 * conductor can coordinate renderers without rewriting authored notes. */
export interface OrchestraConductorGesture {
  contractVersion: typeof ORCHESTRA_CONDUCTOR_VERSION
  ruleVersion: typeof ORCHESTRA_CONDUCTOR_RULE_VERSION
  ensemblePhase: OrchestraEnsemblePhase
  ensembleEnergy: number
  memoryEnergy: number
  density: number
  audibleGapSeconds: number
  balanceScale: number
  colourScale: number
  attackCohesionScale: number
  releaseCohesionScale: number
  sectionSpreadSeconds: number
  sectionSpreadCents: number
}

export const NEUTRAL_ORCHESTRA_CONDUCTOR_GESTURE: OrchestraConductorGesture = Object.freeze({
  contractVersion: ORCHESTRA_CONDUCTOR_VERSION,
  ruleVersion: ORCHESTRA_CONDUCTOR_RULE_VERSION,
  ensemblePhase: "entry",
  ensembleEnergy: 0.5,
  memoryEnergy: 0.5,
  density: 0,
  audibleGapSeconds: 0,
  balanceScale: 1,
  colourScale: 1,
  attackCohesionScale: 1,
  releaseCohesionScale: 1,
  sectionSpreadSeconds: 0,
  sectionSpreadCents: 0,
})
