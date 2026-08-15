// Sincronización de racha y progreso con el servidor.
// Principio: lo LOCAL siempre manda para velocidad y para offline.
// El servidor es la red de seguridad. Estas funciones nunca rompen
// el flujo local: si fallan (sin internet), se ignoran en silencio.

const STREAK_KEY = "novareads_streak"

import { slimBook, saveOfflineContent, migrateHeavySaved } from "./offline"

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
  fetch("/api/sync/progress", {
    method:      "PUT",
    headers:     { "Content-Type": "application/json" },
    credentials: "include",
    body:        JSON.stringify({ bookId: String(bookId), chapter, maxChapter }),
  }).catch(() => {})
}

export function pushSaveBook(bookId: number) {
  fetch(`/api/sync/library/${bookId}`, {
    method: "PUT", credentials: "include",
  }).catch(() => {})
}

export function pushUnsaveBook(bookId: number) {
  fetch(`/api/sync/library/${bookId}`, {
    method: "DELETE", credentials: "include",
  }).catch(() => {})
}

// ── Juntar lo local con el servidor (al abrir la app logueado) ──
export async function pullAndMerge(): Promise<void> {
  // Adelgazar guardados viejos (contenido → IndexedDB) antes de fusionar
  await migrateHeavySaved()

  let data: {
    streak: { days: number; lastDate: string } | null
    progress: { bookId: string; chapter: number; maxChapter: number }[]
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
    const serverMap = new Map<string, { chapter: number; maxChapter: number }>()
    for (const p of data.progress || []) {
      serverMap.set(String(p.bookId), { chapter: p.chapter, maxChapter: p.maxChapter })
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
      const mergedChapter = Math.max(localChapter, sp.chapter)
      const mergedMax     = Math.max(localMax, sp.maxChapter)
      if (mergedChapter !== localChapter) localStorage.setItem(`reading_chapter_${bookId}`, String(mergedChapter))
      if (mergedMax !== localMax)         localStorage.setItem(`reading_maxchapter_${bookId}`, String(mergedMax))
      // Si lo local iba más adelante que el servidor, subir el máximo
      if (localChapter > sp.chapter || localMax > sp.maxChapter) {
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
  // Unión conservadora: nunca pierde libros. (Si quitaste uno en otro
  // dispositivo antes de que este sincronizara, podría reaparecer;
  // preferimos conservar de más que borrar de menos.)
  try {
    const res = await fetch("/api/sync/library", { credentials: "include" })
    if (res.ok) {
      const lib = await res.json() as { books: any[] }
      const serverBooks = lib.books || []
      const localRaw    = localStorage.getItem("novareads_saved")
      const local: any[] = localRaw ? JSON.parse(localRaw) : []
      const localIds  = new Set(local.map(b => String(b.id)))
      const serverIds = new Set(serverBooks.map(b => String(b.id)))

      // Del servidor a local: restaurar los que falten (ligeros + contenido a IndexedDB)
      let changed = false
      for (const sb of serverBooks) {
        if (!localIds.has(String(sb.id))) {
          local.push({ ...slimBook(sb), isSaved: true })
          saveOfflineContent(sb.id, sb)
          changed = true
        }
      }
      if (changed) {
        try { localStorage.setItem("novareads_saved", JSON.stringify(local)) }
        catch { /* cuota llena: no romper */ }
      }

      // De local al servidor: subir los guardados (con id numérico) que falten
      for (const lb of local) {
        const idStr = String(lb.id)
        if (/^\d+$/.test(idStr) && !serverIds.has(idStr)) {
          pushSaveBook(Number(idStr))
        }
      }
    }
  } catch { /* ignorar */ }
}
