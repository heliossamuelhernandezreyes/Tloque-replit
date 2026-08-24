import assert from "node:assert/strict"
import test from "node:test"
import { compileTloqueScoreV2 } from "../shared/tloque-score-v2"
import {
  NATIVE_AUTO_MODULE_ID,
  nativeModuleGroupsForRecipe,
  preferredNativeModuleForInstrument,
  recipeForNativeModule,
} from "../client/src/audio/NativeAutoModule"

test("native-auto resolves solo, tutti, low strings and continuo independently", () => {
  const compiled = compileTloqueScoreV2(`TLOQUE_SCORE 2
title "Winter engine stress"
tempo 144
meter 4/4
loop false
seed 20260823
humanize 0.035
quality master
module ${NATIVE_AUTO_MODULE_ID}
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.30 pan=0.10 attack=0.01 release=1 expression=0.9 brightness=0.58 vibrato=0.05 timbre=natural
track violin1 synth=pad instrument=strings.violin-section program=40 role=harmony gain=0.22 pan=-0.18 attack=0.01 release=1 expression=0.8 brightness=0.52 vibrato=0.03 timbre=natural
track violin2 synth=pad instrument=strings.violin-section program=40 role=harmony gain=0.20 pan=0.18 attack=0.01 release=1 expression=0.76 brightness=0.50 vibrato=0.03 timbre=natural
track viola synth=pad instrument=strings.viola program=41 role=harmony gain=0.20 pan=-0.28 attack=0.01 release=1 expression=0.76 brightness=0.46 vibrato=0.03 timbre=natural
track cello synth=bass instrument=strings.cello program=42 role=bass gain=0.23 pan=0.24 attack=0.01 release=1 expression=0.8 brightness=0.40 vibrato=0.02 timbre=natural
track bass synth=bass instrument=strings.contrabass program=43 role=bass gain=0.20 pan=0.05 attack=0.01 release=1 expression=0.72 brightness=0.36 vibrato=0.01 timbre=natural
track continuo synth=pluck instrument=keys.harpsichord program=6 role=harmony gain=0.18 pan=-0.04 attack=0.003 release=0.5 expression=0.72 brightness=0.62 vibrato=0 timbre=natural
section frost form=custom bars=2 repeat=1 fade=0 tempo=144 rubato=0.01
use violin1
1:1 A4 0.25 velocity=0.56 articulation=spiccato
1:1.25 A4 0.25 velocity=0.59 articulation=spiccato
1:1.5 A4 0.25 velocity=0.54 articulation=spiccato
1:1.75 A4 0.25 velocity=0.61 articulation=spiccato
use violin2
1:1 E4 0.5 velocity=0.52 articulation=spiccato
1:1.5 E4 0.5 velocity=0.55 articulation=spiccato
use viola
1:1 C4 0.5 velocity=0.50 articulation=spiccato
1:1.5 B3 0.5 velocity=0.53 articulation=spiccato
use cello
1:1 A2 1 velocity=0.56 articulation=staccato
1:2 E3 1 velocity=0.58 articulation=staccato
use bass
1:1 A1 2 velocity=0.50
use continuo
1:1 A2,E3,A3 1 velocity=0.40
1:2 E3,G#3,B3 1 velocity=0.38
use solo
control 1:1 expression=0.70 vibrato=0.02 brightness=0.52 ramp=0
1:1 E5 0.25 velocity=0.68 articulation=spiccato
1:1.25 F5 0.25 velocity=0.71 articulation=spiccato
1:1.5 G#5 0.25 velocity=0.74 articulation=spiccato
1:1.75 A5 0.25 velocity=0.78 articulation=accent
1:2 G#5 0.5 velocity=0.70 articulation=staccato
2:1 E5 1 velocity=0.64 articulation=normal
use continuo
2:1 A2,E3,A3 1 velocity=0.41
2:2 E3,A3,C4 1 velocity=0.39
end`)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return

  const groups = nativeModuleGroupsForRecipe(compiled.recipe)
  assert.deepEqual(groups.map(group => group.moduleId), [
    "vsco2-ce-solo-violin",
    "vsco2-ce-violin-section",
    "vsco2-ce-viola-section",
    "vsco2-ce-cello-section",
    "vsco2-ce-solo-contrabass",
    "vcsl-italian-harpsichord-stop1",
  ])
  assert.deepEqual(groups[1].trackIds, ["violin1", "violin2"])
  assert.equal(recipeForNativeModule(compiled.recipe, groups[0]).plan.tracks[0].instrument, "strings.violin")
  assert.equal(recipeForNativeModule(compiled.recipe, groups[1]).plan.events.length, 6)
  assert.equal(recipeForNativeModule(compiled.recipe, groups[5]).plan.tracks[0].instrument, "keys.harpsichord")
})

test("semantic instrument resolution is strict and distinguishes solo from tutti", () => {
  assert.equal(preferredNativeModuleForInstrument("strings.violin"), "vsco2-ce-solo-violin")
  assert.equal(preferredNativeModuleForInstrument("strings.violin-section"), "vsco2-ce-violin-section")
  assert.equal(preferredNativeModuleForInstrument("keys.harpsichord"), "vcsl-italian-harpsichord-stop1")
  assert.equal(preferredNativeModuleForInstrument("keys.pipe-organ"), "vcsl-estuary-pipe-organ")
  assert.equal(preferredNativeModuleForInstrument("instrument.that-does-not-exist"), null)
})
