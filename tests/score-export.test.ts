import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { estimateScoreExport, renderTloqueScoreToWav } from "../client/src/audio/ScoreExporter"
import {
  TLOQUE_SCORE_AUDIO_PROFILE, articulationDurationFactor, articulationVelocityFactor, midiNoteToFrequency,
  midiNotesToFrequencies, scoreBrightnessFrequency, scoreExpressionStateAt, scoreMonitorVolume,
  scorePedalReleaseTime, scoreRenderProfile, scoreTrackEnvelope, scoreTrackTimbre, scoreVelocityGain,
} from "../client/src/audio/ScoreAudioMath"

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

const EXPRESSIVE_SOURCE = `TLOQUE_SCORE 2
tempo 60
meter 4/4
loop false
seed 11
humanize 0
quality core
module builtin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.25 pan=0 attack=0.01 release=0.1 expression=0.5 brightness=0.4 vibrato=0
section phrase form=exposition bars=2 repeat=1 fade=1 tempo=60 rubato=0
use violin
control 1:1 expression=0.4 pedal=down
1:1 C5 1 velocity=0.5 articulation=pizzicato
control 1:2 expression=0.8 brightness=0.8 vibrato=0.6 bend=0.5 ramp=2
1:2 E5 1 velocity=0.6 articulation=spiccato
control 2:1 pedal=up bend=0 ramp=1
2:1 G5 1 velocity=0.5 articulation=harmonic
end`

test("el exportador calcula PCM profesional sin guardar audio durante la edición", async () => {
  const compiled = compileTloqueScore(SOURCE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const estimate = estimateScoreExport(compiled.recipe)
  assert.equal(estimate.audioProfile, TLOQUE_SCORE_AUDIO_PROFILE)
  assert.equal(estimate.sampleRate, 96_000)
  assert.equal(estimate.bitDepth, 24)
  const wav = await renderTloqueScoreToWav(compiled.recipe, { quality: "preview" })
  const bytes = new Uint8Array(await wav.slice(0, 44).arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF")
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE")
  assert.equal(wav.type, "audio/wav")
  assert.equal(wav.size, estimateScoreExport(compiled.recipe, "preview").bytes)
  const pcm = new DataView(await wav.arrayBuffer())
  let peak = 0
  for (let offset = 44; offset < pcm.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(pcm.getInt16(offset, true) / 0x8000))
  }
  assert.ok(peak > 0.04, `El maestro quedó demasiado bajo: ${peak}`)
  assert.ok(peak <= 0.97, `El maestro perdió headroom: ${peak}`)
})

test("la preescucha y el WAV comparten afinación, articulación y envolvente", () => {
  assert.equal(TLOQUE_SCORE_AUDIO_PROFILE, "tloque-score-audio-v4-expression")
  assert.equal(midiNoteToFrequency(69), 440)
  assert.ok(Math.abs(midiNoteToFrequency(60) - 261.625565) < 0.000001)
  assert.deepEqual(midiNotesToFrequencies([60, 64, 67]).map(value => Math.round(value)), [262, 330, 392])
  assert.equal(articulationDurationFactor("staccato"), 0.55)
  assert.equal(articulationDurationFactor("legato"), 1.08)
  assert.equal(articulationDurationFactor("spiccato"), 0.32)
  assert.equal(articulationDurationFactor("pizzicato"), 0.48)
  assert.equal(articulationDurationFactor("tremolo"), 0.96)
  assert.equal(articulationDurationFactor("harmonic"), 0.92)
  assert.ok(articulationVelocityFactor("accent") > articulationVelocityFactor("normal"))
  assert.ok(articulationVelocityFactor("harmonic") < articulationVelocityFactor("normal"))
  assert.ok(scoreBrightnessFrequency(6_000, 0.8) > scoreBrightnessFrequency(6_000, 0.2))
  assert.ok(scoreVelocityGain(0.5) > 0.5)
  assert.ok(scoreRenderProfile("master").polyphonyBudget > scoreRenderProfile("core").polyphonyBudget)
  assert.equal(scoreRenderProfile("master").polyphonyBudget, 128)
  assert.ok(scoreRenderProfile("master").reverbWet > scoreRenderProfile("core").reverbWet)
  assert.equal(scoreMonitorVolume(0.35, 1, 0.16, 0.72, true), 1)
  assert.ok(Math.abs(scoreMonitorVolume(0.35, 1, 0.16, 0.72, false) - 0.04032) < 0.000001)

  const compiled = compileTloqueScore(SOURCE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const track = compiled.recipe.plan.tracks[0]
  assert.deepEqual(scoreTrackEnvelope(track), { attack: 0.01, decay: 0.55, sustain: 0.42, release: 0.1 })
  assert.deepEqual(scoreTrackTimbre(track), { filterHz: 6_000, filterQ: 0.6, level: 1.08 })
})

test("la expresión, el pedal y el bend se automatizan con rampas deterministas", async () => {
  const compiled = compileTloqueScore(EXPRESSIVE_SOURCE)
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
  if (!compiled.ok || compiled.recipe.version !== 2) return
  const track = compiled.recipe.plan.tracks[0]
  const middle = scoreExpressionStateAt(compiled.recipe, track, 2)
  assert.ok(Math.abs(middle.expression - 0.6) < 0.000001)
  assert.ok(Math.abs(middle.brightness - 0.6) < 0.000001)
  assert.ok(Math.abs(middle.vibrato - 0.3) < 0.000001)
  assert.ok(Math.abs(middle.pitchBend - 0.25) < 0.000001)
  assert.equal(middle.pedal, true)
  assert.equal(scorePedalReleaseTime(compiled.recipe, track.id, 1), 4)
  const first = new Uint8Array(await (await renderTloqueScoreToWav(compiled.recipe, { quality: "preview" })).arrayBuffer())
  const second = new Uint8Array(await (await renderTloqueScoreToWav(compiled.recipe, { quality: "preview" })).arrayBuffer())
  assert.deepEqual(first, second)
})

test("el maestro máximo conserva resolución y render determinista", async () => {
  const compiled = compileTloqueScore(SOURCE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const studio = estimateScoreExport(compiled.recipe, "studio")
  const master = estimateScoreExport(compiled.recipe, "master")
  assert.deepEqual(
    { sampleRate: studio.sampleRate, bitDepth: studio.bitDepth },
    { sampleRate: 48_000, bitDepth: 24 },
  )
  assert.deepEqual(
    { sampleRate: master.sampleRate, bitDepth: master.bitDepth },
    { sampleRate: 96_000, bitDepth: 24 },
  )
  assert.ok(master.durationSeconds > studio.durationSeconds)
  const first = new Uint8Array(await (await renderTloqueScoreToWav(compiled.recipe, { quality: "preview" })).arrayBuffer())
  const second = new Uint8Array(await (await renderTloqueScoreToWav(compiled.recipe, { quality: "preview" })).arrayBuffer())
  assert.deepEqual(first, second)
})
