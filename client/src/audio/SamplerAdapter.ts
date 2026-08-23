import type { InstrumentArticulationRoute } from "@shared/instrument-manifest"
import type { PerformanceEventDecision } from "./PerformanceEngine"

export type SamplerAction =
  | { type: "program"; program: number }
  | { type: "keyswitch"; note: number; velocity: number }
  | { type: "controller"; cc: number; value: number }
  | { type: "velocity-layer"; index: number }
  | { type: "round-robin"; index: number }
  | { type: "legato"; enabled: boolean; previousNotes: readonly number[] | null }
  | { type: "release-samples"; enabled: boolean }

export interface SamplerEventPlan {
  decision: PerformanceEventDecision
  actions: readonly SamplerAction[]
}

function midi7(value: number) {
  return Math.max(0, Math.min(127, Math.round(value)))
}

/**
 * Converts renderer-neutral performance decisions into concrete sampler setup
 * actions. Unsupported capabilities remain metadata instead of being faked.
 */
export function buildSamplerEventPlan(
  decision: PerformanceEventDecision,
  route: InstrumentArticulationRoute | null,
): SamplerEventPlan {
  const actions: SamplerAction[] = [{ type: "program", program: decision.program }]

  if (route?.keyswitch !== undefined) {
    actions.push({ type: "keyswitch", note: route.keyswitch, velocity: 96 })
  }
  if (route?.controller) {
    actions.push({ type: "controller", cc: route.controller.cc, value: midi7(route.controller.value) })
  }

  actions.push({ type: "velocity-layer", index: decision.velocityLayer })
  actions.push({ type: "round-robin", index: decision.roundRobin })
  actions.push({ type: "legato", enabled: decision.trueLegato, previousNotes: decision.previousNotes })
  actions.push({ type: "release-samples", enabled: decision.releaseSamples })

  return { decision, actions }
}

/**
 * SpessaSynth/SF2 compatibility adapter. General MIDI banks only understand
 * program/keyswitch/controller messages, so premium-only metadata is ignored
 * rather than approximated acoustically.
 */
export function spessaSynthActions(plan: SamplerEventPlan): SamplerAction[] {
  return plan.actions.filter(action =>
    action.type === "program" || action.type === "keyswitch" || action.type === "controller",
  )
}
