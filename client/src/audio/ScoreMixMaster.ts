import { createCachedDeterministicStereoImpulse } from "./DeterministicImpulseCache"
import { ORCHESTRAL_ROOM_MAX_SECONDS, ORCHESTRAL_ROOM_VERSION, orchestralLateFieldEnvelope } from "./OrchestralRoom"

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
  roomPredelaySeconds: number
  roomLowpassHz: number
}

export const SAMPLED_MIX_MASTER_PROFILE: Readonly<SampledMixMasterProfile> = {
  lowShelfHz: 220,
  lowShelfDb: -0.7,
  highShelfHz: 3_800,
  highShelfDb: 0.7,
  compressorThreshold: -18,
  compressorKnee: 16,
  compressorRatio: 1.6,
  compressorAttack: 0.04,
  compressorRelease: 0.42,
  makeupGain: 1.02,
  limiterThreshold: -1.2,
  limiterRatio: 20,
  limiterAttack: 0.002,
  limiterRelease: 0.09,
  roomSeconds: ORCHESTRAL_ROOM_MAX_SECONDS,
  roomDecay: 1.92,
  roomMix: 0.235,
  roomPredelaySeconds: 0.026,
  roomLowpassHz: 8_100,
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
  const diffusionState = [0, 0]
  const boundedSeconds = Math.min(ORCHESTRAL_ROOM_MAX_SECONDS, seconds)
  return createCachedDeterministicStereoImpulse(context, `${ORCHESTRAL_ROOM_VERSION}:decay=${decay}`, boundedSeconds, (channel, i, t) => {
    const envelope = orchestralLateFieldEnvelope(t, boundedSeconds, decay)
    const density = 0.08 + 0.54 * Math.min(1, t / 0.38)
    const gate = Math.abs(deterministicNoise(i * 17 + channel * 104_729)) < density ? 1 / Math.sqrt(density) : 0
    const shared = deterministicNoise(i * 5 + 12_347)
    const independent = deterministicNoise(i * 11 + channel * 65_537)
    const raw = gate * (shared * 0.22 + independent * 0.78)
    diffusionState[channel] = diffusionState[channel] * 0.67 + raw * 0.33
    const slowAir = 0.96 + 0.04 * Math.sin(2 * Math.PI * (0.31 + channel * 0.07) * t + channel * 1.7)
    return (raw * 0.24 + diffusionState[channel] * 0.76) * envelope * slowAir
  })
}

/**
 * Shared native-WebAudio mastering chain for live and offline sampled renderers.
 * The room is intentionally longer and softer than the old test-room: the goal is
 * orchestral glue, not an audible reverb effect. Predelay preserves articulation,
 * damping keeps brass/strings from becoming brittle, and gentler compression leaves
 * musical dynamics intact.
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
  const predelay = context.createDelay(0.12); predelay.delayTime.value = profile.roomPredelaySeconds
  const roomDamping = context.createBiquadFilter(); roomDamping.type = "lowpass"; roomDamping.frequency.value = profile.roomLowpassHz; roomDamping.Q.value = 0.15
  const room = context.createConvolver(); room.normalize = true; room.buffer = createConcertRoomImpulse(context, profile.roomSeconds, profile.roomDecay)
  const roomReturn = context.createGain(); roomReturn.gain.value = 0.84

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
  highShelf.connect(roomSend); roomSend.connect(predelay); predelay.connect(roomDamping); roomDamping.connect(room); room.connect(roomReturn); roomReturn.connect(compressor)
  compressor.connect(makeup)
  makeup.connect(limiter)
  limiter.connect(output)

  const nodes = [lowShelf, highShelf, dry, roomSend, predelay, roomDamping, room, roomReturn, compressor, makeup, limiter, output] as const
  return {
    input: lowShelf,
    output,
    nodes,
    disconnect() { for (const node of nodes) node.disconnect() },
  }
}
