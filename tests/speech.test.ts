import test from "node:test"
import assert from "node:assert/strict"
import {
  SpeechCompilationError,
  assertAudiobookCharacterCount,
  audiobookPreflight,
  compileSpeechProject,
  speechCacheMaterial,
  speechReadiness,
  type SpeechProjectV1,
} from "../shared/speech"

const content = "El hombre miró a la mujer y le dijo:\n\n—Has envejecido.\n\n—Tú también."
const hash = "a".repeat(64)
const project: SpeechProjectV1 = {
  version: 1,
  bookId: 9,
  chapterIndex: 0,
  revision: 2,
  contentHash: hash,
  language: "es",
  narratorVoiceProfileId: 1,
  paragraphPauseMs: 650,
  characters: [
    { id: "hombre", name: "El hombre", aliases: [], voiceProfileId: 2, confidence: 1, source: "manual", locked: false },
    { id: "mujer", name: "La mujer", aliases: [], voiceProfileId: 3, confidence: 1, source: "manual", locked: false },
  ],
  spans: [
    { id: "n-1", paragraphIndex: 0, startOffset: 0, endOffset: 36, kind: "narration", speakerId: "narrator", delivery: "calm", pace: 0.95, pauseBeforeMs: 0, pauseAfterMs: 650, confidence: 1, source: "manual", locked: false, note: "" },
    { id: "d-1", paragraphIndex: 1, startOffset: 0, endOffset: 16, kind: "dialogue", speakerId: "hombre", delivery: "neutral", pace: 1, pauseBeforeMs: 150, pauseAfterMs: 500, confidence: 1, source: "manual", locked: false, note: "" },
    { id: "d-2", paragraphIndex: 2, startOffset: 0, endOffset: 12, kind: "dialogue", speakerId: "mujer", delivery: "neutral", pace: 1, pauseBeforeMs: 100, pauseAfterMs: 500, confidence: 1, source: "manual", locked: false, note: "" },
  ],
}

test("compila narrador, dos voces de diálogo y silencios sin reescribir el texto", () => {
  const profile = compileSpeechProject(project, content, hash, new Set([1, 2, 3]))
  assert.deepEqual(profile.segments.map(segment => segment.speakerId), ["narrator", "hombre", "mujer"])
  assert.deepEqual(profile.segments.map(segment => segment.voiceProfileId), [1, 2, 3])
  assert.equal(profile.segments.map(segment => segment.text).join(""), "El hombre miró a la mujer y le dijo:—Has envejecido.—Tú también.")
  assert.equal(speechReadiness(project, content, hash, new Set([1, 2, 3])).ready, true)
})

test("rechaza texto sin cubrir, voces ausentes y manuscritos modificados", () => {
  const incomplete = structuredClone(project)
  incomplete.spans[0].endOffset = 10
  assert.throws(() => compileSpeechProject(incomplete, content, hash, new Set([1, 2, 3])), SpeechCompilationError)
  assert.throws(() => compileSpeechProject(project, content, hash, new Set([1, 2])), SpeechCompilationError)
  assert.throws(() => compileSpeechProject(project, content, "b".repeat(64), new Set([1, 2, 3])), SpeechCompilationError)
})

test("la caché cambia al cambiar voz, pausa, modelo o revisión", () => {
  const profile = compileSpeechProject(project, content, hash, new Set([1, 2, 3]))
  const base = speechCacheMaterial(profile, "eleven_multilingual_v2")
  assert.notEqual(base, speechCacheMaterial({ ...profile, revision: 3 }, "eleven_multilingual_v2"))
  assert.notEqual(base, speechCacheMaterial(profile, "eleven_v3"))
  const changed = structuredClone(profile)
  changed.segments[1].pauseAfterMs += 100
  assert.notEqual(base, speechCacheMaterial(changed, "eleven_multilingual_v2"))
})

test("el audiolibro no inicia sin el Papel completo ni acepta texto parcial", () => {
  assert.deepEqual(audiobookPreflight(18_431, 18), {
    characterCount: 18_431,
    estimatedPaper: 19,
    paperBalance: 18,
    allowed: false,
  })
  assert.equal(audiobookPreflight(18_431, 19).allowed, true)
  assert.doesNotThrow(() => assertAudiobookCharacterCount(18_431, 18_431))
  assert.throws(() => assertAudiobookCharacterCount(18_431, 18_000), SpeechCompilationError)
})
