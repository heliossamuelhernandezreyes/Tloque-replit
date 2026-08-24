import { describe, expect, it } from "vitest"
import { hybridEnabledForArticulation, NATIVE_HYBRID_SOURCES } from "../shared/native-hybrid-source"

describe("Hybrid Winds and Brass v1", () => {
  it("covers the verified sampled wind and brass families with a quiet air-column layer", () => {
    const air = NATIVE_HYBRID_SOURCES.filter(source => source.physicalLayer === "air-column-resonator")
    const ids = new Set(air.map(source => source.instrumentId))
    for (const id of [
      "woodwinds.flute", "woodwinds.clarinet", "woodwinds.bass-clarinet", "woodwinds.oboe", "woodwinds.bassoon",
      "brass.trumpet", "brass.horn", "brass.trombone", "brass.bass-trombone", "brass.tuba",
    ]) expect(ids.has(id)).toBe(true)
    for (const source of air) {
      expect(source.baseSource).toBe("sample-pack")
      expect(source.engineVersion).toBe("air-column-overlay-v1")
      expect(source.approval).toBe("studio")
      expect(source.masterApproved).toBe(false)
      expect(source.wet).toBeGreaterThan(0)
      expect(source.wet).toBeLessThan(0.15)
    }
  })

  it("keeps short attacks sample-only", () => {
    expect(hybridEnabledForArticulation("woodwinds.flute", "normal")).toBe(true)
    expect(hybridEnabledForArticulation("brass.horn", "legato")).toBe(true)
    expect(hybridEnabledForArticulation("brass.trumpet", "staccato")).toBe(false)
  })
})
