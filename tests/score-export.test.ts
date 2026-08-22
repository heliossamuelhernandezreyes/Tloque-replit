import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { estimateScoreExport, renderTloqueScoreToWav } from "../client/src/audio/ScoreExporter"

const SOURCE = `TLOQUE_SCORE 2
tempo 120
meter 4/4
loop false
seed 7
quality master
module builtin
track piano synth=warm instrument=piano.grand program=0 role=melody gain=0.25 pan=0 attack=0.01 release=0.1
section coda form=coda bars=1 repeat=1 fade=0
use piano
1:1 C4 0.125 velocity=0.3
end`

test("el exportador calcula PCM profesional sin guardar audio durante la edición", async () => {
  const compiled = compileTloqueScore(SOURCE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const estimate = estimateScoreExport(compiled.recipe)
  assert.equal(estimate.sampleRate, 48_000)
  assert.equal(estimate.bitDepth, 24)
  const wav = await renderTloqueScoreToWav(compiled.recipe, { quality: "preview" })
  const bytes = new Uint8Array(await wav.slice(0, 44).arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF")
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE")
  assert.equal(wav.type, "audio/wav")
  assert.equal(wav.size, estimateScoreExport(compiled.recipe, "preview").bytes)
})
