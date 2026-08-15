import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Sparkles, X, Library as LibraryIcon } from "lucide-react"
import { useLocation } from "wouter"
import CollectibleCard, { type CardData } from "@/components/CollectibleCard"
import { useSettings } from "@/context/SettingsContext"
import { useGenre } from "@/context/GenreContext"

interface Group {
  bookId:    number
  bookTitle: string
  author:    string
  cards:     CardData[]
}

// El álbum del coleccionista: sus tarjetas vivas, agrupadas por obra.
// Tocar una la amplía a pantalla para admirarla en grande.
export default function CardCollection() {
  const { t } = useSettings()
  const { cfg } = useGenre()
  const [, setLocation] = useLocation()

  const { data, isLoading } = useQuery<{ groups: Group[]; total: number }>({
    queryKey: ["/api/cards/collection"],
    queryFn: async () => {
      const res = await fetch("/api/cards/collection", { credentials: "include" })
      if (!res.ok) return { groups: [], total: 0 }
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: cfg.color + "88" }} />
      </div>
    )
  }

  const groups = data?.groups || []
  const total = data?.total || 0

  // Estado vacío — invitación cálida, no un muro frío
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
        <div className="p-4 rounded-full mb-4"
          style={{ background: `${cfg.glow}12`, border: `1px solid ${cfg.color}25` }}>
          <Sparkles className="w-6 h-6" style={{ color: cfg.color }} />
        </div>
        <p className="text-sm font-display font-semibold text-white mb-1">
          {t("collectionEmptyTitle")}
        </p>
        <p className="text-[11px] font-sans leading-relaxed max-w-[240px]"
          style={{ color: "rgba(255,255,255,0.45)" }}>
          {t("collectionEmptyBody")}
        </p>
      </div>
    )
  }

  return (
    <div className="pb-8">
      {/* Encabezado con progreso total */}
      <div className="flex items-center justify-between px-1 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: cfg.color }} />
          <p className="text-sm font-display font-semibold text-white">
            {t("collectionTitle")}
          </p>
        </div>
        <span className="text-[11px] font-sans px-2.5 py-1 rounded-full"
          style={{ background: `${cfg.glow}15`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
          {t("collectionTotal").replace("{n}", String(total))}
        </span>
      </div>

      {/* Grupos por obra */}
      <div className="space-y-6">
        {groups.map(group => (
          <div key={group.bookId}>
            <button
              onClick={() => setLocation(`/book/${group.bookId}`)}
              className="flex items-center gap-1.5 mb-2.5 px-1 group"
            >
              <LibraryIcon className="w-3 h-3" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span className="text-[11px] font-sans font-semibold text-left"
                style={{ color: "rgba(255,255,255,0.7)" }}>
                {group.bookTitle}
              </span>
              <span className="text-[10px] font-sans" style={{ color: cfg.color + "99" }}>
                · {group.cards.length}
              </span>
            </button>
            <div className="grid grid-cols-3 gap-2.5">
              {group.cards.map(card => (
                <motion.div key={card.id} whileTap={{ scale: 0.96 }}>
                  <CollectibleCard
                    card={card}
                    accentColor={cfg.color}
                    accentGlow={cfg.glow}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* El visor ahora es global: tocar cualquier tarjeta lo abre. */}
    </div>
  )
}
