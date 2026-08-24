import { describe, expect, it } from "vitest"
import { hybridSourceMasterApproved } from "../shared/native-hybrid-approval-registry"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"
import { buildHybridAbReport, hybridMasterEvidenceValid, hybridMetricTargets } from "../shared/native-hybrid-validation"

const valuesFor = (instrumentId: string) => {
  const source = nativeHybridForInstrument(instrumentId)
  if (!source) throw new Error("missing source")
  const targets = hybridMetricTargets(source.physicalLayer)
  return Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, (target.min + target.max) / 2])) as any
}

describe("hybrid A/B validation", () => {
  it("does not approve objective metrics without human preference for hybrid", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const report = buildHybridAbReport(source, "vsco2-ce-solo-violin", valuesFor(source.instrumentId))
    expect(report.objectivePass).toBe(true)
    expect(report.humanPreference).toBe("unreviewed")
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("requires exact engine version and a human A/B win", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const report = buildHybridAbReport(source, "vcsl-estuary-grand-piano", valuesFor(source.instrumentId), { preference: "hybrid", note: "B conserva ataque y mejora cola." })
    expect(hybridMasterEvidenceValid(source, report)).toBe(true)
    expect(hybridMasterEvidenceValid({ ...source, engineVersion: "air-column-overlay-v1" } as any, report)).toBe(false)
  })

  it("uses stricter transient preservation for sympathetic resonance", () => {
    const stringTarget = hybridMetricTargets("bowed-string-resonator")["transient-preservation"]
    const resonanceTarget = hybridMetricTargets("sympathetic-resonance")["transient-preservation"]
    expect(resonanceTarget.min).toBeGreaterThan(stringTarget.min)
  })

  it("keeps every current hybrid out of Master until reviewed evidence is versioned", () => {
    for (const id of ["strings.violin", "woodwinds.flute", "piano.grand"]) {
      const source = nativeHybridForInstrument(id)!
      expect(hybridSourceMasterApproved(source)).toBe(false)
    }
  })
})
