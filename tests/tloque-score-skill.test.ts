import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { compileTloqueScore } from "../shared/audio"

const SKILL_PATH = new URL("../client/public/downloads/TLOQUE_SCORE_AI_SKILL.md", import.meta.url)

test("la skill descargable declara el contrato y contiene un ejemplo compilable", async () => {
  const markdown = await readFile(SKILL_PATH, "utf8")
  assert.match(markdown, /^---\nname: compose-tloque-score\n/)
  assert.match(markdown, /tloque-audio-2026-08-v2/)
  assert.match(markdown, /tloque-score-compiler-v2\.1/)
  assert.match(markdown, /control bar:beat expression=0\.\.1/)
  assert.match(markdown, /articulation=.*spiccato.*pizzicato.*tremolo.*harmonic/)
  assert.match(markdown, /Create only original instrumental music/)

  const examples = [...markdown.matchAll(/```text\n(TLOQUE_SCORE 2[\s\S]*?)\n```/g)]
  const completeExample = examples.map(match => match[1]).find(source => source.includes("\ntitle "))
  assert.ok(completeExample)
  const result = compileTloqueScore(completeExample)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) return
  assert.equal(result.recipe.version, 2)
  assert.equal(result.recipe.plan.tracks.length, 2)
  assert.ok(result.recipe.plan.events.length > 1)
  assert.equal(result.recipe.version === 2 ? result.recipe.plan.controls.length : 0, 3)
})
