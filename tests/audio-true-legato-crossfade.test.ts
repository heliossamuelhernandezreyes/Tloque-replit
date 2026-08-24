import test from "node:test"
import assert from "node:assert/strict"
import { trueLegatoCrossfadeSeconds } from "../client/src/audio/NativeSampleScorePlan"

test("true legato usa un crossfade corto y proporcional en notas normales", () => {
  assert.equal(trueLegatoCrossfadeSeconds(0.5), 0.09)
})

test("true legato limita el crossfade para notas muy cortas", () => {
  assert.equal(trueLegatoCrossfadeSeconds(0.05), 0.025)
})

test("true legato limita el crossfade para notas largas", () => {
  assert.equal(trueLegatoCrossfadeSeconds(2), 0.12)
})
