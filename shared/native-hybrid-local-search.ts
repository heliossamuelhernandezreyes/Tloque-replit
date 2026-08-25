import type { NativeHybridSource } from "./native-hybrid-source"
import { boundedHybridCalibrationTuning, tuningChangedAxes, type HybridCalibrationTuning } from "./native-hybrid-tuning"
import {
  hybridCalibrationScore,
  proposeHybridCalibrationCandidate,
  type HybridCalibrationCandidate,
} from "./native-hybrid-calibration"
import type { HybridAbValidationReport } from "./native-hybrid-validation"

export interface HybridLocalSearchCandidate extends HybridCalibrationCandidate {
  searchLabel: "gentle" | "nominal" | "assertive"
  searchStrength: number
}

export interface HybridLocalSearchTrial {
  candidate: HybridLocalSearchCandidate
  report: HybridAbValidationReport
}

export interface HybridLocalSearchSummary {
  baseline: ReturnType<typeof hybridCalibrationScore>
  trials: readonly {
    candidateId: string
    label: HybridLocalSearchCandidate["searchLabel"]
    passingCells: number
    totalCells: number
    worstMargin: number
    improved: boolean
  }[]
  winnerCandidateId: string | null
}

function interpolateTuning(
  tuning: HybridCalibrationTuning,
  strength: number,
): HybridCalibrationTuning {
  const scaled = Object.fromEntries(
    (Object.entries(tuning) as [keyof HybridCalibrationTuning, number][])
      .map(([key, value]) => [key, 1 + (value - 1) * strength]),
  ) as Partial<HybridCalibrationTuning>
  return boundedHybridCalibrationTuning(scaled)
}

function candidateAtStrength(
  source: NativeHybridSource,
  base: HybridCalibrationCandidate,
  label: HybridLocalSearchCandidate["searchLabel"],
  strength: number,
): HybridLocalSearchCandidate {
  const tuning = interpolateTuning(base.tuning, strength)
  const wet = Math.max(0.015, Math.min(0.24, source.wet * tuning.wetScale))
  const normalized = boundedHybridCalibrationTuning({ ...tuning, wetScale: wet / Math.max(1e-6, source.wet) })
  const changedAxes = tuningChangedAxes(normalized)
  const axisSummary = changedAxes.map(axis => `${axis}=${normalized[axis].toFixed(3)}x`).join(", ")
  return {
    ...base,
    id: `${base.id}:local-${label}`,
    wet,
    wetScale: normalized.wetScale,
    tuning: normalized,
    changedAxes,
    reason: `${base.reason} Búsqueda local ${label} (${strength.toFixed(2)}×): ${axisSummary}.`,
    searchLabel: label,
    searchStrength: strength,
  }
}

export function proposeHybridLocalSearchCandidates(
  source: NativeHybridSource,
  report: HybridAbValidationReport,
): readonly HybridLocalSearchCandidate[] {
  const base = proposeHybridCalibrationCandidate(source, report)
  if (!base) return []
  return [
    candidateAtStrength(source, base, "gentle", 0.65),
    candidateAtStrength(source, base, "nominal", 1),
    candidateAtStrength(source, base, "assertive", 1.3),
  ]
}

function scoreBetter(
  a: ReturnType<typeof hybridCalibrationScore>,
  b: ReturnType<typeof hybridCalibrationScore>,
) {
  if (a.passingCells !== b.passingCells) return a.passingCells > b.passingCells
  return a.worstMargin > b.worstMargin
}

export function chooseHybridLocalSearchWinner(
  baselineReport: HybridAbValidationReport,
  trials: readonly HybridLocalSearchTrial[],
): HybridLocalSearchTrial | null {
  const baseline = hybridCalibrationScore(baselineReport)
  let winner: HybridLocalSearchTrial | null = null
  let winnerScore = baseline
  for (const trial of trials) {
    const score = hybridCalibrationScore(trial.report)
    if (scoreBetter(score, winnerScore)) {
      winner = trial
      winnerScore = score
    }
  }
  return winner
}

export function summarizeHybridLocalSearch(
  baselineReport: HybridAbValidationReport,
  trials: readonly HybridLocalSearchTrial[],
): HybridLocalSearchSummary {
  const baseline = hybridCalibrationScore(baselineReport)
  const winner = chooseHybridLocalSearchWinner(baselineReport, trials)
  return {
    baseline,
    trials: trials.map(trial => {
      const score = hybridCalibrationScore(trial.report)
      return {
        candidateId: trial.candidate.id,
        label: trial.candidate.searchLabel,
        ...score,
        improved: scoreBetter(score, baseline),
      }
    }),
    winnerCandidateId: winner?.candidate.id ?? null,
  }
}
