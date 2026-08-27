// Almacén offline para el CONTENIDO pesado de los libros guardados.
// El registro ligero (título, autor, portada…) sigue en localStorage
// (novareads_saved) para que las listas carguen síncronas e instantáneas.
// El contenido (capítulos/texto) vive aquí, en IndexedDB, que tiene
// espacio de sobra — así guardar clásicos enteros no revienta la cuota.
import localforage from "localforage"

const store = localforage.createInstance({
  name:      "Novareads",          // misma base que el resto de la app
  storeName: "offline_content",    // almacén propio para contenido guardado
})

const key = (id: string | number) => `content_${id}`

// Copia ligera de un libro: sin capítulos ni texto (lo pesado).
export function slimBook(book: any): any {
  if (!book) return book
  const { chapters, content, ...rest } = book
  return {
    ...rest,
    chapterCount: Array.isArray(chapters) ? chapters.length : (rest.chapterCount ?? 0),
    hasOfflineContent: true,
  }
}

// Guarda el contenido pesado de un libro (para leer sin conexión).
export async function saveOfflineContent(id: string | number, book: any): Promise<void> {
  await store.setItem(key(id), {
    chapters: book?.chapters ?? null,
    content:  book?.content  ?? null,
    savedAt: Date.now(),
  })
  // Verificación posterior: algunos motores de almacenamiento pueden resolver
  // sin persistir cuando la cuota cambia durante la escritura.
  const confirmed = await store.getItem<any>(key(id))
  if (!confirmed || (!Array.isArray(confirmed.chapters) && confirmed.content == null)) {
    throw new Error("No se pudo verificar el contenido offline")
  }
}

export async function getOfflineContent(id: string | number): Promise<{ chapters: any; content: any } | null> {
  try {
    return (await store.getItem(key(id))) as any
  } catch { return null }
}

export async function removeOfflineContent(id: string | number): Promise<void> {
  try { await store.removeItem(key(id)) } catch { /* ignorar */ }
}

// Migración suave: adelgaza guardados viejos que aún traen el contenido
// dentro de localStorage, moviéndolo a IndexedDB. Corre en silencio.
export async function migrateHeavySaved(): Promise<void> {
  try {
    const raw = localStorage.getItem("novareads_saved")
    if (!raw) return
    const list: any[] = JSON.parse(raw)
    let changed = false
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (b && (b.chapters || b.content)) {
        await saveOfflineContent(b.id, b)
        list[i] = slimBook(b)
        changed = true
      }
    }
    if (changed) {
      try { localStorage.setItem("novareads_saved", JSON.stringify(list)) }
      catch { /* si aún no cabe, se reintenta en la próxima apertura */ }
    }
  } catch { /* ignorar */ }
}
