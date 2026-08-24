import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { INSTRUMENT_MANIFEST_REGISTRY } from "../shared/instrument-manifest"
import { buildPerformancePlan } from "../client/src/audio/PerformanceEngine"

const SOURCE = `TLOQUE_SCORE 2
title "Director test"
tempo 60
meter 4/4
loop false
seed 4242
humanize 0
quality master
module builtin
track flute synth=pad instrument=woodwinds.flute program=73 role=melody gain=0.3 pan=0 attack=0.02 release=0.8 expression=0.8 brightness=0.5 vibrato=0 timbre=natural
section phrase form=exposition bars=2 repeat=1 fade=0 tempo=60 rubato=0
use flute
1:1 C5 0.5 velocity=0.50 articulation=normal
1:2 C5 0.5 velocity=0.50 articulation=normal
1:3 G5 0.5 velocity=0.50 articulation=normal
2:1 A5 1 velocity=0.50 articulation=tenuto
end`

test("Performance Director detecta frase, repetición, salto y cierre sin cambiar articulaciones", () => {
  const result = compileTloqueScore(SOURCE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const plan = buildPerformancePlan(result.recipe)
  assert.equal(plan.events.length, 4)
  assert.equal(plan.events[0].phraseStart, true)
  assert.ok(plan.events[0].directorReasons.includes("phrase-entry"))
  assert.ok(plan.events[1].directorReasons.includes("repeated-note"))
  assert.ok(plan.events[2].directorReasons.includes("leap-destination"))
  assert.equal(plan.events[3].phraseEnd, true)
  assert.ok(plan.events[3].directorReasons.includes("phrase-release"))
  assert.deepEqual(plan.events.map(event => event.articulation), ["normal", "normal", "normal", "tenuto"])
})

test("Director mantiene sus cambios dentro de límites conservadores", () => {
  const result = compileTloqueScore(SOURCE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const plan = buildPerformancePlan(result.recipe)
  for (const event of plan.events) {
    assert.ok(event.startOffsetSeconds >= -0.04 && event.startOffsetSeconds <= 0.04)
    assert.ok(event.durationScale >= 0.84 && event.durationScale <= 1.10)
    assert.ok(event.velocityScale >= 0.86 && event.velocityScale <= 1.14)
  }
})

test("auditoría: ningún instrumento acústico autor-facing declara true legato todavía", () => {
  const acoustic = INSTRUMENT_MANIFEST_REGISTRY.filter(manifest => !manifest.instruments.some(id => id.startsWith("voice.")) && manifest.id !== "gm-orchestral-strings")
  const trueLegato = acoustic.filter(manifest => manifest.articulations.some(route => route.trueLegato))
  assert.deepEqual(trueLegato, [])
  const reference = INSTRUMENT_MANIFEST_REGISTRY.find(manifest => manifest.id === "sfzinstruments-legato-vocal-a")
  assert.equal(reference?.articulations.some(route => route.trueLegato), true)
})
