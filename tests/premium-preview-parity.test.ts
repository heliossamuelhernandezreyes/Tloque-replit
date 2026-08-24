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
  assert.ok(exporter.indexOf("profile.quality === \"master\"") < exporter.indexOf("return renderBaseFallback"))
})

test("downloadable AI skill documents current premium behavior", () => {
  assert.match(skill, /Skill version: `1\.3\.0`/)
  assert.match(skill, /Preview versus premium master/)
  assert.match(skill, /4:4\.75/)
  assert.match(skill, /strings\.violin\s+-> VSCO 2 CE Solo Violin/)
  assert.match(skill, /synthesis fallback is never described as a premium\/native master/i)
})
