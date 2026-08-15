import { useState } from "react"
import { motion } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Printer, Eye, EyeOff, Heart, Store, BadgeCheck, CircleDashed, UserCheck, Droplets, CreditCard } from "lucide-react"
import WalletPanel from "@/components/WalletPanel"
import { useSettings } from "@/context/SettingsContext"

interface Copy {
  id: number; folio: string; claimKey: string
  claimedByUserId: number | null
}
interface TokenWithCopies {
  id: number; kind: "support" | "sale"; copies: Copy[]
}

interface Props {
  bookId:      number
  userId:      number
  accentColor: string
  accentGlow:  string
  isDownloading: boolean
  onPrintCopy: (copy: { folio: string; key: string }, format: "a5" | "letter" | "booklet" | "cover") => void
  premiumUnlocked?: boolean
}

export default function TokensPanel({ bookId, userId, accentColor, accentGlow, isDownloading, onPrintCopy, premiumUnlocked }: Props) {
  const { t } = useSettings()
  const queryClient = useQueryClient()
  const [showKeys, setShowKeys] = useState(false)
  const [printMenuFor, setPrintMenuFor] = useState<number | null>(null)
  const [payMenu, setPayMenu] = useState<"support" | "sale" | null>(null)
  const [showWallet, setShowWallet] = useState(false)

  const { data } = useQuery<{ tokens: TokenWithCopies[] }>({
    queryKey: [`/api/tokens/mine`, bookId],
    queryFn: async () => {
      const res = await fetch(`/api/tokens/mine?bookId=${bookId}`, { credentials: "include" })
      if (!res.ok) return { tokens: [] }
      return res.json()
    },
  })

  // Configuración de pagos: si Stripe está activo, mostrar precios reales
  const { data: payCfg } = useQuery<{ enabled: boolean; prices: Record<string, { cents: number; currency: string; tinta: number }> }>({
    queryKey: ["/api/payments/config", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/config?bookId=${bookId}`)
      if (!res.ok) return { enabled: false, prices: {} as any }
      return res.json()
    },
    staleTime: 60_000,
  })

  // Saldo de Tinta del lector
  const { data: wallet } = useQuery<{ tinta: number; papel: number }>({
    queryKey: ["/api/wallet"],
    queryFn: async () => {
      const res = await fetch("/api/wallet", { credentials: "include" })
      if (!res.ok) return { tinta: 0, papel: 0 }
      return res.json()
    },
  })
  const myTinta = wallet?.tinta ?? 0
  const payOn = !!payCfg?.enabled
  const priceOf = (kind: "support" | "sale") => {
    const p = payCfg?.prices?.[kind]
    if (!p) return ""
    const money = payOn ? `$${(p.cents / 100).toFixed(0)}` : ""
    return ` · ${money}${money && p.tinta ? " · " : ""}${p.tinta ? `${p.tinta} 🪙` : ""}`
  }
  const tintaOf = (kind: "support" | "sale") => payCfg?.prices?.[kind]?.tinta ?? 10

  const acquire = useMutation({
    mutationFn: async ({ kind, payWith }: { kind: "support" | "sale"; payWith: "money" | "tinta" }) => {
      const res = await fetch("/api/tokens/acquire", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ bookId, kind, payWith }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message || "Error")
      }
      return res.json()
    },
    onSuccess: (data: any) => {
      // Con pagos activos: llevar al checkout seguro de Stripe
      if (data?.mode === "checkout" && data?.url) {
        window.location.href = data.url
        return
      }
      queryClient.invalidateQueries({ queryKey: [`/api/tokens/mine`, bookId] })
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] })
      setPayMenu(null)
      // Refrescar desbloqueados (el apoyo desbloquea la obra)
      fetch("/api/tokens/unlocked", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && localStorage.setItem("novareads_unlocked", JSON.stringify((d.bookIds || []).map(String))))
        .catch(() => {})
    },
  })

  // Opciones de método de pago para un tipo de token
  function PayOptions({ kind }: { kind: "support" | "sale" }) {
    const need = tintaOf(kind)
    const enough = myTinta >= need
    const p = payCfg?.prices?.[kind]
    return (
      <div className="grid grid-cols-2 gap-1.5">
        <button
          disabled={acquire.isPending}
          onClick={() => acquire.mutate({ kind, payWith: "money" })}
          className="flex items-center justify-center gap-1.5 text-[10px] font-sans px-2 py-2.5 rounded-lg disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <CreditCard className="w-3 h-3" />
          {payOn ? `${t("payWithCard")} · $${((p?.cents ?? 0) / 100).toFixed(0)}` : t("tokenBeta").split("·")[0].trim()}
        </button>
        <button
          disabled={acquire.isPending || !enough}
          onClick={() => enough ? acquire.mutate({ kind, payWith: "tinta" }) : setShowWallet(true)}
          className="flex items-center justify-center gap-1.5 text-[10px] font-sans px-2 py-2.5 rounded-lg disabled:opacity-40"
          style={{ background: `${accentGlow}15`, color: accentColor, border: `1px solid ${accentColor}35` }}
        >
          <Droplets className="w-3 h-3" />
          {enough ? `${t("payWithTinta")} · ${need} 🪙` : t("notEnoughTinta").replace("{n}", String(need - myTinta))}
        </button>
      </div>
    )
  }

  const tokens     = data?.tokens || []
  const hasSupport = tokens.some(tk => tk.kind === "support")
  const allCopies: { copy: Copy; kind: string }[] = []
  for (const tk of tokens) for (const c of tk.copies) allCopies.push({ copy: c, kind: tk.kind })

  return (
    <div className="rounded-2xl p-4 space-y-3"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${accentColor}25` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-sans font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
          {t("tokensTitle")}
        </p>
        <button onClick={() => setShowWallet(true)}
          className="flex items-center gap-1.5 text-[10px] font-sans px-2.5 py-1 rounded-full"
          style={{ background: `${accentGlow}15`, color: accentColor, border: `1px solid ${accentColor}30` }}>
          <Droplets className="w-3 h-3" /> {myTinta} · {t("getTinta")}
        </button>
      </div>
      {!payOn && (
        <p className="text-[9px] font-sans -mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
          {t("tokenBeta")}
        </p>
      )}
      {premiumUnlocked && (
        <p className="text-[10px] font-sans flex items-center gap-1" style={{ color: accentColor }}>
          ✦ {t("premiumUnlockedNote")}
        </p>
      )}

      {/* Adquirir */}
      <div className="space-y-2">
        {!hasSupport && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={acquire.isPending}
            onClick={() => setPayMenu(payMenu === "support" ? null : "support")}
            className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left disabled:opacity-50"
            style={{ background: `${accentGlow}14`, border: `1px solid ${accentColor}35` }}
          >
            <Heart className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            <div className="min-w-0">
              <p className="text-xs font-sans font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                {t("tokenSupportBtn")}{priceOf("support")}
              </p>
              <p className="text-[10px] font-sans leading-snug mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                {t("tokenSupportDesc")}
              </p>
            </div>
          </motion.button>
        )}
        {payMenu === "support" && !hasSupport && (
          <PayOptions kind="support" />
        )}
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={acquire.isPending}
          onClick={() => setPayMenu(payMenu === "sale" ? null : "sale")}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <Store className="w-4 h-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.6)" }} />
          <div className="min-w-0">
            <p className="text-xs font-sans font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
              {t("tokenSaleBtn")}{priceOf("sale")}
            </p>
            <p className="text-[10px] font-sans leading-snug mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
              {t("tokenSaleDesc")}
            </p>
          </div>
        </motion.button>
        {payMenu === "sale" && (
          <PayOptions kind="sale" />
        )}
        {acquire.isError && (
          <p className="text-[10px] font-sans px-1" style={{ color: "#e8a0a0" }}>
            {(acquire.error as Error)?.message === "tinta_insuficiente"
              ? t("notEnoughTinta").replace("{n}", String(Math.max(0, tintaOf(payMenu || "sale") - myTinta)))
              : (acquire.error as Error)?.message}
          </p>
        )}
      </div>

      {/* Ejemplares */}
      {allCopies.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] font-sans" style={{ color: "rgba(255,255,255,0.45)" }}>
              {allCopies.length} · {t("tokensTitle").toLowerCase()}
            </p>
            <button onClick={() => setShowKeys(v => !v)}
              className="flex items-center gap-1 text-[10px] font-sans"
              style={{ color: "rgba(255,255,255,0.5)" }}>
              {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {t("tokenKeyShow")}
            </button>
          </div>
          {allCopies.map(({ copy, kind }) => {
            const isMineClaim = copy.claimedByUserId === userId
            const isFree      = !copy.claimedByUserId
            const menuOpen    = printMenuFor === copy.id
            return (
              <div key={copy.id} className="rounded-xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-shrink-0">
                    {isMineClaim
                      ? <UserCheck className="w-3.5 h-3.5" style={{ color: "rgba(120,220,160,0.9)" }} />
                      : isFree
                        ? <CircleDashed className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                        : <BadgeCheck className="w-3.5 h-3.5" style={{ color: accentColor }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-mono truncate" style={{ color: "rgba(255,255,255,0.8)" }}>
                      {copy.folio}
                      {kind === "sale" && <span className="ml-1.5 text-[8px] font-sans" style={{ color: accentColor + "aa" }}>venta</span>}
                    </p>
                    <p className="text-[9px] font-sans" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {isMineClaim ? t("tokenYourCopy") : isFree ? t("tokenFreeCopy") : t("tokenClaimedCopy")}
                      {showKeys && <span className="font-mono ml-2" style={{ color: "rgba(201,168,87,0.8)" }}>{copy.claimKey}</span>}
                    </p>
                  </div>
                  <button
                    disabled={isDownloading}
                    onClick={() => setPrintMenuFor(menuOpen ? null : copy.id)}
                    className="flex items-center gap-1 text-[10px] font-sans px-2.5 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-40"
                    style={{ background: `${accentGlow}15`, color: accentColor, border: `1px solid ${accentColor}30` }}
                  >
                    {isDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                    {t("tokenPdfBtn")}
                  </button>
                </div>
                {/* Menú de formato */}
                {menuOpen && (
                  <div className="grid grid-cols-2 gap-1.5 px-3 pb-2.5">
                    {([["a5", "pdfFormatBook"], ["letter", "pdfFormatHome"], ["booklet", "pdfFormatBooklet"], ["cover", "pdfFormatCover"]] as const).map(([f, k]) => (
                      <button
                        key={f}
                        disabled={isDownloading}
                        onClick={() => { setPrintMenuFor(null); onPrintCopy({ folio: copy.folio, key: copy.claimKey }, f) }}
                        className="text-[10px] font-sans px-2 py-2 rounded-lg disabled:opacity-40"
                        style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.1)" }}
                      >
                        {t(k)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <WalletPanel open={showWallet} onClose={() => setShowWallet(false)}
        accentColor={accentColor} accentGlow={accentGlow} />
    </div>
  )
}
