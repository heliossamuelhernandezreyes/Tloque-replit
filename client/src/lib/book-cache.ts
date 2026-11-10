/** An ordinary query cache is not a licence to persist a readable manuscript. */
export function bookMetadata(book: any) {
  const { content: _text, chapters: _chapters, clientDraftId: _draft, ...metadata } = book
  return { ...metadata, chapterCount: Array.isArray(book.chapters) && book.chapters.length ? book.chapters.length
    : book.chapterCount ?? (book.content ? 1 : 0),
    hasOfflineContent: false }
}

/** Remove manuscripts from the old generic cache, including books not opened
 * again. Explicit downloads and editor recovery live in separate stores. */
export async function pruneBookQueryCache(store: {
  entries(): Promise<Record<string, unknown>>
  setItem(key: string, value: any): Promise<unknown>
}) {
  const heavy = (value: any) => value && typeof value === "object" && ("content" in value || "chapters" in value)
  for (const [key, value] of Object.entries(await store.entries())) {
    if (key.startsWith("book_") && heavy(value)) await store.setItem(key, bookMetadata(value))
    else if (key === "books_list" && Array.isArray(value) && value.some(heavy)) {
      await store.setItem(key, value.map(book => book && typeof book === "object" ? bookMetadata(book) : book))
    }
  }
}
