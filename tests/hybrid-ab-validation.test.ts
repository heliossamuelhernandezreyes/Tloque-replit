import { describe, expect, it } from "vitest"
import { hybridSourceMasterApproved } from "../shared/native-hybrid-approval-registry"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"
import { buildHybridAbReport, hybridMasterEvidenceValid, hybridMetricTargets, type HybridAbRegisterValues } from "../shared/native-hybrid-validation"

const matrixFor = (instrumentId: string): HybridAbRegisterValues[] => {
  const source = nativeHybridForInstrument(instrumentId)
  if (!source) throw new Error("missing source")
  const targets = hybridMetricTargets(source.physicalLayer)
  const values = Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, (target.min + target.max) / 2])) as any
  return ["low", "mid", "high"].map((register, index) => ({ register: register as any, midi: source.midiMin + index * Math.floor((source.midiMax - source.midiMin) / 2), values: { ...values } }))
}

describe("hybrid A/B validation", () => {
  it("does not approve objective metrics without human preference for hybrid", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const report = buildHybridAbReport(source, "vsco2-ce-solo-violin", matrixFor(source.instrumentId))
    expect(report.objectivePass).toBe(true)
    expect(report.registerResults.map(result => result.register)).toEqual(["low", "mid", "high"])
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("requires exact engine version, complete register coverage, blind review and a human A/B win", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const report = buildHybridAbReport(source, "vcsl-estuary-grand-piano", matrixFor(source.instrumentId), { preference: "hybrid", mode: "blind-ab", note: "La opción elegida conserva ataque y mejora cola." })
    expect(hybridMasterEvidenceValid(source, report)).toBe(true)
    expect(hybridMasterEvidenceValid({ ...source, engineVersion: "air-column-overlay-v1.1" } as any, report)).toBe(false)
    expect(hybridMasterEvidenceValid(source, { ...report, registerResults: report.registerResults.slice(0, 2) })).toBe(false)
  })

  it("uses the worst register, never an average, for global metrics", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const matrix = matrixFor(source.instrumentId)
    matrix[2].values["transient-preservation"] = 0.2
    matrix[0].values["spectral-deviation"] = 0.9
    const report = buildHybridAbReport(source, "vsco2-flute", matrix)
    expect(report.objectivePass).toBe(false)
    expect(report.metrics.find(metric => metric.id === "transient-preservation")?.value).toBe(0.2)
    expect(report.metrics.find(metric => metric.id === "spectral-deviation")?.value).toBe(0.9)
    expect(report.registerResults.find(result => result.register === "high")?.objectivePass).toBe(false)
  })

  it("rejects a labeled A/B win even when every register passes", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const report = buildHybridAbReport(source, "vsco2-flute", matrixFor(source.instrumentId), { preference: "hybrid", mode: "labeled-ab" })
    expect(report.objectivePass).toBe(true)
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("uses stricter transient preservation for sympathetic resonance", () => {
    expect(hybridMetricTargets("sympathetic-resonance")["transient-preservation"].min).toBeGreaterThan(hybridMetricTargets("bowed-string-resonator")["transient-preservation"].min)
  })

  it("keeps every current hybrid out of Master until reviewed evidence is versioned", () => {
    for (const id of ["strings.violin", "woodwinds.flute", "piano.grand"]) expect(hybridSourceMasterApproved(nativeHybridForInstrument(id)!)).toBe(false)
  })
})
