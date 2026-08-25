import { describe, expect, it } from "vitest"
import { NATIVE_HYBRID_SOURCES, nativeHybridForInstrument } from "../shared/native-hybrid-source"

const engineForLayer = {
  "bowed-string-resonator": "bowed-string-overlay-v1",
  "air-column-resonator": "air-column-overlay-v1.1",
  "sympathetic-resonance": "sympathetic-resonance-v1.1",
} as const

describe("hybrid render parity contract", () => {
  it("maps every registered physical family to its matching engine version", () => {
    expect(NATIVE_HYBRID_SOURCES.length).toBeGreaterThan(0)
    for (const source of NATIVE_HYBRID_SOURCES) {
      expect(source.engineVersion).toBe(engineForLayer[source.physicalLayer])
      expect(source.baseSource).toBe("sample-pack")
    }
  })

  it("keeps sympathetic instruments out of the air-column family", () => {
    for (const id of ["piano.grand", "keys.celesta", "strings.harp", "guitar.acoustic"]) {
      const source = nativeHybridForInstrument(id)
      expect(source).not.toBeNull()
      expect(source?.physicalLayer).toBe("sympathetic-resonance")
      expect(source?.engineVersion).toBe("sympathetic-resonance-v1.1")
    }
  })

  it("keeps representative bowed and wind instruments on their own families", () => {
    expect(nativeHybridForInstrument("strings.violin")?.physicalLayer).toBe("bowed-string-resonator")
    expect(nativeHybridForInstrument("woodwinds.flute")?.physicalLayer).toBe("air-column-resonator")
    expect(nativeHybridForInstrument("woodwinds.flute")?.engineVersion).toBe("air-column-overlay-v1.1")
    expect(nativeHybridForInstrument("brass.trumpet")?.physicalLayer).toBe("air-column-resonator")
  })
})
