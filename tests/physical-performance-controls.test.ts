import { describe, expect, it } from "vitest"
import { physicalControlSupportedByInstrument, physicalPerformanceStateAt } from "../shared/physical-performance-control"

const track = {
  id: "t1",
  instrument: "piano.grand",
  expression: 0.4,
  brightness: 0.7,
  vibrato: 0,
} as any

const control = (timeSeconds: number, values: Partial<Record<"expression" | "brightness" | "pedal", number | boolean>>) => ({
  trackId: "t1",
  timeSeconds,
  expression: values.expression ?? null,
  brightness: values.brightness ?? null,
  vibrato: null,
  pitchBend: null,
  gain: null,
  pedal: values.pedal ?? null,
  rampSeconds: 0,
}) as any

describe("physical performance controls", () => {
  it("maps controls to the correct instrument families", () => {
    expect(physicalControlSupportedByInstrument("strings.violin", "bowPosition")).toBe(true)
    expect(physicalControlSupportedByInstrument("strings.violin", "embouchure")).toBe(false)
    expect(physicalControlSupportedByInstrument("woodwinds.oboe", "embouchure")).toBe(true)
    expect(physicalControlSupportedByInstrument("brass.horn", "pressure")).toBe(true)
    expect(physicalControlSupportedByInstrument("piano.grand", "pedal")).toBe(true)
    expect(physicalControlSupportedByInstrument("strings.harp", "pluckPosition")).toBe(true)
    expect(physicalControlSupportedByInstrument("percussion.timpani", "sympatheticCoupling")).toBe(false)
  })

  it("derives pressure and positions from backwards-compatible score controls", () => {
    const state = physicalPerformanceStateAt(track, [], 0)
    expect(state.pressure).toBeCloseTo(0.4)
    expect(state.bowPosition).toBeCloseTo(0.7)
    expect(state.pluckPosition).toBeCloseTo(0.7)
    expect(state.embouchure).toBeCloseTo(0.7)
    expect(state.pedal).toBe(0)
    expect(state.damper).toBe(1)
  })

  it("turns the existing pedal command into continuous physical pedal/damper semantics", () => {
    const controls = [control(1, { pedal: true }), control(2, { expression: 0.8, brightness: 0.25 })]
    const down = physicalPerformanceStateAt(track, controls, 1.5)
    const later = physicalPerformanceStateAt(track, controls, 2.5)
    expect(down.pedal).toBe(1)
    expect(down.damper).toBe(0)
    expect(down.sympatheticCoupling).toBeGreaterThan(0.7)
    expect(later.pressure).toBeCloseTo(0.8)
    expect(later.pluckPosition).toBeCloseTo(0.25)
    expect(later.embouchure).toBeCloseTo(0.25)
  })
})
