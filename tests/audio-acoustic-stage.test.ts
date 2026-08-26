import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
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

test("preview y WAV comparten el mismo grafo acústico nativo", () => {
  const live = fs.readFileSync("client/src/audio/NativeSampleScoreEngine.ts", "utf8")
  const offline = fs.readFileSync("client/src/audio/NativeSampleScoreExporter.ts", "utf8")
  const graph = fs.readFileSync("client/src/audio/NativeRenderGraph.ts", "utf8")

  for (const source of [live, offline]) {
    assert.match(source, /createNativeRenderGraph\(context, index\.trackById/)
    assert.doesNotMatch(source, /createAcousticStage\(context, mix\.input\)/)
  }

  assert.match(graph, /createSampledMixMaster\(context, 1\)/)
  assert.match(graph, /createAcousticStage\(context, mix\.input\)/)
  assert.match(graph, /stage\.createTrackInput\(semanticTrack\?\.instrument \?\? "unknown", pan\)/)
})
