import { accountFetch as fetch } from "@/lib/account-context"
import { Link, useRoute } from "wouter"
import { usePathname } from "wouter/use-browser-location"
import { motion, AnimatePresence } from "framer-motion"
import { Layout } from "@/components/layout"
import AuthorWorks, { type AuthorWorksPage } from "@/components/AuthorWorks"
import ImportPanel from "@/components/ImportPanel"
import { authorCopy } from "@/components/author-copy"
import { gutenbergCopy } from "@/components/gutenberg-copy"
import { gutenbergAuthorKey, gutenbergAuthorName } from "@shared/gutenberg"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { ArrowLeft, LibraryBig, Pencil, TrendingUp, Eye, Lock, Heart } from "lucide-react"
import InfoDot from "@/components/InfoDot"
import { useGenre, CONTENT_GENRES, GENRE_CONFIG } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { useAuth } from "@/hooks/useAuth"
import SocialLinks from "@/components/SocialLinks"
import ProfileEditor from "@/components/ProfileEditor"
import UserAvatar from "@/components/UserAvatar"
import QueryNotice from "@/components/QueryNotice"

type AuthorProfile = AuthorWorksPage & {
  name:        string
  avatar:      string | null
  banner?:     string
  bio?:        string
  frame?:      string
  socialLinks?: Record<string, string>
  authorId?:   number | null
  isClassicProfile?: boolean
  classicName?: string
  candidates?: { authorId: number | null; name: string; path: string; exampleTitle?: string }[]
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
  const pathname = usePathname()
  return <AuthorProfilePage key={pathname} pathname={pathname} />
}

function AuthorProfilePage({ pathname }: { pathname: string }) {
  const [, idParams] = useRoute("/author/id/:id")
  const [, classicParams] = useRoute("/author/classic/:name")
  const { cfg } = useGenre()
  const { settings, t } = useSettings()
  const copy = authorCopy(settings.language)
  const { user, can, isLoading: authLoading } = useAuth()
  let routeName = ""
  try { routeName = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "") } catch {}
  const ownRoute = !idParams && !classicParams && routeName === "me"
  const authorId = idParams?.id || (ownRoute ? user?.id : undefined)
  const profileUrl = authorId ? `/api/authors/id/${authorId}`
    : classicParams ? `/api/authors/classic/${encodeURIComponent(routeName)}`
    : `/api/authors/${encodeURIComponent(routeName)}`
  const isAdmin = can("manageCatalog") && settings.adminMode
  const [editing, setEditing] = useState(false)
  const [publicView, setPublicView] = useState(false)
  const [importAuthor, setImportAuthor] = useState<string | null>(null)
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutMessage, setPayoutMessage] = useState("")

  const { data: profile, isLoading, isError, refetch } = useQuery<AuthorProfile | null>({
    queryKey: [profileUrl],
    queryFn: async ({ signal }) => {
      const res = await fetch(profileUrl + "?limit=24", { signal })
      if (res.status === 404 || res.status === 400) return null
      if (res.status === 409) return { ...(await res.json()), books: [], nextCursor: null }
      if (!res.ok) throw new Error("author_profile_unavailable")
      const data = await res.json()
      if (typeof data?.name !== "string" || !Array.isArray(data.books)) throw new Error("author_profile_invalid")
      return data
    },
    enabled: !!authorId || (!!routeName && !ownRoute),
    staleTime: 120_000,
  })
  const isOwner = !!(user && profile?.authorId === user.id)
  const isClassic = profile?.isClassicProfile === true
  const canEdit = (isOwner && !publicView) || (isAdmin && isClassic)
  const authorName = profile?.name || routeName

  const { data: payout, refetch: refetchPayout } = useQuery<PayoutState>({
    queryKey: ["/api/payouts/mine"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/payouts/mine", { credentials: "include", signal })
      if (!res.ok) throw new Error("payout_unavailable")
      return res.json()
    },
    enabled: isOwner && !publicView,
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
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/author/stats", { credentials: "include", signal })
      if (!res.ok) return { totalHearts: 0, totalSupports: 0, totalReaders: 0, perBook: [] }
      return res.json()
    },
    enabled: isOwner && !publicView,
  })

  const classicName = profile?.classicName || authorName
  const dominantGenre = useMemo(() => {
    const counts = new Map<string, number>()
    for (const book of profile?.books || []) {
      if (book.genre) counts.set(book.genre, (counts.get(book.genre) || 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  }, [profile?.books])
  const knownGenre = CONTENT_GENRES.find(genre => genre === dominantGenre)
  const gc = knownGenre ? GENRE_CONFIG[knownGenre] : cfg

  const sourceAuthors = useMemo(() => {
    const names = new Set<string>()
    const lifespans = new Set<string>()
    if (!isClassic) return { names: [], lifespan: "" }
    for (const work of profile?.books || []) {
      const people = work.sourceMetadata?.authors
      if (work.sourceMetadata?.provider !== "gutenberg" || !Array.isArray(people)) continue
      for (const person of people) {
        if (typeof person?.name !== "string") continue
        const name = gutenbergAuthorName(person.name)
        if (name) names.add(name)
        const { birth_year: birth, death_year: death } = person
        if (gutenbergAuthorKey(name) === gutenbergAuthorKey(classicName)
          && Number.isSafeInteger(birth) && Number.isSafeInteger(death) && birth <= death) {
          lifespans.add(`${birth}–${death}`)
        }
      }
    }
    const byline = classicName.split(" · ").filter(name => name && name !== "—")
    return { names: names.size ? [...names] : byline, lifespan: lifespans.size === 1 ? [...lifespans][0] : "" }
  }, [isClassic, classicName, profile?.books])

  if (isLoading || (ownRoute && authLoading)) return <Layout><div className="mx-auto max-w-6xl px-5 py-16">
    <QueryNotice loading onRetry={() => { void refetch() }} />
  </div></Layout>
  if (isError) return <Layout><div className="mx-auto max-w-6xl px-5 py-16">
    <QueryNotice error onRetry={() => { void refetch() }} />
  </div></Layout>
  if (!profile) return <Layout><div className="mx-auto max-w-6xl space-y-4 px-5 py-16">
    <h1 className="font-display text-2xl text-white">{copy.notFound}</h1>
    <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-amber-100 underline underline-offset-4">
      <ArrowLeft className="h-4 w-4" />{t("backToHome")}
    </Link>
  </div></Layout>
  if (profile.candidates) return <Layout><div className="mx-auto max-w-lg px-5 py-16">
    <h1 className="mb-4 text-xl">Hay varios autores llamados {authorName}</h1>
    {profile.candidates.map(candidate => <Link key={candidate.path} href={candidate.path}
      className="mb-3 block min-h-11 rounded-xl border border-white/20 p-3 text-start hover:bg-white/5">
      <span className="block font-display">{candidate.name}</span>
      <span className="text-xs text-zinc-400">{candidate.authorId ? copy.community : copy.classic}</span>
      {candidate.exampleTitle && <span className="mt-1 block text-sm text-zinc-200">{candidate.exampleTitle}</span>}
    </Link>)}
  </div></Layout>

  const worksUrl = profile.authorId ? `/api/authors/id/${profile.authorId}/books`
    : `/api/authors/classic/${encodeURIComponent(classicName)}/books`

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
            {!settings.reduceMotion && Array.from({ length: 8 }, (_, i) => (
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
          <Link href="/" aria-label={t("backToHome")}
            className="absolute start-4 top-4 grid min-h-11 min-w-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-amber-200"
            style={{
              background: "rgba(0,0,0,0.5)",
              border:     "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
            }}
          >
            <ArrowLeft className="w-4 h-4 text-white/70" />
          </Link>

          {/* Glow inferior */}
          <div
            className="absolute bottom-0 left-0 right-0 h-24"
            style={{ background: `linear-gradient(to top, rgba(0,0,0,0.98), transparent)` }}
          />
        </div>

        <div className="relative z-10 mx-auto -mt-14 max-w-6xl px-5 sm:px-8">
          <div className="grid items-start gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-6">
            <UserAvatar src={profile.avatar} name={authorName} size={104}
              frame={profile.frame || ""} accentColor={gc.color} />
            <div className="min-w-0 space-y-3 sm:pt-12">
              <p className="text-sm text-zinc-400">{isClassic ? copy.classic : copy.community}</p>
              <h1 className="break-words font-display text-3xl font-bold leading-tight text-white sm:text-4xl" dir="auto">{authorName}</h1>
              {(sourceAuthors.lifespan || dominantGenre) && <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
                {sourceAuthors.lifespan && <span title={copy.dates}>{sourceAuthors.lifespan}</span>}
                {dominantGenre && <span className="rounded-full border px-2.5 py-1 text-xs"
                  style={{ background: gc.bg, color: gc.color, borderColor: gc.color + "30" }}>
                  {knownGenre ? t(gc.tKey) : dominantGenre}
                </span>}
              </div>}
              {profile.bio?.trim() && <p dir="auto" className="max-w-2xl whitespace-pre-wrap break-words text-start text-sm leading-7 text-zinc-200">{profile.bio}</p>}
              <div className="w-fit max-w-full"><SocialLinks links={profile.socialLinks || {}} accentColor={gc.color} /></div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {sourceAuthors.names.map(name => <button type="button" key={name} onClick={() => setImportAuthor(name)}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-amber-200/30 px-4 text-start text-sm text-amber-100 hover:bg-amber-100/10">
              <LibraryBig className="h-4 w-4 shrink-0" />
              {sourceAuthors.names.length === 1 ? copy.gutenberg : gutenbergCopy(settings.language).byAuthor.replace("{name}", name)}
            </button>)}
            {canEdit && <button type="button" onClick={() => setEditing(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm text-zinc-100 hover:bg-white/10">
              <Pencil className="h-4 w-4" />{isClassic ? t("editProfileAdmin") : t("editProfile")}
            </button>}
            {isOwner && <button type="button" aria-pressed={publicView} onClick={() => setPublicView(value => !value)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm text-zinc-100 hover:bg-white/10">
              <Eye className="h-4 w-4" />{publicView ? t("exitPublicView") : t("howOthersSeeMe")}
            </button>}
          </div>

          {isOwner && !publicView && <div className="mt-5 grid gap-4 md:grid-cols-2">
            {/* Estadísticas privadas: corazones, apoyos, lectores */}
            {authorStats && authorStats.perBook.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full rounded-2xl px-4 py-3.5"
                style={{ background: `${gc.glow}0d`, border: `1px solid ${gc.color}30` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="w-3 h-3" style={{ color: "rgba(255,255,255,0.65)" }} />
                  <p className="text-xs font-sans font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
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
                    <p className="text-xs font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>{t("statHearts")}</p>
                  </div>
                  <div>
                    <span className="text-lg font-display font-bold text-white">{authorStats.totalSupports}</span>
                    <p className="text-xs font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>{t("statSupports")}</p>
                  </div>
                  <div>
                    <span className="text-lg font-display font-bold text-white">{authorStats.totalReaders}</span>
                    <p className="text-xs font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>{t("statReaders")}</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Ganancias y liquidación verificada */}
            {payout && (payout.availableCents > 0 || payout.heldCents > 0 || payout.payouts.length > 0) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full rounded-2xl px-4 py-3.5"
                style={{ background: `${gc.glow}0d`, border: `1px solid ${gc.color}30` }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: gc.color }} />
                  <p className="text-xs font-sans font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                    {t("earningsTitle")}
                  </p>
                  <InfoDot text={t("earningsPayoutNote")} color={gc.color} size={12} align="left" />
                </div>
                <p className="text-xl font-display font-bold" style={{ color: gc.color }}>
                  ${(payout.availableCents / 100).toFixed(2)} {payout.currency.toUpperCase()}
                </p>
                <p className="text-xs font-sans mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
                  {t("payoutAvailable")}
                </p>
                {payout.heldCents > 0 && (
                  <p className="text-xs font-sans mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
                    ${(payout.heldCents / 100).toFixed(2)} {payout.currency.toUpperCase()} · En espera según la fecha de cada operación
                  </p>
                )}
                {payout.payouts[0] && ["requested", "processing", "processing_unknown"].includes(payout.payouts[0].status) ? (
                  <p className="text-xs font-sans mt-2" style={{ color: gc.color }}>{t("payoutPending")}</p>
                ) : payout.enabled && !payout.account.ready ? (
                  <button
                    type="button" disabled={payoutBusy} onClick={beginPayoutOnboarding}
                    className="mt-3 w-full rounded-xl px-3 py-2 text-xs font-sans font-semibold disabled:opacity-50"
                    style={{ background: gc.color, color: "rgba(0,0,0,0.88)" }}
                  >
                    {payoutBusy ? t("processing") : t("payoutVerify")}
                  </button>
                ) : payout.enabled && payout.account.ready && payout.availableCents >= payout.minimumCents ? (
                  <button
                    type="button" disabled={payoutBusy} onClick={requestPayout}
                    className="mt-3 w-full rounded-xl px-3 py-2 text-xs font-sans font-semibold disabled:opacity-50"
                    style={{ background: gc.color, color: "rgba(0,0,0,0.88)" }}
                  >
                    {payoutBusy ? t("processing") : t("payoutRequest")}
                  </button>
                ) : !payout.enabled ? (
                  <p className="text-xs font-sans mt-2" style={{ color: "rgba(255,255,255,0.65)" }}>{t("payoutDisabled")}</p>
                ) : null}
                <a href="/legal/receipts" className="mt-3 block min-h-11 text-xs underline">Acuerdos y estado de cuenta detallado</a>
                {payoutMessage && (
                  <p className="text-xs font-sans mt-2" role="status" style={{ color: gc.color }}>{payoutMessage}</p>
                )}
              </motion.div>
            )}
          </div>}

          <AuthorWorks url={worksUrl} initialPage={profile} isOwner={isOwner && !publicView} />
        </div>

      </div>

      <ImportPanel open={importAuthor !== null} onClose={() => setImportAuthor(null)} initialAuthor={importAuthor || ""} />
      <AnimatePresence>
        {editing && canEdit && (
          <ProfileEditor
            authorName={authorName}
            classicName={classicName}
            initialBio={profile?.bio || ""}
            initialLinks={profile?.socialLinks || {}}
            initialAvatar={profile?.avatar || ""}
            initialBanner={profile?.banner || ""}
            initialFrame={profile?.frame || ""}
            isClassic={isClassic}
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
