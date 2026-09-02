import test from "node:test"
import assert from "node:assert/strict"
import { SAMPLED_MIX_MASTER_PROFILE } from "../client/src/audio/ScoreMixMaster"

test("sampled live y offline comparten un único perfil de mezcla/master", () => {
  assert.deepEqual(SAMPLED_MIX_MASTER_PROFILE, {
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
    roomSeconds: 3.6,
    roomDecay: 1.92,
    roomMix: 0.235,
    roomPredelaySeconds: 0.026,
    roomLowpassHz: 8_100,
  })
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.limiterThreshold < 0)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.limiterRatio >= 10)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomMix > 0 && SAMPLED_MIX_MASTER_PROFILE.roomMix < 0.3)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomPredelaySeconds > 0)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomLowpassHz < 12_000)
})
