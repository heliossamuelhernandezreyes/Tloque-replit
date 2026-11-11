import { accountFetch as fetch } from "@/lib/account-context"
import { useEffect, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, BookOpen, Check, ExternalLink, LibraryBig, Loader2, Search, Upload, X } from "lucide-react"
import { useLocation } from "wouter"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"
import { useGenre } from "@/context/GenreContext"
import { GUTENBERG_LANGUAGES, GUTENBERG_SAMPLE_LENGTH, GUTENBERG_TOPICS, gutenbergLanguageName,
  type GutenbergBook, type GutenbergCatalogPage, type GutenbergPreview, type GutenbergSort, type GutenbergTopic } from "@shared/gutenberg"
import { gutenbergCopy } from "./gutenberg-copy"

const field = "w-full min-w-0 rounded-xl border border-white/15 bg-white/[.045] px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-200/60 focus:ring-2 focus:ring-amber-200/15"
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-40"

function Cover({ url, title, large = false }: { url?: string; title: string; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return <div className={"relative aspect-[2/3] shrink-0 overflow-hidden rounded-lg border border-amber-200/15 bg-gradient-to-br from-[#29251c] to-[#11141a] shadow-lg " + (large ? "w-28 sm:w-36" : "w-16 sm:w-20")}>
    {url && !failed ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      : <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-amber-100/65"><BookOpen className="h-5 w-5" /><span className="line-clamp-3 font-display text-xs leading-snug">{title}</span></div>}
  </div>
}

class GutenbergRequestError extends Error {
  constructor(readonly status: number, readonly data: Record<string, unknown> | null) {
    super(typeof data?.message === "string" ? data.message : "")
  }
}

async function readJson<T>(url: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, signal })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || typeof data !== "object") throw new GutenbergRequestError(response.status, data)
  return data as T
}

export default function ImportPanel({ open, onClose, initialQuery = "" }: { open: boolean; onClose: () => void; initialQuery?: string }) {
  const content = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  if (open && !wasOpen.current && typeof document !== "undefined") opener.current = document.activeElement as HTMLElement
  wasOpen.current = open
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose() }}>
    {open && <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[290] bg-black/90" />
      <Dialog.Content ref={content} onOpenAutoFocus={event => { event.preventDefault(); content.current?.focus() }}
        onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } }}
        className="fixed inset-x-2 bottom-2 top-2 z-[300] mx-auto flex max-w-6xl flex-col overflow-hidden rounded-3xl border border-amber-100/15 bg-[#0b0d11] shadow-2xl outline-none sm:inset-x-5 sm:bottom-5 sm:top-5">
        <GutenbergExplorer onClose={onClose} initialQuery={initialQuery.trim().slice(0, 120)} />
      </Dialog.Content>
    </Dialog.Portal>}
  </Dialog.Root>
}

function GutenbergExplorer({ onClose, initialQuery }: { onClose: () => void; initialQuery: string }) {
  const [, navigate] = useLocation()
  const { toast } = useToast()
  const { can } = useAuth()
  const { settings, t } = useSettings()
  const isAdmin = can("manageCatalog") && (settings.adminMode ?? true)
  const { cfg } = useGenre()
  const copy = gutenbergCopy(settings.language)
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(initialQuery)
  const [filters, setFilters] = useState({ query: initialQuery, lang: String(settings.language), topic: "" as GutenbergTopic, sort: "popular" as GutenbergSort, page: 1 })
  const [selected, setSelected] = useState<GutenbergPreview | null>(null)
  const [requested, setRequested] = useState<GutenbergBook | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [chapter, setChapter] = useState(0)
  const [title, setTitle] = useState("")
  const [synopsis, setSynopsis] = useState("")
  const [genre, setGenre] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<{ message: string; existing?: { id: number; status?: string } } | null>(null)
  const previewRequest = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const resultsPane = useRef<HTMLDivElement>(null)
  const detailPane = useRef<HTMLDivElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const lastResult = useRef<HTMLButtonElement | null>(null)
  const previewGeneration = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; previewRequest.current?.abort() }
  }, [])

  const catalog = useQuery({
    queryKey: ["gutenberg-catalog", filters, isAdmin],
    queryFn: ({ signal }) => readJson<GutenbergCatalogPage>("/api/gutenberg/catalog?" + new URLSearchParams({
      q: filters.query, lang: filters.lang, topic: filters.topic, sort: filters.sort, page: String(filters.page),
      includeUnpublished: String(isAdmin),
    }), signal), staleTime: 120_000, gcTime: 180_000, retry: false, refetchOnWindowFocus: false,
  })

  function closeDetails() {
    previewRequest.current?.abort()
    previewRequest.current = null
    previewGeneration.current++
    setSelected(null)
    setRequested(null)
    setShowDetail(false)
    setPreviewBusy(false)
    setPreviewError("")
    setSaveError(null)
  }
  const editFilters = (patch: Partial<typeof filters>) => {
    if (saving) return
    closeDetails()
    setFilters(current => ({ ...current, ...patch, page: patch.page ?? 1 }))
    resultsPane.current?.scrollTo({ top: 0 })
  }
  const openExisting = (bookId: number, status?: string) => {
    navigate(status && status !== "published" ? "/editor?id=" + bookId + "&source=server&status=" + encodeURIComponent(status) : "/book/" + bookId)
    onClose()
  }

  async function openEdition(book: GutenbergBook) {
    if (saving) return
    previewRequest.current?.abort()
    const generation = ++previewGeneration.current
    if (book.existingBookId) { openExisting(book.existingBookId, book.existingStatus); return }
    const controller = new AbortController()
    previewRequest.current = controller
    setRequested(book); setShowDetail(true); setSelected(null); setPreviewError(""); setSaveError(null); setPreviewBusy(true)
    requestAnimationFrame(() => detailHeading.current?.focus())
    try {
      const data = await readJson<GutenbergPreview>("/api/gutenberg/preview/" + book.id + "?lang=" + settings.language, controller.signal)
      if (!mounted.current || generation !== previewGeneration.current) return
      if (data.existingBookId) { openExisting(data.existingBookId, data.existingStatus); return }
      if (typeof data.title !== "string" || !Array.isArray(data.chapters)) throw new Error(copy.error)
      setTitle(data.title.slice(0, 200))
      setSynopsis(data.synopsis)
      setGenre(data.detectedGenre)
      setChapter(0)
      setSelected(data)
      detailPane.current?.scrollTo({ top: 0 })
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && generation === previewGeneration.current) {
        setPreviewError(error instanceof GutenbergRequestError && error.message ? error.message : copy.error)
      }
    } finally {
      if (mounted.current && generation === previewGeneration.current) setPreviewBusy(false)
    }
  }

  async function importEdition() {
    if (!selected || !isAdmin || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const data = await readJson<{ book: { id: number; status: string } }>("/api/admin/gutenberg/import", undefined, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gutenbergId: selected.gutenbergId, genre, overrideTitle: title.trim(),
          overrideSynopsis: synopsis.trim(), lang: settings.language, status: "draft" }),
      })
      void queryClient.invalidateQueries({ queryKey: ["/api/books"] })
      void queryClient.invalidateQueries({ queryKey: ["gutenberg-catalog"] })
      if (mounted.current) {
        toast({ title: data.book.status === "draft" ? copy.draftSaved : copy.publish + " ✓" })
        openExisting(data.book.id, data.book.status)
      }
    } catch (error) {
      if (!mounted.current) return
      const response = error instanceof GutenbergRequestError ? error : null
      const id = response?.data?.existingBookId
      const status = response?.data?.existingStatus
      const existing = response?.status === 409 && typeof id === "number" && Number.isSafeInteger(id) && id > 0
        ? { id, status: typeof status === "string" ? status : undefined } : undefined
      setSaveError({ message: response?.message || copy.error, existing })
      void queryClient.invalidateQueries({ queryKey: ["gutenberg-catalog"] })
    } finally { if (mounted.current) setSaving(false) }
  }

  const currentChapter = selected?.chapters[chapter]
  const existingImport = saveError?.existing
  const accent = { backgroundColor: cfg.color, color: "#0b0d11" }
  return <div className="flex min-h-0 flex-1 flex-col" dir={settings.language === "ar" ? "rtl" : "ltr"}>
    <header className="relative shrink-0 border-b border-white/10 bg-gradient-to-r from-amber-100/[.06] to-transparent px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="mb-1 text-xs uppercase tracking-[.3em] text-amber-100/60">Project Gutenberg · Tloque</p>
          <Dialog.Title className="font-display text-xl text-amber-50 sm:text-3xl">{copy.explore}</Dialog.Title>
          <Dialog.Description className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-400 sm:text-sm">{copy.lead}</Dialog.Description>
        </div>
        <Dialog.Close className={button + " shrink-0 rounded-full p-3"} aria-label={t("cancel")}><X className="h-4 w-4" /></Dialog.Close>
      </div>
    </header>

    <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_1fr]">
      <div ref={resultsPane} className={"min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:border-e lg:border-white/10 " + (showDetail ? "hidden lg:block" : "")}>
        <form onSubmit={event => {
          event.preventDefault()
          if (saving) return
          if (query.trim() === filters.query && filters.page === 1) void catalog.refetch()
          else editFilters({ query: query.trim() })
        }} className="space-y-3">
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <div className="flex gap-2"><label className="relative min-w-0 flex-1"><span className="sr-only">{copy.search}</span>
              <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-zinc-400" />
              <input value={query} onChange={event => setQuery(event.target.value)} maxLength={120} placeholder={copy.search} className={field + " ps-9"} />
            </label><button type="submit" className={button + " shrink-0 border-transparent px-4"} style={accent} aria-label={t("search")}><Search className="h-4 w-4" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 space-y-1 text-xs text-zinc-400">{copy.language}
                <select aria-label={copy.language} className={field} value={filters.lang} onChange={event => editFilters({ lang: event.target.value })}>
                  {GUTENBERG_LANGUAGES.map(([value, label]) => <option key={value} value={value} className="bg-zinc-900">{label}</option>)}
                  <option value="all" className="bg-zinc-900">{copy.all}</option>
                </select></label>
              <label className="min-w-0 space-y-1 text-xs text-zinc-400">{copy.sort}
                <select aria-label={copy.sort} className={field} value={filters.sort} onChange={event => editFilters({ sort: event.target.value as GutenbergSort })}>
                  {(["popular", "descending", "ascending"] as const).map(value => <option key={value} value={value} className="bg-zinc-900">{copy[value]}</option>)}
                </select></label>
            </div>
            <label className="block space-y-1 text-xs text-zinc-400">{copy.topic}<select aria-label={copy.topic} className={field} value={filters.topic} onChange={event => editFilters({ topic: event.target.value as GutenbergTopic })}>
              {GUTENBERG_TOPICS.map((value, i) => <option key={value} value={value} className="bg-zinc-900">{copy.topics[i]}</option>)}
            </select></label>
          </fieldset>
        </form>

        <div className="my-4 flex min-h-5 items-center justify-between gap-2 text-xs text-zinc-400" role="status" aria-live="polite">
          <span>{catalog.isFetching ? t("searching") : catalog.data && !catalog.isError ? copy.results.replace("{n}", catalog.data.count.toLocaleString(settings.language)) : ""}</span>
          {catalog.data && <span>{copy.page} {catalog.data.page}</span>}
        </div>
        {catalog.isError && <div role="alert" className="mb-4 rounded-2xl border border-amber-100/20 bg-amber-100/5 p-4"><p className="text-sm text-zinc-300">{copy.error}</p><button disabled={catalog.isFetching} onClick={() => void catalog.refetch()} className={button + " mt-3"}>{copy.retry}</button></div>}
        {!catalog.isError && catalog.data?.cacheStatus === "stale" && <div role="status" data-testid="gutenberg-stale" className="mb-4 rounded-2xl border border-amber-100/20 bg-amber-100/5 p-4">
          <p className="text-sm leading-relaxed text-zinc-300">{copy.stale}</p>
          {typeof catalog.data.fetchedAt === "number" && <time dateTime={new Date(catalog.data.fetchedAt).toISOString()} className="mt-2 block text-xs text-zinc-400">{new Date(catalog.data.fetchedAt).toLocaleString(settings.language)}</time>}
          <button disabled={catalog.isFetching} onClick={() => void catalog.refetch()} className={button + " mt-3"}>{copy.retry}</button>
        </div>}
        {catalog.isPending && !catalog.isError && <div aria-hidden="true" className={"space-y-3 " + (settings.reduceMotion ? "" : "motion-safe:animate-pulse")}>{[1, 2, 3].map(i => <div key={i} className="h-32 rounded-2xl border border-white/5 bg-white/[.035]" />)}</div>}
        {!catalog.isError && catalog.data?.results.length === 0 && <div className="rounded-2xl border border-dashed border-amber-100/20 px-5 py-8 text-center"><BookOpen className="mx-auto mb-3 h-6 w-6 text-amber-200/50" /><p className="text-sm text-zinc-300">{catalog.data.nextPage || catalog.data.previousPage ? copy.emptyPage : copy.empty}</p>
          {filters.lang !== "all" && <button className={button + " mt-4"} onClick={() => editFilters({ lang: "all" })}>{copy.tryAll}</button>}</div>}
        <div className="space-y-3" aria-busy={catalog.isFetching}>
          {catalog.data?.results.map(book => <button key={book.id} type="button" disabled={saving} onClick={event => { lastResult.current = event.currentTarget; void openEdition(book) }} aria-label={book.title} aria-pressed={requested?.id === book.id}
            className={"group flex w-full items-start gap-4 rounded-2xl border p-3 text-start transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 " + (requested?.id === book.id ? "border-amber-200/45 bg-amber-100/[.065]" : "border-white/10 bg-white/[.02] hover:border-amber-200/30 hover:bg-white/[.045]")}>
            <Cover url={book.coverUrl} title={book.title} />
            <div className="min-w-0 flex-1 py-1"><p className="mb-1 text-xs uppercase tracking-widest text-amber-100/50">#{book.id} · {book.languages.map(gutenbergLanguageName).join(" / ")}</p>
              <h3 className="line-clamp-2 break-words font-display text-base leading-snug text-zinc-100">{book.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{book.authors.map(author => author.name).join(" · ")}</p>
              {book.alreadyImported ? <p className="mt-2 flex items-center gap-1 text-xs text-amber-100/80"><Check className="h-3 w-3" />{copy.existing}{book.existingStatus === "draft" ? " · " + t("drafts") : ""}</p>
                : <p className="mt-2 text-xs text-zinc-400">{Number(book.download_count || 0).toLocaleString(settings.language)} {t("downloads")}</p>}
            </div>
          </button>)}
        </div>
        {catalog.data && (catalog.data.previousPage || catalog.data.nextPage) && <nav aria-label={copy.page} className="mt-5 flex justify-between gap-3 pb-2">
          <button className={button} disabled={saving || !catalog.data.previousPage || catalog.isFetching} onClick={() => editFilters({ page: catalog.data!.previousPage! })}><ArrowLeft className="h-4 w-4" />{copy.previous}</button>
          <button className={button} disabled={saving || !catalog.data.nextPage || catalog.isFetching} onClick={() => editFilters({ page: catalog.data!.nextPage! })}>{copy.next}<ArrowRight className="h-4 w-4" /></button>
        </nav>}
      </div>

      <div ref={detailPane} className={"min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 " + (showDetail ? "" : "hidden lg:block")}>
        {showDetail && <button disabled={saving} onClick={() => {
          closeDetails()
          requestAnimationFrame(() => lastResult.current?.focus())
        }} className={button + " mb-4 lg:hidden"}><ArrowLeft className="h-4 w-4" />{copy.back}</button>}
        <h2 ref={detailHeading} tabIndex={-1} className="sr-only">{requested?.title || copy.choose}</h2>
        {!requested && <div className="flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-amber-100/10 bg-gradient-to-b from-amber-100/[.045] to-transparent p-8 text-center">
          <LibraryBig className="mb-6 h-12 w-12 stroke-[1] text-amber-100/50" /><h3 className="font-display text-2xl text-amber-50">{copy.choose}</h3><p className="mt-3 max-w-xs text-sm leading-relaxed text-zinc-400">{copy.chooseHint}</p>
        </div>}
        {previewBusy && <div role="status" className="rounded-2xl border border-white/10 p-8 text-center"><Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-amber-100/70" /><p className="text-sm text-zinc-300">{copy.loading}</p></div>}
        {previewError && <div role="alert" className="rounded-2xl border border-amber-100/20 p-5"><p className="text-sm text-zinc-300">{previewError}</p><button className={button + " mt-4"} onClick={() => requested && void openEdition(requested)}>{copy.retry}</button></div>}
        {selected && <div className="space-y-5">
          <div className="flex items-start gap-4"><Cover url={selected.coverUrl} title={selected.title} large /><div className="min-w-0 pt-1">
            <p className="text-xs uppercase tracking-widest text-amber-100/60">{selected.languages.map(gutenbergLanguageName).join(" / ")}</p>
            <h3 className="mt-2 break-words font-display text-xl leading-tight text-amber-50 sm:text-2xl">{selected.title}</h3><p className="mt-2 text-sm text-zinc-400">{selected.author}</p>
            {selected.translators.length > 0 && <p className="mt-2 text-xs text-zinc-400">{copy.translators}: {selected.translators.join(" · ")}</p>}
            <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-amber-100/75 underline underline-offset-4">Gutenberg #{selected.gutenbergId}<ExternalLink className="h-3 w-3" /></a>
          </div></div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[.025] p-3 text-center">
            {[[selected.chapterCount, t("chapters")], [selected.wordCount.toLocaleString(settings.language), copy.words], [selected.readingMinutes, copy.minutes]].map(([number, label]) => <div key={label} className="min-w-0"><p className="font-display text-lg text-amber-50">{number}</p><p className="mt-1 text-xs leading-tight text-zinc-400">{label}</p></div>)}
          </div>
          <div><p className="mb-2 text-xs uppercase tracking-widest text-amber-100/60">{selected.synopsisSource === "gutendex" ? copy.sourceSummary : copy.metadataSummary}</p><p dir="auto" className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">{selected.synopsis}</p></div>
          <p className="text-xs leading-relaxed text-zinc-400">{copy.original}</p>
          <section className="rounded-2xl border border-amber-100/15 bg-amber-50/[.025] p-4">
            <h4 className="mb-3 font-display text-lg text-amber-50">{copy.sample}</h4>
            <label className="block space-y-2 text-xs text-zinc-400">{t("chapters")}<select aria-label={t("chapters")} className={field} value={chapter} onChange={event => setChapter(Number(event.target.value))}>
              {selected.chapters.map((item, i) => <option key={i} value={i} className="bg-zinc-900">{i + 1}. {item.title.slice(0, 150)}</option>)}
            </select></label>
            <div dir="auto" data-testid="gutenberg-sample" className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-black/20 p-4 font-serif text-base leading-8 text-[#d5d0c5]">{currentChapter?.content.slice(0, GUTENBERG_SAMPLE_LENGTH)}</div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">{copy.sampleHint}</p>
          </section>
          <p className="text-xs leading-relaxed text-zinc-400">{selected.chapterStrategy === "full-text" ? copy.full : copy.detected}</p>
          {isAdmin && <details className="rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer text-sm text-amber-100/80">{copy.ready}</summary><div className="mt-4 space-y-3">
            <label className="block space-y-1 text-xs text-zinc-400">{t("title")}<input className={field} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
            <label className="block space-y-1 text-xs text-zinc-400">{t("genre_label")}<input className={field} value={genre} maxLength={60} onChange={event => setGenre(event.target.value)} /></label>
            <label className="block space-y-1 text-xs text-zinc-400">{t("synopsis")}<textarea className={field + " min-h-32"} value={synopsis} maxLength={8000} onChange={event => setSynopsis(event.target.value)} /></label>
          </div></details>}
          <p className="text-xs leading-relaxed text-zinc-400">{t("gutenbergRightsNotice")}</p>
          <p className="text-xs leading-relaxed text-zinc-400">{isAdmin ? copy.draftNotice : copy.reviewNotice}</p>
          {saveError && <div className="space-y-3 rounded-xl border border-amber-200/20 p-3 text-sm text-amber-100">
            <p role="alert">{saveError.message}</p>
            {existingImport && <button className={button} onClick={() => openExisting(existingImport.id, existingImport.status)}>{copy.existing}</button>}
          </div>}
          {isAdmin && <button className={button + " border-transparent"} style={accent} onClick={() => void importEdition()} disabled={saving} aria-busy={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{copy.draft}
          </button>}
        </div>}
      </div>
    </div>
  </div>
}
