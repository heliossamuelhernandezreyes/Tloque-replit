import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { compileTloqueScore } from "../shared/audio"
import { NATIVE_LIBRARY_INDEX } from "../shared/native-library-index"
import { TLOQUE_SCORE_COMPILER_V2 } from "../shared/tloque-score-v2"
import { ORCHESTRAL_SYNTH_VERSION } from "../shared/orchestral-synthesis"
import { NATIVE_HYBRID_PERFORMANCE_VERSION } from "../shared/native-hybrid-performance"
import { ORCHESTRAL_DYNAMICS_VERSION } from "../client/src/audio/OrchestralDynamics"
import { ORCHESTRAL_ROOM_VERSION } from "../client/src/audio/OrchestralRoom"
import { BOWED_STRING_OVERLAY_VERSION } from "../client/src/audio/PhysicalBowedStringOverlay"
import { UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION } from "../client/src/audio/PerformanceDirector"
import { TLOQUE_SCORE_AUDIO_PROFILE } from "../client/src/audio/ScoreAudioMath"

const skillPath = resolve(process.cwd(), "skills/tloque-score/SKILL.md")
const downloadableSkillPath = resolve(process.cwd(), "client/public/downloads/TLOQUE_SCORE_AI_SKILL.md")

function scoreExamples(content: string) {
  return [...content.matchAll(/```tloque-score\n([\s\S]*?)```/g)].map(match => match[1].trim())
}

test("la skill canónica y la descarga son exactamente la misma fuente", async () => {
  const [canonical, download] = await Promise.all([
    readFile(skillPath, "utf8"),
    readFile(downloadableSkillPath, "utf8"),
  ])
  assert.equal(download, canonical)
  assert.match(canonical, /version: "3\.3\.0"/)
})

test("todos los ejemplos de la skill compilan con el contrato actual", async () => {
  const content = await readFile(skillPath, "utf8")
  const examples = scoreExamples(content)
  assert.equal(examples.length, 2, "La skill debe tener una plantilla y un ejemplo orquestal completo")

  for (const [index, source] of examples.entries()) {
    const result = compileTloqueScore(source)
    assert.equal(result.ok, true, result.ok ? undefined : `Ejemplo ${index + 1}: ${JSON.stringify(result.diagnostics)}`)
    if (!result.ok || result.recipe.version !== 2) continue
    assert.equal(result.recipe.plan.compilerVersion, TLOQUE_SCORE_COMPILER_V2)
    assert.equal(result.recipe.plan.moduleId, "orchestra-synth")
  }
})

test("el ejemplo completo demuestra controles físicos y percusión de forma semántica", async () => {
  const content = await readFile(skillPath, "utf8")
  const complete = scoreExamples(content)[1]
  const result = compileTloqueScore(complete)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) return

  const controls = result.recipe.plan.controls
  assert.ok(controls.some(control => control.pressure !== null && control.bowPosition !== null && control.sympatheticCoupling !== null))
  assert.ok(controls.some(control => control.pressure !== null && control.embouchure !== null))
  assert.deepEqual(
    result.recipe.plan.events.filter(event => event.trackId === "perc").map(event => event.notes[0]),
    [36, 51, 36, 81],
  )
})

test("la documentación anuncia exactamente las versiones orquestales implementadas", async () => {
  const content = await readFile(skillPath, "utf8")
  for (const version of [
    TLOQUE_SCORE_COMPILER_V2,
    ORCHESTRAL_SYNTH_VERSION,
    ORCHESTRAL_DYNAMICS_VERSION,
    ORCHESTRAL_ROOM_VERSION,
    NATIVE_HYBRID_PERFORMANCE_VERSION,
    BOWED_STRING_OVERLAY_VERSION,
    UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION,
    TLOQUE_SCORE_AUDIO_PROFILE,
  ]) {
    assert.match(content, new RegExp(version.replace(/[.]/g, "\\.")))
  }
  assert.doesNotMatch(content, /tloque-orchestral-synth-v1(?![0-9])/)
})

test("el inventario Master documentado sigue al índice nativo real", async () => {
  const content = await readFile(skillPath, "utf8")
  const block = content.match(/## Instrumentos semánticos verificados[\s\S]*?```text\n([\s\S]*?)```/)
  assert.ok(block, "Falta el inventario semántico verificado")
  const documented = block![1].trim().split("\n")
  const actual = NATIVE_LIBRARY_INDEX
    .filter(entry => entry.masterApproved && entry.family !== "voice")
    .map(entry => entry.instrumentId)
  assert.deepEqual(documented, actual)
  assert.doesNotMatch(block![1], /voice\./)
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

test("la gramática documentada conserva timbre de track y todos los ejes físicos 2.2", async () => {
  const content = await readFile(skillPath, "utf8")
  assert.match(content, /track id .*timbre=natural\|non-vibrato\|vibrato\|expression-vibrato\|mute\|harmon-mute\|straight-mute/)
  assert.match(content, /control bar:beat .*pressure=0\.\.1 .*embouchure=0\.\.1 .*bow=0\.\.1 .*pluck=0\.\.1 .*damper=0\.\.1 .*coupling=0\.\.1/)
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

test("TloqueScore admite subdivisiones dentro del cuarto tiempo y rechaza el tiempo 5 en 4/4", () => {
  const valid = compileTloqueScore(`TLOQUE_SCORE 2
tempo 120
meter 4/4
loop false
seed 9
quality studio
module builtin
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
section fast form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use solo
1:4 E5 0.25 velocity=0.6
1:4.25 F#5 0.25 velocity=0.6
1:4.5 G5 0.25 velocity=0.6
1:4.75 A5 0.25 velocity=0.6
rest 1:4.5 0.25
control 1:4.75 expression=0.8 ramp=0
end`)
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.deepEqual(valid.recipe.plan.events.map(event => event.beat), [4, 4.25, 4.5, 4.75])
    assert.equal(valid.recipe.plan.rests[0].beat, 4.5)
    assert.equal(valid.recipe.plan.controls[0].beat, 4.75)
  }

  const invalid = compileTloqueScore(`TLOQUE_SCORE 2
tempo 120
meter 4/4
loop false
seed 9
quality studio
module builtin
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
section fast form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use solo
1:5 E5 0.25 velocity=0.6
end`)
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.match(invalid.diagnostics.map(item => item.message).join("\n"), /La nota debe caer dentro de 1 compases y 4 tiempos/)
})

test("la última subdivisión también funciona para golpes percusivos", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
tempo 120
meter 4/4
loop false
seed 10
quality studio
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.4 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0 timbre=natural
section hits form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use perc
hit 1:4.75 snare-hit 0.25 velocity=0.6
end`)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.recipe.plan.events[0].beat, 4.75)
})
