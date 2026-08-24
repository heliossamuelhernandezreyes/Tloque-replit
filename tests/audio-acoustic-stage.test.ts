import test from "node:test"
import assert from "node:assert/strict"
import { acousticPlacementForInstrument } from "../client/src/audio/ScoreAcousticStage"
import { SAMPLED_MIX_MASTER_PROFILE } from "../client/src/audio/ScoreMixMaster"

test("native stage coloca familias traseras más profundas que solistas", () => {
  const solo = acousticPlacementForInstrument("strings.violin")
  const brass = acousticPlacementForInstrument("brass.trumpet")
  const percussion = acousticPlacementForInstrument("percussion.timpani")
  const organ = acousticPlacementForInstrument("keys.pipe-organ")
  assert.ok(brass.depth > solo.depth)
  assert.ok(percussion.depth > brass.depth)
  assert.ok(organ.roomSend > solo.roomSend)
})

test("master nativo usa una sala de concierto determinista y conservadora", () => {
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomSeconds >= 2)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomMix > 0)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.roomMix < 0.3)
  assert.ok(SAMPLED_MIX_MASTER_PROFILE.limiterThreshold < 0)
})
