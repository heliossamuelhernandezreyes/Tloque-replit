import { describe, expect, it } from "vitest"
import { acousticPlacementForInstrument } from "../client/src/audio/ScoreAcousticStage"
import { SAMPLED_MIX_MASTER_PROFILE } from "../client/src/audio/ScoreMixMaster"

describe("native acoustic stage", () => {
  it("places rear families deeper than exposed soloists", () => {
    const solo = acousticPlacementForInstrument("strings.violin")
    const brass = acousticPlacementForInstrument("brass.trumpet")
    const percussion = acousticPlacementForInstrument("percussion.timpani")
    const organ = acousticPlacementForInstrument("keys.pipe-organ")
    expect(brass.depth).toBeGreaterThan(solo.depth)
    expect(percussion.depth).toBeGreaterThan(brass.depth)
    expect(organ.roomSend).toBeGreaterThan(solo.roomSend)
  })

  it("uses a conservative deterministic concert-room master", () => {
    expect(SAMPLED_MIX_MASTER_PROFILE.roomSeconds).toBeGreaterThanOrEqual(2)
    expect(SAMPLED_MIX_MASTER_PROFILE.roomMix).toBeGreaterThan(0)
    expect(SAMPLED_MIX_MASTER_PROFILE.roomMix).toBeLessThan(0.3)
    expect(SAMPLED_MIX_MASTER_PROFILE.limiterThreshold).toBeLessThan(0)
  })
})
