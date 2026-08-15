import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"
import CollectibleCard, { type CardData } from "@/components/CollectibleCard"
import { useSettings } from "@/context/SettingsContext"

interface Props {
  bookId:      number
  accentColor: string
  accentGlow:  string
}

// Galería de tarjetas de la obra. Las tuyas VIVEN (parallax); las que
// faltan muestran su método: apoyo ✦ o Tinta a precio visible. Sin azar.
export default function CardsGallery({ bookId, accentColor, accentGlow }: Props) {
  const { t } = useSettings()
  const queryClient = useQueryClient()

  const { data } = useQuery<{ cards: CardData[] }>({
    queryKey: ["/api/books/cards", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/books/${bookId}/cards`, { credentials: "include" })
      if (!res.ok) return { cards: [] }
      return res.json()
    },
  })

  const buy = useMutation({
    mutationFn: async (card: CardData) => {
      const res = await fetch(`/api/cards/${card.id}/buy`, {
        method: "POST", credentials: "include",
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        if (e.message === "tinta_insuficiente") {
          throw new Error(t("notEnoughTinta").replace("{n}", String(Math.max(0, (e.needed || 0) - (e.balance || 0)))))
        }
        throw new Error(e.message || "Error")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books/cards", bookId] })
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] })
    },
  })

  const cards = data?.cards || []
  if (cards.length === 0) return null
  const ownedCount = cards.filter(c => c.owned).length

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      className="rounded-2xl p-4 space-y-3"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${accentColor}25` }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-sans font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
          🃏 {t("cardsTitle")}
        </p>
        <span className="text-[10px] font-sans" style={{ color: accentColor }}>
          {t("cardsOwnedCount").replace("{a}", String(ownedCount)).replace("{b}", String(cards.length))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {cards.map(card => (
          <CollectibleCard
            key={card.id}
            card={card}
            accentColor={accentColor}
            accentGlow={accentGlow}
            onBuy={c => buy.mutate(c)}
            buying={buy.isPending}
          />
        ))}
      </div>

      {buy.isError && (
        <p className="text-[10px] font-sans" style={{ color: "#e8a0a0" }}>
          {(buy.error as Error)?.message}
        </p>
      )}
      {buy.isSuccess && (
        <p className="text-[10px] font-sans" style={{ color: accentColor }}>
          {t("cardGotIt")}
        </p>
      )}
    </motion.div>
  )
}
