import { describe, expect, it } from "./test-compat"
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
  it("reduces wet plus string texture/damping when the worst failure is spectral intrusion", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[8].values["spectral-deviation"] = 0.45
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    expect(candidate.wet).toBeLessThan(source.wet)
    expect(candidate.triggerCell.metricId).toBe("spectral-deviation")
    expect(candidate.tuning.textureScale).toBeLessThan(1)
    expect(candidate.tuning.dampingScale).toBeLessThan(1)
    expect(candidate.changedAxes).toContain("textureScale")
  })

  it("raises resonance body/decay when piano tail is insufficient", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[0].values["tail-naturalness"] = 0
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    expect(candidate.wet).toBeGreaterThan(source.wet)
    expect(candidate.tuning.decayScale).toBeGreaterThan(1)
    expect(candidate.tuning.bodyScale).toBeGreaterThan(1)
    expect(candidate.wetScale).toBeLessThanOrEqual(1.25)
  })

  it("uses bore feedback/body rather than only wet for air-column continuity", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[4].values["sustain-continuity"] = 0
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    expect(candidate.tuning.feedbackScale).toBeGreaterThan(1)
    expect(candidate.tuning.bodyScale).toBeGreaterThan(1)
    expect(candidate.changedAxes).toContain("feedbackScale")
  })

  it("never lets an unpromoted calibration candidate approve Master", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const matrix = passingMatrix(source.instrumentId)
    const report = buildHybridAbReport(source, "sample", matrix, { preference: "hybrid", mode: "blind-ab" }, "candidate:test")
    expect(report.objectivePass).toBe(true)
    expect(hybridMasterEvidenceValid(source, report)).toBe(false)
  })

  it("applies a candidate as ephemeral tuning without mutating the registered source", () => {
    const source = nativeHybridForInstrument("strings.cello")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[2].values["transient-preservation"] = 0.1
    const report = buildHybridAbReport(source, "sample", matrix)
    const candidate = proposeHybridCalibrationCandidate(source, report)!
    const tuned = sourceWithCalibrationCandidate(source, candidate)
    expect(tuned).not.toBe(source)
    expect(tuned.wet).toBe(source.wet)
    expect(tuned.calibrationTuning).toEqual(candidate.tuning)
    expect(source).not.toHaveProperty("calibrationTuning")
  })

  it("keeps every tuning axis inside conservative search bounds", () => {
    const source = nativeHybridForInstrument("brass.tuba")!
    const matrix = passingMatrix(source.instrumentId)
    matrix[8].values["spectral-deviation"] = 1
    const candidate = proposeHybridCalibrationCandidate(source, buildHybridAbReport(source, "sample", matrix))!
    expect(candidate.tuning.wetScale).toBeGreaterThanOrEqual(0.72)
    expect(candidate.tuning.feedbackScale).toBeGreaterThanOrEqual(0.94)
    expect(candidate.tuning.feedbackScale).toBeLessThanOrEqual(1.045)
    expect(candidate.tuning.dampingScale).toBeGreaterThanOrEqual(0.88)
    expect(candidate.tuning.textureScale).toBeGreaterThanOrEqual(0.86)
    expect(candidate.tuning.bodyScale).toBeGreaterThanOrEqual(0.88)
    expect(candidate.tuning.decayScale).toBeGreaterThanOrEqual(0.88)
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
