import { describe, expect, it } from "vitest"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"
import { hybridMetricTargets, buildHybridAbReport, hybridMasterEvidenceValid, type HybridAbCellValues } from "../shared/native-hybrid-validation"
import { hybridCalibrationScore, proposeHybridCalibrationCandidate, sourceWithCalibrationCandidate } from "../shared/native-hybrid-calibration"

function passingMatrix(instrumentId: string): HybridAbCellValues[] {
  const source = nativeHybridForInstrument(instrumentId)!
  const targets = hybridMetricTargets(source.physicalLayer)
  const values = Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, (target.min + target.max) / 2])) as any
  const cells: HybridAbCellValues[] = []
  for (const [ri, register] of (["low", "mid", "high"] as const).entries()) for (const gesture of ["soft", "neutral", "strong"] as const) {
    cells.push({ register, gesture, gestureLabel: gesture, midi: source.midiMin + ri * Math.floor((source.midiMax - source.midiMin) / 2), values: { ...values } })
  }
  return cells
}

describe("hybrid semi-auto calibration", () => {
  it("reduces wet when the worst failure is spectral intrusion", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[8].values["spectral-deviation"] = 0.45
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    expect(candidate.wet).toBeLessThan(source.wet)
    expect(candidate.triggerCell.metricId).toBe("spectral-deviation")
    expect(candidate.wetScale).toBeGreaterThanOrEqual(0.72)
  })

  it("raises wet when the worst failure is insufficient tail", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[0].values["tail-naturalness"] = 0
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    expect(candidate.wet).toBeGreaterThan(source.wet)
    expect(candidate.wetScale).toBeLessThanOrEqual(1.25)
  })

  it("never lets an unpromoted calibration candidate approve Master", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const matrix = passingMatrix(source.instrumentId)
    const report = buildHybridAbReport(source, "sample", matrix, { preference: "hybrid", mode: "blind-ab" }, "candidate:test")
    expect(report.objectivePass).toBe(true)
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("applies a candidate without mutating the registered source", () => {
    const source = nativeHybridForInstrument("strings.cello")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[2].values["transient-preservation"] = 0.1
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    const tuned = sourceWithCalibrationCandidate(source, candidate)
    expect(tuned).not.toBe(source)
    expect(tuned.wet).toBe(candidate.wet)
    expect(source.wet).not.toBe(candidate.wet)
  })

  it("scores passing coverage and worst margin for before/after comparisons", () => {
    const source = nativeHybridForInstrument("guitar.acoustic")!
    const base = buildHybridAbReport(source, "sample", passingMatrix(source.instrumentId))
    const score = hybridCalibrationScore(base)
    expect(score.totalCells).toBe(9)
    expect(score.passingCells).toBe(9)
    expect(Number.isFinite(score.worstMargin)).toBe(true)
  })
})
