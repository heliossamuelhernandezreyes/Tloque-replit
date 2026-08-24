import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { compileTloqueScore } from "../shared/audio"

const skillPath = resolve(process.cwd(), "skills/tloque-score/SKILL.md")
const downloadableSkillPath = resolve(process.cwd(), "client/public/downloads/TLOQUE_SCORE_AI_SKILL.md")

function compileCodeFence(content: string, language: string) {
  const fence = content.match(new RegExp(`\\`\\`\\`${language}\\n([\\s\\S]*?)\\`\\`\\``))
  assert.ok(fence, `La skill debe contener un bloque ${language}`)
  return compileTloqueScore(fence![1].trim())
}

test("la skill canónica declara el contrato y contiene un ejemplo compilable", async () => {
  const content = await readFile(skillPath, "utf8")
  assert.match(content, /TLOQUE_SCORE 2/)
  assert.match(content, /instrumental/i)
  assert.match(content, /module/i)
  assert.match(content, /velocity/i)
  assert.match(content, /articulation/i)
  const result = compileCodeFence(content, "tloque-score")
  assert.equal(result.ok, true)
})

test("timbre a nivel de track forma parte del contrato real del compilador", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
title "Track timbre contract"
tempo 120
meter 4/4
loop false
seed 20260823
humanize 0
quality master
module native-auto
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=0.9 brightness=0.6 vibrato=0.05 timbre=natural
section test form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use solo
1:1 E5 1 velocity=0.7 articulation=spiccato
end`)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.recipe.plan.tracks[0].timbre, "natural")
  assert.equal(result.recipe.plan.events[0].timbre, "natural")
})

test("la skill descargable no puede enseñar timbre= en track si el runtime deja de aceptarlo", async () => {
  const content = await readFile(downloadableSkillPath, "utf8")
  assert.match(content, /track id .*timbre=natural\|non-vibrato\|vibrato\|expression-vibrato\|mute\|harmon-mute\|straight-mute/)
  const example = content.match(/## Native multi-instrument example[\s\S]*?```text\n([\s\S]*?)```/)
  assert.ok(example, "La skill descargable debe incluir el ejemplo native multi-instrument")
  const result = compileTloqueScore(example![1].trim())
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
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.4 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0 timbre=natural
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
