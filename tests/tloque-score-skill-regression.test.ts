import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScoreV2 } from "../shared/tloque-score-v2"

test("track timbre is accepted as the default physical colour", () => {
  const result = compileTloqueScoreV2(`TLOQUE_SCORE 2
title "Track timbre regression"
tempo 120
meter 4/4
loop false
seed 20260823
humanize 0
quality master
module native-auto
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=0.9 brightness=0.6 vibrato=0.04 timbre=natural
section test form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use solo
1:1 E5 1 velocity=0.7 articulation=spiccato
end`)

  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) return
  assert.equal(result.recipe.plan.tracks[0]?.timbre, "natural")
  assert.equal(result.recipe.plan.events[0]?.timbre, "natural")
})

test("event timbre overrides the track default", () => {
  const result = compileTloqueScoreV2(`TLOQUE_SCORE 2
title "Event timbre override"
tempo 72
meter 4/4
loop false
seed 20260823
humanize 0
quality studio
module vsco2-ce-trumpet
track trumpet synth=pad instrument=brass.trumpet program=56 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
section colour form=custom bars=1 repeat=1 fade=0 tempo=72 rubato=0
use trumpet
1:1 C4 1 velocity=0.5 timbre=straight-mute
end`)

  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) return
  assert.equal(result.recipe.plan.tracks[0]?.timbre, "natural")
  assert.equal(result.recipe.plan.events[0]?.timbre, "straight-mute")
})
