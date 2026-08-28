import { useRoute, useLocation } from "wouter"
import { motion, AnimatePresence } from "framer-motion"
import { Layout } from "@/components/layout"
import { BookCard } from "@/components/book-card"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { ArrowLeft, BookOpen, Pencil, TrendingUp, Eye, Lock, Heart } from "lucide-react"
import InfoDot from "@/components/InfoDot"
import { useGenre, GENRE_CONFIG, type Genre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { useAuth } from "@/hooks/useAuth"
import SocialLinks from "@/components/SocialLinks"
import ProfileEditor from "@/components/ProfileEditor"
import UserAvatar from "@/components/UserAvatar"

type AuthorProfile = {
  name:        string
  avatar:      string | null
  banner?:     string
  bio?:        string
  frame?:      string
  socialLinks?: Record<string, string>
  authorId?:   number | null
  isClassicProfile?: boolean
  books:       any[]
}

type PayoutState = {
  enabled: boolean
  holdDays: number
  minimumCents: number
  currency: string
  availableCents: number
  heldCents: number
  account: {
    connected: boolean
    ready: boolean
    detailsSubmitted?: boolean
    payoutsEnabled?: boolean
    transfersActive?: boolean
    disabledReason?: string
  }
  payouts: Array<{ id: number; amountCents: number; currency: string; status: string; requestedAt: string }>
}

export default function AuthorPage() {
  const [, params]      = useRoute("/author/:name")
  const [, setLocation] = useLocation()
  const { cfg }         = useGenre()
  const { t }           = useSettings()

  const authorName = decodeURIComponent(params?.name || "")
  const { user, isAdmin } = useAuth()
  const [editing, setEditing] = useState(false)
  const [publicView, setPublicView] = useState(false)   // "cómo me ven los demás"
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutMessage, setPayoutMessage] = useState("")

  const { data: payout, refetch: refetchPayout } = useQuery<PayoutState>({
    queryKey: ["/api/payouts/mine"],
    queryFn: async () => {
      const res = await fetch("/api/payouts/mine", { credentials: "include" })
      if (!res.ok) throw new Error("payout_unavailable")
      return res.json()
    },
    enabled: !!user,
  })

  async function beginPayoutOnboarding() {
    setPayoutBusy(true); setPayoutMessage("")
    try {
      const res = await fetch("/api/payouts/onboarding", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || typeof body.url !== "string") throw new Error(body.message || t("payoutError"))
      window.location.assign(body.url)
    } catch (error) {
      setPayoutMessage(error instanceof Error ? error.message : t("payoutError"))
      setPayoutBusy(false)
    }
  }

  async function requestPayout() {
    setPayoutBusy(true); setPayoutMessage("")
    try {
      const res = await fetch("/api/payouts/request", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || t("payoutError"))
      setPayoutMessage(t("payoutRequested"))
      await refetchPayout()
    } catch (error) {
      setPayoutMessage(error instanceof Error ? error.message : t("payoutError"))
    } finally {
      setPayoutBusy(false)
    }
  }

  const { data: authorStats } = useQuery<{ totalHearts: number; totalSupports: number; totalReaders: number; perBook: any[] }>({
    queryKey: ["/api/author/stats"],
    queryFn: async () => {
      const res = await fetch("/api/author/stats", { credentials: "include" })
      if (!res.ok) return { totalHearts: 0, totalSupports: 0, totalReaders: 0, perBook: [] }
      return res.json()
    },
    enabled: !!user,
  })

  const { data: profile, isLoading } = useQuery<AuthorProfile>({
    queryKey:  [`/api/authors/${encodeURIComponent(authorName)}`],
    queryFn:   async () => {
      const res = await fetch(`/api/authors/${encodeURIComponent(authorName)}`)
      if (!res.ok) throw new Error("Author not found")
      return res.json()
    },
    enabled:   !!authorName,
    staleTime: 2 * 60 * 1000,
  })

  const authorBooks = profile?.books || []

  // Género más frecuente del autor
  const dominantGenre = useMemo(() => {
    const counts: Record<string, number> = {}
    authorBooks.forEach((b: any) => {
      if (b.genre) counts[b.genre] = (counts[b.genre] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as Genre | undefined
  }, [authorBooks])

  const gc = dominantGenre ? GENRE_CONFIG[dominantGenre] : cfg

  const totalWords = useMemo(() =>
    authorBooks.reduce((acc: number, b: any) => {
      const w = b.chapters?.reduce((a: number, ch: any) =>
        a + (ch.content?.split(/\s+/).length || 0), 0) || 0
      return acc + w
    }, 0),
    [authorBooks]
  )

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <motion.div
            animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-2 h-2 rounded-full"
            style={{ background: cfg.color }}
          />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="min-h-screen pb-32 overflow-x-hidden">

        {/* ── HERO con fondo del género dominante ── */}
        <div className="relative h-52 w-full overflow-hidden">

          {/* Fondo degradado */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(160deg, ${gc.glow}40, rgba(0,0,0,0.98))`,
            }}
          />

          {/* Banner del perfil — foto de portada (si el autor/admin subió una) */}
          {(profile?.banner) && (
            <div className="absolute inset-0">
              <img src={profile.banner} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0"
                style={{ background: `linear-gradient(to top, rgba(0,0,0,0.96) 8%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.5))` }} />
            </div>
          )}

          {/* Textura cósmica */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `radial-gradient(circle at 20% 50%, ${gc.glow}25 0%, transparent 50%),
                                radial-gradient(circle at 80% 20%, ${gc.color}15 0%, transparent 40%)`,
            }}
          />

          {/* Partículas flotantes */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(8)].map((_, i) => (
              <motion.div key={i}
                className="absolute rounded-full"
                style={{
                  background: gc.particle,
                  width: 2 + (i % 3),
                  height: 2 + (i % 3),
                  left: `${8 + i * 11}%`,
                  top:  `${20 + (i % 4) * 18}%`,
                }}
                animate={{ opacity: [0.1, 0.6, 0.1], scale: [0.8, 1.4, 0.8], y: [0, -8, 0] }}
                transition={{ duration: 3 + i * 0.5, repeat: Infinity, delay: i * 0.25 }}
              />
            ))}
          </div>

          {/* Botón volver */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setLocation("/")}
            className="absolute top-4 left-4 p-2 rounded-full"
            style={{
              background: "rgba(0,0,0,0.5)",
              border:     "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
            }}
          >
            <ArrowLeft className="w-4 h-4 text-white/70" />
          </motion.button>

          {/* Glow inferior */}
          <div
            className="absolute bottom-0 left-0 right-0 h-24"
            style={{ background: `linear-gradient(to top, rgba(0,0,0,0.98), transparent)` }}
          />
        </div>

        {/* ── PERFIL ── */}
        <div className="px-5 -mt-14 relative z-10">

          {/* Avatar — foto + marco */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="mb-4"
          >
            <UserAvatar
              src={profile?.avatar || null}
              name={authorName}
              size={104}
              frame={profile?.frame || ""}
              accentColor={gc.color}
            />
          </motion.div>

          {/* Nombre */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-2xl font-display font-bold text-white tracking-tight mb-2"
          >
            {authorName}
          </motion.h1>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center flex-wrap gap-3 mb-6"
          >
            <span className="text-xs font-sans" style={{ color: gc.color + "aa" }}>
              {authorBooks.length} {t("published").toLowerCase()}
            </span>

            {totalWords > 0 && (
              <span className="text-xs text-zinc-600 font-sans">
                {totalWords >= 1000
                  ? `${Math.round(totalWords / 1000)}k ${t("wordsLabel")}`
                  : `${totalWords} ${t("wordsLabel")}`
                }
              </span>
            )}

            {dominantGenre && (
              <span
                className="text-xs font-sans px-2.5 py-1 rounded-full"
                style={{
                  background: gc.bg,
                  color:      gc.color,
                  border:     `1px solid ${gc.color}30`,
                }}
              >
                {t(gc.tKey)}
              </span>
            )}
          </motion.div>

          {/* ── BIO ── */}
          {profile?.bio?.trim() && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="text-sm font-sans leading-relaxed text-zinc-300 max-w-md text-center mb-5 whitespace-pre-wrap"
            >
              {profile.bio}
            </motion.p>
          )}

          {/* ── ENLACES SOCIALES ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.22 }}
            className="mb-5"
          >
            <SocialLinks links={profile?.socialLinks || {}} accentColor={gc.color} />
          </motion.div>

          {/* ── EDITAR PERFIL (dueño, o admin en un clásico) ── */}
          {((user && profile?.authorId && profile.authorId === user.id) ||
            (isAdmin && profile?.isClassicProfile)) && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs font-sans px-3.5 py-2 rounded-full mb-6 transition-colors"
              style={{
                background: profile?.isClassicProfile ? "rgba(255,210,100,0.08)" : "rgba(255,255,255,0.05)",
                border:     `1px solid ${profile?.isClassicProfile ? "rgba(255,210,100,0.25)" : "rgba(255,255,255,0.12)"}`,
                color:      profile?.isClassicProfile ? "rgba(255,210,100,0.85)" : "rgba(255,255,255,0.7)",
              }}
            >
              <Pencil className="w-3 h-3" />
              {profile?.isClassicProfile ? t("editProfileAdmin") : t("editProfile")}
            </motion.button>
          )}

          {/* ── GANANCIAS + ESTADÍSTICAS PRIVADAS (solo el dueño, oculto en vista pública) ── */}
          {(() => {
            const isOwner = !!(user && profile?.authorId === user.id)
            if (!isOwner) return null
            return (
              <>
                {/* Botón: cómo me ven los demás */}
                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setPublicView(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] font-sans px-3 py-1.5 rounded-full mb-4"
                  style={{
                    background: publicView ? gc.color : "rgba(255,255,255,0.05)",
                    color: publicView ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.7)",
                    border: `1px solid ${publicView ? gc.color : "rgba(255,255,255,0.12)"}`,
                  }}
                >
                  {publicView ? <Eye className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {publicView ? t("exitPublicView") : t("howOthersSeeMe")}
                </motion.button>

                {!publicView && (
                  <>
                    {/* Estadísticas privadas: corazones, apoyos, lectores */}
                    {authorStats && authorStats.perBook.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-sm rounded-2xl px-4 py-3.5 mb-4"
                        style={{ background: `${gc.glow}0d`, border: `1px solid ${gc.color}30` }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <Lock className="w-3 h-3" style={{ color: "rgba(255,255,255,0.5)" }} />
                          <p className="text-[11px] font-sans font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                            {t("privateStats")}
                          </p>
                          <InfoDot text={t("privateStatsNote")} color={gc.color} size={11} align="left" />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="flex items-center justify-center gap-1">
                              <Heart className="w-3.5 h-3.5" style={{ color: gc.color, fill: gc.color }} />
                              <span className="text-lg font-display font-bold" style={{ color: gc.color }}>{authorStats.totalHearts}</span>
                            </div>
                            <p className="text-[8px] font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{t("statHearts")}</p>
                          </div>
                          <div>
                            <span className="text-lg font-display font-bold text-white">{authorStats.totalSupports}</span>
                            <p className="text-[8px] font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{t("statSupports")}</p>
                          </div>
                          <div>
                            <span className="text-lg font-display font-bold text-white">{authorStats.totalReaders}</span>
                            <p className="text-[8px] font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{t("statReaders")}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Ganancias y liquidación verificada */}
                    {payout && (payout.availableCents > 0 || payout.heldCents > 0 || payout.payouts.length > 0) && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-sm rounded-2xl px-4 py-3.5 mb-6"
                        style={{ background: `${gc.glow}0d`, border: `1px solid ${gc.color}30` }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <TrendingUp className="w-3.5 h-3.5" style={{ color: gc.color }} />
                          <p className="text-[11px] font-sans font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                            {t("earningsTitle")}
                          </p>
                          <InfoDot text={t("earningsPayoutNote")} color={gc.color} size={12} align="left" />
                        </div>
                        <p className="text-xl font-display font-bold" style={{ color: gc.color }}>
                          ${(payout.availableCents / 100).toFixed(2)} {payout.currency.toUpperCase()}
                        </p>
                        <p className="text-[10px] font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                          {t("payoutAvailable")}
                        </p>
                        {payout.heldCents > 0 && (
                          <p className="text-[10px] font-sans mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
                            ${(payout.heldCents / 100).toFixed(2)} {payout.currency.toUpperCase()} · {t("payoutHeld").replace("{n}", String(payout.holdDays))}
                          </p>
                        )}
                        {payout.payouts[0] && ["requested", "processing", "processing_unknown"].includes(payout.payouts[0].status) ? (
                          <p className="text-[10px] font-sans mt-2" style={{ color: gc.color }}>{t("payoutPending")}</p>
                        ) : payout.enabled && !payout.account.ready ? (
                          <button
                            type="button" disabled={payoutBusy} onClick={beginPayoutOnboarding}
                            className="mt-3 w-full rounded-xl px-3 py-2 text-[11px] font-sans font-semibold disabled:opacity-50"
                            style={{ background: gc.color, color: "rgba(0,0,0,0.88)" }}
                          >
                            {payoutBusy ? t("processing") : t("payoutVerify")}
                          </button>
                        ) : payout.enabled && payout.account.ready && payout.availableCents >= payout.minimumCents ? (
                          <button
                            type="button" disabled={payoutBusy} onClick={requestPayout}
                            className="mt-3 w-full rounded-xl px-3 py-2 text-[11px] font-sans font-semibold disabled:opacity-50"
                            style={{ background: gc.color, color: "rgba(0,0,0,0.88)" }}
                          >
                            {payoutBusy ? t("processing") : t("payoutRequest")}
                          </button>
                        ) : !payout.enabled ? (
                          <p className="text-[10px] font-sans mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>{t("payoutDisabled")}</p>
                        ) : null}
                        {payoutMessage && (
                          <p className="text-[10px] font-sans mt-2" role="status" style={{ color: gc.color }}>{payoutMessage}</p>
                        )}
                      </motion.div>
                    )}
                  </>
                )}
              </>
            )
          })()}

          {/* ── OBRAS ── */}
          <AnimatePresence>
            {authorBooks.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-20 gap-3 text-center"
              >
                <BookOpen className="w-8 h-8 text-zinc-700" />
                <p className="text-zinc-600 text-sm font-sans">
                  Este autor no tiene obras publicadas.
                </p>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans mb-4">
                  {t("published")}
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-5">
                  {authorBooks.map((book: any) => (
                    <BookCard key={book.id} {...book} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* Editor de perfil */}
      <AnimatePresence>
        {editing && (
          <ProfileEditor
            authorName={authorName}
            initialBio={profile?.bio || ""}
            initialLinks={profile?.socialLinks || {}}
            initialAvatar={profile?.avatar || ""}
            initialBanner={profile?.banner || ""}
            initialFrame={profile?.frame || ""}
            isClassic={!!profile?.isClassicProfile}
            isAdmin={!!isAdmin}
            accentColor={gc.color}
            accentGlow={gc.glow}
            onClose={() => setEditing(false)}
          />
        )}
      </AnimatePresence>
    </Layout>
  )
}
