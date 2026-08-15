import { motion, AnimatePresence } from "framer-motion"
import { X, BookOpen, Flame, Clock, Star, TrendingUp, Zap } from "lucide-react"
import { useGenre, GENRE_CONFIG, type Genre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { useState, useMemo, useEffect } from "react"
import { useLocation } from "wouter"
import { useBooks } from "@/hooks/use-books"

interface Props {
  open:    boolean
  onClose: () => void
}

// ── RACHA DE LECTURA ─────────────────────────────────────
function getStreak(): number {
  try {
    const raw = localStorage.getItem("novareads_streak")
    if (!raw) return 0
    const { days, lastDate } = JSON.parse(raw)
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    if (lastDate === today || lastDate === yesterday) return days
    return 0
  } catch { return 0 }
}

function updateStreak(): number {
  try {
    const today = new Date().toDateString()
    const raw   = localStorage.getItem("novareads_streak")
    if (!raw) {
      const streak = { days: 1, lastDate: today }
      localStorage.setItem("novareads_streak", JSON.stringify(streak))
      return 1
    }
    const { days, lastDate } = JSON.parse(raw)
    if (lastDate === today) return days

    const yesterday = new Date(Date.now() - 86400000).toDateString()
    const newDays = lastDate === yesterday ? days + 1 : 1
    localStorage.setItem("novareads_streak", JSON.stringify({ days: newDays, lastDate: today }))
    return newDays
  } catch { return 0 }
}

// ── ESTADÍSTICAS ─────────────────────────────────────────
function getReadingStats(apiBooks: any[]) {
  const authored = JSON.parse(localStorage.getItem("novareads_authored") || "[]")
  const saved    = JSON.parse(localStorage.getItem("novareads_saved")    || "[]")

  // Combinar local + API sin duplicados
  const seenIds = new Set<string>()
  const allBooks = [...authored, ...saved, ...apiBooks].filter((b: any) => {
    const k = String(b.id)
    if (seenIds.has(k)) return false
    seenIds.add(k); return true
  })

  // Géneros
  const genreCounts: Record<string, number> = {}
  allBooks.forEach((b: any) => {
    if (b.genre) genreCounts[b.genre] = (genreCounts[b.genre] || 0) + 1
  })
  const topGenre = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] as Genre | undefined

  // Capítulos con progreso
  const chaptersRead = Object.keys(localStorage)
    .filter(k => k.startsWith("reading_chapter_"))
    .map(k => Number(localStorage.getItem(k) || 0))
    .filter(n => n > 0).length

  const savedCount     = saved.length
  const publishedCount = authored.filter((b: any) => b.status === "published").length
  const classicsCount  = allBooks.filter((b: any) => b.isClassic).length
  const totalBooks     = allBooks.length

  return { topGenre, chaptersRead, savedCount, publishedCount, classicsCount, totalBooks }
}

// ── TARJETA ESTADÍSTICA ───────────────────────────────────
function StatCard({ icon: Icon, value, label, color }: {
  icon: any; value: string | number; label: string; color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color }} />
      <span className="text-xl font-bold font-display" style={{ color }}>{value}</span>
      <span className="text-[10px] text-zinc-600 font-sans text-center leading-tight">{label}</span>
    </motion.div>
  )
}

// ── TARJETA LIBRO ─────────────────────────────────────────
function BookCard({ book, onClose }: { book: any; onClose: () => void }) {
  const [, setLocation] = useLocation()
  const { t }           = useSettings()
  const gc              = GENRE_CONFIG[(book.genre as Genre) || "todos"]
  return (
    <motion.button
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => { setLocation(`/book/${book.id}`); onClose() }}
      className="w-full flex items-center gap-3 p-3 rounded-2xl text-left"
      style={{ background: `linear-gradient(135deg, ${gc.bg}, rgba(0,0,0,0.6))`, border: `1px solid ${gc.color}25` }}
    >
      <div className="shrink-0 rounded-lg overflow-hidden shadow-lg" style={{ width: 44, aspectRatio: "2/3" }}>
        {book.coverUrl
          ? <img loading="lazy" src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center" style={{ background: gc.bg }}>
              <BookOpen className="w-4 h-4" style={{ color: gc.color + "60" }} />
            </div>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-sans mb-0.5" style={{ color: gc.color + "88" }}>
          {t(gc.tKey)}
        </p>
        <p className="text-white text-sm font-medium font-sans line-clamp-1">{book.title}</p>
        <p className="text-zinc-500 text-xs font-sans">{book.author}</p>
      </div>
      <Star className="w-3.5 h-3.5 shrink-0" style={{ color: gc.color + "60" }} />
    </motion.button>
  )
}

// ── PANEL PRINCIPAL ───────────────────────────────────────
export default function PulsoPanel({ open, onClose }: Props) {
  const { cfg }   = useGenre()
  const { t }     = useSettings()
  const [, setLocation] = useLocation()
  const { data: apiBooks } = useBooks()

  const [streak, setStreak] = useState(0)

  useEffect(() => {
    if (open) setStreak(updateStreak())
    else       setStreak(getStreak())
  }, [open])

  const stats = useMemo(
    () => getReadingStats(apiBooks || []),
    [open, apiBooks]
  )

  // Guardar libros API en sessionStorage para que goToRandomBook los encuentre
  useEffect(() => {
    if (apiBooks?.length) {
      try {
        sessionStorage.setItem("novareads_api_books", JSON.stringify(apiBooks))
      } catch {}
    }
  }, [apiBooks])

  const discoveries = useMemo(() => {
    const authored = JSON.parse(localStorage.getItem("novareads_authored") || "[]")
    const saved    = JSON.parse(localStorage.getItem("novareads_saved")    || "[]")
    const api      = apiBooks || []
    const seen = new Set<string>()
    return [...authored, ...saved, ...api]
      .filter((b: any) => { const k = String(b.id); if (seen.has(k)) return false; seen.add(k); return true })
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
  }, [open, apiBooks])

  const topGenreCfg = stats.topGenre ? GENRE_CONFIG[stats.topGenre] : null

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200]"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
            onClick={onClose}
          />

          <motion.div
            initial={{ y: "100%", opacity: 0.8 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="fixed bottom-0 left-0 right-0 z-[210] rounded-t-3xl overflow-hidden"
            style={{
              background:   "rgba(8,8,12,0.98)",
              border:       `1px solid ${cfg.color}20`,
              borderBottom: "none",
              boxShadow:    `0 -8px 64px rgba(0,0,0,0.8)`,
              maxHeight:    "85vh",
            }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            <div className="flex items-center justify-between px-5 py-3">
              <div>
                <h2 className="text-base font-display font-bold text-white tracking-wide">
                  Tu Pulso
                </h2>
                <p className="text-[11px] text-zinc-600 font-sans mt-0.5">
                  Tu actividad en Tloque
                </p>
              </div>
              <motion.button whileTap={{ scale: 0.9 }} onClick={onClose}
                className="p-2 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <X className="w-4 h-4 text-zinc-400" />
              </motion.button>
            </div>

            <div className="overflow-y-auto px-5 space-y-6 pb-36"
              style={{ maxHeight: "calc(85vh - 80px)" }}>

              {stats.totalBooks === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                  <div className="relative w-24 h-24">
                    {[...Array(6)].map((_, i) => (
                      <motion.div key={i} className="absolute w-1.5 h-1.5 rounded-full"
                        style={{ background: cfg.color,
                          top:  `${50 + 38 * Math.sin((Math.PI * 2 * i) / 6)}%`,
                          left: `${50 + 38 * Math.cos((Math.PI * 2 * i) / 6)}%` }}
                        animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.8, 1.2, 0.8] }}
                        transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.4 }} />
                    ))}
                  </div>
                  <p className="text-zinc-400 text-sm font-sans">{t("universeQuote")}</p>
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => { setLocation("/"); onClose() }}
                    className="px-5 py-2.5 rounded-xl text-xs font-sans"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}>
                    Explorar historias
                  </motion.button>
                </motion.div>
              ) : (
                <>
                  {/* ── RACHA ── */}
                  {streak > 0 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-4 rounded-2xl"
                      style={{
                        background: "linear-gradient(135deg, rgba(255,160,50,0.12), rgba(0,0,0,0.6))",
                        border:     "1px solid rgba(255,160,50,0.3)",
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <motion.div
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="shrink-0"
                        >
                          <Zap className="w-6 h-6" style={{ color: "#ffa032" }} />
                        </motion.div>
                        <div>
                          <p className="font-display font-bold text-white text-lg leading-none">
                            {streak}
                            <span className="text-sm font-sans font-normal text-zinc-400 ml-1.5">
                              {streak === 1 ? t("consecutiveDays").replace("s","") : t("readingStreak")}
                            </span>
                          </p>
                          <p className="text-xs font-sans mt-0.5" style={{ color: "rgba(255,160,50,0.7)" }}>
                            {streak >= 7 ? t("newStreak") : streak >= 3 ? t("streakMessage") : t("streakMessage")}
                          </p>
                        </div>
                        {streak >= 3 && (
                          <div className="ml-auto flex gap-0.5">
                            {Array.from({ length: Math.min(streak, 7) }, (_, i) => (
                              <div key={i} className="w-1.5 h-4 rounded-full"
                                style={{ background: i < streak ? "#ffa032" : "rgba(255,160,50,0.2)" }} />
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* ── ESTADÍSTICAS ── */}
                  <div>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans mb-3">
                      {t("yourActivity")}
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <StatCard icon={BookOpen}    value={stats.savedCount}     label={t("saveBook")} color={cfg.color} />
                      <StatCard icon={Flame}        value={stats.chaptersRead}   label={t("readingStreak")} color="#ff9966" />
                      <StatCard icon={TrendingUp}   value={stats.publishedCount} label={t("published")} color="#90ee90" />
                      <StatCard icon={Star}         value={stats.classicsCount}  label={t("classicBadge")} color="rgba(255,210,100,0.8)" />
                    </div>
                  </div>

                  {/* ── GÉNERO ── */}
                  {topGenreCfg && stats.topGenre && (
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans mb-3">
                        Tu género
                      </p>
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-4 rounded-2xl"
                        style={{ background: `linear-gradient(135deg, ${topGenreCfg.bg}, rgba(0,0,0,0.7))`, border: `1px solid ${topGenreCfg.color}35` }}
                      >
                        <div className="flex items-center gap-3">
                          <motion.div
                            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                            transition={{ duration: 3, repeat: Infinity }}
                            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: `radial-gradient(circle, ${topGenreCfg.glow}60, transparent)` }}
                          >
                            <span className="text-lg">✦</span>
                          </motion.div>
                          <div>
                            <p className="text-white text-sm font-medium font-sans">{t(topGenreCfg.tKey)}</p>
                            <p className="text-xs font-sans mt-0.5" style={{ color: topGenreCfg.color + "88" }}>
                              Tu género más explorado
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}

                  {/* ── SEÑALES — ahora con datos reales ── */}
                  <div>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans mb-3">
                      {t("signals")}
                    </p>
                    <div className="space-y-2">
                      {[
                        {
                          text: `${stats.totalBooks} ${stats.totalBooks === 1
                            ? t("chapter") : t("chapters")} ${t("inLibrary") || "en el catálogo"}`,
                          dot: cfg.color
                        },
                        stats.classicsCount > 0 && {
                          text: `${stats.classicsCount} ${t("classicBadge")}${stats.classicsCount !== 1 ? "s" : ""} · ${t("publicDomain")}`,
                          dot: "rgba(255,210,100,0.8)"
                        },
                        stats.chaptersRead > 0 && {
                          text: `${stats.chaptersRead} ${t("chapters")} ${t("readBook").toLowerCase()}`,
                          dot: "#90ee90"
                        },
                      ].filter(Boolean).map((signal: any, i) => (
                        <motion.div key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.08 }}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                        >
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: signal.dot }}
                            animate={{ opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 2 + i * 0.3, repeat: Infinity }}
                          />
                          <p className="text-xs text-zinc-400 font-sans">{signal.text}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* ── PARA EXPLORAR ── */}
                  {discoveries.length > 0 && (
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans mb-3">
                        Para explorar
                      </p>
                      <div className="space-y-2">
                        {discoveries.map(book => (
                          <BookCard key={book.id} book={book} onClose={onClose} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── RETOMAR ── */}
                  {localStorage.getItem("lastReading") && (
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans mb-3">
                        Retomar
                      </p>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          const last = localStorage.getItem("lastReading")
                          if (last) { setLocation(last); onClose() }
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                        style={{ background: `linear-gradient(135deg, ${cfg.bg}, rgba(0,0,0,0.6))`, border: `1px solid ${cfg.color}35` }}
                      >
                        <Clock className="w-4 h-4 shrink-0" style={{ color: cfg.color }} />
                        <span className="text-sm font-sans" style={{ color: cfg.color + "cc" }}>
                          Continuar lectura anterior
                        </span>
                        <span className="ml-auto text-zinc-600 text-xs font-sans">→</span>
                      </motion.button>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
