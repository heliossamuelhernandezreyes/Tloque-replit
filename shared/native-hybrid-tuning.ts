export interface HybridCalibrationTuning {
  wetScale: number
  feedbackScale: number
  dampingScale: number
  textureScale: number
  bodyScale: number
  decayScale: number
}

export const DEFAULT_HYBRID_CALIBRATION_TUNING: HybridCalibrationTuning = {
  wetScale: 1,
  feedbackScale: 1,
  dampingScale: 1,
  textureScale: 1,
  bodyScale: 1,
  decayScale: 1,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function boundedHybridCalibrationTuning(
  tuning: Partial<HybridCalibrationTuning> | null | undefined,
): HybridCalibrationTuning {
  return {
    wetScale: clamp(tuning?.wetScale ?? 1, 0.72, 1.25),
    feedbackScale: clamp(tuning?.feedbackScale ?? 1, 0.94, 1.045),
    dampingScale: clamp(tuning?.dampingScale ?? 1, 0.88, 1.12),
    textureScale: clamp(tuning?.textureScale ?? 1, 0.86, 1.14),
    bodyScale: clamp(tuning?.bodyScale ?? 1, 0.88, 1.14),
    decayScale: clamp(tuning?.decayScale ?? 1, 0.88, 1.14),
  }
}

export function tuningChangedAxes(tuning: HybridCalibrationTuning) {
  return (Object.entries(tuning) as [keyof HybridCalibrationTuning, number][])
    .filter(([, value]) => Math.abs(value - 1) > 1e-6)
    .map(([key]) => key)
}
