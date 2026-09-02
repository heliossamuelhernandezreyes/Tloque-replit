import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const live = readFileSync("client/src/audio/NativeSampleScoreEngine.ts", "utf8")
const exporter = readFileSync("client/src/audio/NativeSampleScoreExporter.ts", "utf8")
const skill = readFileSync("client/public/downloads/TLOQUE_SCORE_AI_SKILL.md", "utf8")

test("native live preview freezes the audio clock before dense scheduling", () => {
  assert.match(live, /sampleRate:\s*48_000/)
  assert.match(live, /context\.state === "running"\) await context\.suspend\(\)/)
  assert.ok(live.indexOf("await Promise.all(scheduled)") < live.indexOf("await context.resume()"))
})

test("quality master never silently becomes base synthesis", () => {
  assert.match(exporter, /profile\.quality === "master"/)
  assert.match(exporter, /Master premium requiere todos los bancos acústicos nativos/)
  assert.doesNotMatch(exporter, /return renderBaseFallback/)
  assert.match(exporter, /fallbackTrackIds/)
  assert.ok(exporter.indexOf("profile.quality === \"master\"") < exporter.indexOf("fallbackTrackIds"))
})

test("downloadable AI skill documents current premium behavior", () => {
  const match = skill.match(/version: "(\d+)\.(\d+)\.(\d+)"/)
  assert.ok(match, "La skill debe declarar una versión semántica")
  const [, major] = match
  assert.ok(Number(major) >= 3, "La skill no puede retroceder por debajo del contrato unificado 3.0")
  assert.match(skill, /quality master.*native-auto.*bancos físicos/is)
  assert.match(skill, /4:4\.75/)
  assert.match(skill, /strings\.violin/)
  assert.match(skill, /No prometas que la síntesis es indistinguible de una orquesta grabada/)
})
