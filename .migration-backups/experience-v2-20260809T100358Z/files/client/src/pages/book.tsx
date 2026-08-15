import { useRoute, useLocation } from "wouter"
import { motion, AnimatePresence } from "framer-motion"
import { Layout } from "@/components/layout"
import { useBook } from "@/hooks/use-books"
import { Loader2, ArrowLeft, Bookmark, BookmarkCheck, BookOpen, Clock, Pencil, Download, Maximize2, Minimize2, EyeOff, Eye, Shield, ChevronRight } from "lucide-react"
import ParallaxCover from "@/components/ParallaxCover"
import { resolveBookCoverFx } from "@/lib/cover-effects"
import { useState, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import UserAvatar from "@/components/UserAvatar"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/use-toast"
import { GENRE_CONFIG, type Genre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import BookmarkBurst from "@/components/BookmarkBurst"
import { useSoundFX } from "@/hooks/useSoundFX"
import { FREE_SAVE_LIMIT, countsTowardLimit } from "@/lib/library"
import { pushSaveBook, pushUnsaveBook } from "@/lib/sync"
import { slimBook, saveOfflineContent, removeOfflineContent } from "@/lib/offline"
import TokensPanel from "@/components/TokensPanel"
import CardsGallery from "@/components/CardsGallery"
import HeartCount from "@/components/HeartCount"
import InfoDot from "@/components/InfoDot"
import { generateBookPdf, generateCoverKit } from "@/lib/bookPdf"
import { coverFor, backCoverFor, showingPremium } from "@/lib/covers"

function readingTime(book: any, t: (k: string) => string): string {
  let words = 0
  if (book.chapters?.length) {
    words = book.chapters.reduce((acc: number, c: any) =>
      acc + (c.content || "").split(/\s+/).filter(Boolean).length, 0)
  } else if (book.content) {
    words = book.content.split(/\s+/).filter(Boolean).length
  }
  if (!words) return ""
  const mins = Math.max(1, Math.round(words / 200))
  // Use neutral format that works in all languages
  return mins < 60
    ? `${mins} min`
    : `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? ` ${mins % 60}min` : ""}`
}

export default function BookPage() {
  const [, params]      = useRoute("/book/:id")
  const [, setLocation] = useLocation()
  const { toast }       = useToast()
  const { play }        = useSoundFX()
  const rawId   = params?.id || ""
  const numericId = /^\d+$/.test(rawId) ? Number(rawId) : null
  const id        = rawId  // keep as string for localStorage lookups

  const { data: apiBook, isLoading } = useBook(numericId as number)
  const [localBook, setLocalBook]   = useState<any>(null)
  const [isSaved,   setIsSaved]     = useState(false)
  const [isMine,    setIsMine]      = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDraft,   setIsDraft]     = useState(false)
  const [imgFailed, setImgFailed]   = useState(false)
  const [showBurst, setShowBurst]   = useState(false)
  const [showLibraryFull, setShowLibraryFull] = useState(false)
  const [showFormats, setShowFormats] = useState(false)
  const [coverOnly, setCoverOnly]   = useState(false)
  const [bookStatus, setBookStatus] = useState<string>("published")
  const [savingVis,  setSavingVis]  = useState(false)

  useEffect(() => {
    if (!id) return
    const authored = JSON.parse(localStorage.getItem("novareads_authored") || "[]")
    const drafts   = JSON.parse(localStorage.getItem("novareads_drafts")   || "[]")
    const saved    = JSON.parse(localStorage.getItem("novareads_saved")    || "[]")
    const isDraftBook = !!drafts.find((b: any)  => String(b.id) === String(id))
    const found    = authored.find((b: any) => String(b.id) === String(id))
                  || drafts.find((b: any)   => String(b.id) === String(id))
                  || saved.find((b: any)    => String(b.id) === String(id))
    if (found) setLocalBook(found)
    // La PROPIEDAD real se decide contra el servidor (más abajo, con authorId).
    // Aquí solo marcamos borradores locales que aún no están en el servidor.
    if (isDraftBook) setIsDraft(true)
    setIsSaved(!!saved.find((b: any) => String(b.id) === String(id)))
  }, [id])

  const book      = apiBook || localBook
  const gc        = GENRE_CONFIG[(book?.genre as Genre) || "todos"]
  const { t, settings } = useSettings()
  const { isAdmin, user } = useAuth()

  // Dueño de verdad: el authorId del libro (servidor) coincide con la sesión.
  // Un borrador local sin id de servidor también es editable por su creador.
  useEffect(() => {
    const serverOwns = !!(book && (book as any).authorId && user && (book as any).authorId === user.id)
    const localDraftMine = isDraft && numericId === null   // borrador aún no publicado
    setIsMine(serverOwns || localDraftMine)
  }, [book, user, isDraft, numericId])
  const queryClient = useQueryClient()
  const showAdmin   = isAdmin && settings.adminMode
  const isClassic = !!(book?.isClassic)

  // Al volver del pago (Stripe redirige con ?paid=orderId): agradecer y refrescar
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get("paid")) {
      toast({ title: t("paySuccess"), description: t("paySuccessDesc") })
      queryClient.invalidateQueries({ queryKey: ["/api/tokens/mine"] })
      fetch("/api/tokens/unlocked", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && localStorage.setItem("novareads_unlocked", JSON.stringify((d.bookIds || []).map(String))))
        .catch(() => {})
      window.history.replaceState({}, "", window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincronizar el estado de visibilidad cuando carga el libro
  useEffect(() => {
    if (book?.status) setBookStatus(book.status)
  }, [book])

  // Admin: ocultar para revisión o restaurar al catálogo
  async function toggleVisibility() {
    if (!numericId || savingVis) return
    const next = bookStatus === "review" ? "published" : "review"
    setSavingVis(true)
    try {
      const res = await fetch(`/api/admin/books/${numericId}/visibility`, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error(t("visibilityErr"))
      setBookStatus(next)
      // Refrescar el catálogo para que el cambio se vea de inmediato
      queryClient.invalidateQueries({ queryKey: ["/api/books"] })
      toast({
        title: next === "review" ? t("bookHiddenToast") : t("bookRestoredToast"),
        description: next === "review"
          ? "Ya no aparece en el catálogo público. Puedes auditarlo o corregirlo."
          : "Vuelve a ser visible para todos los lectores.",
      })
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Inténtalo de nuevo." })
    } finally {
      setSavingVis(false)
    }
  }

  function toggleSave() {
    if (!book) return
    const saved = JSON.parse(localStorage.getItem("novareads_saved") || "[]")
    if (isSaved) {
      localStorage.setItem("novareads_saved",
        JSON.stringify(saved.filter((b: any) => String(b.id) !== String(id))))
      setIsSaved(false)
      removeOfflineContent(id)
      if (/^\d+$/.test(String(id))) pushUnsaveBook(Number(id))
      toast({ title: t("removedFromLibrary") })
    } else {
      // Límite gratuito: solo cuenta para libros de OTROS autores.
      // Clásicos, libros propios y administradores no tienen límite.
      if (!isAdmin && countsTowardLimit(book, user?.id)) {
        const usados = saved.filter((b: any) => countsTowardLimit(b, user?.id)).length
        if (usados >= FREE_SAVE_LIMIT) {
          setShowLibraryFull(true)
          return
        }
      }
      localStorage.setItem("novareads_saved",
        JSON.stringify([...saved, { ...slimBook(book), isSaved: true }]))
      saveOfflineContent(id, book)   // contenido pesado → IndexedDB
      setIsSaved(true)
      if (/^\d+$/.test(String(id))) pushSaveBook(Number(id))
      setShowBurst(true)
      play("save_book")
      toast({ title: t("tomeClaimed"), description: t("savedToLibrary") })
    }
  }

  // Retomar lectura donde se quedó

  // Genera el PDF del libro. copy = ejemplar físico (folio+QR+clave).
  // format: "a5" (imprenta) | "letter" (impresora casera) | "booklet" (folleto para doblar y engrapar)
  async function downloadPDF(copy?: { folio: string; key: string }, opts?: { format?: "a5" | "letter" | "booklet" | "cover" }) {
    if (!book || isDownloading) return
    setIsDownloading(true)
    try {
      const bookForPdf = { ...book, coverUrl: shownCover, backCoverUrl: backCoverFor(book, user?.id) }
      if (opts?.format === "cover") {
        await generateCoverKit(bookForPdf, t, copy)
      } else {
        await generateBookPdf(bookForPdf, t, copy, { format: (opts?.format as any) || "a5" })
      }
    } catch (err) {
      console.error("PDF error:", err)
    } finally {
      setIsDownloading(false)
    }
  }

  function startReading() {
    const savedChapter = localStorage.getItem(`reading_chapter_${id}`)
    const chapter = savedChapter ? Number(savedChapter) : 0
    setLocation(`/read/${id}/${chapter + 1}`)
  }

  const timeRead     = book ? readingTime(book, t) : ""
  const coverFx      = resolveBookCoverFx(book)
  const chapterCount = book?.chapters?.length || (book?.content ? 1 : 0)
  const hasSavedProgress = !!localStorage.getItem(`reading_chapter_${id}`)
    && Number(localStorage.getItem(`reading_chapter_${id}`)) > 0
  const readProgress = (() => {
    if (!chapterCount) return 0
    const savedCh = Number(localStorage.getItem(`reading_chapter_${id}`) || 0)
    return Math.min(100, Math.round((savedCh / chapterCount) * 100))
  })()
  const shownCover = coverFor(book, user?.id)
  const isPremiumView = showingPremium(book, user?.id)
  const hasImage = !!shownCover && !imgFailed

  if (isLoading && !localBook) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-screen">
          <Loader2 className="w-7 h-7 animate-spin text-white/30" />
        </div>
      </Layout>
    )
  }

  if (!book) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-screen gap-5 px-8 text-center">
          <p className="text-zinc-500 font-sans text-sm">{t("noResults")}</p>
          <button onClick={() => setLocation("/")}
            className="text-xs text-zinc-600 underline underline-offset-4 font-sans">
            Volver al inicio
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="relative min-h-screen pb-36 overflow-x-hidden">

        {/* ── PORTADA A PANTALLA COMPLETA — fondo nítido ── */}
        <div className="fixed inset-0 z-0">
          {hasImage ? (
            <img
              src={shownCover}
              alt={book.title}
              className="w-full h-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-full h-full"
              style={{ background: `linear-gradient(160deg, ${gc.glow}40, rgba(0,0,0,0.98))` }} />
          )}
          {/* Vaho ahumado del género — respira lento detrás del libro */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse 90% 60% at 50% 78%, ${gc.glow}55 0%, transparent 65%)`,
              mixBlendMode: "screen",
            }}
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut" }}
          />
          {isPremiumView && (
            <div className="absolute top-20 right-4 px-2.5 py-1 rounded-full text-[10px] font-sans tracking-wide"
              style={{ background: "rgba(0,0,0,0.45)", color: "#e0c878", border: "1px solid rgba(201,168,87,0.4)", backdropFilter: "blur(4px)" }}>
              {t("premiumBadge")}
            </div>
          )}
          {/* Degradado para legibilidad — se atenúa al ver solo la portada */}
          <motion.div
            className="absolute inset-0"
            animate={{ opacity: coverOnly ? 0.12 : 1 }}
            transition={{ duration: 0.5 }}
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.92) 20%, rgba(0,0,0,0.5) 48%, rgba(0,0,0,0.22) 70%, rgba(0,0,0,0.62) 100%)",
            }}
          />
        </div>

        {/* Zona tocable para salir del modo "solo portada" */}
        {coverOnly && (
          <div className="fixed inset-0 z-20" onClick={() => setCoverOnly(false)} />
        )}

        {/* ── BOTONES FLOTANTES ── */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0   }}
          transition={{ delay: 0.15 }}
          onClick={() => setLocation("/")}
          className="fixed top-4 left-4 z-30 p-2.5 rounded-full backdrop-blur-xl"
          style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <ArrowLeft className="w-4 h-4 text-white/80" />
        </motion.button>

        {/* lupa — ver solo la portada */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          onClick={() => setCoverOnly(v => !v)}
          className="fixed top-4 right-16 z-30 p-2.5 rounded-full backdrop-blur-xl transition-all duration-300"
          style={coverOnly ? {
            background: `${gc.glow}30`,
            border:     `1px solid ${gc.color}70`,
            boxShadow:  `0 0 20px ${gc.glow}50`,
          } : {
            background: "rgba(0,0,0,0.55)",
            border:     "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {coverOnly
            ? <Minimize2 className="w-4 h-4" style={{ color: gc.color }} />
            : <Maximize2 className="w-4 h-4 text-white/70" />}
        </motion.button>

        {/* guardar */}
        <motion.button
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0  }}
          transition={{ delay: 0.15 }}
          onClick={toggleSave}
          className="fixed top-4 right-4 z-30 p-2.5 rounded-full backdrop-blur-xl transition-all duration-400 overflow-visible"
          style={isSaved ? {
            background: `${gc.glow}30`,
            border:     `1px solid ${gc.color}70`,
            boxShadow:  `0 0 20px ${gc.glow}50`,
          } : {
            background: "rgba(0,0,0,0.55)",
            border:     "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <AnimatePresence mode="wait">
            {isSaved ? (
              <motion.div key="saved"
                initial={{ scale: 0.5, rotate: -20 }}
                animate={{ scale: 1,   rotate: 0   }}
                exit={{    scale: 0.5              }}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
              >
                <BookmarkCheck className="w-4 h-4" style={{ color: gc.color }} />
                <BookmarkBurst trigger={showBurst} color={gc.color} onDone={() => setShowBurst(false)} />
              </motion.div>
            ) : (
              <motion.div key="unsaved"
                initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}
              >
                <Bookmark className="w-4 h-4 text-white/50" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Espaciador — deja ver la portada antes de que empiece el contenido */}
        <div style={{ height: "46vh" }} />


        {/* ── CONTENIDO ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: coverOnly ? 0 : 1, y: 0 }}
          transition={{ delay: coverOnly ? 0 : 0.25, duration: coverOnly ? 0.35 : 0.5 }}
          style={{ pointerEvents: coverOnly ? "none" : "auto" }}
          className="px-5 sm:px-8 max-w-lg mx-auto mt-6 relative z-10 space-y-5"
        >
          {/* badge — clásico o género */}
          <div className="flex items-center gap-2 flex-wrap">
            {isClassic && (
              <span
                className="inline-block px-3 py-0.5 rounded-full text-[10px] tracking-[0.18em] uppercase font-medium font-sans"
                style={{
                  background:     "rgba(255,210,100,0.1)",
                  color:          "rgba(255,210,100,0.85)",
                  border:         "1px solid rgba(255,210,100,0.25)",
                  backdropFilter: "blur(8px)",
                }}
              >
                Dominio público
              </span>
            )}
            {book.genre && (
              <span
                className="inline-block px-3 py-0.5 rounded-full text-[10px] tracking-[0.18em] uppercase font-medium font-sans"
                style={{
                  background:     `${gc.glow}20`,
                  color:          gc.color,
                  border:         `1px solid ${gc.color}40`,
                  backdropFilter: "blur(8px)",
                }}
              >
                {t(gc.tKey)}
              </span>
            )}
          </div>

          {/* título y autor */}
          <div className="space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-white leading-tight tracking-wide"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,1)" }}>
              {book.title}
            </h1>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setLocation(`/author/${encodeURIComponent(book.author)}`)}
              className="flex items-center gap-2.5 mt-2"
            >
              {/* Avatar del autor (foto real + marco) */}
              <UserAvatar
                src={(book as any).authorAvatar || null}
                name={book.author}
                size={40}
                frame={(book as any).authorFrame || ""}
                accentColor={gc.color}
                className="flex-shrink-0"
              />
              <div className="text-left">
                <p className="text-sm font-sans font-medium"
                  style={{ color: "rgba(255,255,255,0.92)", textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
                  {book.author}
                </p>
                <p className="text-[10px] font-sans flex items-center gap-0.5" style={{ color: gc.color + "cc" }}>
                  {t("viewProfile")} <ChevronRight className="w-2.5 h-2.5" />
                </p>
              </div>
            </motion.button>
          </div>

          {/* meta */}
          {(chapterCount > 0 || timeRead) && (
            <div className="flex items-center gap-4">
              {!isClassic && numericId !== null && (book as any).authorId && (
                <HeartCount bookId={numericId} accentColor={gc.color} />
              )}
              {chapterCount > 0 && (
                <div className="flex items-center gap-1.5 text-zinc-600 text-xs font-sans">
                  <BookOpen className="w-3 h-3" />
                  <span>{chapterCount} {chapterCount === 1 ? t("chapter") : t("chapters")}</span>
                </div>
              )}
              {timeRead && (
                <div className="flex items-center gap-1.5 text-zinc-600 text-xs font-sans">
                  <Clock className="w-3 h-3" />
                  <span>{timeRead} de lectura</span>
                </div>
              )}
            </div>
          )}

        {/* sinopsis */}
          <p className="text-zinc-200 text-sm sm:text-[15px] leading-[1.85] font-sans"
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,1)" }}>
            {book.synopsis || "Sinopsis no disponible."}
          </p>

          {/* separador */}
          <div className="h-px w-16 rounded-full"
            style={{ background: `linear-gradient(to right, ${gc.color}50, transparent)` }} />

          {/* botones */}
          <div className="flex flex-col gap-3 pt-1 pb-6">

            {/* leer / retomar */}
            <motion.button
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.975 }}
              onClick={startReading}
              className="relative w-full py-4 rounded-2xl font-semibold text-sm tracking-wide font-sans overflow-hidden"
              style={isClassic ? {
                background: "linear-gradient(130deg, rgba(255,210,100,0.9), rgba(255,240,180,0.95))",
                color:      "#2a1f00",
                boxShadow:  "0 6px 28px rgba(255,180,0,0.35), 0 2px 8px rgba(0,0,0,0.3)",
              } : {
                background: `linear-gradient(130deg, ${gc.color}, white 160%)`,
                color:      "black",
                boxShadow:  `0 6px 28px ${gc.glow}55, 0 2px 8px rgba(0,0,0,0.3)`,
              }}
            >
              {/* shimmer */}
              <motion.div
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3.5 }}
                className="absolute inset-y-0 w-1/3 pointer-events-none"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)" }}
              />
              {hasSavedProgress ? t("resumeBook") : t("readBook")}
              {hasSavedProgress && readProgress > 0 && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-sans opacity-70">
                  {readProgress}%
                </span>
              )}
            </motion.button>

            {/* nota de dominio público para clásicos */}
            {isClassic && (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-[10px] font-sans uppercase tracking-widest"
                    style={{ color: "rgba(255,210,100,0.5)" }}>
                    {t("domainPublicShort")}
                  </span>
                  <InfoDot
                    text={`${t("domainPublic")} ${t("audioCtaText")}`}
                    color="rgba(255,210,100,0.6)"
                    size={13}
                  />
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={isDownloading}
                  onClick={() => setShowFormats(v => !v)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-sans"
                  style={{
                    background: isDownloading ? "rgba(255,210,100,0.05)" : "rgba(255,210,100,0.08)",
                    color:      isDownloading ? "rgba(255,210,100,0.3)" : "rgba(255,210,100,0.7)",
                    border:     "1px solid rgba(255,210,100,0.2)",
                  }}
                >
                  {isDownloading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Download className="w-3.5 h-3.5" />
                  }
                  {isDownloading ? `${t("searching")}...` : t("downloadPDF")}
                </motion.button>

                {showFormats && !isDownloading && (
                  <div className="space-y-1.5">
                    {([["a5", "pdfFormatBook"], ["letter", "pdfFormatHome"], ["booklet", "pdfFormatBooklet"], ["cover", "pdfFormatCover"]] as const).map(([f, k]) => (
                      <button
                        key={f}
                        onClick={() => { setShowFormats(false); downloadPDF(undefined, { format: f }) }}
                        className="w-full py-2.5 rounded-xl text-[11px] font-sans"
                        style={{
                          background: "rgba(255,210,100,0.05)",
                          color:      "rgba(255,210,100,0.65)",
                          border:     "1px solid rgba(255,210,100,0.15)",
                        }}
                      >
                        {t(k)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ejemplares físicos — solo obras de autores vivos del catálogo */}
            {!isClassic && numericId !== null && book.authorId && user && (
              <TokensPanel
                bookId={numericId}
                userId={user.id}
                accentColor={gc.color}
                accentGlow={gc.glow}
                isDownloading={isDownloading}
                onPrintCopy={(c, f) => downloadPDF(c, { format: f })}
                premiumUnlocked={isPremiumView}
              />
            )}

            {/* Tarjetas coleccionables de la obra */}
            {!isClassic && numericId !== null && book.authorId && (
              <CardsGallery
                bookId={numericId}
                accentColor={gc.color}
                accentGlow={gc.glow}
              />
            )}

            {/* editar — solo para el autor */}
            {isMine && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setLocation(`/editor?id=${id}&status=${isDraft ? "draft" : "published"}`)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-sans"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color:      "rgba(255,255,255,0.5)",
                  border:     "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
                {t("editStory")}
              </motion.button>
            )}

            {/* ── CONTROLES DE ADMINISTRADOR ── */}
            {showAdmin && numericId && (
              <div
                className="rounded-2xl p-3 space-y-2.5"
                style={{
                  background: "rgba(255,210,100,0.05)",
                  border:     "1px solid rgba(255,210,100,0.18)",
                }}
              >
                <div className="flex items-center gap-1.5 px-1">
                  <Shield className="w-3 h-3" style={{ color: "rgba(255,210,100,0.7)" }} />
                  <span className="text-[10px] tracking-[0.15em] uppercase font-sans"
                    style={{ color: "rgba(255,210,100,0.7)" }}>
                    Administrador
                  </span>
                  {bookStatus === "review" && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-sans"
                      style={{ background: "rgba(255,150,80,0.15)", color: "rgba(255,170,100,0.9)" }}>
                      En revisión
                    </span>
                  )}
                </div>

                {/* editar este libro (incluidos clásicos) */}
                {!isMine && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setLocation(`/editor?id=${numericId}&source=server`)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-sans"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      color:      "rgba(255,255,255,0.7)",
                      border:     "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar libro
                  </motion.button>
                )}

                {/* ocultar para revisión / restaurar */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={toggleVisibility}
                  disabled={savingVis}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-sans disabled:opacity-50"
                  style={bookStatus === "review" ? {
                    background: "rgba(120,220,140,0.1)",
                    color:      "rgba(150,230,170,0.9)",
                    border:     "1px solid rgba(120,220,140,0.25)",
                  } : {
                    background: "rgba(255,150,80,0.08)",
                    color:      "rgba(255,180,120,0.9)",
                    border:     "1px solid rgba(255,150,80,0.2)",
                  }}
                >
                  {savingVis
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : bookStatus === "review"
                      ? <Eye className="w-3.5 h-3.5" />
                      : <EyeOff className="w-3.5 h-3.5" />}
                  {bookStatus === "review" ? t("adminRestoreBtn") : t("adminHideBtn")}
                </motion.button>
              </div>
            )}

            {/* guardar */}
            <motion.button
              whileTap={{ scale: 0.975 }}
              onClick={toggleSave}
              className="w-full py-3.5 rounded-2xl text-sm font-sans transition-all duration-400"
              style={isSaved ? {
                background: isClassic ? "rgba(255,210,100,0.1)" : `${gc.glow}18`,
                color:      isClassic ? "rgba(255,210,100,0.8)" : gc.color,
                border:     isClassic ? "1px solid rgba(255,210,100,0.3)" : `1px solid ${gc.color}50`,
              } : {
                background: "rgba(255,255,255,0.05)",
                color:      "rgba(255,255,255,0.45)",
                border:     "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {isSaved ? t("savedBook") : t("saveBook")}
            </motion.button>
          </div>
        </motion.div>
      </div>

      {/* Modal: biblioteca gratuita llena */}
      <AnimatePresence>
        {showLibraryFull && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLibraryFull(false)}
            className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
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
    </Layout>
  )
}
