import { accountStorage as localStorage, accountFetch as fetch } from "@/lib/account-context"
import { useState } from "react"
import { motion } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Printer, Heart, Store, BadgeCheck, CircleDashed, UserCheck, Droplets, CreditCard } from "lucide-react"
import WalletPanel from "@/components/WalletPanel"
import { useSettings } from "@/context/SettingsContext"
import type { LegalDocument } from "@shared/legal"
import type { PdfCopy, PrintBook } from "@/print/model"

interface Copy {
  id: number; folio: string; canPrint: boolean
  digitalClaimed: boolean
  claimedByOwner: boolean
  digitalClaimAllowed?: boolean
}
interface TokenWithCopies {
  id: number; kind: "support" | "sale"; licenseStatus: "active" | "suspended" | "revoked"; copies: Copy[]
}

interface Props {
  bookId:      number
  accentColor: string
  accentGlow:  string
  isDownloading: boolean
  onPrintCopy: (copy: PdfCopy, edition?: PrintBook) => void
  premiumUnlocked?: boolean
  isAuthor?: boolean
}

export default function TokensPanel({ bookId, accentColor, accentGlow, isDownloading, onPrintCopy, premiumUnlocked, isAuthor }: Props) {
  const { t } = useSettings()
  const queryClient = useQueryClient()
  const [payMenu, setPayMenu] = useState<"support" | "sale" | null>(null)
  const [showWallet, setShowWallet] = useState(false)
  const [acceptedHash, setAcceptedHash] = useState("")
  const legal = useQuery<{ hash: string; documents: LegalDocument[] }>({
    queryKey: ["/api/legal/documents"], staleTime: 0,
    queryFn: async () => { const response = await fetch("/api/legal/documents", { cache: "no-store" }); if (!response.ok) throw new Error("No se pudieron cargar las condiciones"); return response.json() },
  })

  const { data } = useQuery<{ tokens: TokenWithCopies[] }>({
    queryKey: [`/api/tokens/mine`, bookId],
    queryFn: async () => {
      const res = await fetch(`/api/tokens/mine?bookId=${bookId}`, { credentials: "include" })
      if (!res.ok) return { tokens: [] }
      return res.json()
    },
  })

  // Configuración de pagos: si Stripe está activo, mostrar precios reales
  const { data: payCfg } = useQuery<{ enabled: boolean; offers?: { support: string | null; sale: string | null }; prices: Record<string, { cents: number; currency: string; tinta: number }> }>({
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
      const intent = `purchase:${bookId}:${kind}:${payWith}`
      let purchaseKey = localStorage.getItem(intent)
      if (!purchaseKey) {
        purchaseKey = crypto.randomUUID()
        localStorage.setItem(intent, purchaseKey)
      }
      const res = await fetch("/api/tokens/acquire", {
        method:      "POST",
        headers:     { "Content-Type": "application/json", "Idempotency-Key": purchaseKey },
        credentials: "include",
        body:        JSON.stringify({ bookId, kind, payWith, acceptance: { accepted: acceptedHash === legal.data?.hash, documentHash: acceptedHash } }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        // Keep the key after network/server/429 errors: the first request may
        // already have succeeded. A completed checkout keeps it until confirmed.
        if ([400, 402, 409, 428].includes(res.status)) localStorage.removeItem(intent)
        if (e.code === "LEGAL_DOCUMENT_CHANGED") { setAcceptedHash(""); void legal.refetch() }
        throw new Error(e.message || "Error")
      }
      const result = await res.json()
      if (result.mode !== "checkout") localStorage.removeItem(intent)
      return result
    },
    onSuccess: (data: any) => {
      // Con pagos activos: llevar al checkout seguro de Stripe
      if (data?.mode === "checkout" && data?.url) {
        window.location.href = data.url
        return
      }
      queryClient.invalidateQueries({ queryKey: [`/api/tokens/mine`, bookId] })
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] })
      queryClient.invalidateQueries({ queryKey: ["/api/books", bookId] })
      setPayMenu(null)
      // Refrescar desbloqueados (el apoyo desbloquea la obra)
      fetch("/api/tokens/unlocked", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && localStorage.setItem("novareads_unlocked", JSON.stringify((d.bookIds || []).map(String))))
        .catch(() => {})
    },
  })

  const preparePrint = useMutation({
    mutationFn: async (copyId: number) => {
      const response = await fetch(`/api/print-copies/${copyId}/prepare`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}" })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.message || "No se pudo verificar el permiso de impresión. Reintenta cuando tengas conexión.")
      }
      const prepared: { bookId: number; book: PrintBook; copy: PdfCopy } = await response.json()
      if (prepared.bookId !== bookId || !prepared.copy?.folio || !prepared.copy?.key) throw new Error("No se pudo preparar el ejemplar.")
      onPrintCopy(prepared.copy, prepared.book)

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
          disabled={acquire.isPending || acceptedHash !== legal.data?.hash}
          onClick={() => acquire.mutate({ kind, payWith: "money" })}
          className="flex items-center justify-center gap-1.5 text-[10px] font-sans px-2 py-2.5 rounded-lg disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <CreditCard className="w-3 h-3" />
          {payOn ? `${t("payWithCard")} · $${((p?.cents ?? 0) / 100).toFixed(0)}` : t("tokenBeta").split("·")[0].trim()}
        </button>
        <button
          disabled={acquire.isPending || !enough || acceptedHash !== legal.data?.hash}
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
  const hasSupport = tokens.some(tk => tk.kind === "support" && tk.licenseStatus !== "revoked")
  const activeSupport = tokens.some(tk => tk.kind === "support" && tk.licenseStatus === "active")
  const supportReason = isAuthor ? "Esta obra es tuya: ya tienes acceso completo." : payCfg?.offers?.support
  const saleReason = payCfg?.offers?.sale || (!activeSupport && !isAuthor ? "Necesitas un Token 1 activo antes de adquirir un permiso comercial." : null)
  const allCopies: { copy: Copy; kind: string; licenseStatus: TokenWithCopies["licenseStatus"] }[] = []
  for (const tk of tokens) for (const c of tk.copies) allCopies.push({ copy: c, kind: tk.kind, licenseStatus: tk.licenseStatus })

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
        {!hasSupport && !isAuthor && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={acquire.isPending || !payCfg?.offers || !!supportReason}
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
        {!hasSupport && !isAuthor && supportReason && <p className="text-xs text-amber-100">{supportReason}</p>}
        {payMenu === "support" && !hasSupport && !supportReason && (
          <PayOptions kind="support" />
        )}
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={acquire.isPending || !payCfg?.offers || !!saleReason}
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
        {saleReason && <p className="text-xs text-amber-100">{saleReason}</p>}
        {payMenu === "sale" && !saleReason && (
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
      {payMenu && <div className="space-y-3 text-xs text-white/70">
        <p>{payMenu === "support" ? "Token 1: edición digital permanente sin suscripción y tres impresiones personales, sin venta ni accesos digitales adicionales." : "Un ejemplar físico nuevo y su primera distribución comercial. Un canje digital definitivo a la primera cuenta; una reventa no lo renueva."}</p>
        {legal.data?.documents.filter(document => document.id === "terms").map(document => <details key={document.id}><summary className="cursor-pointer underline">Condiciones · {document.version}</summary><p className="mt-2 whitespace-pre-line leading-6">{document.text}</p></details>)}
        {legal.isError && <button onClick={() => void legal.refetch()} className="underline">Reintentar carga de condiciones</button>}
        <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={!!legal.data && acceptedHash === legal.data.hash} disabled={!legal.data} onChange={event => setAcceptedHash(event.target.checked ? legal.data!.hash : "")} />Leí y acepto las condiciones de esta compra.</label>
      </div>}

      {/* Ejemplares */}
      {allCopies.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] font-sans" style={{ color: "rgba(255,255,255,0.45)" }}>
              {allCopies.length} · {t("tokensTitle").toLowerCase()}
            </p>

          </div>
          {preparePrint.isError && <p role="alert" className="px-1 text-xs text-amber-200">{preparePrint.error.message}</p>}
          {allCopies.map(({ copy, kind, licenseStatus }) => {
            const isMineClaim = copy.claimedByOwner
            const isFree      = !copy.digitalClaimed
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
                      {licenseStatus === "revoked" ? "Permiso reembolsado" : licenseStatus === "suspended" ? "Permiso suspendido: pago en revisión" : copy.digitalClaimAllowed === false ? "Impresión personal · sin canje adicional" : isMineClaim ? t("tokenYourCopy") : isFree ? t("tokenFreeCopy") : t("tokenClaimedCopy")}
                    </p>
                  </div>
                  <button
                    disabled={isDownloading || preparePrint.isPending || licenseStatus !== "active" || !copy.canPrint}
                    onClick={() => preparePrint.mutate(copy.id)}
                    aria-label={t("tokenPdfBtn") + " " + copy.folio}
                    className="flex items-center gap-1 text-[10px] font-sans px-2.5 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-40"
                    style={{ background: `${accentGlow}15`, color: accentColor, border: `1px solid ${accentColor}30` }}
                  >
                    {isDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                    {t("tokenPdfBtn")}
                  </button>
                </div>

              </div>
            )
          })}
        </div>
      )}

      <WalletPanel open={showWallet} onClose={() => setShowWallet(false)}
        accentColor={accentColor} accentGlow={accentGlow} />
      <a href="/legal/receipts" className="block text-xs text-white/60 underline">Mis comprobantes de compra y permisos</a>
    </div>
  )
}
