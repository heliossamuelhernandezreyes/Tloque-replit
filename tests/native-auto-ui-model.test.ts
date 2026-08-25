import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScoreV2 } from "../shared/tloque-score-v2"
import { nativeRouterUiModel } from "../client/src/audio/NativeAutoUiModel"

test("native-auto se presenta como router virtual y no como banco único", () => {
  const compiled = compileTloqueScoreV2(`TLOQUE_SCORE 2\ntitle "Router"\ntempo 72\nmeter 4/4\nloop false\nseed 1\nhumanize 0\nquality master\nmodule native-auto\ntrack violin synth=pad instrument=strings.violin program=40 role=melody gain=0.2 pan=0 attack=0.1 release=1 expression=0.7 brightness=0.5 vibrato=0 timbre=natural\nsection a form=exposition bars=1 repeat=1 fade=0 tempo=72 rubato=0\nuse violin\n1:1 C5 1 velocity=0.5 articulation=normal\nend`)
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
  if (!compiled.ok) return
  const model = nativeRouterUiModel(compiled.recipe)
  assert.ok(model)
  assert.equal(model.virtual, true)
  assert.equal(model.moduleIds.length, 1)
  assert.match(model.label, /Router acústico automático/)
})
