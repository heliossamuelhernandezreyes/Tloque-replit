export type CoverFxLayerKey = "back" | "mid" | "front"

export type CoverFxConfig = {
  mode?: "simple" | "layered"
  layers?: Partial<Record<CoverFxLayerKey, string>>
}

const COVER_FX_STORAGE_KEY = "novareads_cover_fx"

function readCoverFxMap(): Record<string, CoverFxConfig> {
  try {
    const raw = localStorage.getItem(COVER_FX_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeCoverFxMap(next: Record<string, CoverFxConfig>) {
  localStorage.setItem(COVER_FX_STORAGE_KEY, JSON.stringify(next))
}

export function normalizeCoverFx(input: any): CoverFxConfig {
  const mode = input?.mode === "layered" ? "layered" : "simple"
  const layers = {
    back: typeof input?.layers?.back === "string" ? input.layers.back : "",
    mid: typeof input?.layers?.mid === "string" ? input.layers.mid : "",
    front: typeof input?.layers?.front === "string" ? input.layers.front : "",
  }

  return { mode, layers }
}

export function getBookCoverFx(bookId: string | number | undefined | null): CoverFxConfig {
  if (bookId === undefined || bookId === null || bookId === "") {
    return normalizeCoverFx(null)
  }

  const map = readCoverFxMap()
  return normalizeCoverFx(map[String(bookId)])
}

export function saveBookCoverFx(bookId: string | number | undefined | null, coverFx: CoverFxConfig) {
  if (bookId === undefined || bookId === null || bookId === "") return
  const map = readCoverFxMap()
  map[String(bookId)] = normalizeCoverFx(coverFx)
  writeCoverFxMap(map)
}

export function moveBookCoverFx(oldId: string | number | undefined | null, newId: string | number | undefined | null) {
  if (oldId === undefined || oldId === null || oldId === "") return
  if (newId === undefined || newId === null || newId === "") return

  const map = readCoverFxMap()
  const oldKey = String(oldId)
  const newKey = String(newId)
  const existing = map[oldKey]

  if (!existing) return

  map[newKey] = normalizeCoverFx(existing)
  if (oldKey !== newKey) delete map[oldKey]
  writeCoverFxMap(map)
}

export function resolveBookCoverFx(book: any): CoverFxConfig {
  if (!book) return normalizeCoverFx(null)

  if (book.coverFx) {
    const serverFx = normalizeCoverFx(book.coverFx)
    if (hasLayeredCover(serverFx)) return serverFx

    const localFx = getBookCoverFx(book.id)
    if (hasLayeredCover(localFx)) return localFx

    return serverFx
  }

  return getBookCoverFx(book.id)
}

export function hasLayeredCover(coverFx: CoverFxConfig | undefined | null): boolean {
  const normalized = normalizeCoverFx(coverFx)
  return normalized.mode === "layered" && !!(
    normalized.layers?.back ||
    normalized.layers?.mid ||
    normalized.layers?.front
  )
}
