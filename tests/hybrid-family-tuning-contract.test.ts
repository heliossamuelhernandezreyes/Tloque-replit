import { describe, expect, it } from "vitest"
import { boundedHybridCalibrationTuning, DEFAULT_HYBRID_CALIBRATION_TUNING } from "../shared/native-hybrid-tuning"

describe("hybrid family tuning contract", () => {
  it("keeps baseline tuning acoustically neutral", () => {
    expect(DEFAULT_HYBRID_CALIBRATION_TUNING).toEqual({
      wetScale: 1,
      feedbackScale: 1,
      dampingScale: 1,
      textureScale: 1,
      bodyScale: 1,
      decayScale: 1,
    })
  })

  it("clamps every experimental axis to conservative bounds", () => {
    expect(boundedHybridCalibrationTuning({ wetScale: 9, feedbackScale: 2, dampingScale: 0, textureScale: 4, bodyScale: -2, decayScale: 7 })).toEqual({
      wetScale: 1.25,
      feedbackScale: 1.045,
      dampingScale: 0.88,
      textureScale: 1.14,
      bodyScale: 0.88,
      decayScale: 1.14,
    })
  })
})
