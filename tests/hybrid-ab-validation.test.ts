import { describe, expect, it } from "vitest"
import { hybridSourceMasterApproved } from "../shared/native-hybrid-approval-registry"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"
import {
  buildHybridAbReport,
  hybridMasterEvidenceValid,
  hybridMetricTargets,
  type HybridAbCellValues,
  type HybridAbGesture,
  type HybridAbRegister,
} from "../shared/native-hybrid-validation"

const REGISTERS: readonly HybridAbRegister[] = ["low", "mid", "high"]
const GESTURES: readonly HybridAbGesture[] = ["soft", "neutral", "strong"]

const matrixFor = (instrumentId: string): HybridAbCellValues[] => {
  const source = nativeHybridForInstrument(instrumentId)
  if (!source) throw new Error("missing source")
  const targets = hybridMetricTargets(source.physicalLayer)
  const values = Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, (target.min + target.max) / 2])) as any
  return REGISTERS.flatMap((register, registerIndex) => GESTURES.map(gesture => ({
    register,
    gesture,
    gestureLabel: `${gesture} test`,
    midi: Math.round(source.midiMin + (source.midiMax - source.midiMin) * [0.22, 0.5, 0.78][registerIndex]),
    values: { ...values },
  })))
}

describe("hybrid A/B validation", () => {
  it("requires all nine register by gesture cells before objective pass", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const report = buildHybridAbReport(source, "vsco2-ce-solo-violin", matrixFor(source.instrumentId))
    expect(report.objectivePass).toBe(true)
    expect(report.cellResults).toHaveLength(9)
    expect(report.registerResults.map(result => result.register)).toEqual(["low", "mid", "high"])
    expect(report.registerResults.every(result => result.objectivePass)).toBe(true)
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("requires exact engine version, full 3x3 coverage, blind review and a human hybrid win", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const report = buildHybridAbReport(source, "vcsl-estuary-grand-piano", matrixFor(source.instrumentId), { preference: "hybrid", mode: "blind-ab", note: "La opción elegida conserva ataque y mejora resonancia en toda la matriz." })
    expect(hybridMasterEvidenceValid(source, report)).toBe(true)
    expect(hybridMasterEvidenceValid({ ...source, engineVersion: "air-column-overlay-v1.1" } as any, report)).toBe(false)
    expect(hybridMasterEvidenceValid(source, { ...report, cellResults: report.cellResults.slice(0, 8) })).toBe(false)
  })

  it("uses the worst cell, never an average, for register and global metrics", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const matrix = matrixFor(source.instrumentId)
    const highStrong = matrix.find(cell => cell.register === "high" && cell.gesture === "strong")!
    highStrong.values["transient-preservation"] = 0.2
    const lowSoft = matrix.find(cell => cell.register === "low" && cell.gesture === "soft")!
    lowSoft.values["spectral-deviation"] = 0.9
    const report = buildHybridAbReport(source, "vsco2-flute", matrix)
    expect(report.objectivePass).toBe(false)
    expect(report.metrics.find(metric => metric.id === "transient-preservation")?.value).toBe(0.2)
    expect(report.metrics.find(metric => metric.id === "spectral-deviation")?.value).toBe(0.9)
    expect(report.registerResults.find(result => result.register === "high")?.objectivePass).toBe(false)
    expect(report.cellResults.find(cell => cell.register === "high" && cell.gesture === "strong")?.objectivePass).toBe(false)
  })

  it("rejects duplicate coverage even when nine cells are present", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const matrix = matrixFor(source.instrumentId)
    matrix[8] = { ...matrix[7] }
    const report = buildHybridAbReport(source, "vsco2-ce-solo-violin", matrix, { preference: "hybrid", mode: "blind-ab" })
    expect(report.objectivePass).toBe(false)
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("rejects legacy reports without cell coverage instead of throwing", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const report = buildHybridAbReport(source, "vcsl-estuary-grand-piano", matrixFor(source.instrumentId), { preference: "hybrid", mode: "blind-ab" })
    const legacy = { ...report, cellResults: undefined } as any
    expect(() => hybridMasterEvidenceValid(source, legacy)).not.toThrow()
    expect(hybridMasterEvidenceValid(source, legacy)).toBe(false)
  })

  it("rejects a labeled A/B win even when every cell passes", () => {
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
