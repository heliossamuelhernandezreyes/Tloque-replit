import { useParams, useLocation } from "wouter"
import { useBook, useBooks } from "@/hooks/use-books"
import { Loader2, ArrowLeft, Bookmark, BookmarkCheck, Pencil,
         ChevronLeft, ChevronRight, Volume2, VolumeX, BookOpen, Music2 } from "lucide-react"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useToast } from "@/hooks/use-toast"
import { motion, AnimatePresence } from "framer-motion"
import { GENRE_CONFIG, type Genre } from "@/context/GenreContext"
import { useSoundFX } from "@/hooks/useSoundFX"
import CommentsSection from "@/components/CommentsSection"
import SupportInvite from "@/components/SupportInvite"
import { pushStreak, pushProgress, pushSaveBook, pushUnsaveBook } from "@/lib/sync"
import { slimBook, saveOfflineContent, removeOfflineContent, getOfflineContent } from "@/lib/offline"
import { useAuth } from "@/hooks/useAuth"
import { FREE_SAVE_LIMIT, countsTowardLimit, countLimitedSaved } from "@/lib/library"
import {
  useSettings,
  READING_MODE_BG,
  READING_MODE_TEXT,
  READING_MODE_HEADER_BG,
  READING_MODE_HEADER_TEXT,
  FONT_SIZE_PX,
  LINE_SPACING_VALUE,
} from "@/context/SettingsContext"

export default function Reader() {
  const { bookId }      = useParams()
  const [, setLocation] = useLocation()
  const { toast }       = useToast()
  const { play }        = useSoundFX()
  const { settings, t } = useSettings()

  const numericBookId = /^\d+$/.test(String(bookId)) ? Number(bookId) : null
  const { data: apiBook, isLoading: apiLoading } = useBook(numericBookId as number)
  const { data: allBooks } = useBooks()
  const [localBook,     setLocalBook]     = useState<any>(null)
  const [isSaved,       setIsSaved]       = useState(false)
  const [isMine,        setIsMine]        = useState(false)
  const [showLibraryFull, setShowLibraryFull] = useState(false)
  const { user, isAdmin } = useAuth()
  const [activeChapter,  setActiveChapter]  = useState(0)
  const [maxChapter,     setMaxChapter]     = useState(0)
  const [streakCelebration, setStreakCelebration] = useState<number | null>(null)
  const bookLangRef = useRef("es")
  // ── DICCIONARIO ──────────────────────────────────────
  const [dictWord,       setDictWord]       = useState<string | null>(null)
  const [dictDefinition, setDictDefinition] = useState<string | null>(null)
  const [dictLoading,    setDictLoading]    = useState(false)
  const [headerVisible, setHeaderVisible] = useState(true)
  const [readProgress,  setReadProgress]  = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  // ── LECTURA EN VOZ ALTA ──────────────────────────────
  const [isSpeaking,  setIsSpeaking]  = useState(false)
  const [ttsSupported]                = useState(() => "speechSynthesis" in window)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const scrollRef   = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)

  useEffect(() => {
    if (!bookId) return
    const authored = JSON.parse(localStorage.getItem("novareads_authored") || "[]")
    const drafts   = JSON.parse(localStorage.getItem("novareads_drafts")   || "[]")
    const saved    = JSON.parse(localStorage.getItem("novareads_saved")    || "[]")
    const foundA   = authored.find((b: any) => String(b.id) === String(bookId))
    const foundD   = drafts.find((b: any)   => String(b.id) === String(bookId))
    const foundS   = saved.find((b: any)    => String(b.id) === String(bookId))

    if (foundA) { setLocalBook(foundA); setIsMine(true) }
    else if (foundD) { setLocalBook(foundD); setIsMine(true) }  // borradores = propios
    else if (foundS) {
      setLocalBook(foundS); setIsSaved(true)
      // Guardado "ligero": su contenido vive en IndexedDB — hidratarlo
      if (!foundS.chapters && !foundS.content) {
        getOfflineContent(bookId).then(c => {
          if (c && (c.chapters || c.content)) {
            setLocalBook({ ...foundS, chapters: c.chapters ?? undefined, content: c.content ?? undefined })
          }
        })
      }
    }

    const savedCap = localStorage.getItem(`reading_chapter_${bookId}`)
    if (savedCap) setActiveChapter(Number(savedCap))
  }, [bookId, apiBook])

  // Detener voz al desmontar o cambiar capítulo
  useEffect(() => {
    return () => { window.speechSynthesis?.cancel() }
  }, [])

  useEffect(() => {
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
  }, [activeChapter])

  useEffect(() => {
    if (!bookId) return
    localStorage.setItem(`reading_chapter_${bookId}`, String(activeChapter))
    // Rastrear el capítulo más lejano alcanzado (para bloquear comentarios atrás)
    const storedMax = Number(localStorage.getItem(`reading_maxchapter_${bookId}`) || "0")
    const nextMax   = Math.max(maxChapter, storedMax, activeChapter)
    if (nextMax !== storedMax) localStorage.setItem(`reading_maxchapter_${bookId}`, String(nextMax))
    setMaxChapter(nextMax)
    // Respaldar el progreso en la nube (solo libros del servidor)
    if (numericBookId !== null) pushProgress(numericBookId, activeChapter, nextMax)
    // Guardar último punto de lectura con el capítulo actual
    localStorage.setItem("lastReading", `/read/${bookId}/${activeChapter + 1}`)
    // Actualizar racha de lectura al avanzar capítulo
    try {
      const today = new Date().toDateString()
      const raw   = localStorage.getItem("novareads_streak")
      if (!raw) {
        localStorage.setItem("novareads_streak", JSON.stringify({ days: 1, lastDate: today }))
        pushStreak(1, today)
      } else {
        const { days, lastDate } = JSON.parse(raw)
        if (lastDate !== today) {
          // Cálculo de "ayer" seguro ante cambios de horario (no resta milisegundos)
          const y = new Date()
          y.setDate(y.getDate() - 1)
          const yesterday = y.toDateString()
          const newDays   = lastDate === yesterday ? days + 1 : 1
          localStorage.setItem("novareads_streak",
            JSON.stringify({ days: newDays, lastDate: today }))
          pushStreak(newDays, today)

          const MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 365]
          if (MILESTONES.includes(newDays)) {
            setStreakCelebration(newDays)
            play("streak_milestone")
            if ("vibrate" in navigator) navigator.vibrate([20, 30, 20, 30, 45])
            setTimeout(() => setStreakCelebration(null), 3800)
          }
        }
      }
    } catch {}
  }, [activeChapter, bookId])

  // ── BUSQUEDA EN WIKTIONARY ───────────────────────────
  const lookupWord = useCallback(async (word: string) => {
    // Solo letras — elimina signos de puntuación y números
    const cleaned = word.replace(/[^a-zA-ZÀ-ɏ぀-鿿一-鿿]/g, "").trim()
    if (!cleaned || cleaned.length < 2) return
    setDictWord(word.trim())
    setDictDefinition(null)
    setDictLoading(true)
    try {
      // Proxy del servidor — busca en el idioma del LIBRO (no el de la interfaz)
      const lang   = bookLangRef.current || "es"
      const target = settings.language || "es"
      const res  = await fetch(`/api/dictionary/${encodeURIComponent(cleaned)}?lang=${lang}&target=${target}`)
      if (res.ok) {
        const data = await res.json()
        if (data.definition) {
          setDictDefinition(data.definition)
          return
        }
      }
      setDictDefinition(`"${word.trim()}" — definición no disponible`)
    } catch {
      setDictDefinition(`"${word.trim()}" — definición no disponible`)
    } finally {
      setDictLoading(false)
    }
  }, [t, settings.language])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const scrollY   = el.scrollTop
    const maxScroll = el.scrollHeight - el.clientHeight
    setReadProgress(maxScroll > 0 ? Math.min(100, (scrollY / maxScroll) * 100) : 0)
    const delta = scrollY - lastScrollY.current
    if (delta > 8  && scrollY > 80) setHeaderVisible(false)
    if (delta < -8 || scrollY < 40) setHeaderVisible(true)
    lastScrollY.current = scrollY
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  function changeChapter(newIndex: number) {
    if (transitioning) return
    setTransitioning(true)
    play("page_turn")
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
    setTimeout(() => {
      setActiveChapter(newIndex)
      setTransitioning(false)
    }, 320)
  }

  // ── WEB SPEECH API ───────────────────────────────────
  function toggleSpeech(text: string) {
    if (!ttsSupported) return

    if (isSpeaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }

    const utterance  = new SpeechSynthesisUtterance(text)
    utteranceRef.current = utterance

    // Seleccionar voz en español
    const voices = window.speechSynthesis.getVoices()
    const esVoice = voices.find(v =>
      v.lang.startsWith("es") && !v.name.toLowerCase().includes("google")
    ) || voices.find(v => v.lang.startsWith("es"))
    if (esVoice) utterance.voice = esVoice

    utterance.lang  = "es-MX"
    utterance.rate  = 0.92
    utterance.pitch = 1.0
    utterance.volume = 1.0

    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend   = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)

    window.speechSynthesis.speak(utterance)
  }

  function toggleSave() {
    const currentBook = apiBook || localBook
    if (!currentBook || isMine) return
    let saved = JSON.parse(localStorage.getItem("novareads_saved") || "[]")
    if (isSaved) {
      saved = saved.filter((b: any) => String(b.id) !== String(bookId))
      localStorage.setItem("novareads_saved", JSON.stringify(saved))
      setIsSaved(false)
      removeOfflineContent(bookId)
      if (numericBookId !== null) pushUnsaveBook(numericBookId)
      toast({ title: t("removedFromReadings") })
    } else {
      // Límite gratuito (clásicos, propios y admin no cuentan)
      if (!isAdmin && countsTowardLimit(currentBook, user?.id)) {
        if (countLimitedSaved(saved, user?.id) >= FREE_SAVE_LIMIT) {
          setShowLibraryFull(true)
          return
        }
      }
      saved.push({ ...slimBook(currentBook), isSaved: true })
      localStorage.setItem("novareads_saved", JSON.stringify(saved))
      saveOfflineContent(bookId!, currentBook)   // contenido pesado → IndexedDB
      setIsSaved(true)
      if (numericBookId !== null) pushSaveBook(numericBookId)
      toast({ title: t("tomeClaimed"), description: t("savedOffline") })
    }
  }

  const book      = apiBook || localBook

  // Mantener el idioma del libro actualizado para el diccionario
  useEffect(() => {
    bookLangRef.current = (book as any)?.originalLanguage || "es"
  }, [book])

  // Sugerencias al terminar — mismo autor primero, luego mismo género
  const endSuggestions = useMemo(() => {
    if (!book || !allBooks) return []
    const others = (allBooks as any[]).filter(b => String(b.id) !== String(bookId))
    const byAuthor = others.filter(b => b.author === book.author).slice(0, 2)
    const byGenre  = others
      .filter(b => b.genre === book.genre && b.author !== book.author)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2 - byAuthor.length)
    return [...byAuthor, ...byGenre].slice(0, 3)
  }, [book, allBooks, bookId])
  const isLoading = apiLoading && !localBook
  const gc        = GENRE_CONFIG[(book?.genre as Genre) || "todos"]

  // ── Valores desde settings ───────────────────────────
  const bgColor      = READING_MODE_BG[settings.readingMode]
  const textColor    = READING_MODE_TEXT[settings.readingMode]
  const headerBg     = READING_MODE_HEADER_BG[settings.readingMode]
  const headerText   = READING_MODE_HEADER_TEXT[settings.readingMode]
  const fontSizePx   = FONT_SIZE_PX[settings.fontSize]
  const lineHeight   = LINE_SPACING_VALUE[settings.lineSpacing]

  if (isLoading) return (
    <div className="h-screen flex items-center justify-center" style={{ background: bgColor }}>
      <Loader2 className="animate-spin text-white/30 w-7 h-7" />
    </div>
  )

  if (!book) return (
    <div className="h-screen flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: bgColor }}>
      <p className="text-sm font-sans" style={{ color: textColor + "80" }}>
        El manuscrito no fue hallado
      </p>
      <button onClick={() => setLocation("/")}
        className="text-xs underline font-sans" style={{ color: textColor + "50" }}>
        Volver
      </button>
    </div>
  )

  const chapters    = book.chapters?.length
    ? book.chapters
    : [{ title: "", content: book.content || "" }]
  const hasChapters = chapters.length > 1
  const cap         = chapters[activeChapter] || chapters[0]

  return (
    <div
      ref={scrollRef}
      className="h-screen overflow-y-auto"
      style={{ background: bgColor, scrollBehavior: "auto",
               transition: "background 0.5s ease" }}
    >
      {/* ── CELEBRACIÓN DE HITO DE RACHA ── */}
      <AnimatePresence>
        {streakCelebration !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            onClick={() => setStreakCelebration(null)}
            className="fixed inset-0 z-[300] flex items-center justify-center px-8"
            style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,0,0,0.82), rgba(0,0,0,0.94))" }}
          >
            <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
              {[...Array(12)].map((_, i) => (
                <motion.div key={i} className="absolute origin-bottom"
                  style={{ width: 2, height: "45vh",
                    background: `linear-gradient(to top, ${gc.color}00, ${gc.color}55, ${gc.color}00)`,
                    rotate: `${i * 30}deg` }}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: [0, 0.7, 0], scaleY: [0, 1, 1] }}
                  transition={{ duration: 2.2, delay: 0.1 + i * 0.03, ease: "easeOut" }} />
              ))}
            </div>
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(18)].map((_, i) => (
                <motion.div key={i} className="absolute rounded-full"
                  style={{ width: 3 + (i % 3), height: 3 + (i % 3), background: gc.color,
                    left: `${8 + (i * 5) % 84}%`, bottom: "30%", boxShadow: `0 0 8px ${gc.glow}` }}
                  initial={{ opacity: 0, y: 0 }}
                  animate={{ opacity: [0, 1, 0], y: [-20, -180 - (i % 4) * 40] }}
                  transition={{ duration: 1.8 + (i % 3) * 0.4, delay: 0.2 + i * 0.04, ease: "easeOut" }} />
              ))}
            </div>
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 18, delay: 0.1 }}
              className="relative z-10 flex flex-col items-center text-center"
            >
              <motion.div animate={{ scale: [1, 1.12, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="text-6xl mb-2" style={{ filter: `drop-shadow(0 0 24px ${gc.glow})` }}>
                🔥
              </motion.div>
              <div className="font-display font-bold leading-none"
                style={{ fontSize: "64px", color: gc.color, textShadow: `0 0 40px ${gc.glow}` }}>
                {streakCelebration}
              </div>
              <p className="text-sm font-sans tracking-[0.2em] uppercase mt-2" style={{ color: gc.color + "cc" }}>
                {t("readingStreak")}
              </p>
              <p className="text-xs font-sans mt-4 max-w-[240px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                {streakCelebration >= 100 ? "Tu constancia es extraordinaria."
                  : streakCelebration >= 30 ? "Un mes leyendo. Esto ya es parte de ti."
                  : streakCelebration >= 7  ? "Una semana entera. El hábito está echando raíces."
                  : "Tres días seguidos. Así empieza todo."}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── BARRA DE PROGRESO ── */}
      <div className="fixed top-0 left-0 right-0 z-[200] h-[2px]"
        style={{ background: "rgba(255,255,255,0.06)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{
            width:      `${readProgress}%`,
            background: `linear-gradient(to right, ${gc.glow}, ${gc.color})`,
            boxShadow:  `0 0 6px ${gc.glow}`,
          }}
          transition={{ duration: 0.08 }}
        />
      </div>

      {/* ── HEADER ── */}
      <motion.div
        animate={{ y: headerVisible ? 0 : -60 }}
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
        className="fixed top-[2px] left-0 right-0 z-[150] flex items-center justify-between px-4 py-3"
        style={{
          background:     headerBg,
          borderBottom:   "1px solid rgba(255,255,255,0.05)",
          backdropFilter: "blur(24px)",
          transition:     "background 0.5s ease",
        }}
      >
        <button
          onClick={() => setLocation(`/book/${bookId}`)}
          className="p-2 transition-colors"
          style={{ color: headerText }}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center min-w-0 px-2">
          <p
            className="text-[10px] tracking-[0.18em] uppercase font-sans truncate max-w-[140px]"
            style={{ color: gc.color + "99" }}
          >
            {hasChapters ? (cap.title || `${t("chapter")} ${activeChapter + 1}`) : book.title}
          </p>
          {hasChapters && (
            <p className="text-[9px] font-sans mt-0.5 truncate max-w-[140px]"
              style={{ color: headerText + "80" }}>
              {book.title}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Botón de lectura en voz alta */}
          {ttsSupported && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => toggleSpeech(cap.content)}
              className="p-2 transition-colors"
              style={{ color: isSpeaking ? gc.color : headerText }}
            >
              <AnimatePresence mode="wait">
                {isSpeaking ? (
                  <motion.div key="on"
                    initial={{ scale: 0.7 }} animate={{ scale: 1 }} exit={{ scale: 0.7 }}>
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}>
                      <VolumeX className="w-4 h-4" />
                    </motion.div>
                  </motion.div>
                ) : (
                  <motion.div key="off"
                    initial={{ scale: 0.7 }} animate={{ scale: 1 }} exit={{ scale: 0.7 }}>
                    <Volume2 className="w-4 h-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          )}

          {isMine ? (
            <button
              onClick={() => setLocation(`/editor?id=${book.id}&status=published`)}
              className="p-2 transition-colors"
              style={{ color: headerText }}
            >
              <Pencil className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={toggleSave} className="p-2 transition-colors">
              <AnimatePresence mode="wait">
                {isSaved ? (
                  <motion.div key="s" initial={{scale:0.6}} animate={{scale:1}} exit={{scale:0.6}}>
                    <BookmarkCheck className="w-4 h-4" style={{ color: gc.color }} />
                  </motion.div>
                ) : (
                  <motion.div key="u" initial={{scale:0.6}} animate={{scale:1}} exit={{scale:0.6}}>
                    <Bookmark className="w-4 h-4" style={{ color: headerText }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          )}
        </div>
      </motion.div>

      {/* ── ORBE SPOTIFY — flotante — solo si el autor configuró un link ── */}
      {book?.spotifyLink && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 280, damping: 22 }}
          whileTap={{ scale: 0.88 }}
          onClick={() => window.open((book as any).spotifyLink, "_blank", "noopener")}
          className="fixed bottom-24 right-4 z-[140] flex items-center justify-center rounded-full"
          style={{
            width:      44,
            height:     44,
            background: `radial-gradient(circle at 40% 35%, ${gc.glow}55, rgba(0,0,0,0.88))`,
            border:     `1px solid ${gc.color}45`,
            boxShadow:  `0 0 20px ${gc.glow}30, 0 3px 10px rgba(0,0,0,0.6)`,
          }}
          title={t("spotifyTitle")}
        >
          <motion.div
            className="absolute inset-0 rounded-full pointer-events-none"
            animate={{ scale: [1, 1.3, 1], opacity: [0.25, 0, 0.25] }}
            transition={{ duration: 3.5, repeat: Infinity }}
            style={{ border: `1px solid ${gc.color}55` }}
          />
          <Music2 className="w-4 h-4" style={{ color: gc.color }} />
        </motion.button>
      )}

      {/* ── CONTENIDO ── */}
      <div className="max-w-[660px] mx-auto px-5 sm:px-10 pt-20 pb-40">

        {/* cabecera del libro */}
        <AnimatePresence>
          {activeChapter === 0 && (
            <motion.header
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{    opacity: 0         }}
              className="mb-14 text-center"
            >
              <div className="w-10 h-px mx-auto mb-8 rounded-full"
                style={{ background: `linear-gradient(to right, transparent, ${gc.color}70, transparent)` }} />
              <h1
                className="font-display font-bold tracking-widest uppercase leading-tight mb-3"
                style={{
                  fontSize:   `${Math.round(fontSizePx * 1.35)}px`,
                  color:      textColor,
                  textShadow: `0 0 40px ${gc.glow}35`,
                  transition: "font-size 0.3s ease, color 0.5s ease",
                }}
              >
                {book.title}
              </h1>
              <p className="text-[10px] uppercase tracking-[0.25em] font-sans"
                style={{ color: textColor + "60" }}>
                {book.author}
              </p>
              <div className="w-10 h-px mx-auto mt-8 rounded-full"
                style={{ background: `linear-gradient(to right, transparent, ${gc.color}70, transparent)` }} />
            </motion.header>
          )}
        </AnimatePresence>

        {/* capítulo */}
        <AnimatePresence mode="wait">
          <motion.article
            key={activeChapter}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{    opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            {hasChapters && cap.title && (
              <div className="mb-10 flex items-center gap-4">
                <div className="flex-1 h-px"
                  style={{ background: `linear-gradient(to right, ${gc.color}35, transparent)` }} />
                <h2 className="text-[10px] uppercase tracking-[0.22em] font-sans shrink-0"
                  style={{ color: gc.color + "bb" }}>
                  {cap.title}
                </h2>
                <div className="flex-1 h-px"
                  style={{ background: `linear-gradient(to left, ${gc.color}35, transparent)` }} />
              </div>
            )}

            {/* Indicador de lectura activa */}
            {isSpeaking && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 flex items-center gap-2.5 px-3 py-2 rounded-xl"
                style={{
                  background: `${gc.glow}15`,
                  border:     `1px solid ${gc.color}25`,
                }}
              >
                <div className="flex gap-0.5 items-end h-4">
                  {[0,1,2,3].map(i => (
                    <motion.div key={i}
                      className="w-0.5 rounded-full"
                      style={{ background: gc.color }}
                      animate={{ height: ["4px","14px","6px","12px","4px"] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
                <span className="text-[11px] font-sans" style={{ color: gc.color + "cc" }}>
                  Leyendo en voz alta...
                </span>
                <button onClick={() => { window.speechSynthesis.cancel(); setIsSpeaking(false) }}
                  className="ml-auto text-[10px] font-sans"
                  style={{ color: gc.color + "70" }}>
                  Detener
                </button>
              </motion.div>
            )}

            {/* TEXTO — aplica preferencias + protección para autores independientes */}
            <div
              className="font-serif whitespace-pre-wrap"
              onContextMenu={book?.isClassic ? undefined : (e) => e.preventDefault()}
              onDoubleClick={(e) => {
                const sel = window.getSelection()?.toString().trim()
                if (sel && sel.split(" ").length <= 3) {
                  lookupWord(sel)
                } else {
                  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
                  if (range) { range.expand("word"); const w = range.toString().trim(); if (w) lookupWord(w) }
                }
              }}
              style={{
                fontSize:      `${fontSizePx}px`,
                lineHeight:    lineHeight,
                letterSpacing: "0.012em",
                color:         textColor,
                transition:    "font-size 0.3s ease, line-height 0.3s ease, color 0.5s ease",
                userSelect:    book?.isClassic ? "text" : "none",
                WebkitUserSelect: book?.isClassic ? "text" : "none",
              }}
            >
              {cap.content}
            </div>

            {/* ornamento de fin */}
            <div className="mt-16 flex items-center justify-center gap-3">
              {[0, 1, 2].map(i => (
                <motion.div key={i}
                  animate={{ opacity: [0.15, 0.55, 0.15], scale: [0.8, 1, 0.8] }}
                  transition={{ duration: 2.8, repeat: Infinity, delay: i * 0.5 }}
                  className="w-1 h-1 rounded-full"
                  style={{ background: gc.color }}
                />
              ))}
            </div>
          </motion.article>
        </AnimatePresence>

        {/* ── NAVEGACIÓN ── */}
        {hasChapters && (
          <div className="mt-12 flex items-center justify-between gap-3">
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => changeChapter(Math.max(0, activeChapter - 1))}
              disabled={activeChapter === 0 || transitioning}
              className="flex items-center gap-2 px-4 py-3 rounded-xl font-sans text-sm transition-all disabled:opacity-25"
              style={{
                background: settings.readingMode === "dawn"
                  ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.04)",
                border: settings.readingMode === "dawn"
                  ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.07)",
                color:  textColor + "cc",
              }}
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </motion.button>

            <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-[120px]">
              {chapters.map((_: any, i: number) => (
                <motion.button key={i}
                  onClick={() => changeChapter(i)}
                  disabled={transitioning}
                  animate={{ width: i === activeChapter ? 18 : 5 }}
                  transition={{ duration: 0.25 }}
                  className="h-[5px] rounded-full transition-colors"
                  style={{
                    background: i === activeChapter ? gc.color : textColor + "25",
                    boxShadow:  i === activeChapter ? `0 0 6px ${gc.glow}` : "none",
                    minWidth: 5,
                  }}
                />
              ))}
            </div>

            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => changeChapter(Math.min(chapters.length - 1, activeChapter + 1))}
              disabled={activeChapter === chapters.length - 1 || transitioning}
              className="flex items-center gap-2 px-4 py-3 rounded-xl font-sans text-sm transition-all disabled:opacity-25"
              style={{
                background: `${gc.glow}18`,
                border:     `1px solid ${gc.color}30`,
                color:      gc.color,
              }}
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </motion.button>
          </div>
        )}

        {/* ── COMENTARIOS DEL CAPÍTULO ── */}
        {numericBookId !== null && (
          <CommentsSection
            bookId={numericBookId}
            chapterIndex={activeChapter}
            locked={activeChapter < maxChapter}
            accentColor={gc.color}
            accentGlow={gc.glow}
            textColor={textColor}
          />
        )}

        {/* ── INVITACIÓN DE APOYO (tercer capítulo) ── */}
        {numericBookId !== null && book?.authorId && !isMine
          && activeChapter === 2 && activeChapter !== chapters.length - 1 && (
          <SupportInvite
            bookId={numericBookId}
            authorName={book.author}
            moment="mid"
            accentColor={gc.color}
            accentGlow={gc.glow}
            textColor={textColor}
          />
        )}

        {/* ── INVITACIÓN DE APOYO (final de la lectura) ── */}
        {numericBookId !== null && book?.authorId && !isMine
          && activeChapter === chapters.length - 1 && (
          <SupportInvite
            bookId={numericBookId}
            authorName={book.author}
            moment="end"
            accentColor={gc.color}
            accentGlow={gc.glow}
            textColor={textColor}
          />
        )}

        {/* ── FIN ── */}
        {activeChapter === chapters.length - 1 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            onViewportEnter={() => {
              play("book_complete")
              if ("vibrate" in navigator) navigator.vibrate([30, 40, 30, 40, 60])
            }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mt-16 mb-8 rounded-3xl overflow-hidden text-center"
            style={{
              background: `linear-gradient(160deg, ${gc.glow}14, rgba(0,0,0,0.7))`,
              border:     `1px solid ${gc.color}22`,
              boxShadow:  `0 0 60px ${gc.glow}15`,
            }}
          >
            {/* Partículas de celebración */}
            <div className="relative pt-10 pb-2 px-6">
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[...Array(8)].map((_, i) => (
                  <motion.div key={i}
                    className="absolute w-1 h-1 rounded-full"
                    style={{
                      background: gc.color,
                      left: `${15 + i * 10}%`,
                      top:  `${20 + (i % 3) * 25}%`,
                    }}
                    animate={{ opacity: [0, 0.7, 0], y: [0, -20, -40], scale: [0, 1.2, 0] }}
                    transition={{ duration: 2.5, delay: i * 0.2, repeat: Infinity, repeatDelay: 2 }}
                  />
                ))}
              </div>

              {/* Símbolo */}
              <motion.div
                animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="text-3xl mb-4"
                style={{ color: gc.color }}
              >
                ✦
              </motion.div>

              <p className="text-[9px] tracking-[0.35em] uppercase font-sans mb-3"
                style={{ color: gc.color + "77" }}>
                {t("finish")}
              </p>

              <p className="text-sm font-sans leading-relaxed mb-1"
                style={{ color: textColor + "70" }}>
                {t("endOfBook")}
              </p>
              <p className="text-base font-display font-semibold italic mb-4"
                style={{ color: textColor + "cc" }}>
                {book.title}
              </p>

              {/* Estadísticas de lectura */}
              <div className="flex justify-center gap-6 mb-6">
                {(() => {
                  const totalW = book.chapters?.reduce(
                    (acc: number, ch: any) => acc + (ch.content?.split(/\s+/).length || 0), 0
                  ) || (book.content?.split(/\s+/).length || 0)
                  const mins = Math.max(1, Math.round(totalW / 200))
                  return (
                    <>
                      <div className="text-center">
                        <p className="text-lg font-display font-bold" style={{ color: gc.color }}>
                          {totalW.toLocaleString()}
                        </p>
                        <p className="text-[9px] uppercase tracking-widest font-sans"
                          style={{ color: gc.color + "60" }}>
                          {t("wordsLabel")}
                        </p>
                      </div>
                      <div className="w-px" style={{ background: gc.color + "20" }} />
                      <div className="text-center">
                        <p className="text-lg font-display font-bold" style={{ color: gc.color }}>
                          {mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`}
                        </p>
                        <p className="text-[9px] uppercase tracking-widest font-sans"
                          style={{ color: gc.color + "60" }}>
                          {t("readingTime")}
                        </p>
                      </div>
                      {(book.chapters?.length || 0) > 1 && (
                        <>
                          <div className="w-px" style={{ background: gc.color + "20" }} />
                          <div className="text-center">
                            <p className="text-lg font-display font-bold" style={{ color: gc.color }}>
                              {book.chapters.length}
                            </p>
                            <p className="text-[9px] uppercase tracking-widest font-sans"
                              style={{ color: gc.color + "60" }}>
                              {t("chapters")}
                            </p>
                          </div>
                        </>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* Sugerencias del mismo autor o género */}
              {endSuggestions.length > 0 && (
                <div className="px-4 pb-4 space-y-2 text-left">
                  <p className="text-[9px] tracking-[0.25em] uppercase font-sans mb-3"
                    style={{ color: gc.color + "66" }}>
                    {t("explore")}
                  </p>
                  {endSuggestions.map((s: any) => {
                    const sg = GENRE_CONFIG[(s.genre as Genre) || "todos"]
                    return (
                      <motion.button
                        key={s.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setLocation(`/book/${s.id}`)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
                        style={{
                          background: `linear-gradient(135deg, ${sg.bg}, rgba(0,0,0,0.5))`,
                          border:     `1px solid ${sg.color}22`,
                        }}
                      >
                        <div className="shrink-0 rounded-lg overflow-hidden"
                          style={{ width: 36, aspectRatio: "2/3", background: sg.bg }}>
                          {s.coverUrl
                            ? <img loading="lazy" src={s.coverUrl} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center">
                                <BookOpen className="w-3 h-3" style={{ color: sg.color + "50" }} />
                              </div>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-sans font-medium line-clamp-1">
                            {s.title}
                          </p>
                          <p className="text-[10px] font-sans mt-0.5" style={{ color: sg.color + "77" }}>
                            {s.author}
                          </p>
                        </div>
                      </motion.button>
                    )
                  })}
                </div>
              )}

              {/* Botones */}
              <div className="flex flex-col gap-2.5 pb-8 px-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setLocation("/")}
                  className="w-full py-3.5 rounded-2xl font-sans font-semibold text-sm"
                  style={{
                    background: `linear-gradient(135deg, ${gc.glow}cc, ${gc.color})`,
                    color:      "rgba(0,0,0,0.85)",
                    boxShadow:  `0 4px 20px ${gc.glow}40`,
                  }}
                >
                  {t("discoverMore")}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setLocation(`/book/${bookId}`)}
                  className="w-full py-3 rounded-2xl font-sans text-sm"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color:      textColor + "70",
                    border:     "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {t("backToSynopsis")}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

      </div>

    {/* ── DICCIONARIO ─────────────────────────────────── */}
    <AnimatePresence>
      {dictWord && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500]"
            onClick={() => { setDictWord(null); setDictDefinition(null) }}
          />
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-[501] max-w-md mx-auto"
            style={{
              background:   "rgba(14,12,20,0.98)",
              borderTop:    `1px solid ${gc.color}30`,
              borderRadius: "24px 24px 0 0",
              boxShadow:    `0 -16px 64px ${gc.glow}25, 0 -4px 16px rgba(0,0,0,0.8)`,
              paddingBottom:"env(safe-area-inset-bottom)",
            }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
            </div>
            <div className="px-6 pb-6 pt-2">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-display text-lg font-semibold text-white leading-tight">{dictWord}</h3>
                  <p className="text-[10px] uppercase tracking-widest font-sans mt-0.5" style={{ color: gc.color + "66" }}>
                    {t("dictionary")}
                  </p>
                </div>
                <button
                  onClick={() => { setDictWord(null); setDictDefinition(null) }}
                  className="p-1.5 rounded-full mt-0.5"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <span className="text-zinc-500 text-sm leading-none">✕</span>
                </button>
              </div>
              <div
                className="rounded-2xl px-4 py-3 min-h-[64px] flex items-center"
                style={{ background: `linear-gradient(135deg, ${gc.bg}, rgba(0,0,0,0.4))`, border: `1px solid ${gc.color}18` }}
              >
                {dictLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: gc.color + "80" }} />
                    <span className="text-zinc-500 text-sm font-sans">{t("searching")}...</span>
                  </div>
                ) : (
                  <p className="text-sm font-sans leading-relaxed"
                    style={{ color: dictDefinition && dictDefinition !== t("noResults") ? textColor : "rgba(255,255,255,0.25)" }}>
                    {dictDefinition || t("noResults")}
                  </p>
                )}
              </div>
              <p className="text-[9px] text-zinc-700 font-sans text-center mt-2.5 tracking-wide">
                Wiktionary
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {/* Modal: biblioteca gratuita llena */}
    <AnimatePresence>
      {showLibraryFull && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShowLibraryFull(false)}
          className="fixed inset-0 z-[600] flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-6"
            style={{ background: "rgba(18,18,24,0.99)", border: `1px solid ${gc.color}30` }}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-2 rounded-full" style={{ background: `${gc.glow}25` }}>
                <Bookmark className="w-4 h-4" style={{ color: gc.color }} />
              </div>
              <h2 className="text-base font-display font-bold text-white">{t("libraryFullTitle")}</h2>
            </div>
            <p className="text-[13px] font-sans leading-relaxed mb-3" style={{ color: "rgba(255,255,255,0.65)" }}>
              {t("libraryFullBefore")}<span style={{ color: gc.color }}>{FREE_SAVE_LIMIT}</span>{t("libraryFullAfter")}
            </p>
            <p className="text-[11px] font-sans leading-relaxed mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
              {t("libraryFullNote")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLibraryFull(false)}
                className="flex-1 py-3 rounded-xl text-sm font-sans"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
              >
                {t("understood")}
              </button>
              <button
                onClick={() => { setShowLibraryFull(false); setLocation("/library") }}
                className="flex-1 py-3 rounded-xl text-sm font-sans font-semibold"
                style={{ background: `linear-gradient(135deg, ${gc.glow}cc, ${gc.color})`, color: "rgba(0,0,0,0.85)" }}
              >
                {t("viewMyLibrary")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  )
}
