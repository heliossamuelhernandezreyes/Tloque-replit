import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS } from "../client/src/audio/NativeProgressivePreload"
import { NATIVE_REALTIME_LOOKAHEAD_SECONDS } from "../client/src/audio/NativeRealtimeLookahead"

const read = (path: string) => readFileSync(path, "utf8")

test("realtime usa el ciclo preload → playback → release sin liberar antes de tiempo", () => {
  const engine = read("client/src/audio/NativeSampleScoreEngine.ts")
  assert.ok(NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS > NATIVE_REALTIME_LOOKAHEAD_SECONDS)
  assert.match(engine, /buildNativeProgressivePreloadPlan\(plan\)/)
  assert.match(engine, /preload\.releaseAtSeconds \+ NATIVE_REALTIME_LOOKAHEAD_SECONDS/)
  assert.match(engine, /player\.releaseSample\(preload\.zone\.sampleUrl\)/)
  assert.doesNotMatch(engine, /player\.preload\(plan\.zones\)/)
})

test("un fallo transitorio de fetch o decode no envenena el cache de la muestra", () => {
  const player = read("client/src/audio/NativeSamplePackEngine.ts")
  assert.match(player, /releaseSample\(sampleUrl: string\)/)
  assert.match(player, /this\.buffers\.delete\(sampleUrl\)/)
  assert.match(player, /if \(this\.buffers\.get\(zone\.sampleUrl\) === promise\) this\.buffers\.delete\(zone\.sampleUrl\)/)
  assert.match(player, /\.catch\(error =>/)
})

test("el plan conserva una única vida por URL física", () => {
  const preload = read("client/src/audio/NativeProgressivePreload.ts")
  assert.match(preload, /new Map<string, TloqueSampleZone>\(\)/)
  assert.match(preload, /useByUrl/)
  assert.match(preload, /firstUseSeconds/)
  assert.match(preload, /lastUseSeconds/)
  assert.match(preload, /releaseAtSeconds/)
})
