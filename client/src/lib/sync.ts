// Sincronización de racha y progreso con el servidor.
// Principio: lo LOCAL siempre manda para velocidad y para offline.
// El servidor es la red de seguridad. Estas funciones nunca rompen
// el flujo local: si fallan (sin internet), se ignoran en silencio.

const STREAK_KEY = "novareads_streak"

import { slimBook, saveOfflineContent, removeOfflineContent, migrateHeavySaved } from "./offline"

const LIBRARY_OPS_KEY = "tloque_library_ops_v1"
const LIBRARY_MIGRATED_KEY = "tloque_library_ops_migrated_v1"
type LibraryOperation = { bookId: number; action: "save" | "remove"; createdAt: number }

function readLibraryOperations(): LibraryOperation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIBRARY_OPS_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeLibraryOperations(operations: LibraryOperation[]): boolean {
  try {
    localStorage.setItem(LIBRARY_OPS_KEY, JSON.stringify(operations))
    return true
  } catch { return false }
}

function enqueueLibraryOperation(bookId: number, action: LibraryOperation["action"]): boolean {
  const existing = readLibraryOperations()
  const operations = existing.filter(operation => operation.bookId !== bookId)
  const latest = existing.reduce((maximum, operation) => Math.max(maximum, operation.createdAt), 0)
  operations.push({ bookId, action, createdAt: Math.max(Date.now(), latest + 1) })
  return writeLibraryOperations(operations)
}

async function flushLibraryOperations(): Promise<void> {
  const operations = readLibraryOperations().sort((a, b) => a.createdAt - b.createdAt)
  for (const operation of operations) {
    try {
      const response = await fetch(`/api/sync/library/${operation.bookId}`, {
        method: operation.action === "save" ? "PUT" : "DELETE",
        credentials: "include",
      })
      if (!response.ok) break
      // Leer de nuevo evita que una respuesta antigua borre una operación más
      // reciente (por ejemplo save seguido inmediatamente de remove).
      const current = readLibraryOperations().filter(item =>
        item.bookId !== operation.bookId
        || item.createdAt !== operation.createdAt
        || item.action !== operation.action)
      writeLibraryOperations(current)
    } catch { break }
  }
}

let libraryFlushQueue: Promise<void> = Promise.resolve()
function scheduleLibraryFlush(): Promise<void> {
  const task = libraryFlushQueue.then(flushLibraryOperations, flushLibraryOperations)
  libraryFlushQueue = task.catch(() => undefined)
  return task
}

// ── Subidas (dispara y olvida, a prueba de offline) ──────────
export function pushStreak(days: number, lastDate: string) {
  fetch("/api/sync/streak", {
    method:      "PUT",
    headers:     { "Content-Type": "application/json" },
    credentials: "include",
    body:        JSON.stringify({ days, lastDate }),
  }).catch(() => {})
}

export function pushProgress(bookId: string | number, chapter: number, maxChapter: number) {
  try { localStorage.setItem(`reading_updated_${bookId}`, String(Date.now())) } catch {}
  fetch("/api/sync/progress", {
    method:      "PUT",
    headers:     { "Content-Type": "application/json" },
    credentials: "include",
    body:        JSON.stringify({ bookId: String(bookId), chapter, maxChapter }),
  }).catch(() => {})
}

export function pushSaveBook(bookId: number) {
  if (enqueueLibraryOperation(bookId, "save")) void scheduleLibraryFlush()
  else void fetch(`/api/sync/library/${bookId}`, { method: "PUT", credentials: "include" }).catch(() => undefined)
}

export function pushUnsaveBook(bookId: number) {
  if (enqueueLibraryOperation(bookId, "remove")) void scheduleLibraryFlush()
  else void fetch(`/api/sync/library/${bookId}`, { method: "DELETE", credentials: "include" }).catch(() => undefined)
}

// ── Juntar lo local con el servidor (al abrir la app logueado) ──
export async function pullAndMerge(): Promise<void> {
  // Adelgazar guardados viejos (contenido → IndexedDB) antes de fusionar
  await migrateHeavySaved()

  let data: {
    streak: { days: number; lastDate: string } | null
    progress: { bookId: string; chapter: number; maxChapter: number; updatedAt?: string }[]
  }
  try {
    const res = await fetch("/api/sync/state", { credentials: "include" })
    if (!res.ok) return
    data = await res.json()
  } catch {
    return  // sin conexión: lo local sigue como está
  }

  // ── Racha ──
  try {
    const localRaw = localStorage.getItem(STREAK_KEY)
    const local    = localRaw ? JSON.parse(localRaw) : null
    const server   = data.streak

    if (server && !local) {
      // Nuevo dispositivo: traer la racha de la nube
      localStorage.setItem(STREAK_KEY, JSON.stringify(server))
    } else if (local && !server) {
      // El servidor no tiene nada todavía: subir la local
      pushStreak(local.days, local.lastDate)
    } else if (local && server) {
      // Los dos existen: gana el de fecha más reciente
      const lt = local.lastDate  ? new Date(local.lastDate).getTime()  : 0
      const st = server.lastDate ? new Date(server.lastDate).getTime() : 0
      if (st > lt) {
        localStorage.setItem(STREAK_KEY, JSON.stringify(server))
      } else if (lt > st) {
        pushStreak(local.days, local.lastDate)
      } else {
        // Misma fecha: quedarse con la racha más alta
        const days = Math.max(local.days || 0, server.days || 0)
        localStorage.setItem(STREAK_KEY, JSON.stringify({ days, lastDate: local.lastDate }))
        pushStreak(days, local.lastDate)
      }
    }
  } catch { /* ignorar */ }

  // ── Progreso por libro ──
  try {
    const serverMap = new Map<string, { chapter: number; maxChapter: number; updatedAt?: string }>()
    for (const p of data.progress || []) {
      serverMap.set(String(p.bookId), { chapter: p.chapter, maxChapter: p.maxChapter, updatedAt: p.updatedAt })
    }

    // Recolectar el progreso local de todas las claves reading_*
    const localBookIds = new Set<string>()
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      const m = k.match(/^reading_(?:max)?chapter_(.+)$/)
      if (m) localBookIds.add(m[1])
    }

    // Para cada libro del servidor: si va más adelante, actualizar lo local
    for (const [bookId, sp] of serverMap) {
      const localChapter = Number(localStorage.getItem(`reading_chapter_${bookId}`)    || "0")
      const localMax     = Number(localStorage.getItem(`reading_maxchapter_${bookId}`) || "0")
      const localUpdated = Number(localStorage.getItem(`reading_updated_${bookId}`) || "0")
      const serverUpdated = sp.updatedAt ? Date.parse(sp.updatedAt) : 0
      const mergedChapter = serverUpdated > localUpdated ? sp.chapter : localChapter
      const mergedMax     = Math.max(localMax, sp.maxChapter)
      if (mergedChapter !== localChapter) localStorage.setItem(`reading_chapter_${bookId}`, String(mergedChapter))
      if (mergedMax !== localMax)         localStorage.setItem(`reading_maxchapter_${bookId}`, String(mergedMax))
      if (serverUpdated > localUpdated) localStorage.setItem(`reading_updated_${bookId}`, String(serverUpdated))
      // Una posición local más reciente se respeta incluso si retrocedió.
      if (localUpdated > serverUpdated || localMax > sp.maxChapter) {
        pushProgress(bookId, mergedChapter, mergedMax)
      }
      localBookIds.delete(bookId)
    }

    // Libros que solo existen en local: subirlos al servidor
    for (const bookId of localBookIds) {
      const c = Number(localStorage.getItem(`reading_chapter_${bookId}`)    || "0")
      const m = Number(localStorage.getItem(`reading_maxchapter_${bookId}`) || "0")
      if (c > 0 || m > 0) pushProgress(bookId, c, m)
    }
  } catch { /* ignorar */ }

  // ── Libros desbloqueados por token ──
  try {
    const res = await fetch("/api/tokens/unlocked", { credentials: "include" })
    if (res.ok) {
      const data = await res.json() as { bookIds: number[] }
      localStorage.setItem("novareads_unlocked", JSON.stringify((data.bookIds || []).map(String)))
    }
  } catch { /* sin conexión: se conserva lo último conocido */ }

  // ── Biblioteca guardada ──
  // Las operaciones pendientes actúan como tombstones. Tras confirmarlas, el
  // servidor es canónico y una eliminación en otro dispositivo no reaparece.
  try {
    const legacyRaw = localStorage.getItem("novareads_saved")
    const legacyLocal: any[] = legacyRaw ? JSON.parse(legacyRaw) : []
    if (!localStorage.getItem(LIBRARY_MIGRATED_KEY)) {
      for (const book of legacyLocal) {
        const numeric = Number(book.id)
        if (Number.isInteger(numeric) && numeric > 0) enqueueLibraryOperation(numeric, "save")
      }
      localStorage.setItem(LIBRARY_MIGRATED_KEY, "1")
    }
    await scheduleLibraryFlush()
    const res = await fetch("/api/sync/library", { credentials: "include" })
    if (res.ok) {
      const lib = await res.json() as { books: any[] }
      const serverBooks = lib.books || []
      const localRaw    = localStorage.getItem("novareads_saved")
      let local: any[] = localRaw ? JSON.parse(localRaw) : []
      const localIds  = new Set(local.map(b => String(b.id)))
      const serverIds = new Set(serverBooks.map(b => String(b.id)))
      const pending = new Map(readLibraryOperations().map(operation => [String(operation.bookId), operation.action]))

      // Del servidor a local: restaurar los que falten (ligeros + contenido a IndexedDB)
      let changed = false
      for (const sb of serverBooks) {
        if (!localIds.has(String(sb.id)) && pending.get(String(sb.id)) !== "remove") {
          local.push({ ...slimBook(sb), isSaved: true })
          void saveOfflineContent(sb.id, sb).catch(error => {
            console.warn("No se pudo restaurar el contenido offline", error)
          })
          changed = true
        }
      }
      // Quitar copias que el servidor ya no guarda, salvo un alta aún pendiente.
      const removed = local.filter(book => {
        const id = String(book.id)
        return /^\d+$/.test(id) && !serverIds.has(id) && pending.get(id) !== "save"
      })
      if (removed.length) {
        local = local.filter(book => !removed.some(item => String(item.id) === String(book.id)))
        for (const book of removed) void removeOfflineContent(book.id)
        changed = true
      }
      if (changed) {
        try { localStorage.setItem("novareads_saved", JSON.stringify(local)) }
        catch { /* cuota llena: no romper */ }
      }
    }
  } catch { /* ignorar */ }
}
