import test from "node:test"
import assert from "node:assert/strict"
import { SAMPLED_MIX_MASTER_PROFILE } from "../client/src/audio/ScoreMixMaster"

test("sampled live y offline comparten un único perfil de mezcla/master", () => {
  assert.deepEqual(SAMPLED_MIX_MASTER_PROFILE, {
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
  })
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.limiterThreshold < 0)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.limiterRatio >= 10)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomMix > 0 && SAMPLED_MIX_MASTER_PROFILE.roomMix < 0.3)
})
