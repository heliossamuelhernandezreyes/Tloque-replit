import type { LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { createAcousticStage, type AcousticStage } from "./ScoreAcousticStage"
import { createSampledMixMaster, type SampledMixMasterChain } from "./ScoreMixMaster"

export interface NativeRenderTrackControl {
  trackId: string
  timeSeconds: number
  rampSeconds: number
  gain: number | null
  brightness: number | null
}

export interface NativeRenderGraph {
  readonly mix: SampledMixMasterChain
  readonly stage: AcousticStage
  readonly trackGain: ReadonlyMap<string, GainNode>
  readonly trackTone: ReadonlyMap<string, BiquadFilterNode>
  readonly output: GainNode
  createTrackPath(trackId: string, gainValue: number, brightness: number, pan: number): GainNode
  scheduleTrackControl(control: NativeRenderTrackControl, startAt?: number): void
  disconnect(): void
}

export function nativeBrightnessCutoff(value: number) {
  const amount = Math.max(0, Math.min(1, value))
  return 3_400 + Math.pow(amount, 0.72) * 16_000
}

/**
 * One native signal graph for realtime playback and offline export.
 *
 * Both paths receive the same per-track tone filter, acoustic stage and sampled
 * master. Callers only decide when sources are scheduled and where the final
 * output is connected; the acoustic routing itself cannot silently diverge.
 */
export function createNativeRenderGraph(
  context: BaseAudioContext,
  trackById: ReadonlyMap<string, LinearScoreTrackV2>,
  destination?: AudioNode,
): NativeRenderGraph {
  const mix = createSampledMixMaster(context, 1)
  const stage = createAcousticStage(context, mix.input)
  const trackGain = new Map<string, GainNode>()
  const trackTone = new Map<string, BiquadFilterNode>()
  const trackNodes: AudioNode[] = []

  if (destination) mix.output.connect(destination)

  function createTrackPath(trackId: string, gainValue: number, brightness: number, pan: number) {
    const existing = trackGain.get(trackId)
    if (existing) return existing
    const semanticTrack = trackById.get(trackId)
    const gain = context.createGain(); gain.gain.value = gainValue
    const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = nativeBrightnessCutoff(brightness); tone.Q.value = 0.12
    const stageInput = stage.createTrackInput(semanticTrack?.instrument ?? "unknown", pan)
    gain.connect(tone); tone.connect(stageInput)
    trackNodes.push(gain, tone)
    trackGain.set(trackId, gain); trackTone.set(trackId, tone)
    return gain
  }

  function scheduleTrackControl(control: NativeRenderTrackControl, startAt = 0) {
    const gain = trackGain.get(control.trackId)
    const tone = trackTone.get(control.trackId)
    const at = startAt + control.timeSeconds
    if (gain && control.gain !== null) {
      gain.gain.cancelScheduledValues(at)
      if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds)
      else gain.gain.setValueAtTime(control.gain, at)
    }
    if (tone && control.brightness !== null) {
      const cutoff = nativeBrightnessCutoff(control.brightness)
      tone.frequency.cancelScheduledValues(at)
      if (control.rampSeconds > 0) tone.frequency.exponentialRampToValueAtTime(cutoff, at + control.rampSeconds)
      else tone.frequency.setValueAtTime(cutoff, at)
    }
  }

  return {
    mix,
    stage,
    trackGain,
    trackTone,
    output: mix.output,
    createTrackPath,
    scheduleTrackControl,
    disconnect() {
      for (const node of trackNodes) node.disconnect()
      stage.disconnect()
      mix.disconnect()
    },
  }
}
