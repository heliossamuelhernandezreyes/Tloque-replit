import localforage from "localforage"

type DurableDraftEnvelope<T> = {
  schemaVersion: 1
  savedAt: number
  value: T
}

const editorDraftStore = localforage.createInstance({
  name: "tloque",
  storeName: "editor_drafts_v1",
  description: "Copias de recuperación del editor de manuscritos",
})

function draftKey(id: string | number): string {
  return `book:${String(id)}`
}

export async function saveDurableEditorDraft<T>(
  id: string | number,
  value: T,
): Promise<void> {
  const envelope: DurableDraftEnvelope<T> = {
    schemaVersion: 1,
    savedAt: Date.now(),
    value,
  }
  await editorDraftStore.setItem(draftKey(id), envelope)
}

export async function loadDurableEditorDraft<T>(
  id: string | number,
): Promise<T | null> {
  const envelope = await editorDraftStore.getItem<DurableDraftEnvelope<T>>(draftKey(id))
  if (!envelope || envelope.schemaVersion !== 1) return null
  return envelope.value
}

export async function removeDurableEditorDraft(id: string | number): Promise<void> {
  await editorDraftStore.removeItem(draftKey(id))
}
