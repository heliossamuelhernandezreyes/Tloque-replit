import { displayTinta } from "@shared/tinta"
import { accountStorage as localStorage, accountFetch as fetch } from "@/lib/account-context"
import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery } from "@tanstack/react-query"
import { Heart, X } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"

interface Props {
  bookId:     number
  authorName: string
  moment:     "mid" | "end"     // tercer capítulo | final de la lectura
  accentColor: string
  accentGlow:  string
  textColor?:  string           // se adapta al modo de lectura en "mid"
}

// Invitación OPCIONAL y discreta a apoyar al autor. Filosofía Tloque:
// una sugerencia con cariño, no un anzuelo. Si el lector la cierra,
// no vuelve a aparecer para esa obra.
export default function SupportInvite({
  bookId, authorName, moment, accentColor, accentGlow, textColor = "rgba(255,255,255,0.85)",
}: Props) {
  const { t } = useSettings()
  const dismissKey = `support_invite_dismissed_${bookId}`
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissKey) === "1"
  )

  // Precio exacto de la obra y saldo de Tinta (para apoyar con un toque)
  const { data: payCfg } = useQuery<{ enabled: boolean; prices: { support: { cents: number; tinta: number } } }>({
    queryKey: ["/api/payments/config", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/config?bookId=${bookId}`)
      if (!res.ok) return { enabled: false, prices: { support: { cents: 0, tinta: 10 } } }
      return res.json()
    },
    staleTime: 60_000,
  })
  const { data: wallet } = useQuery<{ tinta: number }>({
    queryKey: ["/api/wallet"],
    queryFn: async () => {
      const res = await fetch("/api/wallet", { credentials: "include" })
      if (!res.ok) return { tinta: 0 }
      return res.json()
    },
  })
  const needTinta = payCfg?.prices?.support?.tinta ?? 10
  const canTinta  = (wallet?.tinta ?? 0) >= needTinta

  // ¿Ya tiene el token de apoyo? Entonces no invitar.
  const { data } = useQuery<{ tokens: { kind: string; licenseStatus: string }[] }>({
    queryKey: [`/api/tokens/mine`, bookId],
    queryFn: async () => {
      const res = await fetch(`/api/tokens/mine?bookId=${bookId}`, { credentials: "include" })
      if (!res.ok) return { tokens: [] }
      return res.json()
    },
  })
  const hasSupport = (data?.tokens || []).some(tk => tk.kind === "support" && tk.licenseStatus !== "revoked")

  function dismiss() {
    localStorage.setItem(dismissKey, "1")
    setDismissed(true)
  }

  if (dismissed || hasSupport) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        className="relative rounded-2xl px-4 py-4 my-8"
        style={{ background: `${accentGlow}0d`, border: `1px solid ${accentColor}30` }}
      >
        <button onClick={dismiss} className="absolute top-2.5 right-2.5 p-1 rounded-full"
          style={{ color: textColor, opacity: 0.4 }} aria-label={t("notNow")}>
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="p-2 rounded-full flex-shrink-0" style={{ background: `${accentGlow}20` }}>
            <Heart className="w-4 h-4" style={{ color: accentColor }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-sans font-semibold" style={{ color: textColor }}>
              {moment === "mid" ? t("supportInviteTitleMid") : t("supportInviteTitleEnd")}
            </p>
            <p className="text-[11px] font-sans mt-1 leading-relaxed" style={{ color: textColor, opacity: 0.65 }}>
              {t("supportInviteBody")}
            </p>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => { window.location.href = `/book/${bookId}#mecenazgo` }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-sans font-semibold disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${accentGlow}cc, ${accentColor})`, color: "rgba(0,0,0,0.85)" }}
              >
                <Heart className="w-3.5 h-3.5" />
                {t("supportInviteBtn").replace("{x}", authorName)}{canTinta ? ` · ${displayTinta(needTinta)} 🪙` : ""}
              </motion.button>
              <button onClick={dismiss} className="text-[11px] font-sans"
                style={{ color: textColor, opacity: 0.5 }}>
                {t("notNow")}
              </button>
            </div>

          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
