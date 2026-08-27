import localforage from "localforage"

export type DurableDraftEnvelope<T> = {
  schemaVersion: 1 | 2
  savedAt: number
  baseRevision: number | null
  baseUpdatedAt: string | null
  contentHash: string
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["revision", "updatedAt", "createdAt", "localSavedAt"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function editorDraftContentHash(value: unknown): string {
  const input = stableJson(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export type DraftRecoveryDecision = "same" | "recover" | "stale" | "unknown"

export function classifyDurableDraft<T>(
  draft: DurableDraftEnvelope<T>,
  canonical: { value: unknown; revision?: number | null; updatedAt?: string | null },
): DraftRecoveryDecision {
  if (draft.contentHash === editorDraftContentHash(canonical.value)) return "same"
  const serverRevision = Number.isInteger(canonical.revision) ? Number(canonical.revision) : null
  if (draft.baseRevision !== null && serverRevision !== null) {
    if (draft.baseRevision < serverRevision) return "stale"
    if (draft.baseRevision > serverRevision) return "unknown"
  }
  const serverUpdatedAt = canonical.updatedAt ? Date.parse(canonical.updatedAt) : Number.NaN
  if (Number.isFinite(serverUpdatedAt)) return draft.savedAt > serverUpdatedAt ? "recover" : "stale"
  return "unknown"
}

export async function saveDurableEditorDraft<T>(
  id: string | number,
  value: T,
): Promise<void> {
  const metadata = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {}
  const envelope: DurableDraftEnvelope<T> = {
    schemaVersion: 2,
    savedAt: Date.now(),
    baseRevision: Number.isInteger(metadata.revision) ? Number(metadata.revision) : null,
    baseUpdatedAt: typeof metadata.updatedAt === "string" ? metadata.updatedAt : null,
    contentHash: editorDraftContentHash(value),
    value,
  }
  await editorDraftStore.setItem(draftKey(id), envelope)
}

export async function loadDurableEditorDraft<T>(
  id: string | number,
): Promise<DurableDraftEnvelope<T> | null> {
  const stored = await editorDraftStore.getItem<any>(draftKey(id))
  if (!stored || (stored.schemaVersion !== 1 && stored.schemaVersion !== 2)) return null
  if (stored.schemaVersion === 1) {
    return {
      schemaVersion: 1,
      savedAt: Number(stored.savedAt) || 0,
      baseRevision: Number.isInteger(stored.value?.revision) ? stored.value.revision : null,
      baseUpdatedAt: typeof stored.value?.updatedAt === "string" ? stored.value.updatedAt : null,
      contentHash: editorDraftContentHash(stored.value),
      value: stored.value as T,
    }
  }
  return stored as DurableDraftEnvelope<T>
}

export async function removeDurableEditorDraft(id: string | number): Promise<void> {
  await editorDraftStore.removeItem(draftKey(id))
}
