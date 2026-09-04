import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileTloqueScore } from "../shared/audio"
import { ORCHESTRAL_SYNTH_MODULE_ID, ORCHESTRAL_SYNTH_MAX_SOURCES, ORCHESTRAL_SYNTH_VERSION, orchestralSpectrum, orchestralTimbreFor, withOrchestralModule } from "../shared/orchestral-synthesis"
import { ORCHESTRAL_ROOM_MAX_SECONDS, ORCHESTRAL_ROOM_VERSION, orchestralEarlyReflections, orchestralLateFieldEnvelope } from "../client/src/audio/OrchestralRoom"
import { orchestralExpressionCurve, orchestralNoteExpression } from "../client/src/audio/OrchestralExpression"
import { ORCHESTRAL_DYNAMICS_MAX_POINTS, ORCHESTRAL_DYNAMICS_VERSION, orchestralContinuousDynamics, orchestralDynamicCutoffCurve } from "../client/src/audio/OrchestralDynamics"
import { nativeControlValueAt, nativeTrackAtTime } from "../client/src/audio/NativeRecipeIndex"
import { buildOrchestralSynthPlan } from "../client/src/audio/OrchestralSynthPlan"
import { estimateScoreExport } from "../client/src/audio/ScoreExporter"
import { preflightNativeSamplePacks, renderTloqueScoreWithNativeSamplePackToWav } from "../client/src/audio/NativeSampleScoreExporter"
import { ORCHESTRAL_QA_SCORE } from "./fixtures/orchestral-score"

function recipe() {
  const result = compileTloqueScore(ORCHESTRAL_QA_SCORE)
  assert.ok(result.ok)
  if (!result.ok || result.recipe.version !== 2) throw new Error("fixture inválida")
  return result.recipe
}

test("orchestra-synth compila sin bancos y conserva exactamente las notas al cambiar de módulo", () => {
  const first = recipe()
  assert.equal(first.plan.moduleId, ORCHESTRAL_SYNTH_MODULE_ID)
  for (const moduleId of ["builtin", "native-auto", ORCHESTRAL_SYNTH_MODULE_ID] as const) {
    const next = compileTloqueScore(withOrchestralModule(ORCHESTRAL_QA_SCORE, moduleId))
    assert.ok(next.ok)
    if (next.ok) assert.deepEqual(next.recipe.plan.events, first.plan.events)
  }
  assert.equal(withOrchestralModule("", ORCHESTRAL_SYNTH_MODULE_ID), "")
})

test("espectros por familia son distintos, acotados, sin DC y sin parciales sobre Nyquist", () => {
  const identities = new Set<string>()
  for (const instrument of ["strings.violin", "woodwinds.flute", "woodwinds.clarinet", "woodwinds.oboe", "brass.trumpet", "brass.horn"]) {
    const profile = orchestralTimbreFor(instrument)
    const first = orchestralSpectrum(profile, 440, 0.65, 48_000)
    assert.deepEqual(first, orchestralSpectrum(profile, 440, 0.65, 48_000))
    assert.equal(first[0], 0)
    assert.ok(first.every(Number.isFinite))
    assert.ok(first.reduce((sum, value) => sum + Math.abs(value), 0) <= 1.000001)
    identities.add(JSON.stringify([...first]))
    const high = orchestralSpectrum(profile, 4000, 1, 32_000)
    assert.ok(high.slice(4).every(value => value === 0))
  }
  assert.equal(identities.size, 6)
})

test("la dinámica abre el espectro y las secciones no duplican un solista idéntico", () => {
  const profile = orchestralTimbreFor("brass.trumpet")
  const soft = orchestralSpectrum(profile, 440, 0.1, 48_000)
  const loud = orchestralSpectrum(profile, 440, 0.9, 48_000)
  assert.ok(loud[6] / loud[1] > soft[6] / soft[1])
  assert.equal(orchestralTimbreFor("strings.violin").ensemble, 1)
  assert.equal(orchestralTimbreFor("strings.violin-section").ensemble, 3)
  assert.ok(ORCHESTRAL_SYNTH_MAX_SOURCES <= 192)
})

test("dinámica V2 recorre una nota sostenida de forma determinista, finita y Nyquist-safe", () => {
  const score = recipe(), track = { ...score.plan.tracks[0], expression: 0.2, brightness: 0.25 }
  const base = score.plan.controls[0]
  const controls = [{ ...base, trackId: track.id, timeSeconds: 0, expression: 1, brightness: 0.9, rampSeconds: 4 }]
  const first = orchestralContinuousDynamics(track, controls, 0, 4, 0.5, "legato")
  const again = orchestralContinuousDynamics(track, controls, 0, 4, 0.5, "legato")
  assert.equal(ORCHESTRAL_DYNAMICS_VERSION, "tloque-orchestral-dynamics-v2")
  assert.deepEqual(first, again)
  assert.equal(first.sustained, true)
  assert.ok(first.effort.length <= ORCHESTRAL_DYNAMICS_MAX_POINTS)
  assert.ok(first.effort.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
  assert.ok(first.brightness.at(-1)! > first.brightness[0])
  for (const sampleRate of [32_000, 48_000, 96_000]) {
    const cutoff = orchestralDynamicCutoffCurve(first, sampleRate, "synth")
    assert.ok(cutoff.at(-1)! > cutoff[0])
    assert.ok(cutoff.every(value => Number.isFinite(value) && value >= 250 && value <= sampleRate * 0.44))
  }
  assert.equal(orchestralContinuousDynamics(track, controls, 0, 0.15, 1, "staccato").sustained, false)
})

test("piano, arpa y percusión usan decaimientos modales, no sustains de pad", () => {
  for (const instrument of ["piano.grand", "strings.harp", "percussion.marimba", "keys.celesta"]) {
    const profile = orchestralTimbreFor(instrument)
    assert.ok(profile.decay > 0)
    assert.ok(profile.modalRatios && profile.modalRatios.length >= 3)
    assert.equal(profile.vibratoCents, 0)
  }
  assert.notDeepEqual(orchestralTimbreFor("percussion.orchestral-kit", 36), orchestralTimbreFor("percussion.orchestral-kit", 49))
})

test("vibrato grabado no recibe doble vibrato y las notas cortas no se deforman", () => {
  const recorded = orchestralNoteExpression("strings.violin", "legato", 4, 0.8, true, "a")
  assert.equal(recorded.vibratoCents, 0)
  const short = orchestralNoteExpression("strings.violin", "staccato", 0.2, 1, false, "a")
  assert.equal(short.swell, 0)
  assert.equal(short.vibratoCents, 0)
  const sustained = orchestralNoteExpression("strings.violin", "legato", 4, 0.8, false, "a")
  const curve = orchestralExpressionCurve(sustained, 4, "detune")
  assert.ok(curve.some(value => Math.abs(value) > 1))
  assert.deepEqual(curve, orchestralExpressionCurve(sustained, 4, "detune"))
  assert.equal(curve[0], 0)
  const gain = orchestralExpressionCurve(sustained, 4, "gain")
  assert.ok(gain.every(value => value >= 0.88 && value <= 1))
})

test("crescendo y rampas interrumpidas comienzan en el valor correcto", () => {
  const score = recipe(), track = score.plan.tracks[0]
  const base = score.plan.controls[0]
  const controls = [
    { ...base, timeSeconds: 2, expression: 1, rampSeconds: 4 },
    { ...base, timeSeconds: 4, expression: 0.2, rampSeconds: 2 },
  ]
  assert.equal(nativeControlValueAt(controls, "expression", 1, 0.4), 0.4)
  assert.equal(nativeControlValueAt(controls, "expression", 2, 0.4), 0.4)
  assert.ok(Math.abs(nativeControlValueAt(controls, "expression", 4, 0.4) - 0.7) < 1e-9)
  assert.ok(Math.abs(nativeControlValueAt(controls, "expression", 5, 0.4) - 0.45) < 1e-9)
  assert.equal(nativeControlValueAt(controls, "expression", 9, 0.4), 0.2)
  assert.equal(nativeTrackAtTime({ ...track, expression: 0.4 }, controls, 2).expression, 0.4)
})

test("sala direccional conserva simetría, tiempos físicos y energía limitada", () => {
  const left = orchestralEarlyReflections(-0.5, 0.4), right = orchestralEarlyReflections(0.5, 0.4)
  assert.equal(left.length, 4)
  assert.ok(left.some(reflection => reflection.pan < -0.5))
  assert.ok(left.some(reflection => reflection.pan > 0.5))
  assert.ok(left.every(reflection => reflection.delaySeconds > 0 && reflection.delaySeconds < 0.13))
  assert.ok(left.reduce((sum, reflection) => sum + reflection.gain, 0) < 0.5)
  for (let i = 0; i < left.length; i++) {
    assert.ok(Math.abs(left[i].delaySeconds - right[i].delaySeconds) < 1e-9)
    assert.ok(Math.abs(left[i].pan + right[i].pan) < 1e-9)
  }
})

test("sala V3 tiene bloom y doble caída acotada sin fingir una IR medida", () => {
  assert.equal(ORCHESTRAL_ROOM_VERSION, "tloque-concert-stage-v3")
  assert.equal(ORCHESTRAL_ROOM_MAX_SECONDS, 3.6)
  const values = [0, 0.04, 0.3, 1.2, 2.5, 3.59, 3.6].map(time => orchestralLateFieldEnvelope(time, 3.6, 1.92))
  assert.equal(values[0], 0)
  assert.ok(values[1] > 0 && values[2] > values[3] && values[3] > values[4] && values[4] > values[5])
  assert.equal(values.at(-1), 0)
  assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
})

test("el plan interpretado es estable, ordenado y no cambia las alturas", () => {
  const score = recipe(), ids = new Set(score.plan.tracks.map(track => track.id))
  const first = buildOrchestralSynthPlan(score, ids)
  assert.deepEqual(first, buildOrchestralSynthPlan(score, ids))
  assert.equal(first.length, score.plan.events.length)
  assert.ok(first.every((event, i) => event.timeSeconds >= 0 && (i === 0 || event.timeSeconds >= first[i - 1].timeSeconds)))
  assert.ok(first.every(event => event.durationIsPerformed && event.velocity <= 1))
  assert.deepEqual(first.map(event => [...event.notes].sort()).sort(), score.plan.events.map(event => [...event.notes].sort()).sort())
  const linked = first.filter(event => event.legatoFromPrevious)
  assert.ok(linked.length > 0)
  assert.ok(linked.every(event => event.notes.length === 1 && event.articulation === "legato" && event.transitionFromMidi !== undefined))
  assert.ok(first.filter(event => event.notes.length > 1).every(event => !event.legatoFromPrevious))
})

test("síntesis explícita no descarga bancos ni se hace pasar por certificación nativa", async () => {
  const score = recipe()
  assert.deepEqual(await preflightNativeSamplePacks(score), { ready: true, items: [], missing: [] })
  await assert.rejects(() => renderTloqueScoreWithNativeSamplePackToWav(score, "", { strictNativeSources: true }), /no es una fuente acústica grabada/)
  assert.equal(estimateScoreExport(score, "studio").sampleRate, 48_000)
  assert.equal(estimateScoreExport(score, "master").sampleRate, 96_000)
})

test("realtime y WAV consumen las mismas voces, interpretación y envolventes", () => {
  for (const file of ["NativeSampleScoreEngine.ts", "NativeSampleScoreExporter.ts"]) {
    const code = readFileSync(`client/src/audio/${file}`, "utf8")
    assert.match(code, /scheduleOrchestralSynthVoice/)
    assert.match(code, /buildOrchestralSynthPlan/)
    assert.match(code, /expression: voice.expression/)
    assert.match(code, /dynamics: voice.dynamics/)
    assert.match(code, /fallbackTrackIds.has\(event.trackId\)/)
  }
  assert.match(readFileSync("client/src/audio/NativeSampleScoreEngine.ts", "utf8"), /scoreMonitorVolume\(this.master/)
  assert.equal(ORCHESTRAL_SYNTH_VERSION, "tloque-orchestral-synth-v2.1")
})
