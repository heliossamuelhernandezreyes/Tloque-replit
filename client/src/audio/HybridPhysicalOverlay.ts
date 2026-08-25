import type { NativeHybridSource } from "@shared/native-hybrid-source"
import type { HybridCalibrationTuning } from "@shared/native-hybrid-tuning"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { scheduleAirColumnOverlay } from "./PhysicalAirColumnOverlay"
import { scheduleBowedStringOverlay } from "./PhysicalBowedStringOverlay"
import { scheduleSympatheticResonanceOverlay } from "./PhysicalSympatheticResonanceOverlay"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]

export interface HybridPhysicalOverlayOptions {
  startAt: number
  event: LinearScoreEventV2
  track: LinearScoreTrackV2
  midi: number
  destination: AudioNode
  controls?: readonly LinearScoreControlV2[]
  legatoFromPrevious?: boolean
  calibrationTuning?: HybridCalibrationTuning
}

export function scheduleHybridPhysicalOverlay(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: HybridPhysicalOverlayOptions,
) {
  switch (source.physicalLayer) {
    case "bowed-string-resonator":
      return scheduleBowedStringOverlay(context, source, options)
    case "air-column-resonator":
      return scheduleAirColumnOverlay(context, source, options)
    case "sympathetic-resonance":
      return scheduleSympatheticResonanceOverlay(context, source, options)
    default: {
      const exhaustive: never = source.physicalLayer
      throw new Error(`Unsupported hybrid physical layer: ${String(exhaustive)}`)
    }
  }
}
