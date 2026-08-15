import { useState, useEffect, useMemo , useRef, useCallback } from "react"
import { useBooks } from "../hooks/use-books"
import { useLocation } from "wouter"
import { Layout } from "../components/layout"
import { BookCard } from "../components/book-card"
import useEmblaCarousel from "embla-carousel-react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Edit3, Trash2, BookOpen } from "lucide-react"
import { coverFor } from "@/lib/covers"
import { useGenre, GENRE_CONFIG, type Genre } from "@/context/GenreContext"
import { useSettings, LITERARY_QUOTES_I18N } from "@/context/SettingsContext"

type Book = {
  id:              string | number
  title?:          string
  author?:         string
  genre?:          string
  type?:           string
  reads?:          number
  status?:         string
  synopsis?:       string
  isClassic?:      boolean
  publicationYear?: number
  chapters?:       { content: string }[]
  content?:        string
  openingLine?:    string
  chapterCount?:   number
  coverUrl?:       string
  premiumCoverUrl?: string
}


// Las citas literarias ahora vienen de LITERARY_QUOTES_I18N en SettingsContext


function getOpeningLine(book: Book): string {
  const text = book.openingLine || book.chapters?.[0]?.content || book.content || ""
  if (!text) return ""
  const sentence = text.split(/[.!?…\n]/)[0]?.trim()
  if (!sentence || sentence.length < 10) return ""
  return sentence.length > 80 ? sentence.slice(0, 80) + "…" : sentence
}


// ── Tarjeta propia con press largo ────────────────────────
function OwnBookCard({ book }: { book: any }) {
  const [, setLocation]  = useLocation()
  const [showMenu, setShowMenu] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressing = useRef(false)
  const { cfg }  = useGenre()
  const { t }    = useSettings()

  const startPress = useCallback(() => {
    pressing.current = true
    timerRef.current = setTimeout(() => {
      if (pressing.current) setShowMenu(true)
    }, 600)
  }, [])

  const cancelPress = useCallback(() => {
    pressing.current = false
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const handleTap = useCallback(() => {
    const wasLong = showMenu
    pressing.current = false
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!wasLong) setLocation(`/book/${book.id}`)
  }, [showMenu, book.id, setLocation])

  const handleDelete = useCallback(async () => {
    setShowMenu(false)
    // 1. Borrar de localStorage
    const authored = JSON.parse(localStorage.getItem("novareads_authored") || "[]")
    const updated  = authored.filter((b: any) => String(b.id) !== String(book.id))
    localStorage.setItem("novareads_authored", JSON.stringify(updated))
    window.dispatchEvent(new Event("novareads_authored_changed"))
    // 2. Si el libro está en el servidor (ID numérico), borrarlo también
    //    para que no reaparezca en los carruseles
    if (/^\d+$/.test(String(book.id))) {
      try {
        await fetch(`/api/books/${book.id}`, { method: "DELETE", credentials: "include" })
      } catch { /* si falla, al menos ya no está en local */ }
    }
  }, [book.id])

  return (
    <div className="relative">
      <div
        onPointerDown={startPress}
        onPointerUp={handleTap}
        onPointerLeave={cancelPress}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true) }}
        style={{ userSelect: "none", WebkitUserSelect: "none", cursor: "pointer" }}
      >
        <BookCard {...book} coverUrl={coverFor(book)} />
      </div>

      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[400]"
              onClick={() => setShowMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 4 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
              className="absolute top-0 right-0 z-[401] rounded-2xl overflow-hidden min-w-[150px]"
              style={{
                background: "rgba(18,18,24,0.98)",
                border:     "1px solid rgba(255,255,255,0.1)",
                boxShadow:  "0 12px 40px rgba(0,0,0,0.8)",
              }}
            >
              <div className="p-1.5 space-y-0.5">
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest font-sans px-2 py-1 truncate">
                  {book.title?.slice(0, 18)}{book.title?.length > 18 ? "…" : ""}
                </p>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={() => { setShowMenu(false); setLocation(`/book/${book.id}`) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans"
                  style={{ color: "rgba(255,255,255,0.7)" }}>
                  <BookOpen className="w-3.5 h-3.5" /> {t("readBook")}
                </motion.button>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={() => { setShowMenu(false); setLocation(`/editor?id=${book.id}&status=${book.status || "published"}`) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans"
                  style={{ color: cfg.color + "cc" }}>
                  <Edit3 className="w-3.5 h-3.5" /> {t("editStory")}
                </motion.button>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans"
                  style={{ color: "rgba(255,80,80,0.8)" }}>
                  <Trash2 className="w-3.5 h-3.5" /> {t("deleteBtn")}
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Home() {
  const { data: apiBooks, isLoading } = useBooks()
  const { activeGenre, lobbyFilter, cfg, isFiltered } = useGenre()
  const { t } = useSettings()
  const [, setLocation] = useLocation()

  const [authoredBooks,    setAuthoredBooks]    = useState<Book[]>([])
  const ownedIds = useMemo(
    () => new Set(authoredBooks.map(b => String(b.id))),
    [authoredBooks]
  )
  const [spotlightIndex,   setSpotlightIndex]   = useState(() => Math.floor(Math.random() * 10))
  const [spotlightVisible, setSpotlightVisible] = useState(true)

  useEffect(() => {
    const loadAuthored = () => {
      const authored = JSON.parse(localStorage.getItem("novareads_authored") || "[]")
      setAuthoredBooks(authored.filter((b: Book) =>
        b.status === "published" || b.status === undefined
      ))
    }
    loadAuthored()
    // Re-leer cuando se borra/edita un libro propio (Bug: la pantalla no se actualizaba)
    window.addEventListener("novareads_authored_changed", loadAuthored)
    return () => window.removeEventListener("novareads_authored_changed", loadAuthored)
  }, [])

  // Todos los libros sin duplicados
  // Cachear libros del servidor para que OrbSystem los encuentre en goToRandomBook
  useEffect(() => {
    if (apiBooks?.length) {
      try {
        sessionStorage.setItem("novareads_api_books", JSON.stringify(apiBooks))
      } catch {}
    }
  }, [apiBooks])

  const allBooks = useMemo(() => {
    const api = (apiBooks || []) as Book[]
    const ids = new Set(api.map((b) => String(b.id)))
    return [...authoredBooks.filter(b => !ids.has(String(b.id))), ...api]
  }, [authoredBooks, apiBooks])

  // ── LIBROS POR CATEGORÍA (sin filtro activo) ──────────
  const classics   = useMemo(() => allBooks.filter(b => b.isClassic),                        [allBooks])
  const stories    = useMemo(() => allBooks.filter(b => !b.isClassic && b.type === "story"),  [allBooks])
  const novels     = useMemo(() => allBooks.filter(b => !b.isClassic && b.type === "book"),   [allBooks])
  const sagas      = useMemo(() => allBooks.filter(b => !b.isClassic && b.type === "saga"),   [allBooks])

  // Joyas ocultas — orden estable basado en ID para evitar re-renders aleatorios
  const hiddenGems = useMemo(() => {
    if (allBooks.length <= 4) return []
    // Ordenar por ID de forma que sea estable pero no trivial (por último dígito)
    return [...allBooks]
      .sort((a, b) => (Number(a.id) % 7) - (Number(b.id) % 7))
      .slice(0, 8)
  }, [allBooks])

  // ── LIBROS FILTRADOS (cuando hay filtro activo) ───────
  const filteredBooks = useMemo(() => {
    let books = allBooks
    // Filtro de género — solo aplica si hay un género específico seleccionado
    if (activeGenre !== "todos") {
      books = books.filter(b => b.genre === activeGenre)
    }
    // Filtro de relatos cortos
    if (lobbyFilter === "short") {
      books = books.filter(b => b.type === "story")
    }
    return books
  }, [allBooks, activeGenre, lobbyFilter])

  // Libros para el spotlight — evitar clásicos en el spotlight principal
  const spotlightPool = useMemo(() => {
    const pool = isFiltered ? filteredBooks : allBooks.filter(b => !b.isClassic)
    return pool.length > 0 ? pool : allBooks
  }, [allBooks, filteredBooks, isFiltered])

  // ── SPOTLIGHT ROTATIVO ───────────────────────────────
  useEffect(() => {
    if (!spotlightPool.length) return
    const interval = setInterval(() => {
      setSpotlightVisible(false)
      setTimeout(() => {
        setSpotlightIndex(prev => {
          let next = Math.floor(Math.random() * spotlightPool.length)
          if (spotlightPool.length > 1 && next === prev) {
            next = (next + 1) % spotlightPool.length
          }
          return next
        })
        setSpotlightVisible(true)
      }, 400)
    }, 7000)
    return () => clearInterval(interval)
  }, [spotlightPool.length, activeGenre])

  useEffect(() => {
    setSpotlightIndex(Math.floor(Math.random() * Math.max(1, 8)))
    setSpotlightVisible(true)
  }, [activeGenre, lobbyFilter])

  if (isLoading && allBooks.length === 0) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-screen">
          <Loader2 className="w-7 h-7 animate-spin text-white/30" />
        </div>
      </Layout>
    )
  }

  const spotlightBook = spotlightPool[spotlightIndex % Math.max(1, spotlightPool.length)]

  return (
    <Layout>
      {/* fondo reactivo */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-zinc-950 to-black" />
        <motion.div
          key={activeGenre}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.8 }}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: "80vw", height: "80vw",
            top: "5%", left: "10%",
            background: `radial-gradient(circle, ${cfg.glow}12, transparent 70%)`,
            filter: "blur(50px)",
          }}
        />
      </div>

      <div className="pt-14 sm:pt-20 pb-36 space-y-6 sm:space-y-10">

        {/* ── INDICADOR DE FILTRO ACTIVO ── */}
        <AnimatePresence>
          {isFiltered && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{    opacity: 0, height: 0 }}
              className="px-4 sm:px-6 overflow-hidden"
            >
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-sans"
                style={{
                  background: `${cfg.glow}10`,
                  border:     `1px solid ${cfg.color}22`,
                }}
              >
                <span style={{ color: cfg.color + "cc" }}>✦</span>
                <span style={{ color: cfg.color + "99" }}>
                  {activeGenre !== "todos" && lobbyFilter === "short"
                    ? `${t(cfg.tKey)} · ${t("soloRelatos")}`
                    : activeGenre !== "todos"
                    ? t(cfg.tKey)
                    : t("soloRelatos")
                  }
                </span>
                <span className="ml-auto text-zinc-700 text-[10px]">
                  {filteredBooks.length}{" "}
                  {filteredBooks.length === 1 ? t("stories").slice(0,-1) : t("stories")}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── SPOTLIGHT ── */}
        {spotlightBook && (
          <AnimatePresence mode="wait">
            {spotlightVisible && (
              <motion.div
                key={`spot-${spotlightIndex}-${activeGenre}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{    opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="relative mx-4 sm:mx-6 rounded-2xl overflow-hidden cursor-pointer"
                style={{
                  minHeight:  180,
                  background: "rgba(0,0,0,0.4)",
                  border:     `1px solid ${cfg.color}18`,
                }}
                onClick={() => setLocation(`/book/${spotlightBook.id}`)}
              >
                {spotlightBook.coverUrl && (
                  <div className="absolute inset-0">
                    <img loading="lazy" src={spotlightBook.coverUrl} alt="" aria-hidden
                      className="w-full h-full object-cover opacity-25"
                      style={{ filter: "blur(20px)", transform: "scale(1.1)" }} />
                    <div className="absolute inset-0"
                      style={{ background: "linear-gradient(to right, rgba(0,0,0,0.85), rgba(0,0,0,0.4))" }} />
                  </div>
                )}

                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at 80% 50%, ${cfg.glow}20, transparent 60%)` }} />

                <div className="relative z-10 flex items-center gap-4 p-4 sm:p-5">
                  {/* portada */}
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0   }}
                    transition={{ delay: 0.15 }}
                    className="shrink-0"
                  >
                    <div className="rounded-lg overflow-hidden shadow-2xl"
                      style={{
                        width: 72, aspectRatio: "2/3",
                        boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 20px ${cfg.glow}40`,
                      }}>
                      {spotlightBook.coverUrl ? (
                        <img loading="lazy" src={spotlightBook.coverUrl} alt={spotlightBook.title}
                          className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"
                          style={{ background: cfg.bg }}>
                          <span className="text-xs" style={{ color: cfg.color + "60" }}>✦</span>
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* texto */}
                  <motion.div
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0  }}
                    transition={{ delay: 0.2 }}
                    className="flex-1 min-w-0 space-y-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* badge principal */}
                      <span
                        className="text-[9px] tracking-[0.22em] uppercase font-sans px-2 py-0.5 rounded-full"
                        style={{
                          background: spotlightBook.isClassic
                            ? "rgba(255,210,100,0.12)" : `${cfg.glow}18`,
                          color: spotlightBook.isClassic
                            ? "rgba(255,210,100,0.85)" : cfg.color + "aa",
                          border: spotlightBook.isClassic
                            ? "1px solid rgba(255,210,100,0.25)" : `1px solid ${cfg.color}25`,
                        }}
                      >
                        {spotlightBook.isClassic
                          ? `${t("classicBadge")} · ${spotlightBook.publicationYear || t("publicDomain")}`
                          : t("discoveryLabel")
                        }
                      </span>
                      {/* badge de género */}
                      {spotlightBook.genre && (
                        <span className="text-[9px] text-zinc-600 font-sans uppercase tracking-wider">
                          {t(GENRE_CONFIG[spotlightBook.genre as Genre]?.tKey || "")}
                        </span>
                      )}
                    </div>

                    <h3 className="font-display font-bold text-white text-base sm:text-lg leading-tight line-clamp-2"
                      style={{ textShadow: `0 0 20px ${cfg.glow}30` }}>
                      {spotlightBook.title}
                    </h3>

                    <p className="text-zinc-500 text-xs font-sans">
                      {spotlightBook.author}
                    </p>

                    {getOpeningLine(spotlightBook) && (
                      <p className="text-xs font-serif leading-relaxed line-clamp-2 italic"
                        style={{ color: spotlightBook.isClassic ? "rgba(255,210,100,0.5)" : cfg.color + "66" }}>
                        "{getOpeningLine(spotlightBook)}"
                      </p>
                    )}
                  </motion.div>

                  <motion.div
                    animate={{ x: [0, 4, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="shrink-0 text-xl"
                    style={{ color: cfg.color + "50" }}
                  >
                    ›
                  </motion.div>
                </div>

                {/* indicadores */}
                {spotlightPool.length > 1 && (
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1">
                    {spotlightPool.slice(0, Math.min(6, spotlightPool.length)).map((_, i) => (
                      <div key={i}
                        className="rounded-full transition-all duration-500"
                        style={{
                          width:  i === spotlightIndex % Math.min(6, spotlightPool.length) ? 14 : 4,
                          height: 4,
                          background: i === spotlightIndex % Math.min(6, spotlightPool.length)
                            ? cfg.color : "rgba(255,255,255,0.15)",
                        }}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* ── VACÍO ── */}
        {isFiltered && filteredBooks.length === 0 && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-24 gap-3 px-8 text-center"
          >
            <p className="text-zinc-600 text-sm font-sans">
              No hay historias de{" "}
              {activeGenre !== "todos" ? t(cfg.tKey).toLowerCase() : t("relatosCortosFilter")} aún.
            </p>
            <p className="text-zinc-700 text-xs font-sans">
              {t("exploreButton")}.
            </p>
          </motion.div>
        )}

        {/* ── CARRUSELES ── */}
        {isFiltered ? (
          // Con filtro activo — un solo carrusel con los resultados
          filteredBooks.length > 0 && (
            <Carousel
              title={lobbyFilter === "short"
                ? t("relatosCortosFilter")
                : t(cfg.tKey)
              }
              books={filteredBooks}

                ownedIds={ownedIds}
              />
          )
        ) : (
          // Sin filtro — carruseles organizados por tipo y género
          <>
            {/* Clásicos — carrusel especial dorado */}
            {classics.length > 0 && (
              <Carousel
                title={t("patrimonioLiterario")}
                books={classics}
                accent="classic"

                ownedIds={ownedIds}
              />
            )}

            {/* Relatos cortos de autores */}
            {stories.length > 0 && (
              <Carousel title={t("relatosCortos")} books={stories} 
                ownedIds={ownedIds}
              />
            )}

            {/* Novelas de autores */}
            {novels.length > 0 && (
              <Carousel title={t("novelas")} books={novels} 
                ownedIds={ownedIds}
              />
            )}

            {/* Sagas */}
            {sagas.length > 0 && (
              <Carousel title={t("sagas")} books={sagas} 
                ownedIds={ownedIds}
              />
            )}

            {/* Clásicos de terror */}
            {classics.filter(b => b.genre === "terror").length > 0 && (
              <Carousel
                title={`${t("classicsOf")} ${t("genreTerror")}`}
                books={classics.filter(b => b.genre === "terror")}
                accent="classic"

                ownedIds={ownedIds}
              />
            )}

            {/* Clásicos de misterio */}
            {classics.filter(b => b.genre === "misterio").length > 0 && (
              <Carousel
                title={`${t("classicsOf")} ${t("genreMisterio")}`}
                books={classics.filter(b => b.genre === "misterio")}
                accent="classic"

                ownedIds={ownedIds}
              />
            )}

            {/* Clásicos de fantasía */}
            {classics.filter(b => b.genre === "fantasia").length > 0 && (
              <Carousel
                title={`${t("classicsOf")} ${t("genreFantasia")}`}
                books={classics.filter(b => b.genre === "fantasia")}
                accent="classic"

                ownedIds={ownedIds}
              />
            )}

            {/* Clásicos de romance */}
            {classics.filter(b => b.genre === "romance").length > 0 && (
              <Carousel
                title={`${t("classicsOf")} ${t("genreRomance")}`}
                books={classics.filter(b => b.genre === "romance")}
                accent="classic"

                ownedIds={ownedIds}
              />
            )}

            {/* Clásicos melancólicos */}
            {classics.filter(b => b.genre === "melancolico").length > 0 && (
              <Carousel
                title={`${t("classicsOf")} ${t("genreMelancolico")}`}
                books={classics.filter(b => b.genre === "melancolico")}
                accent="classic"

                ownedIds={ownedIds}
              />
            )}

            {/* Descubrimientos — libros con menos reads, ordenados al azar */}
            {hiddenGems.length > 0 && (
              <Carousel
                title={t("joyasOcultas")}
                books={hiddenGems}

                ownedIds={ownedIds}
              />
            )}

            {/* Todo el catálogo cuando hay poco contenido */}
            {classics.length === 0 && stories.length === 0 &&
             novels.length === 0  && sagas.length === 0 &&
             allBooks.length > 0  && (
              <Carousel title={t("destacados")} books={allBooks.slice(0, 12)} 
                ownedIds={ownedIds}
              />
            )}

            {/* ── CITA LITERARIA ── espacios entre carruseles */}
            {allBooks.length > 0 && (
              <LiteraryQuote />
            )}
          </>
        )}

      </div>
    </Layout>
  )
}

// ── CARRUSEL ──────────────────────────────────────────────

// ── COMPONENTE CITA LITERARIA ─────────────────────────────
function LiteraryQuote() {
  const { cfg } = useGenre()
  const { settings } = useSettings()
  // Citas del idioma activo, con cascada de respaldo: idioma → español →
  // lista mínima garantizada. Nunca queda vacío (evita quote undefined).
  const FALLBACK = [{ text: "Un lector vive mil vidas antes de morir. El que nunca lee, solo vive una.", author: "George R.R. Martin" }]
  const langQuotes = LITERARY_QUOTES_I18N[settings.language]
  const esQuotes   = LITERARY_QUOTES_I18N["es"]
  const quotes = (Array.isArray(langQuotes) && langQuotes.length > 0) ? langQuotes
               : (Array.isArray(esQuotes) && esQuotes.length > 0)     ? esQuotes
               : FALLBACK
  const quote = quotes[Math.floor(Date.now() / 3600000) % quotes.length] || FALLBACK[0]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="mx-4 my-8 py-8 px-6 text-center"
    >
      <motion.p
        className="text-zinc-500 text-[10px] tracking-[0.3em] uppercase font-sans mb-4"
        style={{ color: cfg.color + "55" }}
      >
        ✦
      </motion.p>
      <p className="font-display italic text-sm leading-relaxed mb-3"
        style={{ color: "rgba(255,255,255,0.35)" }}>
        &ldquo;{quote.text}&rdquo;
      </p>
      <p className="text-[10px] tracking-widest uppercase font-sans"
        style={{ color: "rgba(255,255,255,0.18)" }}>
        — {quote.author}
      </p>
    </motion.div>
  )
}


function Carousel({
  title, books, accent, ownedIds = new Set<string>()
}: {
  title:    string
  books:    Book[]
  accent?:  "classic" | "default"
  ownedIds?: Set<string>
}) {
  const isClassicCarousel = accent === "classic"

  // Carrusel verdaderamente infinito: si hay pocos libros, duplicamos el
  // catálogo para que Embla siempre tenga tarjetas de sobra y el giro sea
  // continuo, sin límite ni salto. Con muchos libros no se duplica.
  const displayBooks = useMemo(() => {
    if (books.length < 2 || books.length >= 7) return books
    const reps = Math.ceil(8 / books.length)
    return Array.from({ length: reps }).flatMap(() => books)
  }, [books])

  const startIdx = useMemo(
    () => displayBooks.length > 3 ? Math.floor(Math.random() * Math.min(3, displayBooks.length)) : 0,
    [displayBooks.length]
  )
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align:         "center",
    dragFree:      false,
    containScroll: false,
    loop:          displayBooks.length > 3,
    startIndex:    startIdx,
    duration:      26,
  })

  // (El abanico ya no usa estado de React: applyOffsets escribe directo al DOM)

  const applyOffsets = useCallback(() => {
    if (!emblaApi) return
    const engine         = emblaApi.internalEngine()
    const scrollProgress = emblaApi.scrollProgress()
    const snaps          = emblaApi.scrollSnapList()
    const factor         = Math.max(1, snaps.length - 1)

    const diffs = snaps.map((snap, index) => {
      let diff = snap - scrollProgress
      if (engine.options.loop) {
        engine.slideLooper.loopPoints.forEach((loopItem: any) => {
          const target = loopItem.target()
          if (index === loopItem.index && target !== 0) {
            const sign = Math.sign(target)
            if (sign === -1) diff = snap - (1 + scrollProgress)
            if (sign ===  1) diff = snap + (1 - scrollProgress)
          }
        })
      }
      return diff * factor
    })

    // Escribir DIRECTO al DOM (sin setState): el scroll no re-renderiza React.
    const nodes = emblaApi.slideNodes()
    for (let i = 0; i < nodes.length; i++) {
      const offset   = diffs[i] ?? 0
      const distance = Math.abs(offset)
      const scale    = 1 - Math.min(distance * 0.15, 0.4)
      const opacity  = 1 - Math.min(distance * 0.5,  0.6)
      const rotateY  = Math.max(-30, Math.min(30, offset * 18))
      const node = nodes[i] as HTMLElement
      node.style.transform =
        `perspective(1000px) translateZ(${scale * 20}px) rotateY(${rotateY}deg) scale(${scale})`
      node.style.opacity = String(opacity)
      const glowEl = node.querySelector<HTMLElement>(".fan-glow")
      if (glowEl) glowEl.style.opacity = String(1 - Math.min(distance * 0.4, 0.8))
    }
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    applyOffsets()
    emblaApi.on("scroll", applyOffsets)
    emblaApi.on("reInit", applyOffsets)
    return () => {
      emblaApi.off("scroll", applyOffsets)
      emblaApi.off("reInit", applyOffsets)
    }
  }, [emblaApi, applyOffsets])

  useEffect(() => { emblaApi?.reInit() }, [books, emblaApi])

  if (!books.length) return null

  const genreGlow: Record<string, string> = {
    melancolico: "rgba(70,96,255,0.4)",
    terror:      "rgba(255,50,50,0.4)",
    fantasia:    "rgba(255,200,80,0.4)",
    misterio:    "rgba(160,120,255,0.4)",
    romance:     "rgba(255,120,200,0.4)",
    default:     "rgba(140,140,255,0.18)",
  }

  // Color del título según tipo de carrusel
  const titleColor = isClassicCarousel
    ? "rgba(255,210,100,0.7)"
    : "rgba(255,255,255,0.3)"

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <div className="flex items-center gap-2 px-4 sm:px-6 mb-3 sm:mb-4">
        {isClassicCarousel && (
          <span className="text-[10px]" style={{ color: "rgba(255,210,100,0.6)" }}>✦</span>
        )}
        <h2
          className="text-[10px] sm:text-[11px] tracking-[0.2em] font-sans uppercase"
          style={{ color: titleColor }}
        >
          {title}
        </h2>
        {isClassicCarousel && (
          <div className="flex-1 h-px ml-2"
            style={{ background: "linear-gradient(to right, rgba(255,210,100,0.2), transparent)" }} />
        )}
      </div>

      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-3 sm:gap-5 pl-4 sm:pl-6 pr-12 sm:pr-20 py-3 sm:py-5">
          {displayBooks.map((book, index) => {
            const isOwn = ownedIds.has(String(book.id))
            // Posición inicial (primer pintado); después applyOffsets
            // escribe directo al DOM en cada scroll, sin re-render.
            const offset   = index - startIdx
            const distance = Math.abs(offset)
            const scale    = 1 - Math.min(distance * 0.15, 0.4)
            const opacity  = 1 - Math.min(distance * 0.5,  0.6)
            const rotateY  = Math.max(-30, Math.min(30, offset * 18))
            const glow = isClassicCarousel
              ? "rgba(255,210,100,0.3)"
              : genreGlow[book.genre || "default"]

            return (
              <div
                key={`${book.id}-${index}`}
                className="fan-slide relative flex-[0_0_44%] sm:flex-[0_0_30%] md:flex-[0_0_17%]"
                style={{
                  transform: `perspective(1000px) translateZ(${scale * 20}px) rotateY(${rotateY}deg) scale(${scale})`,
                  opacity,
                  willChange: "transform, opacity",
                }}
              >
                {/* Vaho de género — gradiente amplio sin blur (mismo humo, sin costo) */}
                <div
                  className="fan-glow absolute -inset-3 -z-10 rounded-xl pointer-events-none"
                  style={{
                    background: `radial-gradient(ellipse at center, ${glow} 0%, transparent 62%)`,
                    opacity:    1 - Math.min(distance * 0.4, 0.8),
                  }}
                />
                {isOwn
                  ? <OwnBookCard book={{ ...book, coverUrl: book.premiumCoverUrl || book.coverUrl }} />
                  : <BookCard {...(book as any)} coverUrl={coverFor(book)} />
                }
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
