const MAX_SERVER_BOOK_ID = 1_000_000_000_000

export type DirectionWorkspaceLocation = {
  bookId: number
  chapterIndex: number
}

export function isServerBookId(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value < MAX_SERVER_BOOK_ID
}

export function buildDirectionWorkspaceUrl(
  bookId: unknown,
  chapterIndex = 0,
): string | null {
  if (!isServerBookId(bookId)) return null
  const safeChapter = Number.isFinite(chapterIndex)
    ? Math.max(0, Math.floor(chapterIndex))
    : 0
  const query = new URLSearchParams({
    id: String(bookId),
    chapter: String(safeChapter),
  })
  return `/editor/direction?${query.toString()}`
}

export function parseDirectionWorkspaceLocation(
  search: string,
): DirectionWorkspaceLocation | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`)
  const bookId = Number(params.get("id"))
  if (!isServerBookId(bookId)) return null
  const requestedChapter = Number(params.get("chapter") ?? 0)
  return {
    bookId,
    chapterIndex: Number.isFinite(requestedChapter)
      ? Math.max(0, Math.floor(requestedChapter))
      : 0,
  }
}
