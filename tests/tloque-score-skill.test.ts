import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { compileTloqueScore } from "../shared/audio"

const skillPath = resolve(process.cwd(), "skills/tloque-score/SKILL.md")

test("la skill descargable declara el contrato y contiene un ejemplo compilable", async () => {
  const content = await readFile(skillPath, "utf8")
  assert.match(content, /TLOQUE_SCORE 2/)
  assert.match(content, /instrumental/i)
  assert.match(content, /module/i)
  assert.match(content, /velocity/i)
  assert.match(content, /articulation/i)
  const fence = content.match(/```tloque-score\n([\s\S]*?)```/)
  assert.ok(fence)
  const result = compileTloqueScore(fence![1].trim())
  assert.equal(result.ok, true)
})

test("TloqueScore admite percusión semántica sin tratar el nombre del golpe como pitch", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
tempo 72
meter 4/4
loop false
seed 5
quality studio
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.4 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0
section hits form=custom bars=1 repeat=1 fade=0 tempo=72 rubato=0
use perc
hit 1:1 bass-drum 0.5 velocity=0.7
hit 1:2 snare-hit 0.25 velocity=0.6
end`)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.recipe.plan.events.map(event => event.notes), [[36], [38]])
  assert.match(result.recipe.source, /hit 1:2 snare-hit/)
})
