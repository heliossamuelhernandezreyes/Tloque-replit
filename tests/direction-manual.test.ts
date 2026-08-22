import test from "node:test"
import assert from "node:assert/strict"
import {
  advancedDirectionProjectSchema,
  createEmptyAdvancedDirection,
  defaultVoiceNote,
  manualNarrationSpans,
} from "../shared/direction.ts"

test("la partitura manual vacía es determinista y no contiene audio vocal musical", () => {
  const input = {
    bookId: 41,
    chapterIndex: 2,
    contentHash: "b".repeat(64),
    language: "es",
  }
  const first = createEmptyAdvancedDirection(input)
  const second = createEmptyAdvancedDirection(input)
  assert.deepEqual(first, second)
  assert.equal(first.agentAudit, null)
  assert.deepEqual(first.voiceProject.spans, [])
  assert.deepEqual(first.musicProject.regions, [])
})

test("la narración manual cubre cada párrafo con identificadores estables", () => {
  const hash = "c".repeat(64)
  const paragraphs = ["Primera línea.", "Segunda línea con diálogo.", "Cierre."]
  const first = manualNarrationSpans(hash, paragraphs)
  const second = manualNarrationSpans(hash, paragraphs)
  assert.deepEqual(first, second)
  assert.equal(first.length, paragraphs.length)
  assert.equal(new Set(first.map(span => span.id)).size, paragraphs.length)
  for (const [index, span] of first.entries()) {
    assert.equal(span.paragraphIndex, index)
    assert.equal(span.startOffset, 0)
    assert.equal(span.endOffset, paragraphs[index].length)
    assert.equal(span.source, "manual")
  }

  const empty = createEmptyAdvancedDirection({
    bookId: 41,
    chapterIndex: 2,
    contentHash: hash,
    language: "es",
  })
  const project = advancedDirectionProjectSchema.parse({
    ...empty,
    voiceProject: { ...empty.voiceProject, spans: first },
    voiceNotes: first.map(defaultVoiceNote),
  })
  assert.equal(project.voiceNotes.length, paragraphs.length)
  assert.ok(project.voiceNotes.every(note => note.source === "manual"))
})
