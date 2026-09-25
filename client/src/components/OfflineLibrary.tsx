import { useEffect, useState } from "react"
import { accountContext, accountStorage } from "@/lib/account-context"
import { getOfflineContent } from "@/lib/offline"

// Deliberately self-contained: cached identity grants access only to local
// downloads, never administrative capabilities or authenticated API calls.
export default function OfflineLibrary({ onRetry }: { onRetry: () => void }) {
  const [available, setAvailable] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<any>(null)
  const [chapter, setChapter] = useState(0)
  useEffect(() => {
    let active = true
    const id = accountContext.requireId()
    void (async () => {
      let saved: any[] = []
      try { saved = JSON.parse(accountStorage.getItem("novareads_saved") || "[]") } catch { /* no downloads */ }
      if (!Array.isArray(saved)) saved = []
      const loaded = await Promise.all(saved.map(async item => {
        const content = await getOfflineContent(item.id)
        return content ? { ...item, ...content } : null
      }))
      accountContext.assertCurrent(id)
      if (active) { setAvailable(loaded.filter(Boolean)); setLoading(false) }
    })().catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const chapters = book ? (book.chapters?.length ? book.chapters : [{ title: book.title, content: book.content || "" }]) : []
  function turn(next: number) {
    setChapter(next)
    accountStorage.setItem(`reading_chapter_${book.id}`, String(next))
    accountStorage.setItem(`reading_maxchapter_${book.id}`, String(Math.max(next, Number(accountStorage.getItem(`reading_maxchapter_${book.id}`) || "0"))))
    accountStorage.setItem(`reading_updated_${book.id}`, String(Date.now()))
    window.scrollTo(0, 0)
  }
  return <main className="min-h-screen bg-[#0c0d10] px-6 py-8 text-zinc-200">
    <div className="mx-auto max-w-2xl">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <p className="text-sm text-amber-200">Biblioteca sin conexión · solo este dispositivo</p>
        <button className="min-h-11 rounded-full border border-white/20 px-4" onClick={onRetry}>Reconectar</button>
      </header>
      {book ? <>
        <button className="mb-6 min-h-11 underline" onClick={() => setBook(null)}>← Mis descargas</button>
        <h1 className="mb-2 font-serif text-3xl">{book.title}</h1><p className="mb-8 text-zinc-400">{book.author}</p>
        <h2 className="mb-6 text-xl">{chapters[chapter]?.title}</h2>
        <article className="whitespace-pre-wrap break-words font-serif text-lg leading-9">{chapters[chapter]?.content}</article>
        <nav className="mt-10 flex items-center justify-between gap-3" aria-label="Capítulos">
          <button className="min-h-11 disabled:opacity-30" disabled={chapter === 0} onClick={() => turn(chapter - 1)}>Anterior</button>
          <span>{chapter + 1} / {chapters.length}</span>
          <button className="min-h-11 disabled:opacity-30" disabled={chapter === chapters.length - 1} onClick={() => turn(chapter + 1)}>Siguiente</button>
        </nav>
        {chapter === chapters.length - 1 && <button className="mt-8 min-h-11 underline" onClick={event => { accountStorage.setItem(`reading_completed_${book.id}`, "true"); turn(chapter); event.currentTarget.textContent = "Lectura terminada ✓" }}>Marcar lectura como terminada</button>}
      </> : <>
        <h1 className="mb-6 font-serif text-3xl">Tus libros descargados</h1>
        {loading ? <p role="status">Abriendo descargas…</p> : !available.length ? <p>No hay libros descargados en esta cuenta y dispositivo. Reconecta para guardar uno.</p> : <ul className="space-y-3">{available.map(item => <li key={item.id}><button className="w-full rounded-2xl border border-white/15 p-5 text-left" onClick={() => { setBook(item); setChapter(Math.max(0, Math.min(Number(accountStorage.getItem(`reading_chapter_${item.id}`) || "0"), Math.max(0, (item.chapters?.length || 1) - 1)))) }}><strong className="block">{item.title}</strong><span className="text-sm text-zinc-400">{item.author}</span></button></li>)}</ul>}
      </>}
    </div>
  </main>
}
