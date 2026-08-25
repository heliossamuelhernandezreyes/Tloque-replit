import { describe, expect, it } from "./test-compat"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"
import { hybridMetricTargets, buildHybridAbReport, type HybridAbCellValues } from "../shared/native-hybrid-validation"
import {
  chooseHybridLocalSearchWinner,
  proposeHybridLocalSearchCandidates,
  summarizeHybridLocalSearch,
  type HybridLocalSearchTrial,
} from "../shared/native-hybrid-local-search"

function matrix(instrumentId: string, failure?: { metric: keyof ReturnType<typeof hybridMetricTargets>; value: number }) {
  const source = nativeHybridForInstrument(instrumentId)!
  const targets = hybridMetricTargets(source.physicalLayer)
  const baseValues = Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, (target.min + target.max) / 2])) as any
  const cells: HybridAbCellValues[] = []
  for (const [ri, register] of (["low", "mid", "high"] as const).entries()) for (const gesture of ["soft", "neutral", "strong"] as const) {
    cells.push({ register, gesture, gestureLabel: gesture, midi: source.midiMin + ri * Math.floor((source.midiMax - source.midiMin) / 2), values: { ...baseValues } })
  }
  if (failure) cells[8].values[failure.metric as any] = failure.value
  return cells
}

function trial(sourceId: string, label: "gentle" | "nominal" | "assertive", passing: boolean): HybridLocalSearchTrial {
  const source = nativeHybridForInstrument(sourceId)!
  const baseline = buildHybridAbReport(source, "sample", matrix(sourceId, { metric: "spectral-deviation", value: 0.8 }))
  const candidate = proposeHybridLocalSearchCandidates(source, baseline).find(item => item.searchLabel === label)!
  const cells = matrix(sourceId)
  if (!passing) cells[0].values["transient-preservation"] = 0
  return { candidate, report: buildHybridAbReport(source, "sample", cells, undefined, candidate.id) }
}

describe("hybrid bounded local search", () => {
  it("generates gentle, nominal and assertive candidates around one causal hypothesis", () => {
    const source = nativeHybridForInstrument("strings.violin")!
    const report = buildHybridAbReport(source, "sample", matrix(source.instrumentId, { metric: "spectral-deviation", value: 0.7 }))
    const candidates = proposeHybridLocalSearchCandidates(source, report)
    expect(candidates.map(item => item.searchLabel)).toEqual(["gentle", "nominal", "assertive"])
    expect(candidates.every(item => item.instrumentId === source.instrumentId)).toBe(true)
    expect(candidates.every(item => item.changedAxes.length > 0)).toBe(true)
    expect(candidates.every(item => item.wetScale >= 0.72 && item.wetScale <= 1.25)).toBe(true)
  })

  it("keeps stronger variants bounded by the shared tuning contract", () => {
    const source = nativeHybridForInstrument("brass.tuba")!
    const report = buildHybridAbReport(source, "sample", matrix(source.instrumentId, { metric: "tail-naturalness", value: 0 }))
    for (const candidate of proposeHybridLocalSearchCandidates(source, report)) {
      expect(candidate.tuning.feedbackScale).toBeGreaterThanOrEqual(0.94)
      expect(candidate.tuning.feedbackScale).toBeLessThanOrEqual(1.045)
      expect(candidate.tuning.bodyScale).toBeGreaterThanOrEqual(0.88)
      expect(candidate.tuning.bodyScale).toBeLessThanOrEqual(1.14)
      expect(candidate.tuning.decayScale).toBeGreaterThanOrEqual(0.88)
      expect(candidate.tuning.decayScale).toBeLessThanOrEqual(1.14)
    }
  })

  it("selects a trial only when it beats the baseline worst-case score", () => {
    const source = nativeHybridForInstrument("piano.grand")!
    const baseline = buildHybridAbReport(source, "sample", matrix(source.instrumentId, { metric: "tail-naturalness", value: 0 }))
    const bad = trial(source.instrumentId, "gentle", false)
    const good = trial(source.instrumentId, "nominal", true)
    expect(chooseHybridLocalSearchWinner(baseline, [bad, good])?.candidate.id).toBe(good.candidate.id)
    expect(summarizeHybridLocalSearch(baseline, [bad, good]).winnerCandidateId).toBe(good.candidate.id)
  })

  it("returns no winner when every trial is no better than baseline", () => {
    const source = nativeHybridForInstrument("woodwinds.flute")!
    const baseline = buildHybridAbReport(source, "sample", matrix(source.instrumentId))
    const bad = trial(source.instrumentId, "gentle", false)
    expect(chooseHybridLocalSearchWinner(baseline, [bad])).toBeNull()
  })
})
