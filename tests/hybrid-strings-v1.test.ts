import { describe, expect, it } from "vitest"
import { hybridEnabledForArticulation, nativeHybridForInstrument, NATIVE_HYBRID_SOURCES } from "../shared/native-hybrid-source"

describe("Hybrid Strings v1", () => {
  it("covers the bowed orchestral string family without replacing the sample base", () => {
    const bowed = NATIVE_HYBRID_SOURCES.filter(source => source.physicalLayer === "bowed-string-resonator")
    const ids = new Set(bowed.map(source => source.instrumentId))
    expect(ids).toEqual(new Set(["strings.violin", "strings.violin-section", "strings.viola", "strings.cello", "strings.contrabass"]))
    for (const source of bowed) {
      expect(source.kind).toBe("hybrid")
      expect(source.baseSource).toBe("sample-pack")
      expect(source.engineVersion).toBe("bowed-string-overlay-v1")
      expect(source.approval).toBe("studio")
      expect(source.masterApproved).toBe(false)
      expect(source.wet).toBeGreaterThan(0)
      expect(source.wet).toBeLessThan(0.25)
    }
  })

  it("uses the physical overlay only for bow-driven articulations", () => {
    expect(hybridEnabledForArticulation("strings.violin", "normal")).toBe(true)
    expect(hybridEnabledForArticulation("strings.violin", "legato")).toBe(true)
    expect(hybridEnabledForArticulation("strings.cello", "tremolo")).toBe(true)
    expect(hybridEnabledForArticulation("strings.viola", "pizzicato")).toBe(false)
    expect(hybridEnabledForArticulation("strings.violin", "spiccato")).toBe(false)
    expect(hybridEnabledForArticulation("strings.contrabass", "staccato")).toBe(false)
  })

  it("does not claim unrelated non-hybrid instruments", () => {
    expect(nativeHybridForInstrument("keys.pipe-organ")).toBeNull()
  })
})
