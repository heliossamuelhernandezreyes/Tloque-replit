import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deterministicNoiseOffset } from "../client/src/audio/DeterministicAudioNoise"
import { measureNativeRuntimeBudget } from "../client/src/audio/NativeRuntimeBudget"
import { compileViolinWinterStressV1 } from "../shared/violin-winter-stress"

const read = (path: string) => readFileSync(path, "utf8")

test("offset de ruido físico es determinista y queda dentro del buffer", () => {
  const a = deterministicNoiseOffset("violin:track:1:C4", 8)
  const b = deterministicNoiseOffset("violin:track:1:C4", 8)
  const c = deterministicNoiseOffset("violin:track:2:C4", 8)
  assert.equal(a, b)
  assert.ok(a >= 0 && a < 8)
  assert.ok(c >= 0 && c < 8)
  assert.notEqual(a, c)
})

test("arco y columna de aire reutilizan noise beds por contexto", () => {
  const helper = read("client/src/audio/DeterministicAudioNoise.ts")
  const bow = read("client/src/audio/PhysicalBowedStringOverlay.ts")
  const air = read("client/src/audio/PhysicalAirColumnOverlay.ts")
  assert.match(helper, /WeakMap<BaseAudioContext, Map<string, AudioBuffer>>/)
  for (const source of [bow, air]) {
    assert.match(source, /sharedDeterministicNoiseBuffer/)
    assert.match(source, /deterministicNoiseOffset/)
    assert.doesNotMatch(source, /createDeterministicNoiseBuffer\(/)
  }
})

test("realtime indexa eventos y automatización en una sola estructura", () => {
  const engine = read("client/src/audio/NativeSampleScoreEngine.ts")
  const index = read("client/src/audio/NativeRecipeIndex.ts")
  assert.match(engine, /buildNativeRecipeIndex\(recipe\)/)
  assert.match(engine, /index\.controlsByTrack\.get\(event\.trackId\)/)
  assert.match(engine, /index\.eventsByTrack\.get\(trackId\)/)
  assert.doesNotMatch(engine, /recipe\.plan\.controls\.filter\(/)
  assert.doesNotMatch(engine, /recipe\.plan\.events\.filter\(/)
  assert.match(index, /for \(const control of recipe\.plan\.controls\)/)
  assert.match(index, /for \(const event of recipe\.plan\.events\)/)
  assert.match(index, /if \(control\.timeSeconds > timeSeconds\) break/)
})

test("realtime y WAV comparten el mismo índice temporal nativo", () => {
  const engine = read("client/src/audio/NativeSampleScoreEngine.ts")
  const exporter = read("client/src/audio/NativeSampleScoreExporter.ts")
  for (const source of [engine, exporter]) {
    assert.match(source, /buildNativeRecipeIndex\(recipe\)/)
    assert.match(source, /nativeTrackAtTime/)
  }
  assert.match(exporter, /index\.chronologicalEvents/)
  assert.match(exporter, /index\.controlsByTrack\.get\(event\.trackId\)/)
  assert.doesNotMatch(exporter, /recipe\.plan\.controls\.filter\(/)
  assert.doesNotMatch(exporter, /\[\.\.\.recipe\.plan\.events\]\.sort/)
})

test("Winter expone una presión de voces determinista para benchmarks", () => {
  const compiled = compileViolinWinterStressV1()
  assert.equal(compiled.ok, true)
  if (!compiled.ok || compiled.recipe.version !== 2) return
  const a = measureNativeRuntimeBudget(compiled.recipe)
  const b = measureNativeRuntimeBudget(compiled.recipe)
  assert.deepEqual(a, b)
  assert.equal(a.eventCount, compiled.recipe.plan.events.length)
  assert.equal(a.controlCount, compiled.recipe.plan.controls.length)
  assert.ok(a.noteVoiceCount > 0)
  assert.ok(a.hybridVoiceCount > 0)
  assert.ok(a.peakNoteVoices >= a.peakHybridVoices)
  assert.ok(a.peakHybridVoices > 0)
})
