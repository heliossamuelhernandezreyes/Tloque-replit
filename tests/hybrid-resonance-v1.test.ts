import { describe, expect, it } from "vitest"
import { hybridEnabledForArticulation, nativeHybridForInstrument, NATIVE_HYBRID_SOURCES } from "../shared/native-hybrid-source"

describe("Hybrid Resonance v1", () => {
  it("covers only sample-first resonant instruments", () => {
    const resonance = NATIVE_HYBRID_SOURCES.filter(source => source.physicalLayer === "sympathetic-resonance")
    expect(new Set(resonance.map(source => source.instrumentId))).toEqual(new Set([
      "piano.grand",
      "keys.celesta",
      "strings.harp",
      "guitar.acoustic",
    ]))
    for (const source of resonance) {
      expect(source.baseSource).toBe("sample-pack")
      expect(source.engineVersion).toBe("sympathetic-resonance-v1")
      expect(source.approval).toBe("studio")
      expect(source.masterApproved).toBe(false)
      expect(source.wet).toBeGreaterThan(0)
      expect(source.wet).toBeLessThan(0.1)
    }
  })

  it("keeps attacks sample-led and rejects inappropriate articulations", () => {
    expect(hybridEnabledForArticulation("piano.grand", "normal")).toBe(true)
    expect(hybridEnabledForArticulation("strings.harp", "accent")).toBe(true)
    expect(hybridEnabledForArticulation("guitar.acoustic", "staccato")).toBe(false)
    expect(hybridEnabledForArticulation("keys.celesta", "spiccato")).toBe(false)
  })

  it("does not hybridize percussive/key sources without evidence", () => {
    expect(nativeHybridForInstrument("keys.pipe-organ")).toBeNull()
    expect(nativeHybridForInstrument("keys.harpsichord")).toBeNull()
    expect(nativeHybridForInstrument("percussion.timpani")).toBeNull()
  })
})
