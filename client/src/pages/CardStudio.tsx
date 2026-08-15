import { useQuery } from "@tanstack/react-query"
import { useLocation, useRoute } from "wouter"
import { ArrowLeft, Frame, BookOpen } from "lucide-react"
import CardsEditor from "@/components/CardsEditor"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"

interface Book { id: number; title: string; authorId: number }

const GC = { color: "#c9a84c", glow: "#c9a84c" }

// El estudio de tarjetas: la sección propia del autor para crear sus
// tarjetas coleccionables — sueltas (antes de tener libro) o por obra.
// Separada del editor de libros; desde el editor se llega con un botón.
export default function CardStudio() {
  const [, setLocation] = useLocation()
  const [matchBook, params] = useRoute("/tarjetas/:bookId")
  const focusBookId = matchBook ? Number(params?.bookId) : null
  const { user, isLoggedIn, isLoading } = useAuth()
  const { t } = useSettings()

  const { data } = useQuery<Book[]>({
    queryKey: ["/api/books"],
    queryFn: async () => {
      const res = await fetch("/api/books", { credentials: "include" })
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!isLoggedIn,
  })
  const myBooks = (data || []).filter(b => b.authorId === user?.id)
  const focused = focusBookId ? myBooks.find(b => b.id === focusBookId) : null
  const assignTargets = myBooks.map(b => ({ id: b.id, title: b.title }))

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
      </div>
    )
  }
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center">
        <p className="text-zinc-400 text-sm font-sans">{t("loginToContinue")}</p>
        <button onClick={() => setLocation("/")}
          className="text-xs text-amber-400/80 font-sans">{t("backToHome")}</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-12">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/90"
        style={{ backdropFilter: "blur(8px)" }}>
        <button onClick={() => setLocation(focused ? "/tarjetas" : "/library")}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Volver">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-semibold text-zinc-200 tracking-wide"
          style={{ fontVariant: "small-caps" }}>
          {focused ? focused.title : t("cardsStudio")}
        </h1>
        {/* La galería de marcos, a un toque del estudio */}
        <button onClick={() => setLocation("/marcos")}
          className="ml-auto flex items-center gap-1.5 text-[11px] font-sans px-2.5 py-1.5 rounded-lg"
          style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c" }}>
          <Frame className="w-3 h-3" />
          {t("frames")}
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4">
        {focused ? (
          /* Vista de UNA obra (llegando desde el editor) */
          <div className="pt-2">
            <CardsEditor bookId={focused.id} gc={GC} />
            <button onClick={() => setLocation("/tarjetas")}
              className="mt-4 text-[11px] font-sans text-zinc-500 hover:text-zinc-300">
              {t("viewAllCards")} →
            </button>
          </div>
        ) : (
          <>
            {/* Tarjetas sueltas: nacen aquí, se asignan al publicar */}
            <div className="pt-2">
              <p className="text-[10px] text-zinc-500 font-sans leading-snug mt-3 mb-1">
                {t("looseCardsHint")}
              </p>
              <CardsEditor bookId={null} gc={GC} assignTargets={assignTargets} />
            </div>

            {/* Una sección por obra */}
            {myBooks.map(b => (
              <div key={b.id} className="mt-6">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-zinc-600" />
                  <p className="text-[12px] font-display font-semibold text-zinc-300 truncate">{b.title}</p>
                </div>
                <CardsEditor bookId={b.id} gc={GC} />
              </div>
            ))}

            {myBooks.length === 0 && (
              <p className="text-[11px] text-zinc-600 font-sans text-center mt-8 leading-relaxed px-6">
                {t("noBooksYetCards")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
