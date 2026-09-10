import { Link } from "wouter"
import { motion } from "framer-motion"
import { BookOpen } from "lucide-react"
import { useState, useEffect } from "react"
import { GENRE_CONFIG, type Genre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"

interface BookCardProps {
  id:              number
  title:           string
  author:          string
  coverUrl?:       string
  genre?:          string
  isSaved?:        boolean
  isClassic?:      boolean
  publicationYear?: number
  type?:           string
}

// Color neutro para libros sin género asignado
const NEUTRAL_CFG = GENRE_CONFIG["todos"]

export function BookCard({ id, title, author, coverUrl, genre, isClassic, type }: BookCardProps) {
  const [imgFailed,     setImgFailed]     = useState(false)
  const [readProgress,  setReadProgress]  = useState(0)

  const gc     = genre ? (GENRE_CONFIG[genre as Genre] || NEUTRAL_CFG) : NEUTRAL_CFG
  const { t, settings }  = useSettings()
  const hasImg = !!coverUrl && !imgFailed

  // Leer progreso guardado en localStorage
  useEffect(() => {
    try {
      const savedChapter = Number(localStorage.getItem(`reading_chapter_${id}`) || 0)
      // No tenemos el total de capítulos aquí, pero si hay progreso lo marcamos
      if (savedChapter > 0) setReadProgress(Math.min(savedChapter * 12, 92))
    } catch {}
  }, [id])

  return (
      <motion.div
        whileHover={settings.reduceMotion ? undefined : { y: -3 }}
        whileTap={settings.reduceMotion ? undefined : { scale: 0.98 }}
        className="group flex flex-col gap-3"
      >
        <Link href={`/book/${id}`} aria-label={title} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200">
        {/* PORTADA */}
        <div
          className="relative aspect-[2/3] w-full rounded-lg overflow-hidden"
          style={{
            boxShadow: `0 16px 38px -12px ${gc.glow}55, 0 8px 24px #0009, 0 0 0 1px #ffffff18`,
          }}
        >
          {/* imagen */}
          {hasImg && (
            <img
              src={coverUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.025]"
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setImgFailed(true)}
            />
          )}

          {/* fallback */}
          {!hasImg && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-3"
              style={{
                background: `linear-gradient(150deg, ${gc.bg}, rgba(0,0,0,0.85))`,
                borderTop:  `2px solid ${gc.color}40`,
              }}
            >
              <BookOpen className="w-5 h-5 shrink-0" style={{ color: gc.color + "60" }} />
              <span
                className="text-[9px] tracking-widest uppercase text-center leading-relaxed line-clamp-3 font-sans"
                style={{ color: gc.color + "50" }}
              >
                {title}
              </span>
            </div>
          )}

          {/* overlay gradiente */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent z-10" />

          {/* badge de clásico — etiqueta dorada sutil */}
          {isClassic && (
            <div
              className="absolute top-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest font-sans"
              style={{
                background: "rgba(0,0,0,0.75)",
                color:      "rgba(255,210,100,0.85)",
                border:     "1px solid rgba(255,210,100,0.25)",
                backdropFilter: "blur(4px)",
              }}
            >
              {t("classicBadge")}
            </div>
          )}

          {/* badge de tipo — relato/saga en esquina */}
          {type === "story" && (
            <div
              className="absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest font-sans"
              style={{
                background:     "rgba(0,0,0,0.7)",
                color:          "rgba(255,255,255,0.4)",
                backdropFilter: "blur(4px)",
              }}
            >
              {t("storyBadge")}
            </div>
          )}
          {type === "saga" && (
            <div
              className="absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest font-sans"
              style={{
                background:     "rgba(0,0,0,0.7)",
                color:          "rgba(180,160,255,0.6)",
                backdropFilter: "blur(4px)",
              }}
            >
              {t("sagaBadge")}
            </div>
          )}

          {/* barra de progreso de lectura — siempre visible si hay progreso */}
          {readProgress > 0 && (
            <div
              className="absolute bottom-0 left-0 right-0 h-[3px] z-20"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${readProgress}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{
                  background: `linear-gradient(90deg, ${gc.color}99, ${gc.color})`,
                  boxShadow:  `0 0 6px ${gc.glow}80`,
                }}
              />
            </div>
          )}

          {/* línea de género al hover */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-[2px] z-20"
            initial={{ opacity: 0 }}
            whileHover={{ opacity: readProgress > 0 ? 0 : 1 }}
            transition={{ duration: 0.3 }}
            style={{ background: `linear-gradient(90deg, transparent, ${gc.color}cc, transparent)` }}
          />

          {/* glow al hover */}
          <motion.div
            className="absolute inset-0 z-10"
            initial={{ opacity: 0 }}
            whileHover={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            style={{ background: `radial-gradient(ellipse at bottom, ${gc.glow}20, transparent 70%)` }}
          />
        </div>
        </Link>

        {/* TEXTO */}
        <div className="px-0.5 space-y-0.5">
          <Link href={`/book/${id}`} tabIndex={-1}>
          <h3 className="font-display font-bold text-white/90 text-sm leading-snug line-clamp-2 group-hover:text-white transition-colors duration-200">
            {title}
          </h3>
          </Link>
          <Link href={`/author/${encodeURIComponent(author)}`}
            className="block text-xs leading-6 text-zinc-400 hover:text-zinc-200 line-clamp-1 font-sans text-left transition-colors duration-200 w-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-200"
          >
            {author}
          </Link>
        </div>
      </motion.div>
  )
}
