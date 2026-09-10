import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { compileTloqueScore } from "../shared/audio"
import { buildPerformancePlan } from "../client/src/audio/PerformanceEngine"
import {
  activeScoreTrack, buildComposerBrief, buildScoreRepairPrompt, checkRequiredBanks,
  DEFAULT_COMPOSER_BRIEF, normalizeScoreInput, scoreLineRange, snippetFitsInstrument,
  summarizeInterpretation, summarizeScore,
} from "../client/src/lib/tloqueComposer"
import { readScoreFile, scoreFileName } from "../client/src/lib/tloqueScoreFileBridge"

async function examples() {
  const skill = await readFile("skills/tloque-score/SKILL.md", "utf8")
  return [...skill.matchAll(/```tloque-score\n([\s\S]*?)```/g)].map(match => match[1].trim())
}

test("el encargo es determinista, explícito y distingue 6/8 de negras", () => {
  const brief = { ...DEFAULT_COMPOSER_BRIEF, seconds: 45, meter: "6/8" as const, bpm: 60 }
  const prompt = buildComposerBrief(brief)
  assert.equal(prompt, buildComposerBrief(brief))
  assert.match(prompt, /15 compases/)
  assert.match(prompt, /tempo 60 negras por minuto/)
  assert.match(prompt, /Roles fijos/)
  assert.match(prompt, /module orchestra-synth; quality master; loop false/)
  assert.match(prompt, /sin descargar bancos/)
  assert.doesNotMatch(prompt, /bancos instalados/)
})

test("el encargo nativo no inventa disponibilidad y respeta instrumentos", () => {
  const prompt = buildComposerBrief({ ...DEFAULT_COMPOSER_BRIEF, moduleId: "native-auto", instruments: ["woodwinds.flute"], loop: true })
  assert.match(prompt, /NO COMPROBADA/)
  assert.match(prompt, /Instrumentos permitidos: woodwinds.flute\./)
  assert.match(prompt, /loop true/)
})

test("normaliza BOM, CRLF y un único bloque de IA sin truncar alternativas", () => {
  assert.equal(normalizeScoreInput('\uFEFF\r\nTLOQUE_SCORE 2\r\nend\r\n'), "TLOQUE_SCORE 2\nend")
  assert.equal(normalizeScoreInput("Aquí está:\n```tloque-score\nTLOQUE_SCORE 2\nend\n```\nListo."), "TLOQUE_SCORE 2\nend")
  const two = "```tloque-score\nTLOQUE_SCORE 2\n```\n```tloque-score\nTLOQUE_SCORE 2\n```"
  assert.equal(normalizeScoreInput(two), two)
  assert.equal(normalizeScoreInput("```tloque-score\nTLOQUE_SCORE 2"), "```tloque-score\nTLOQUE_SCORE 2")
})

test("los diagnósticos seleccionan exactamente su línea y acotan posiciones", () => {
  const source = "TLOQUE_SCORE 2\ntempo 999\nend"
  const range = scoreLineRange(source, 2)
  assert.deepEqual(range, { start: 15, end: 24 })
  assert.equal(source.slice(range.start, range.end), "tempo 999")
  assert.deepEqual(scoreLineRange(source, 99), { start: 25, end: 28 })
  assert.deepEqual(scoreLineRange("", Number.NaN), { start: 0, end: 0 })
})

test("la reparación conserva la fuente completa y no confunde líneas con compases", () => {
  const source = "TLOQUE_SCORE 2\ntempo 999\nend"
  const prompt = buildScoreRepairPrompt(source, [{ line: 2, message: "tempo fuera de rango" }])
  assert.ok(prompt.endsWith(source))
  assert.match(prompt, /L2: tempo fuera de rango/)
  assert.match(prompt, /no compases/)
})

test("la paleta se acota al use de la sección activa y la familia", async () => {
  const source = (await examples())[0]
  const inside = source.indexOf("control 1:1")
  assert.deepEqual(activeScoreTrack(source, inside), { id: "melody", instrument: "strings.violin" })
  assert.equal(activeScoreTrack(source, source.indexOf("section")), null)
  assert.equal(activeScoreTrack(source, source.length), null)
  assert.equal(snippetFitsInstrument("control 1:1 pressure=0.6 bow=0.4 coupling=0.3", "strings.violin"), true)
  assert.equal(snippetFitsInstrument("control 1:1 pressure=0.6 bow=0.4 coupling=0.3", "woodwinds.flute"), false)
  assert.equal(snippetFitsInstrument("control 1:1 pedal=down", "piano.grand"), true)
  assert.equal(snippetFitsInstrument("control 1:1 pedal=down", "brass.horn"), false)
  assert.equal(snippetFitsInstrument("control 1:1 pluck=0.3", "strings.harp"), true)
})

test("resumen cuenta eventos, pitches, controles y compases repetidos por separado", async () => {
  const source = (await examples())[1].replace("repeat=1", "repeat=2")
  const result = compileTloqueScore(source)
  assert.ok(result.ok)
  if (!result.ok) return
  const summary = summarizeScore(result.recipe)
  assert.equal(summary.events, result.recipe.plan.events.length)
  assert.equal(summary.pitches, result.recipe.plan.events.reduce((sum, event) => sum + event.notes.length, 0))
  assert.ok(summary.pitches > summary.events)
  assert.equal(summary.sections[0].bars, 8)
  assert.equal(summary.sections[0].repeat, 2)
  assert.equal(summary.tracks.reduce((sum, track) => sum + track.events, 0), summary.events)
})

test("el resumen interpretativo usa el plan real sin mutar la partitura", async () => {
  const result = compileTloqueScore((await examples())[2])
  assert.ok(result.ok)
  if (!result.ok) return
  const before = JSON.stringify(result.recipe)
  const plan = buildPerformancePlan(result.recipe, [])
  const summary = summarizeInterpretation(plan)
  assert.equal(summary.length, 2)
  assert.ok(summary.every(track => track.phrases >= 1 && Number.isFinite(track.tension)))
  assert.equal(summary.reduce((sum, track) => sum + track.climaxes, 0), plan.events.filter(event => event.interpretation.phrasePhase === "climax").length)
  assert.equal(JSON.stringify(result.recipe), before)
})

test("comprobación de bancos diferencia ausencia, fallo y metadatos accesibles", async () => {
  const requests: string[] = []
  const request = (async (url: string) => {
    requests.push(url)
    if (url.includes("missing")) return new Response("", { status: 404 })
    if (url.includes("denied")) return new Response("", { status: 403 })
    if (url.includes("broken")) return Response.json({ instrumentManifestId: "other", zones: [{}] })
    if (url.includes("network")) throw new Error("offline")
    return Response.json({ instrumentManifestId: "known", zones: [{}] })
  }) as typeof fetch
  const results = await checkRequiredBanks(["known", "missing", "denied", "broken", "network", null].map(moduleId => ({ moduleId, instruments: ["strings.violin"] })), undefined, request)
  assert.deepEqual(results.map(result => result.status), ["available", "missing", "unknown", "unknown", "unknown", "missing"])
  assert.match(results[0].detail, /PCM sin comprobar/)
  assert.equal(requests.length, 5)
  assert.ok(requests.every(url => url.startsWith("/api/audio/sample-packs/modules/")))
})

test("cancelar comprobación no se convierte en bancos ausentes", async () => {
  const abort = new AbortController(); abort.abort()
  await assert.rejects(checkRequiredBanks([{ moduleId: "known", instruments: [] }], abort.signal), { name: "AbortError" })
})

test("la importación de texto normaliza bloques y rechaza formatos o tamaños inválidos", async () => {
  const source = (await examples())[0]
  const imported = await readScoreFile(new File(["\uFEFF\n```tloque-score\n" + source + "\n```"], "Obra.TLOQUE"))
  assert.equal(imported.source, source)
  assert.equal(imported.recipe, null)
  assert.equal(imported.report, null)
  await assert.rejects(readScoreFile(new File([source], "unsafe.html")), /Formato no admitido/)
  await assert.rejects(readScoreFile(new File(["sin encabezado"], "score.txt")), /no comienza/)
  await assert.rejects(readScoreFile(new File([new Uint8Array(4_000_001)], "score.tloque")), /supera el límite/)
  assert.equal(scoreFileName("../Mi canción: uno"), "Mi_cancion_uno.tloque")
})

test("el diálogo de la skill hace un relevo monofónico y cuenta correctamente 6/8", async () => {
  const result = compileTloqueScore((await examples())[2])
  assert.ok(result.ok)
  if (!result.ok || result.recipe.version !== 2) return
  assert.equal(result.recipe.plan.totalBeats, 6)
  assert.equal(result.recipe.plan.totalSeconds, 6)
  assert.equal(result.recipe.plan.events.find(event => event.bar === 1 && event.beat === 4)?.timeBeats, 1.5)
  assert.ok(result.recipe.plan.events.every(event => event.notes.length === 1))
  assert.ok(result.recipe.plan.rests.some(rest => rest.durationBeats === 3))
})

test("la miniatura de la skill contiene forma completa y duración nominal de 30 s", async () => {
  const result = compileTloqueScore((await examples())[3])
  assert.ok(result.ok)
  if (!result.ok || result.recipe.version !== 2) return
  assert.deepEqual(result.recipe.plan.sections.map(section => section.form), ["exposition", "development", "recapitulation", "coda"])
  assert.equal(result.recipe.plan.totalSeconds, 30)
  assert.ok(result.recipe.plan.controls.some(control => control.expression === 0.32 && control.rampBeats === 2))
})
