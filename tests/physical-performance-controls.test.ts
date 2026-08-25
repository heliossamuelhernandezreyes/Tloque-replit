import { describe, expect, it } from "vitest"
import { physicalControlSupportedByInstrument, physicalPerformanceStateAt } from "../shared/physical-performance-control"

const track = {
  id: "t1",
  instrument: "piano.grand",
  expression: 0.4,
  brightness: 0.7,
  vibrato: 0,
} as any

const control = (timeSeconds: number, values: Partial<Record<"expression" | "brightness" | "pedal" | "pressure" | "embouchure" | "bowPosition" | "pluckPosition" | "damper" | "sympatheticCoupling", number | boolean>>) => ({
  trackId: "t1",
  timeSeconds,
  expression: values.expression ?? null,
  brightness: values.brightness ?? null,
  vibrato: null,
  pitchBend: null,
  pedal: values.pedal ?? null,
  pressure: values.pressure ?? null,
  embouchure: values.embouchure ?? null,
  bowPosition: values.bowPosition ?? null,
  pluckPosition: values.pluckPosition ?? null,
  damper: values.damper ?? null,
  sympatheticCoupling: values.sympatheticCoupling ?? null,
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

  it("preserves the 2.1 compatibility bridge when no dedicated fields exist", () => {
    const state = physicalPerformanceStateAt(track, [], 0)
    expect(state.pressure).toBeCloseTo(0.4)
    expect(state.bowPosition).toBeCloseTo(0.7)
    expect(state.pluckPosition).toBeCloseTo(0.7)
    expect(state.embouchure).toBeCloseTo(0.7)
    expect(state.pedal).toBe(0)
    expect(state.damper).toBe(1)
  })

  it("turns pedal into physical pedal/damper semantics when no damper override exists", () => {
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

  it("lets 2.2 physical values override only their own axes and persist", () => {
    const controls = [
      control(1, { pressure: 0.91, pluckPosition: 0.18, damper: 0.33, sympatheticCoupling: 0.77 }),
      control(2, { expression: 0.2, brightness: 0.95 }),
    ]
    const state = physicalPerformanceStateAt(track, controls, 2.5)
    expect(state.pressure).toBeCloseTo(0.91)
    expect(state.pluckPosition).toBeCloseTo(0.18)
    expect(state.damper).toBeCloseTo(0.33)
    expect(state.sympatheticCoupling).toBeCloseTo(0.77)
    expect(state.bowPosition).toBeCloseTo(0.95)
    expect(state.embouchure).toBeCloseTo(0.95)
  })

  it("allows a later dedicated value to replace an earlier dedicated value", () => {
    const controls = [control(1, { pressure: 0.8 }), control(2, { pressure: 0.35 })]
    expect(physicalPerformanceStateAt(track, controls, 1.5).pressure).toBeCloseTo(0.8)
    expect(physicalPerformanceStateAt(track, controls, 2.5).pressure).toBeCloseTo(0.35)
  })
})
