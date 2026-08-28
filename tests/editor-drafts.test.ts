import test from "node:test"
import assert from "node:assert/strict"
import {
  classifyDurableDraft,
  editorDraftContentHash,
  type DurableDraftEnvelope,
} from "../client/src/lib/editor-drafts.ts"

function envelope(overrides: Partial<DurableDraftEnvelope<any>> = {}): DurableDraftEnvelope<any> {
  const value = { title: "Borrador", chapters: [{ title: "Uno", content: "Cambio local" }], revision: 3 }
  return {
    schemaVersion: 2,
    savedAt: Date.parse("2026-08-26T12:00:00Z"),
    baseRevision: 3,
    baseUpdatedAt: "2026-08-26T10:00:00Z",
    contentHash: editorDraftContentHash(value),
    value,
    ...overrides,
  }
}

test("el hash editorial ignora sólo metadatos del servidor", () => {
  const first = { title: "A", chapters: [{ content: "Texto" }], revision: 1, updatedAt: "a" }
  const second = { title: "A", chapters: [{ content: "Texto" }], revision: 9, updatedAt: "b" }
  assert.equal(editorDraftContentHash(first), editorDraftContentHash(second))
  assert.notEqual(editorDraftContentHash(first), editorDraftContentHash({ ...second, title: "B" }))
})

test("la recuperación distingue copia igual, recuperable, obsoleta y desconocida", () => {
  const canonical = {
    value: { title: "Canónico", chapters: [{ title: "Uno", content: "Servidor" }], revision: 3 },
    revision: 3,
    updatedAt: "2026-08-26T10:00:00Z",
  }
  assert.equal(classifyDurableDraft(envelope({
    contentHash: editorDraftContentHash(canonical.value),
  }), canonical), "same")
  assert.equal(classifyDurableDraft(envelope(), canonical), "recover")
  assert.equal(classifyDurableDraft(envelope({ baseRevision: 2 }), canonical), "stale")
  assert.equal(classifyDurableDraft(envelope({ baseRevision: 4 }), canonical), "unknown")
  assert.equal(classifyDurableDraft(envelope({
    baseRevision: 3,
    savedAt: Date.parse("2026-08-26T09:00:00Z"),
  }), canonical), "stale")
})
