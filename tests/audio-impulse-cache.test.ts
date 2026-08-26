import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(path, "utf8")

test("stage y master reutilizan plantillas PCM deterministas sin compartir AudioNodes", () => {
  const helper = read("client/src/audio/DeterministicImpulseCache.ts")
  const stage = read("client/src/audio/ScoreAcousticStage.ts")
  const master = read("client/src/audio/ScoreMixMaster.ts")

  assert.match(helper, /Map<string, StereoTemplate>/)
  assert.match(helper, /context\.createBuffer\(2, length, context\.sampleRate\)/)
  assert.match(helper, /copyToChannel\(template\[0\], 0\)/)
  assert.doesNotMatch(helper, /ConvolverNode/)

  for (const source of [stage, master]) {
    assert.match(source, /createCachedDeterministicStereoImpulse/)
  }
  assert.doesNotMatch(stage, /for \(let channel = 0; channel < 2/)
  assert.doesNotMatch(master, /for \(let channel = 0; channel < 2/)
})

test("las ecuaciones acústicas originales permanecen en stage y master", () => {
  const stage = read("client/src/audio/ScoreAcousticStage.ts")
  const master = read("client/src/audio/ScoreMixMaster.ts")
  assert.match(stage, /Math\.exp\(-t \* 6\.8\)/)
  assert.match(stage, /t < 0\.16/)
  assert.match(master, /Math\.exp\(-t \* decay\)/)
  assert.match(master, /t < 0\.14/)
  assert.match(master, /Math\.min\(1, t \/ 0\.32\)/)
})
