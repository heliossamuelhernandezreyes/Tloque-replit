import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deterministicNoiseOffset } from "../client/src/audio/DeterministicAudioNoise"

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

test("realtime indexa automatización una vez por track", () => {
  const source = read("client/src/audio/NativeSampleScoreEngine.ts")
  assert.match(source, /controlsByTrack/)
  assert.match(source, /controlsByTrack\.get\(event\.trackId\)/)
  assert.doesNotMatch(source, /recipe\.plan\.controls\.filter\(control => control\.trackId === event\.trackId\)/)
})
