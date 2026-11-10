import { useState } from "react"
import AccessibleDialog from "./AccessibleDialog"
import QueryNotice from "./QueryNotice"
import { displayTinta } from "@shared/tinta"
import { money } from "@shared/commerce"
import { accountFetch as fetch } from "@/lib/account-context"
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
  const [selected, setSelected] = useState<CardData | null>(null)
  const [acceptedHash, setAcceptedHash] = useState("")
  const quote = useQuery<any>({
    queryKey: ["/api/cards/quote", selected?.id], enabled: !!selected, staleTime: 0,
    queryFn: async () => {
      const response = await fetch(`/api/cards/${selected!.id}/quote`, { credentials: "include", cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || "No se pudo preparar la compra")
      return data
    },
  })

  const { data } = useQuery<{ cards: CardData[] }>({
    queryKey: ["/api/books/cards", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/books/${bookId}/cards`, { credentials: "include" })
      if (!res.ok) throw new Error("No se pudieron cargar las tarjetas")
      return res.json()
    },
  })

  const buy = useMutation({
    mutationFn: async (card: CardData) => {
      const res = await fetch(`/api/cards/${card.id}/buy`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptance: { accepted: acceptedHash === quote.data?.hash,
          documentHash: quote.data?.documentHash, quoteHash: quote.data?.hash } }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        if (e.message === "tinta_insuficiente") {
          throw new Error(t("notEnoughTinta").replace("{n}", String(Math.max(0, (e.needed || 0) - (e.balance || 0)))))
        }
        if (res.status === 409) { setAcceptedHash(""); void quote.refetch() }
        throw new Error(e.message || "Error")
      }
      return res.json()
    },
    onSuccess: () => {
      setSelected(null); setAcceptedHash("")
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
        <span className="text-xs font-sans" style={{ color: accentColor }}>
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
            onBuy={c => { buy.reset(); setAcceptedHash(""); setSelected(c) }}
            buying={buy.isPending}
          />
        ))}
      </div>

      <AccessibleDialog open={!!selected} onClose={() => { if (!buy.isPending) setSelected(null) }} title="Confirmar compra de tarjeta" className="max-w-md" style={{ background: "#121218" }}>
        <div className="min-h-0 overflow-y-auto p-5 space-y-4">
          <h2 className="text-lg text-white">{selected?.name}</h2>
          <QueryNotice loading={quote.isPending} error={quote.isError} onRetry={() => { void quote.refetch() }} />
          {quote.data && <>
            <p className="text-sm text-white/80">Incluye la tarjeta y la edición digital permanente de «{quote.data.bookTitle}», con descarga autorizada. No añade folios de impresión.</p>
            <p className="text-sm text-white">Precio: {displayTinta(quote.data.economics.units)} Tintas.</p>
            <p className="text-xs text-white/70">Del efectivo atribuido a este gasto: {money(quote.data.economics.authorCents)} para el titular y {money(quote.data.economics.platformCents)} para Tloque.</p>
            {quote.data.documents?.filter((document: any) => ["terms", "tokens"].includes(document.id)).map((document: any) => <details key={document.id} className="text-xs text-white/70"><summary>{document.title}</summary><p className="mt-2 whitespace-pre-line leading-6">{document.text}</p></details>)}
            <label className="flex min-h-11 items-start gap-3 text-sm text-white/80"><input type="checkbox" checked={acceptedHash === quote.data.hash} onChange={event => setAcceptedHash(event.target.checked ? quote.data.hash : "")} />Leí y acepto el precio, los beneficios y las condiciones de esta compra.</label>
            {!quote.data.canPay && <p role="status" className="text-sm text-amber-200">No tienes suficiente Tinta para esta tarjeta.</p>}
          </>}
          {buy.isError && <p role="alert" className="text-sm text-red-200">{buy.error.message}</p>}
          <div className="flex flex-wrap gap-3"><button className="min-h-11 rounded-xl border border-white/25 px-4 text-white" onClick={() => setSelected(null)} disabled={buy.isPending}>Volver</button><button className="min-h-11 rounded-xl bg-amber-200 px-4 text-black disabled:opacity-40" disabled={!selected || !quote.data?.canPay || quote.isFetching || quote.isError || acceptedHash !== quote.data?.hash || buy.isPending} onClick={() => selected && buy.mutate(selected)}>{buy.isPending ? "Confirmando…" : "Confirmar compra"}</button></div>
        </div>
      </AccessibleDialog>
      {buy.isError && (
        <p className="text-xs font-sans" style={{ color: "#e8a0a0" }}>
          {(buy.error as Error)?.message}
        </p>
      )}
      {buy.isSuccess && (
        <p className="text-xs font-sans" style={{ color: accentColor }}>
          {t("cardGotIt")}
        </p>
      )}
    </motion.div>
  )
}
