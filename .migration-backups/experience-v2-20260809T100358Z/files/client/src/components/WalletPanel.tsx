import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X, Loader2, Sparkles, Droplets, ScrollText, BadgeCheck } from "lucide-react"
import InfoDot from "@/components/InfoDot"
import { useSettings } from "@/context/SettingsContext"

interface Pack { id: string; tinta: number; cents: number }

interface Props {
  open:        boolean
  onClose:     () => void
  accentColor: string
  accentGlow:  string
}

// El monedero de Tloque: Tinta 🪙 para apoyar historias con un toque,
// y Papel 📄 (latente) para el Oráculo y los audiolibros del futuro.
export default function WalletPanel({ open, onClose, accentColor, accentGlow }: Props) {
  const { t } = useSettings()
  const queryClient = useQueryClient()
  const [credited, setCredited] = useState<number | null>(null)

  const { data: wallet } = useQuery<{ tinta: number; papel: number }>({
    queryKey: ["/api/wallet"],
    queryFn: async () => {
      const res = await fetch("/api/wallet", { credentials: "include" })
      if (!res.ok) return { tinta: 0, papel: 0 }
      return res.json()
    },
    enabled: open,
  })

  const { data: packsData } = useQuery<{ enabled: boolean; tintaCents: number; packs: Pack[] }>({
    queryKey: ["/api/wallet/packs"],
    queryFn: async () => {
      const res = await fetch("/api/wallet/packs")
      if (!res.ok) return { enabled: false, tintaCents: 200, packs: [] }
      return res.json()
    },
    enabled: open,
    staleTime: 60_000,
  })
  const payOn = !!packsData?.enabled
  const tintaCents = packsData?.tintaCents || 200

  const buy = useMutation({
    mutationFn: async (packId: string) => {
      const res = await fetch("/api/wallet/buy", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ packId }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message || "Error")
      }
      return res.json()
    },
    onSuccess: (data: any) => {
      if (data?.mode === "checkout" && data?.url) {
        window.location.href = data.url
        return
      }
      setCredited(data?.credited || 0)
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] })
    },
  })

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[700] flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-5"
            style={{ background: "rgba(18,18,24,0.99)", border: `1px solid ${accentColor}30` }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-display font-bold text-white">{t("walletTitle")}</h2>
              <button onClick={onClose} className="p-1.5 rounded-full"
                style={{ color: "rgba(255,255,255,0.5)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Saldos */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="rounded-2xl px-3.5 py-3"
                style={{ background: `${accentGlow}12`, border: `1px solid ${accentColor}30` }}>
                <div className="flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5" style={{ color: accentColor }} />
                  <p className="text-[10px] font-sans" style={{ color: "rgba(255,255,255,0.55)" }}>{t("tintaName")}</p>
                </div>
                <p className="text-xl font-display font-bold mt-0.5" style={{ color: accentColor }}>
                  {wallet?.tinta ?? 0}
                </p>
              </div>
              <div className="rounded-2xl px-3.5 py-3"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div className="flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.45)" }} />
                  <p className="text-[10px] font-sans" style={{ color: "rgba(255,255,255,0.55)" }}>{t("papelName")}</p>
                  <InfoDot text={t("papelNote")} color="rgba(255,255,255,0.4)" size={12} align="left" />
                </div>
                <p className="text-xl font-display font-bold mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {wallet?.papel ?? 0}
                </p>
              </div>
            </div>

            {/* Acreditación reciente */}
            {credited !== null && (
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-3"
                style={{ background: "rgba(90,200,130,0.1)", border: "1px solid rgba(90,200,130,0.3)" }}>
                <BadgeCheck className="w-4 h-4" style={{ color: "rgba(120,220,160,0.9)" }} />
                <p className="text-xs font-sans text-white">
                  {t("tintaCredited")} <span style={{ color: accentColor }}>+{credited} 🪙</span>
                </p>
              </motion.div>
            )}

            {/* Paquetes */}
            <p className="text-[11px] font-sans font-semibold mb-2" style={{ color: "rgba(255,255,255,0.7)" }}>
              {t("getTinta")}
              {!payOn && (
                <span className="ml-2 text-[9px] font-normal px-1.5 py-0.5 rounded-full"
                  style={{ background: `${accentGlow}18`, color: accentColor }}>
                  {t("tokenBeta")}
                </span>
              )}
            </p>
            <div className="space-y-1.5">
              {(packsData?.packs || []).map(p => {
                const bonus = p.tinta - Math.round(p.cents / tintaCents)
                return (
                  <button
                    key={p.id}
                    disabled={buy.isPending}
                    onClick={() => buy.mutate(p.id)}
                    className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" style={{ color: accentColor }} />
                      <div className="text-left">
                        <p className="text-sm font-sans font-semibold text-white">{p.tinta} 🪙</p>
                        {bonus > 0 && (
                          <p className="text-[9px] font-sans" style={{ color: accentColor }}>
                            {t("packBonus").replace("{n}", String(bonus))}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-sans font-semibold"
                      style={{ color: payOn ? "rgba(255,255,255,0.85)" : accentColor }}>
                      {buy.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                        payOn ? `$${(p.cents / 100).toFixed(0)} MXN` : t("tokenBeta").split("·")[0].trim()}
                    </span>
                  </button>
                )
              })}
            </div>
            {buy.isError && (
              <p className="text-[10px] font-sans mt-2" style={{ color: "#e8a0a0" }}>
                {(buy.error as Error)?.message}
              </p>
            )}
            <p className="text-[9px] font-sans mt-3 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
              {t("walletDesc")}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
