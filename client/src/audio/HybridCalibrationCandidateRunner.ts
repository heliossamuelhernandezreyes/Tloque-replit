import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { sourceWithCalibrationCandidate, type HybridCalibrationCandidate } from "@shared/native-hybrid-calibration"
import { runHybridAbCalibration, type HybridAbCalibrationResult } from "./HybridAbCalibrationRunner"

export async function runHybridCalibrationCandidate(
  source: NativeHybridSource,
  candidate: HybridCalibrationCandidate,
  signal?: AbortSignal,
): Promise<HybridAbCalibrationResult> {
  const tunedSource = sourceWithCalibrationCandidate(source, candidate)
  const result = await runHybridAbCalibration(tunedSource, signal)
  return {
    ...result,
    report: {
      ...result.report,
      calibrationCandidateId: candidate.id,
      reviewerNote: candidate.reason,
    },
  }
}
