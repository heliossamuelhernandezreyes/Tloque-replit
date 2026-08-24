import assert from "node:assert/strict"
import test from "node:test"
import { compileTloqueScoreV2 } from "../shared/tloque-score-v2"
import {
  NATIVE_AUTO_MODULE_ID,
  nativeModuleGroupsForRecipe,
  preferredNativeModuleForInstrument,
  recipeForNativeModule,
} from "../client/src/audio/NativeAutoModule"

test("native-auto resolves orchestral tracks to independent verified modules", () => {
  const compiled = compileTloqueScoreV2(`TLOQUE_SCORE 2
title "Native auto routing"
tempo 120
meter 4/4
loop false
seed 20260823
humanize 0
quality studio
module ${NATIVE_AUTO_MODULE_ID}
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
track viola synth=pad instrument=strings.viola program=41 role=harmony gain=0.25 pan=-0.2 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
track cello synth=pad instrument=strings.cello program=42 role=bass gain=0.25 pan=0.2 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.25 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
section test form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use solo
1:1 E5 1 velocity=0.7 articulation=spiccato
use viola
1:2 A4 1 velocity=0.6
use cello
1:3 E3 1 velocity=0.6
use piano
1:4 A3,C4,E4 1 velocity=0.5
end`)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return

  const groups = nativeModuleGroupsForRecipe(compiled.recipe)
  assert.deepEqual(groups.map(group => group.moduleId), [
    "vsco2-ce-solo-violin",
    "vsco2-ce-viola-section",
    "vsco2-ce-cello-section",
    "vcsl-estuary-grand-piano",
  ])
  assert.equal(recipeForNativeModule(compiled.recipe, groups[0]).plan.events.length, 1)
  assert.equal(recipeForNativeModule(compiled.recipe, groups[3]).plan.tracks[0].instrument, "piano.grand")
})

test("semantic instrument resolution is strict", () => {
  assert.equal(preferredNativeModuleForInstrument("strings.violin"), "vsco2-ce-solo-violin")
  assert.equal(preferredNativeModuleForInstrument("keys.pipe-organ"), "vcsl-estuary-pipe-organ")
  assert.equal(preferredNativeModuleForInstrument("instrument.that-does-not-exist"), null)
})
