import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { useLocation } from "wouter"
import { ArrowLeft, Droplets, Sparkles, BookOpen, Lock, Loader2, ChevronDown, Copy } from "lucide-react"
import CollectibleCard from "@/components/CollectibleCard"
import WalletPanel from "@/components/WalletPanel"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"

// El color de cada rareza. Es lo que revela la suerte ANTES que la carta:
// el brillo sube de temperatura mientras el sobre se abre.
const RARITY_COLOR: Record<string, { c: string; glow: string; labelKey: string }> = {
  common:    { c: "#8a8f98", glow: "#8a8f98", labelKey: "rarityCommon" },
  rare:      { c: "#6bd08a", glow: "#6bd08a", labelKey: "rarityRare" },
  very_rare: { c: "#5b9dd9", glow: "#5b9dd9", labelKey: "rarityVeryRare" },
  unusual:   { c: "#a77fd0", glow: "#a77fd0", labelKey: "rarityUnusual" },
  golden:    { c: "#d4af37", glow: "#e6cd82", labelKey: "rarityGolden" },
  legendary: { c: "#e8833a", glow: "#ffb066", labelKey: "rarityLegendary" },
  mythic:    { c: "#e0509a", glow: "#ff8cc4", labelKey: "rarityMythic" },
  absolute:  { c: "#ffffff", glow: "#e6d7ff", labelKey: "rarityAbsolute" },
}
const RARITY_ORDER = ["common","rare","very_rare","unusual","golden","legendary","mythic","absolute"]

interface Tier {
  key: string; name: string; probability: number; bonusToAuthor: number
  obras: number; cartas: number; poolUnlocked: boolean; poolProgress: number
}
interface Status {
  enabled: boolean
  pool: number
  ticket: { price: number; direct: number; pool: number; house: number }
  tiers: Tier[]
  pity: null | {
    toGolden: number; toLegendary: number
    sinceGolden: number; sinceLegendary: number
    totalDraws: number; everyGolden: number; everyLegendary: number
  }
}
interface DrawResult {
  drawId: number
  rarity: string
  pityApplied: boolean
  card: { id: number; name: string; subtitle: string; fx: any; rarity: string; inGachaPool: boolean }
  book: { id: number; title: string; author: string; coverUrl: string }
  isDuplicate: boolean
  bookGranted: boolean
  paperGranted: number
  poolAfter: number
  pity: { sinceGolden: number; sinceLegendary: number }
}

type Phase = "idle" | "opening" | "revealed"

export default function GachaScreen() {
  const [, setLocation] = useLocation()
  const { isLoggedIn } = useAuth()
  const { t } = useSettings()
  const queryClient = useQueryClient()

  const [phase, setPhase] = useState<Phase>("idle")
  const [result, setResult] = useState<DrawResult | null>(null)
  const [showOdds, setShowOdds] = useState(false)
  const [showWallet, setShowWallet] = useState(false)
  const [error, setError] = useState<{ text: string; missing?: number } | null>(null)

  const { data: status } = useQuery<Status>({
    queryKey: ["/api/gacha/status"],
    queryFn: async () => {
      const res = await fetch("/api/gacha/status", { credentials: "include" })
      if (!res.ok) throw new Error("no")
      return res.json()
    },
  })

  const { data: wallet } = useQuery<{ tinta: number; papel: number }>({
    queryKey: ["/api/wallet"],
    queryFn: async () => {
      const res = await fetch("/api/wallet", { credentials: "include" })
      if (!res.ok) return { tinta: 0, papel: 0 }
      return res.json()
    },
    enabled: !!isLoggedIn,
  })
  const tinta = wallet?.tinta ?? 0
  const price = status?.ticket.price ?? 40

  const draw = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/gacha/draw", { method: "POST", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const e: any = new Error(data.message || "Error")
        e.status = res.status
        e.missing = data.missing
        throw e
      }
      return data as DrawResult
    },
    onMutate: () => {
      setError(null)
      setResult(null)
      setPhase("opening")
    },
    onSuccess: (d) => {
      // El suspenso: dejamos que la animación respire antes de revelar.
      setResult(d)
      setTimeout(() => setPhase("revealed"), 1500)
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] })
      queryClient.invalidateQueries({ queryKey: ["/api/gacha/status"] })
    },
    onError: (e: any) => {
      setPhase("idle")
      if (e.status === 402) {
        setError({ text: t("notEnoughTinta").replace("{n}", String(e.missing ?? price)), missing: e.missing })
      } else {
        setError({ text: e.message || t("gachaError") })
      }
    },
  })

  const rar = result ? (RARITY_COLOR[result.rarity] ?? RARITY_COLOR.common) : RARITY_COLOR.common
  const isBig = result ? RARITY_ORDER.indexOf(result.rarity) >= 4 : false

  // ── El sistema aún duerme ──
  if (status && !status.enabled) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        <Header onBack={() => setLocation("/library")} title={t("gachaTitle")} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="p-4 rounded-full bg-zinc-900 border border-zinc-800">
            <Lock className="w-6 h-6 text-zinc-600" />
          </div>
          <p className="text-[15px] font-display text-zinc-300">{t("gachaSoon")}</p>
          <p className="text-[12px] text-zinc-600 font-sans max-w-[280px] leading-relaxed">
            {t("gachaSoonHint")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col pb-10">
      <Header onBack={() => setLocation("/library")} title={t("gachaTitle")}
        right={isLoggedIn && (
          <button onClick={() => setShowWallet(true)}
            className="flex items-center gap-1 text-[11px] font-sans font-semibold px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c" }}>
            <Droplets className="w-3 h-3" />{tinta}
          </button>
        )} />

      {error && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl flex items-center gap-2 text-[12px] font-sans"
          style={{ background: "rgba(224,122,122,0.12)", color: "#e07a7a", border: "1px solid rgba(224,122,122,0.25)" }}>
          <span className="flex-1">{error.text}</span>
          {error.missing != null && (
            <button onClick={() => { setShowWallet(true); setError(null) }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex-shrink-0"
              style={{ background: "#c9a84c", color: "#1a1508" }}>
              {t("getTinta")}
            </button>
          )}
        </div>
      )}

      {/* ── EL ESCENARIO ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 min-h-[420px]">
        <AnimatePresence mode="wait">

          {/* Sobre cerrado */}
          {phase === "idle" && (
            <motion.div key="idle"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-6">
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                className="relative">
                <Envelope />
              </motion.div>
              <div className="text-center">
                <p className="text-[13px] font-display text-zinc-300">{t("gachaOneBook")}</p>
                <p className="text-[10.5px] text-zinc-600 font-sans mt-1">{t("gachaOneCard")}</p>
              </div>
            </motion.div>
          )}

          {/* Abriendo: el color revela la suerte antes que la carta */}
          {phase === "opening" && (
            <motion.div key="opening"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6">
              <div className="relative">
                <motion.div
                  animate={{ rotate: [-2, 2, -2], scale: [1, 1.04, 1] }}
                  transition={{ duration: 0.35, repeat: Infinity }}>
                  <Envelope />
                </motion.div>
                {/* El resplandor que crece: el suspenso puro */}
                <motion.div
                  className="absolute inset-0 rounded-3xl pointer-events-none"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{
                    opacity: [0, 0.5, 0.85, 1],
                    scale: [0.8, 1.3, 1.8, 2.4],
                    background: result
                      ? [`radial-gradient(circle, #ffffff55, transparent 70%)`,
                         `radial-gradient(circle, ${rar.glow}88, transparent 70%)`,
                         `radial-gradient(circle, ${rar.c}cc, transparent 70%)`]
                      : `radial-gradient(circle, #ffffff55, transparent 70%)`,
                  }}
                  transition={{ duration: 1.5, ease: "easeIn" }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 font-sans tracking-wide"
                style={{ fontVariant: "small-caps" }}>{t("gachaOpening")}</p>
            </motion.div>
          )}

          {/* Revelado */}
          {phase === "revealed" && result && (
            <motion.div key="revealed"
              initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 180, damping: 18 }}
              className="flex flex-col items-center gap-5 w-full max-w-[280px]">

              {/* El sello de rareza */}
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                style={{ background: `${rar.c}18`, border: `1px solid ${rar.c}60` }}>
                {isBig && <Sparkles className="w-3 h-3" style={{ color: rar.glow }} />}
                <span className="text-[11px] font-display font-bold tracking-wide"
                  style={{ color: rar.c, fontVariant: "small-caps" }}>
                  {t(rar.labelKey)}
                </span>
                {result.pityApplied && (
                  <span className="text-[8px] font-sans px-1 rounded" style={{ color: rar.glow, opacity: 0.8 }}>
                    {t("gachaPityHit")}
                  </span>
                )}
              </motion.div>

              {/* La carta */}
              <div className="w-full" style={{ filter: isBig ? `drop-shadow(0 0 22px ${rar.glow}70)` : undefined }}>
                <CollectibleCard
                  card={{
                    id: result.card.id, name: result.card.name,
                    subtitle: result.card.subtitle, description: "",
                    fx: result.card.fx, unlock: "tinta",
                    rarity: result.card.rarity || result.rarity,
                    inGachaPool: true,
                    priceTinta: 0,
                    owned: true,
                  }}
                  accentColor={rar.c} accentGlow={rar.glow}
                />
              </div>

              {/* El libro que cayó en la biblioteca */}
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="w-full rounded-xl px-3 py-2.5 flex items-center gap-2.5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
                <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: rar.c }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-display font-semibold text-zinc-200 truncate">
                    {result.book.title}
                  </p>
                  <p className="text-[9.5px] text-zinc-500 font-sans truncate">
                    {result.bookGranted ? t("gachaBookAdded") : t("gachaBookOwned")}
                  </p>
                </div>
                <button onClick={() => setLocation(`/book/${result.book.id}`)}
                  className="text-[10px] font-sans px-2 py-1 rounded-lg flex-shrink-0"
                  style={{ background: `${rar.c}20`, color: rar.c }}>
                  {t("gachaRead")}
                </button>
              </motion.div>

              {/* Una repetida queda registrada, pero Papel solo mide consumo de IA. */}
              {result.isDuplicate && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}
                  className="flex items-center gap-1.5 text-[10.5px] font-sans"
                  style={{ color: "#7fb3d5" }}>
                  <Copy className="w-3 h-3" />
                  {t("gachaDuplicate")}
                </motion.div>
              )}

              <button onClick={() => { setPhase("idle"); setResult(null) }}
                className="text-[11px] text-zinc-500 font-sans hover:text-zinc-300">
                {t("gachaAgain")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── EL BOTÓN ── */}
      {phase !== "opening" && (
        <div className="px-6">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => isLoggedIn ? draw.mutate() : setLocation("/")}
            disabled={draw.isPending}
            className="w-full py-3.5 rounded-2xl font-display font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-60"
            style={{
              background: tinta >= price
                ? "linear-gradient(135deg, #e6cd82, #c9a84c)"
                : "rgba(255,255,255,0.06)",
              color: tinta >= price ? "#1a1508" : "rgba(255,255,255,0.45)",
              boxShadow: tinta >= price ? "0 6px 24px -8px rgba(201,168,76,0.6)" : undefined,
            }}>
            {draw.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Droplets className="w-4 h-4" />}
            {t("gachaOpen")} · {price}
          </motion.button>

          {/* La piedad, visible: es un seguro, y saberlo retiene */}
          {status?.pity && (
            <div className="mt-3 flex items-center justify-center gap-4 text-[10px] font-sans text-zinc-600">
              <span>
                <span style={{ color: RARITY_COLOR.golden.c }}>◆</span>{" "}
                {t("gachaPityGolden").replace("{n}", String(status.pity.toGolden))}
              </span>
              <span>
                <span style={{ color: RARITY_COLOR.legendary.c }}>◆</span>{" "}
                {t("gachaPityLegendary").replace("{n}", String(status.pity.toLegendary))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── LAS PROBABILIDADES, A LA VISTA ── */}
      {status && (
        <div className="px-4 mt-6">
          <button onClick={() => setShowOdds(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[11.5px] font-sans"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#a1a1aa" }}>
            <span>{t("gachaOdds")}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOdds ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showOdds && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <div className="pt-3 space-y-1.5">
                  {status.tiers.map(tier => {
                    const rc = RARITY_COLOR[tier.key] ?? RARITY_COLOR.common
                    return (
                      <div key={tier.key}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.02)" }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: rc.c, boxShadow: `0 0 6px ${rc.glow}` }} />
                        <span className="text-[11.5px] font-display flex-1"
                          style={{ color: tier.poolUnlocked ? "#e4e4e7" : "#52525b" }}>
                          {t(RARITY_COLOR[tier.key]?.labelKey || "rarityCommon")}
                        </span>
                        {/* El jackpot progresivo: si el pozo no la banca, se ve */}
                        {!tier.poolUnlocked ? (
                          <span className="text-[9px] font-sans flex items-center gap-1" style={{ color: "#71717a" }}>
                            <Lock className="w-2.5 h-2.5" />
                            {(tier.poolProgress * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-[9px] font-sans text-zinc-600">
                            {tier.obras} {tier.obras === 1 ? t("gachaWork") : t("gachaWorks")}
                          </span>
                        )}
                        <span className="text-[11px] font-sans font-semibold tabular-nums w-14 text-right"
                          style={{ color: rc.c }}>
                          {(tier.probability * 100).toFixed(tier.probability < 0.01 ? 3 : 2)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[9.5px] text-zinc-600 font-sans mt-2.5 px-1 leading-relaxed">
                  {t("gachaOddsNote")}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <WalletPanel open={showWallet} onClose={() => setShowWallet(false)}
        accentColor="#c9a84c" accentGlow="#c9a84c" />
    </div>
  )
}

function Header({ onBack, title, right }: { onBack: () => void; title: string; right?: any }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
      <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Volver">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <h1 className="text-sm font-semibold text-zinc-200 tracking-wide" style={{ fontVariant: "small-caps" }}>
        {title}
      </h1>
      <div className="ml-auto">{right}</div>
    </div>
  )
}

// El sobre: sobrio, con el sello de Tloque. Nada de estridencias.
function Envelope() {
  return (
    <div className="relative" style={{ width: 168, height: 224 }}>
      <div className="absolute inset-0 rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(150deg, #1c1c22, #0e0e12 60%, #15151a)",
          border: "1px solid rgba(201,168,76,0.3)",
          boxShadow: "0 12px 40px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}>
        {/* La solapa */}
        <div className="absolute inset-x-0 top-0 h-1/2"
          style={{
            background: "linear-gradient(180deg, rgba(201,168,76,0.08), transparent)",
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            borderBottom: "1px solid rgba(201,168,76,0.2)",
          }} />
        {/* El sello */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full"
          style={{
            width: 46, height: 46,
            background: "radial-gradient(circle at 35% 30%, #e6cd82, #a8842f)",
            boxShadow: "0 3px 12px rgba(201,168,76,0.4)",
          }}>
          <span className="font-display font-bold text-[17px]" style={{ color: "#2a2008" }}>T</span>
        </div>
      </div>
    </div>
  )
}
