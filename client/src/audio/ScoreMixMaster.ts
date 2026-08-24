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
  roomSeconds: number
  roomDecay: number
  roomMix: number
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
  roomSeconds: 2.35,
  roomDecay: 3.05,
  roomMix: 0.16,
}

export interface SampledMixMasterChain {
  input: BiquadFilterNode
  output: GainNode
  nodes: readonly AudioNode[]
  disconnect(): void
}

function deterministicNoise(index: number) {
  const x = Math.sin((index + 1) * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function createConcertRoomImpulse(context: BaseAudioContext, seconds: number, decay: number) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      const t = i / context.sampleRate
      const tail = Math.exp(-t * decay)
      const early = t < 0.095 ? (1 - t / 0.095) * 0.18 : 0
      data[i] = deterministicNoise(i * 2 + channel * 7919) * tail * (0.12 + early)
    }
  }
  return impulse
}

/**
 * Shared native-WebAudio mastering chain for live and offline sampled renderers.
 * The deterministic stereo room is generated locally: it adds one coherent acoustic
 * space without downloading an IR and, crucially, preview and WAV hear the same room.
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

  const dry = context.createGain(); dry.gain.value = 1
  const roomSend = context.createGain(); roomSend.gain.value = profile.roomMix
  const room = context.createConvolver(); room.normalize = true; room.buffer = createConcertRoomImpulse(context, profile.roomSeconds, profile.roomDecay)
  const roomReturn = context.createGain(); roomReturn.gain.value = 0.72

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = profile.compressorThreshold
  compressor.knee.value = profile.compressorKnee
  compressor.ratio.value = profile.compressorRatio
  compressor.attack.value = profile.compressorAttack
  compressor.release.value = profile.compressorRelease

  const makeup = context.createGain()
  makeup.gain.value = profile.makeupGain

  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = profile.limiterThreshold
  limiter.knee.value = 0
  limiter.ratio.value = profile.limiterRatio
  limiter.attack.value = profile.limiterAttack
  limiter.release.value = profile.limiterRelease

  const output = context.createGain()
  output.gain.value = outputGain

  lowShelf.connect(highShelf)
  highShelf.connect(dry); dry.connect(compressor)
  highShelf.connect(roomSend); roomSend.connect(room); room.connect(roomReturn); roomReturn.connect(compressor)
  compressor.connect(makeup)
  makeup.connect(limiter)
  limiter.connect(output)

  const nodes = [lowShelf, highShelf, dry, roomSend, room, roomReturn, compressor, makeup, limiter, output] as const
  return {
    input: lowShelf,
    output,
    nodes,
    disconnect() { for (const node of nodes) node.disconnect() },
  }
}
