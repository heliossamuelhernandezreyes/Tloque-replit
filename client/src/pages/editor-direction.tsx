import { useEffect, useMemo, useState } from "react"
import { useLocation } from "wouter"
import {
  ArrowLeft,
  Bot,
  FileLock2,
  Loader2,
  Mic2,
  Music2,
} from "lucide-react"
import ChapterSoundtrackPicker from "@/components/ChapterSoundtrackPicker"
import DirectionAgentPanel from "@/components/DirectionAgentPanel"
import NarrativeStudioPanel from "@/components/NarrativeStudioPanel"
import SpeechStudioPanel from "@/components/SpeechStudioPanel"
import { parseDirectionWorkspaceLocation } from "@/lib/editor-workspace"

type DirectionChapter = {
  title: string
  content: string
}

type DirectionBook = {
  id: number
  title: string
  genre?: string | null
  chapters?: DirectionChapter[] | null
  content?: string | null
}

type DirectionTool = "music" | "audiobook" | "agent"

const toolOptions: Array<{
  key: DirectionTool
  label: string
  shortLabel: string
  Icon: typeof Music2
}> = [
  { key: "music", label: "Dirección musical", shortLabel: "Música", Icon: Music2 },
  { key: "audiobook", label: "Dirección de audiolibro", shortLabel: "Audiolibro", Icon: Mic2 },
  { key: "agent", label: "Director Artificial", shortLabel: "DA", Icon: Bot },
]

function chaptersFor(book: DirectionBook): DirectionChapter[] {
  if (Array.isArray(book.chapters) && book.chapters.length > 0) return book.chapters
  return [{ title: "Capítulo 1", content: book.content ?? "" }]
}

export default function EditorDirection() {
  const [, setLocation] = useLocation()
  const location = useMemo(
    () => parseDirectionWorkspaceLocation(window.location.search),
    [],
  )
  const [book, setBook] = useState<DirectionBook | null>(null)
  const [chapterIndex, setChapterIndex] = useState(location?.chapterIndex ?? 0)
  const [activeTool, setActiveTool] = useState<DirectionTool>("music")
  const [loading, setLoading] = useState(Boolean(location))
  const [error, setError] = useState(location ? "" : "No se indicó una obra válida.")

  useEffect(() => {
    if (!location) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/books/${location.bookId}`, { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error(await response.text())
        return response.json() as Promise<DirectionBook>
      })
      .then(result => {
        if (cancelled) return
        const chapters = chaptersFor(result)
        setBook(result)
        setChapterIndex(Math.min(location.chapterIndex, chapters.length - 1))
        setError("")
      })
      .catch(() => {
        if (!cancelled) setError("No pudimos cargar la versión guardada de esta obra.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [location])

  const chapters = book ? chaptersFor(book) : []
  const chapter = chapters[chapterIndex]
  const accent = "#c4b5fd"

  const returnToManuscript = () => {
    if (!book) return setLocation("/library")
    const query = new URLSearchParams({
      id: String(book.id),
      status: "published",
      source: "server",
    })
    setLocation(`/editor?${query.toString()}`)
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-white/55">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparando Dirección…
        </div>
      </main>
    )
  }

  if (error || !book || !chapter) {
    return (
      <main className="grid min-h-screen place-items-center bg-black px-6 text-white">
        <section className="max-w-sm text-center" role="alert">
          <FileLock2 className="mx-auto h-7 w-7 text-violet-200/60" />
          <h1 className="mt-4 font-serif text-xl">Dirección no disponible</h1>
          <p className="mt-3 text-sm leading-6 text-white/45">{error || "La obra no contiene este capítulo."}</p>
          <button
            type="button"
            onClick={() => setLocation("/library")}
            className="mt-6 min-h-11 rounded-xl border border-white/10 px-5 text-sm text-white/70"
          >
            Volver a la biblioteca
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black pb-12 text-zinc-200">
      <header className="sticky top-0 z-50 border-b border-white/[.07] bg-black/90 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={returnToManuscript}
            className="flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-sm text-white/55 transition hover:bg-white/[.04] hover:text-white/80"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Volver a Escribir</span>
          </button>
          <div className="min-w-0 text-center">
            <p className="truncate font-serif text-sm text-white/85 sm:text-base">{book.title}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[.18em] text-violet-200/45">Dirección avanzada</p>
          </div>
          <div className="flex min-h-11 items-center gap-1.5 rounded-xl border border-violet-200/10 bg-violet-200/[.04] px-3 text-[10px] text-violet-100/55">
            <FileLock2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Manuscrito protegido</span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
        <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Capítulos">
          {chapters.map((item, index) => (
            <button
              type="button"
              key={`${item.title}-${index}`}
              onClick={() => setChapterIndex(index)}
              className="min-h-11 shrink-0 rounded-xl border px-3 text-xs transition"
              style={chapterIndex === index ? {
                borderColor: `${accent}55`,
                background: `${accent}16`,
                color: accent,
              } : {
                borderColor: "rgba(255,255,255,.07)",
                background: "rgba(255,255,255,.025)",
                color: "rgba(255,255,255,.38)",
              }}
            >
              {item.title || `Capítulo ${index + 1}`}
            </button>
          ))}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(20rem,.85fr)_minmax(30rem,1.35fr)]">
          <aside className="overflow-hidden rounded-2xl border border-white/[.07] bg-white/[.018] lg:sticky lg:top-[5.5rem]">
            <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
              <div>
                <p className="text-xs font-medium text-white/70">{chapter.title || `Capítulo ${chapterIndex + 1}`}</p>
                <p className="mt-1 text-[10px] text-white/30">Referencia de solo lectura</p>
              </div>
              <FileLock2 className="h-4 w-4 text-violet-200/35" />
            </div>
            <article className="max-h-[68vh] overflow-y-auto px-5 py-5 font-serif text-[15px] leading-8 text-white/58 sm:px-6">
              {chapter.content.trim() ? chapter.content.split(/\n\s*\n/).map((paragraph, index) => (
                <p key={index} className="mb-5 whitespace-pre-wrap">{paragraph}</p>
              )) : (
                <p className="font-sans text-sm text-white/30">Este capítulo todavía está vacío.</p>
              )}
            </article>
          </aside>

          <section className="min-w-0">
            <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border border-white/[.07] bg-white/[.02] p-1" role="tablist" aria-label="Herramientas de dirección">
              {toolOptions.map(({ key, label, shortLabel, Icon }) => (
                <button
                  type="button"
                  key={key}
                  role="tab"
                  aria-selected={activeTool === key}
                  aria-label={label}
                  onClick={() => setActiveTool(key)}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 text-xs transition"
                  style={activeTool === key ? {
                    borderColor: `${accent}38`,
                    background: `${accent}14`,
                    color: accent,
                  } : {
                    borderColor: "transparent",
                    color: "rgba(255,255,255,.35)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{shortLabel}</span>
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-white/[.07] bg-white/[.012] p-3 sm:p-4">
              {activeTool === "music" && (
                <div className="space-y-4">
                  <ChapterSoundtrackPicker bookId={book.id} chapterIndex={chapterIndex} accent={accent} />
                  <NarrativeStudioPanel bookId={book.id} chapterIndex={chapterIndex} content={chapter.content} accent={accent} />
                </div>
              )}
              {activeTool === "audiobook" && (
                <SpeechStudioPanel bookId={book.id} chapterIndex={chapterIndex} content={chapter.content} accent={accent} />
              )}
              {activeTool === "agent" && (
                <DirectionAgentPanel
                  bookId={book.id}
                  chapterIndex={chapterIndex}
                  content={chapter.content}
                  accent={accent}
                  saveSignal={`${book.id}:${chapterIndex}`}
                />
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
