import type { NativeHybridSource } from "@shared/native-hybrid-source"
import {
  chooseHybridLocalSearchWinner,
  proposeHybridLocalSearchCandidates,
  summarizeHybridLocalSearch,
  type HybridLocalSearchTrial,
} from "@shared/native-hybrid-local-search"
import type { HybridAbValidationReport } from "@shared/native-hybrid-validation"
import { hybridCalibrationScore } from "@shared/native-hybrid-calibration"
import { runHybridCalibrationCandidate } from "./HybridCalibrationCandidateRunner"

export interface HybridLocalSearchResult {
  trials: readonly HybridLocalSearchTrial[]
  winner: HybridLocalSearchTrial | null
  summary: ReturnType<typeof summarizeHybridLocalSearch>
  stoppedEarly: boolean
}

export async function runHybridLocalSearch(
  source: NativeHybridSource,
  baseline: HybridAbValidationReport,
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number, label: string) => void,
): Promise<HybridLocalSearchResult> {
  const candidates = proposeHybridLocalSearchCandidates(source, baseline)
  if (!candidates.length) return { trials: [], winner: null, summary: summarizeHybridLocalSearch(baseline, []), stoppedEarly: false }

  const trials: HybridLocalSearchTrial[] = []
  let stoppedEarly = false
  for (let index = 0; index < candidates.length; index += 1) {
    if (signal?.aborted) throw new DOMException("Búsqueda local cancelada", "AbortError")
    const candidate = candidates[index]
    onProgress?.(index, candidates.length, candidate.searchLabel)
    const result = await runHybridCalibrationCandidate(source, candidate, signal)
    trials.push({ candidate, report: result.report })
    const score = hybridCalibrationScore(result.report)
    if (score.passingCells === 9 && score.worstMargin > 0) {
      stoppedEarly = true
      onProgress?.(index + 1, candidates.length, candidate.searchLabel)
      break
    }
    onProgress?.(index + 1, candidates.length, candidate.searchLabel)
  }

  return {
    trials,
    winner: chooseHybridLocalSearchWinner(baseline, trials),
    summary: summarizeHybridLocalSearch(baseline, trials),
    stoppedEarly,
  }
}
