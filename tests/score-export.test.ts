import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { estimateScoreExport, renderTloqueScoreToWav } from "../client/src/audio/ScoreExporter"
import { articulationDurationFactor, midiNoteToFrequency, midiNotesToFrequencies, scoreTrackEnvelope } from "../client/src/audio/ScoreAudioMath"

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

test("la preescucha y el WAV comparten afinación, articulación y envolvente", () => {
  assert.equal(midiNoteToFrequency(69), 440)
  assert.ok(Math.abs(midiNoteToFrequency(60) - 261.625565) < 0.000001)
  assert.deepEqual(midiNotesToFrequencies([60, 64, 67]).map(value => Math.round(value)), [262, 330, 392])
  assert.equal(articulationDurationFactor("staccato"), 0.55)
  assert.equal(articulationDurationFactor("legato"), 1.08)

  const compiled = compileTloqueScore(SOURCE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const track = compiled.recipe.plan.tracks[0]
  assert.deepEqual(scoreTrackEnvelope(track), { attack: 0.01, release: 0.1 })
})
