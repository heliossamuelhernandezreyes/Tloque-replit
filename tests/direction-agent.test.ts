import test from "node:test"
import assert from "node:assert/strict"
import {
  advancedDirectionProjectSchema,
  createAdvancedDirection,
  mergeDirectionProposal,
  quoteDirectionAgent,
  type AdvancedDirectionProjectV2,
} from "../shared/direction"
import type { NarrativeProjectV1 } from "../shared/narrative"
import type { SpeechProjectV1 } from "../shared/speech"

const hash = "d".repeat(64)

function speech(revision: number, source: "manual" | "oracle", lockedFirst = false): SpeechProjectV1 {
  return {
    version: 1,
    bookId: 7,
    chapterIndex: 0,
    revision,
    contentHash: hash,
    language: "es",
    narratorVoiceProfileId: 3,
    paragraphPauseMs: 650,
    characters: [],
    spans: [
      { id: source === "manual" ? "manual-1" : "agent-1", paragraphIndex: 0, startOffset: 0, endOffset: 11, kind: "narration", speakerId: "narrator", delivery: "sad", pace: 0.9, pauseBeforeMs: 0, pauseAfterMs: 700, confidence: 1, source, locked: lockedFirst, note: lockedFirst ? "Aprobado por autor" : "" },
      { id: source === "manual" ? "manual-2" : "agent-2", paragraphIndex: 1, startOffset: 0, endOffset: 12, kind: "narration", speakerId: "narrator", delivery: "calm", pace: 1, pauseBeforeMs: 0, pauseAfterMs: 500, confidence: 0.9, source, locked: false, note: "" },
    ],
  }
}

function music(revision: number, source: "manual" | "oracle", lockedFirst = false): NarrativeProjectV1 {
  const region = (id: string, paragraph: number, locked: boolean): NarrativeProjectV1["regions"][number] => ({
    id,
    name: `Región ${paragraph + 1}`,
    startParagraph: paragraph,
    preferredParagraph: paragraph,
    endParagraph: paragraph,
    mood: paragraph === 0 ? "melancholy" : "release",
    targetIntensity: 0.35,
    tension: 0.3,
    warmth: 0.4,
    density: 0.25,
    texture: "minimal",
    percussion: "none",
    transition: { minimumSeconds: 8, preferredSeconds: 12, maximumSeconds: 20 },
    scoreId: paragraph === 0 ? 10 : 11,
    layerTags: [paragraph === 0 ? "cello" : "piano"],
    confidence: 0.9,
    source,
    locked,
    note: locked ? "Selección aprobada" : "",
  })
  return {
    version: 1,
    bookId: 7,
    chapterIndex: 0,
    revision,
    directionStyle: "subtle",
    defaultScoreId: 10,
    regions: [
      region(source === "manual" ? "manual-r1" : "agent-r1", 0, lockedFirst),
      region(source === "manual" ? "manual-r2" : "agent-r2", 1, false),
    ],
  }
}

function project(revision: number, source: "manual" | "oracle", lockedFirst = false): AdvancedDirectionProjectV2 {
  return createAdvancedDirection({
    revision,
    voiceProject: speech(revision, source, lockedFirst),
    musicProject: music(revision, source, lockedFirst),
    musicLayerIds: new Map([[source === "manual" ? "manual-r1" : "agent-r1", [101]]]),
    provider: source === "manual" ? "manual" : "groq",
    model: source === "manual" ? "editor" : "test-model",
  })
}

test("la partitura v2 referencia el manuscrito sin copiarlo", () => {
  const parsed = advancedDirectionProjectSchema.parse(project(1, "oracle"))
  assert.equal(parsed.contentHash, hash)
  assert.equal("content" in parsed, false)
  assert.equal(parsed.voiceNotes[0].vocalState, "near_tears")
  assert.deepEqual(parsed.voiceNotes[0].elevenLabsTags, ["sad", "near tears"])
})

test("el DA conserva voz y música bloqueadas por el autor", () => {
  const current = project(1, "manual", true)
  const proposed = project(2, "oracle")
  const merged = mergeDirectionProposal(current, proposed, "replace_unlocked")
  assert.equal(merged.voiceProject.spans[0].id, "manual-1")
  assert.equal(merged.voiceProject.spans[0].note, "Aprobado por autor")
  assert.equal(merged.voiceProject.spans[1].id, "agent-2")
  assert.equal(merged.musicProject.regions[0].id, "manual-r1")
  assert.equal(merged.musicProject.regions[1].id, "agent-r2")
})

test("la cotización crece con texto y catálogo y expone un tope", () => {
  const small = quoteDirectionAgent(1_000, 5)
  const large = quoteDirectionAgent(25_000, 80)
  assert.ok(large.estimatedPaper > small.estimatedPaper)
  assert.ok(small.maximumPaper >= small.estimatedPaper)
  assert.ok(large.maximumPaper >= large.estimatedPaper)
})

test("rechaza metadatos que apunten a fragmentos inexistentes", () => {
  const invalid = structuredClone(project(1, "oracle"))
  invalid.voiceNotes[0].spanId = "no-existe"
  assert.throws(() => advancedDirectionProjectSchema.parse(invalid))
})
