import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deterministicNoiseOffset } from "../client/src/audio/DeterministicAudioNoise"
import { NativeRealtimeLookahead, NATIVE_REALTIME_LOOKAHEAD_SECONDS } from "../client/src/audio/NativeRealtimeLookahead"
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
  assert.match(index, /numericCurves = new WeakMap/)
  assert.match(index, /while \(low < high\)/)
  assert.match(index, /segments\[middle\]\.start <= timeSeconds/)
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

test("realtime y WAV construyen stage, master y filtros desde NativeRenderGraph", () => {
  const engine = read("client/src/audio/NativeSampleScoreEngine.ts")
  const exporter = read("client/src/audio/NativeSampleScoreExporter.ts")
  const graph = read("client/src/audio/NativeRenderGraph.ts")
  for (const source of [engine, exporter]) {
    assert.match(source, /createNativeRenderGraph\(/)
    assert.doesNotMatch(source, /createSampledMixMaster\(/)
    assert.doesNotMatch(source, /createAcousticStage\(/)
    assert.doesNotMatch(source, /createBiquadFilter\(\)/)
  }
  assert.match(graph, /createSampledMixMaster\(context, 1\)/)
  assert.match(graph, /createAcousticStage\(context, mix\.input\)/)
  assert.match(graph, /nativeBrightnessCutoff/)
  assert.match(graph, /scheduleTrackControl/)
})

test("look-ahead materializa sólo la ventana próxima y nunca duplica tareas", async () => {
  const fired: number[] = []
  const lookahead = new NativeRealtimeLookahead([
    { timeSeconds: 0, run: () => { fired.push(0) } },
    { timeSeconds: NATIVE_REALTIME_LOOKAHEAD_SECONDS, run: () => { fired.push(1) } },
    { timeSeconds: NATIVE_REALTIME_LOOKAHEAD_SECONDS + 0.01, run: () => { fired.push(2) } },
    { timeSeconds: 20, run: async () => { fired.push(3) } },
  ])

  await Promise.all(lookahead.pump(0))
  assert.deepEqual(fired, [0, 1])
  assert.equal(lookahead.pendingCount, 2)

  await Promise.all(lookahead.pump(0))
  assert.deepEqual(fired, [0, 1])

  await Promise.all(lookahead.pump(0.02))
  assert.deepEqual(fired, [0, 1, 2])

  await Promise.all(lookahead.pump(14))
  assert.deepEqual(fired, [0, 1, 2, 3])
  assert.equal(lookahead.complete, true)
})

test("realtime usa look-ahead y cancela su intervalo al detenerse", () => {
  const engine = read("client/src/audio/NativeSampleScoreEngine.ts")
  assert.match(engine, /new NativeRealtimeLookahead\(realtimeTasks, shouldLoop \? recipe\.plan\.totalSeconds : 0\)/)
  assert.match(engine, /window\.setInterval\(pump, NATIVE_REALTIME_TICK_MS\)/)
  assert.match(engine, /window\.clearInterval\(this\.schedulerTimer\)/)
  assert.doesNotMatch(engine, /await Promise\.all\(scheduled\)/)
})

test("look-ahead repite el ciclo sin duplicar ataques ya programados", async () => {
  const fired: number[] = []
  const lookahead = new NativeRealtimeLookahead([
    { timeSeconds: 0, run: offset => { fired.push(offset ?? -1) } },
    { timeSeconds: 1, run: offset => { fired.push(offset ?? -1) } },
  ], 2)
  await Promise.all(lookahead.pump(0, 0))
  await Promise.all(lookahead.pump(0.95, 0.1))
  await Promise.all(lookahead.pump(1.95, 0.1))
  await Promise.all(lookahead.pump(2.95, 0.1))
  assert.deepEqual(fired, [0, 0, 2, 2])
  assert.equal(lookahead.complete, false)
})

test("el cambio de región conserva dos decks, espera al próximo compás y cruza ganancias", () => {
  const source = read("client/src/audio/NativeCrossfadeScoreEngine.ts")
  assert.match(source, /NativeSampleScoreEngine, NativeSampleScoreEngine/)
  assert.match(source, /secondsUntilNextBar/)
  assert.match(source, /fadeOutAndStop\(seconds, startDelay\)/)
  assert.match(source, /this\.listener\("crossfading"/)
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
