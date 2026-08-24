import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"

const header = `TLOQUE_SCORE 2
title "Long-form regression"
tempo 150
meter 4/4
loop false
seed 20260823
humanize 0
quality master
module builtin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.25 pan=0 attack=0.01 release=1 expression=0.8 brightness=0.5 vibrato=0.05`

test("TloqueScore V2 admite secciones largas cuando bars declara su longitud real", () => {
  const result = compileTloqueScore(`${header}
section winter form=development bars=64 repeat=1 fade=0 tempo=150 rubato=0
use violin
1:1 E5 0.25 velocity=0.65 articulation=spiccato
17:1 F5 0.25 velocity=0.68 articulation=spiccato
33:1 G5 0.25 velocity=0.70 articulation=spiccato
49:1 A5 0.25 velocity=0.72 articulation=spiccato
64:4 B5 0.25 velocity=0.74 articulation=accent
end`)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) return
  assert.equal(result.recipe.plan.sections[0].bars, 64)
  assert.equal(result.recipe.plan.totalBars, 64)
  assert.equal(result.recipe.plan.events.at(-1)?.bar, 64)
})

test("TloqueScore explica el desajuste cuando una nota excede bars", () => {
  const result = compileTloqueScore(`${header}
section winter form=development bars=4 repeat=1 fade=0 tempo=150 rubato=0
use violin
5:1 E5 0.25 velocity=0.65 articulation=spiccato
end`)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.diagnostics.some(item => item.line === 13 && item.message.includes("dentro de 4 compases")))
})

test("TloqueScore no acepta endw como cierre silencioso", () => {
  const result = compileTloqueScore(`${header}
section winter form=development bars=4 repeat=1 fade=0 tempo=150 rubato=0
use violin
1:1 E5 0.25 velocity=0.65 articulation=spiccato
endw`)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.diagnostics.some(item => item.message.includes("Comando desconocido: endw")))
  assert.ok(result.diagnostics.some(item => item.message.includes("Falta end")))
})
