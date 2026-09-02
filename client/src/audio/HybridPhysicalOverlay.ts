import type { NativeHybridSource } from "@shared/native-hybrid-source"
import type { NativeHybridOverlayPerformance } from "@shared/native-hybrid-performance"
import type { HybridCalibrationTuning } from "@shared/native-hybrid-tuning"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { scheduleAirColumnOverlay } from "./PhysicalAirColumnOverlay"
import { scheduleBowedStringOverlay } from "./PhysicalBowedStringOverlay"
import { scheduleSympatheticResonanceOverlay } from "./PhysicalSympatheticResonanceOverlay"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]
type TunableHybridSource = NativeHybridSource & { calibrationTuning?: HybridCalibrationTuning }

export interface HybridPhysicalOverlayOptions {
  startAt: number
  event: LinearScoreEventV2
  track: LinearScoreTrackV2
  midi: number
  destination: AudioNode
  controls?: readonly LinearScoreControlV2[]
  legatoFromPrevious?: boolean
  calibrationTuning?: HybridCalibrationTuning
  performance?: NativeHybridOverlayPerformance
}

export function scheduleHybridPhysicalOverlay(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: HybridPhysicalOverlayOptions,
) {
  const effectiveOptions = {
    ...options,
    calibrationTuning: options.calibrationTuning ?? (source as TunableHybridSource).calibrationTuning,
  }
  switch (source.physicalLayer) {
    case "bowed-string-resonator":
      return scheduleBowedStringOverlay(context, source, effectiveOptions)
    case "air-column-resonator":
      return scheduleAirColumnOverlay(context, source, effectiveOptions)
    case "sympathetic-resonance":
      return scheduleSympatheticResonanceOverlay(context, source, effectiveOptions)
    default: {
      const exhaustive: never = source.physicalLayer
      throw new Error(`Unsupported hybrid physical layer: ${String(exhaustive)}`)
    }
  }
}
