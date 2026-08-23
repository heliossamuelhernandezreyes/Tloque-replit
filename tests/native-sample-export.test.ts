import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileTloqueScore } from "../shared/audio"
import { validateTloqueSamplePack, type TloqueSamplePack } from "../shared/native-sample-pack"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"
import { renderTloqueScoreWithNativeSamplePackToWav } from "../client/src/audio/NativeSampleScoreExporter"

const SCORE = `TLOQUE_SCORE 2
title "Native parity"
tempo 60
meter 4/4
loop false
seed 20260823
quality studio
module vsco2-ce-solo-violin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.40 pan=0.25 attack=0.1 release=1 expression=0.75 brightness=0.6 vibrato=0.1
section phrase form=exposition bars=1 repeat=1 fade=0 tempo=60 rubato=0
use violin
control 1:1 expression=0.50 ramp=0
1:1 C5 1 velocity=0.40 articulation=normal
1:2 D5 0.5 velocity=0.55 articulation=spiccato
end`

const PACK: TloqueSamplePack = {
  version: 1,
  id: "vsco2-ce-solo-violin",
  name: "Fixture violin",
  instrumentManifestId: "vsco2-ce-solo-violin",
  license: "CC0-1.0",
  sourceName: "fixture",
  sourceUrl: "https://example.invalid",
  zones: [
    { id: "sus", articulation: "normal", sampleUrl: "/api/audio/sample-packs/samples/a.wav", rootMidi: 72, loMidi: 60, hiMidi: 84, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0 },
    { id: "spic0", articulation: "spiccato", sampleUrl: "/api/audio/sample-packs/samples/b.wav", rootMidi: 74, loMidi: 60, hiMidi: 84, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 0, gainDb: -2, tuneCents: 0 },
    { id: "spic1", articulation: "spiccato", sampleUrl: "/api/audio/sample-packs/samples/c.wav", rootMidi: 74, loMidi: 60, hiMidi: 84, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 1, gainDb: -2, tuneCents: 0 },
  ],
}

function recipe() {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.errors.join("\n"))
  return result.recipe
}

test("live y WAV comparten un único plan de voces nativas", () => {
  const plan = buildNativeSampleScorePlan(recipe(), validateTloqueSamplePack(PACK))
  assert.equal(plan.tracks.length, 1)
  assert.equal(plan.tracks[0].pan, 0.25)
  assert.equal(plan.controls.length, 1)
  assert.equal(plan.voices.length, 2)
  assert.deepEqual(plan.voices.map(voice => voice.articulation), ["normal", "spiccato"])
  assert.deepEqual(plan.voices.map(voice => voice.startSeconds), [0, 1])
  assert.equal(plan.voices[0].durationSeconds, 0.96)
  assert.ok(plan.voices[1].durationSeconds < 0.5)
  assert.ok(plan.zones.some(zone => zone.id === "sus"))
  assert.ok(plan.zones.some(zone => zone.id === "spic0" || zone.id === "spic1"))
})

test("el plan nativo conserva expresión, velocity y RR deterministas", () => {
  const first = buildNativeSampleScorePlan(recipe(), validateTloqueSamplePack(PACK))
  const second = buildNativeSampleScorePlan(recipe(), validateTloqueSamplePack(PACK))
  assert.deepEqual(first.voices, second.voices)
  assert.deepEqual(first.zones.map(zone => zone.id), second.zones.map(zone => zone.id))
  assert.ok(first.controls[0].gain < first.tracks[0].gain)
  assert.ok(first.voices.every(voice => voice.velocity >= 1 && voice.velocity <= 127))
  assert.ok(first.voices[1].roundRobin === 0 || first.voices[1].roundRobin === 1)
})

test("el exportador WAV nativo queda expuesto como ruta independiente de SoundFont", () => {
  assert.equal(typeof renderTloqueScoreWithNativeSamplePackToWav, "function")
})

test("el exportador general deriva módulos VSCO curados hacia TloqueSamplePack", () => {
  const source = readFileSync(new URL("../client/src/audio/ScoreExporter.ts", import.meta.url), "utf8")
  assert.match(source, /curatedSamplePackByModuleId\(recipe\.plan\.moduleId\)/)
  assert.match(source, /renderTloqueScoreWithNativeSamplePackToWav/)
  assert.match(source, /\/api\/audio\/sample-packs\/modules\//)
})
