export interface SampledMixMasterProfile {
  lowShelfHz: number
  lowShelfDb: number
  highShelfHz: number
  highShelfDb: number
  compressorThreshold: number
  compressorKnee: number
  compressorRatio: number
  compressorAttack: number
  compressorRelease: number
  makeupGain: number
  limiterThreshold: number
  limiterRatio: number
  limiterAttack: number
  limiterRelease: number
}

export const SAMPLED_MIX_MASTER_PROFILE: Readonly<SampledMixMasterProfile> = {
  lowShelfHz: 220,
  lowShelfDb: -1,
  highShelfHz: 3_600,
  highShelfDb: 1.2,
  compressorThreshold: -20,
  compressorKnee: 14,
  compressorRatio: 2.6,
  compressorAttack: 0.015,
  compressorRelease: 0.24,
  makeupGain: 1.08,
  limiterThreshold: -1.2,
  limiterRatio: 20,
  limiterAttack: 0.002,
  limiterRelease: 0.075,
}

export interface SampledMixMasterChain {
  input: BiquadFilterNode
  output: GainNode
  nodes: readonly AudioNode[]
  disconnect(): void
}

/**
 * Native-WebAudio chain shared by live SpessaSynth playback and OfflineAudioContext export.
 * Keeping this renderer-neutral prevents the reference preview and rendered WAV from
 * silently acquiring different EQ/dynamics/headroom.
 */
export function createSampledMixMaster(
  context: BaseAudioContext,
  outputGain = 1,
  profile: Readonly<SampledMixMasterProfile> = SAMPLED_MIX_MASTER_PROFILE,
): SampledMixMasterChain {
  const lowShelf = context.createBiquadFilter()
  lowShelf.type = "lowshelf"
  lowShelf.frequency.value = profile.lowShelfHz
  lowShelf.gain.value = profile.lowShelfDb

  const highShelf = context.createBiquadFilter()
  highShelf.type = "highshelf"
  highShelf.frequency.value = profile.highShelfHz
  highShelf.gain.value = profile.highShelfDb

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = profile.compressorThreshold
  compressor.knee.value = profile.compressorKnee
  compressor.ratio.value = profile.compressorRatio
  compressor.attack.value = profile.compressorAttack
  compressor.release.value = profile.compressorRelease

  const makeup = context.createGain()
  makeup.gain.value = profile.makeupGain

  // WebAudio has no standard LimiterNode. A fast high-ratio compressor gives both
  // live and offline sampled renderers the same conservative final peak guard.
  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = profile.limiterThreshold
  limiter.knee.value = 0
  limiter.ratio.value = profile.limiterRatio
  limiter.attack.value = profile.limiterAttack
  limiter.release.value = profile.limiterRelease

  const output = context.createGain()
  output.gain.value = outputGain

  lowShelf.connect(highShelf)
  highShelf.connect(compressor)
  compressor.connect(makeup)
  makeup.connect(limiter)
  limiter.connect(output)

  const nodes = [lowShelf, highShelf, compressor, makeup, limiter, output] as const
  return {
    input: lowShelf,
    output,
    nodes,
    disconnect() {
      for (const node of nodes) node.disconnect()
    },
  }
}
