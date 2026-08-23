import test from "node:test"
import assert from "node:assert/strict"
import type { PerformanceEventDecision } from "../client/src/audio/PerformanceEngine"
import { buildSamplerEventPlan, spessaSynthActions } from "../client/src/audio/SamplerAdapter"

function decision(overrides: Partial<PerformanceEventDecision> = {}): PerformanceEventDecision {
  return {
    eventIndex: 0,
    trackId: "violin",
    articulation: "normal",
    program: 40,
    source: "base-program",
    manifestId: "test",
    route: null,
    velocityLayer: 0,
    roundRobin: 0,
    trueLegato: false,
    releaseSamples: false,
    previousNotes: null,
    identity: "0:violin:C5",
    ...overrides,
  }
}

test("GM sólo emite acciones que SpessaSynth realmente entiende", () => {
  const plan = buildSamplerEventPlan(decision(), null)
  assert.deepEqual(spessaSynthActions(plan), [{ type: "program", program: 40 }])
  assert.ok(plan.actions.some(action => action.type === "velocity-layer"))
  assert.ok(plan.actions.some(action => action.type === "round-robin"))
})

test("un route premium puede convertir articulación en keyswitch y CC", () => {
  const route = {
    articulation: "legato" as const,
    program: 71,
    keyswitch: 24,
    controller: { cc: 32, value: 96 },
    velocityLayers: 4,
    roundRobins: 6,
    trueLegato: true,
    releaseSamples: true,
  }
  const plan = buildSamplerEventPlan(decision({
    articulation: "legato",
    program: 71,
    source: "dedicated-articulation",
    route,
    velocityLayer: 2,
    roundRobin: 4,
    trueLegato: true,
    releaseSamples: true,
    previousNotes: [72],
  }), route)
  assert.deepEqual(spessaSynthActions(plan), [
    { type: "program", program: 71 },
    { type: "keyswitch", note: 24, velocity: 96 },
    { type: "controller", cc: 32, value: 96 },
  ])
  assert.ok(plan.actions.some(action => action.type === "legato" && action.enabled))
  assert.ok(plan.actions.some(action => action.type === "release-samples" && action.enabled))
})
