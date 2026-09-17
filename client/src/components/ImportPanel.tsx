import { accountStorage as localStorage, accountFetch as fetch } from "@/lib/account-context"
import { useEffect, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, ExternalLink, LibraryBig, Loader2, Search, Upload, X } from "lucide-react"
import { useLocation } from "wouter"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"
import { useGenre } from "@/context/GenreContext"
import { slimBook, saveOfflineContent } from "@/lib/offline"
import { GUTENBERG_LANGUAGES, GUTENBERG_TOPICS, gutenbergLanguageName,
  type GutenbergBook, type GutenbergCatalogPage, type GutenbergPreview, type GutenbergSort, type GutenbergTopic } from "@shared/gutenberg"
import { gutenbergCopy } from "./gutenberg-copy"

const field = "w-full min-w-0 rounded-xl border border-white/15 bg-white/[.045] px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-200/60 focus:ring-2 focus:ring-amber-200/15"
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-40"

function Cover({ url, title, large = false }: { url?: string; title: string; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return <div className={"relative aspect-[2/3] shrink-0 overflow-hidden rounded-lg border border-amber-200/15 bg-gradient-to-br from-[#29251c] to-[#11141a] shadow-lg " + (large ? "w-28 sm:w-36" : "w-16 sm:w-20")}>
    {url && !failed ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      : <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-amber-100/65"><BookOpen className="h-5 w-5" /><span className="line-clamp-3 font-display text-[10px] leading-snug">{title}</span></div>}
  </div>
}

async function readJson<T>(url: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, signal })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || "HTTP " + response.status)
  return data as T
}

export default function ImportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <GutenbergExplorer onClose={onClose} />
      </Dialog.Content>
    </Dialog.Portal>}
  </Dialog.Root>
}

function GutenbergExplorer({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation()
  const { toast } = useToast()
  const { can } = useAuth()
  const isAdmin = can("manageCatalog")
  const { settings, t } = useSettings()
  const { cfg } = useGenre()
  const copy = gutenbergCopy(settings.language)
  const queryClient = useQueryClient()
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState({ query: "", lang: String(settings.language), topic: "" as GutenbergTopic, sort: "popular" as GutenbergSort, page: 1 })
  const [selected, setSelected] = useState<GutenbergPreview | null>(null)
  const [requested, setRequested] = useState<GutenbergBook | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [chapter, setChapter] = useState(0)
  const [title, setTitle] = useState("")
  const [synopsis, setSynopsis] = useState("")
  const [genre, setGenre] = useState("")
  const [destination, setDestination] = useState<"draft" | "published">("draft")
  const [saving, setSaving] = useState<"private" | "catalog" | null>(null)
  const [saveError, setSaveError] = useState("")
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
    }), signal), staleTime: 120_000, gcTime: 180_000, retry: false, refetchOnWindowFocus: false,
  })

  const editFilters = (patch: Partial<typeof filters>) => {
    previewRequest.current?.abort(); previewGeneration.current++
    setFilters(current => ({ ...current, ...patch, page: patch.page ?? 1 }))
    setSelected(null); setRequested(null); setShowDetail(false); setPreviewBusy(false); setPreviewError("")
    resultsPane.current?.scrollTo({ top: 0 })
  }
  const openExisting = (bookId: number, status?: string) => {
    navigate(status && status !== "published" ? "/editor?id=" + bookId + "&status=" + encodeURIComponent(status) : "/book/" + bookId)
    onClose()
  }

  async function openEdition(book: GutenbergBook) {
    if (book.existingBookId) { openExisting(book.existingBookId, book.existingStatus); return }
    previewRequest.current?.abort()
    const controller = new AbortController()
    previewRequest.current = controller
    const generation = ++previewGeneration.current
    setRequested(book); setShowDetail(true); setSelected(null); setPreviewError(""); setSaveError(""); setPreviewBusy(true)
    requestAnimationFrame(() => detailHeading.current?.focus())
    try {
      const data = await readJson<GutenbergPreview>("/api/gutenberg/preview/" + book.id + "?lang=" + settings.language, controller.signal)
      if (!mounted.current || generation !== previewGeneration.current) return
      if (data.existingBookId) { openExisting(data.existingBookId); return }
      setSelected(data); setTitle(data.title.slice(0, 200)); setSynopsis(data.synopsis); setGenre(data.detectedGenre); setChapter(0)
      detailPane.current?.scrollTo({ top: 0 })
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && generation === previewGeneration.current) setPreviewError(error instanceof Error ? error.message : copy.error)
    } finally {
      if (mounted.current && generation === previewGeneration.current) setPreviewBusy(false)
    }
  }

  async function savePrivate() {
    if (!selected || saving) return
    const edition = selected
    setSaving("private"); setSaveError("")
    try {
      // Edition ID stays stable across UI language changes.
      const id = "gutenberg-" + edition.gutenbergId
      const book = { ...edition, id, genre: edition.detectedGenre, isClassic: true, isSaved: true, status: "saved" }
      await saveOfflineContent(id, book)
      // Publish the shelf entry only after the complete text is confirmed in IndexedDB.
      let saved: any[] = []
      try { const value = JSON.parse(localStorage.getItem("novareads_saved") || "[]"); if (Array.isArray(value)) saved = value } catch { /* recover malformed shelf */ }
      localStorage.setItem("novareads_saved", JSON.stringify([slimBook(book), ...saved.filter(item => String(item.id) !== id)]))
      if (mounted.current) { toast({ title: t("saveBook") + " ✓" }); navigate("/book/" + id); onClose() }
    } catch (error) {
      if (mounted.current) setSaveError(error instanceof Error ? error.message : copy.error)
    } finally { if (mounted.current) setSaving(null) }
  }

  async function importEdition() {
    if (!selected || !isAdmin || saving) return
    setSaving("catalog"); setSaveError("")
    try {
      const data = await readJson<{ book: { id: number; status: string } }>("/api/admin/gutenberg/import", undefined, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gutenbergId: selected.gutenbergId, genre, overrideTitle: title.trim(),
          overrideSynopsis: synopsis.trim(), lang: settings.language, status: destination }),
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/books"] }),
        queryClient.invalidateQueries({ queryKey: ["gutenberg-catalog"] }),
      ])
      if (mounted.current) {
        toast({ title: data.book.status === "draft" ? copy.draftSaved : copy.publish + " ✓" })
        openExisting(data.book.id, data.book.status)
      }
    } catch (error) {
      if (mounted.current) { setSaveError(error instanceof Error ? error.message : copy.error); void queryClient.invalidateQueries({ queryKey: ["gutenberg-catalog"] }) }
    } finally { if (mounted.current) setSaving(null) }
  }

  const currentChapter = selected?.chapters[chapter]
  const accent = { backgroundColor: cfg.color, color: "#0b0d11" }
  return <div className="flex min-h-0 flex-1 flex-col" dir={settings.language === "ar" ? "rtl" : "ltr"}>
    <header className="relative shrink-0 border-b border-white/10 bg-gradient-to-r from-amber-100/[.06] to-transparent px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="mb-1 text-[10px] uppercase tracking-[.3em] text-amber-100/60">Project Gutenberg · Tloque</p>
          <Dialog.Title className="font-display text-xl text-amber-50 sm:text-3xl">{copy.explore}</Dialog.Title>
          <Dialog.Description className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-400 sm:text-sm">{copy.lead}</Dialog.Description>
        </div>
        <Dialog.Close className={button + " shrink-0 rounded-full p-3"} aria-label={t("cancel")}><X className="h-4 w-4" /></Dialog.Close>
      </div>
    </header>

    <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_1fr]">
      <div ref={resultsPane} className={"min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:border-e lg:border-white/10 " + (showDetail ? "hidden lg:block" : "")}>
        <form onSubmit={event => { event.preventDefault(); editFilters({ query: query.trim() }) }} className="space-y-3">
          <div className="flex gap-2"><label className="relative min-w-0 flex-1"><span className="sr-only">{copy.search}</span>
            <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-zinc-500" />
            <input value={query} onChange={event => setQuery(event.target.value)} maxLength={120} placeholder={copy.search} className={field + " ps-9"} />
          </label><button type="submit" className={button + " shrink-0 border-transparent px-4"} style={accent} aria-label={t("search")}><Search className="h-4 w-4" /></button></div>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 space-y-1 text-[11px] text-zinc-400">{copy.language}
              <select aria-label={copy.language} className={field} value={filters.lang} onChange={event => editFilters({ lang: event.target.value })}>
                {GUTENBERG_LANGUAGES.map(([value, label]) => <option key={value} value={value} className="bg-zinc-900">{label}</option>)}
                <option value="all" className="bg-zinc-900">{copy.all}</option>
              </select></label>
            <label className="min-w-0 space-y-1 text-[11px] text-zinc-400">{copy.sort}
              <select aria-label={copy.sort} className={field} value={filters.sort} onChange={event => editFilters({ sort: event.target.value as GutenbergSort })}>
                {(["popular", "descending", "ascending"] as const).map(value => <option key={value} value={value} className="bg-zinc-900">{copy[value]}</option>)}
              </select></label>
          </div>
          <label className="block space-y-1 text-[11px] text-zinc-400">{copy.topic}<select aria-label={copy.topic} className={field} value={filters.topic} onChange={event => editFilters({ topic: event.target.value as GutenbergTopic })}>
            {GUTENBERG_TOPICS.map((value, i) => <option key={value} value={value} className="bg-zinc-900">{copy.topics[i]}</option>)}
          </select></label>
        </form>

        <div className="my-4 flex min-h-5 items-center justify-between gap-2 text-[11px] text-zinc-400" role="status" aria-live="polite">
          <span>{catalog.isFetching ? t("searching") : catalog.data && !catalog.isError ? copy.results.replace("{n}", catalog.data.count.toLocaleString(settings.language)) : ""}</span>
          {catalog.data && <span>{copy.page} {catalog.data.page}</span>}
        </div>
        {catalog.isError && <div role="alert" className="mb-4 rounded-2xl border border-amber-100/20 bg-amber-100/5 p-4"><p className="text-sm text-zinc-300">{copy.error}</p><button onClick={() => void catalog.refetch()} className={button + " mt-3"}>{copy.retry}</button></div>}
        {catalog.isPending && !catalog.isError && <div aria-hidden="true" className={"space-y-3 " + (settings.reduceMotion ? "" : "motion-safe:animate-pulse")}>{[1, 2, 3].map(i => <div key={i} className="h-32 rounded-2xl border border-white/5 bg-white/[.035]" />)}</div>}
        {!catalog.isError && catalog.data?.results.length === 0 && <div className="rounded-2xl border border-dashed border-amber-100/20 px-5 py-8 text-center"><BookOpen className="mx-auto mb-3 h-6 w-6 text-amber-200/50" /><p className="text-sm text-zinc-300">{copy.empty}</p>
          {filters.lang !== "all" && <button className={button + " mt-4"} onClick={() => editFilters({ lang: "all" })}>{copy.tryAll}</button>}</div>}
        <div className="space-y-3" aria-busy={catalog.isFetching}>
          {catalog.data?.results.map(book => <button key={book.id} type="button" onClick={event => { lastResult.current = event.currentTarget; void openEdition(book) }} aria-label={book.title} aria-pressed={requested?.id === book.id}
            className={"group flex w-full items-start gap-4 rounded-2xl border p-3 text-start transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 " + (requested?.id === book.id ? "border-amber-200/45 bg-amber-100/[.065]" : "border-white/10 bg-white/[.02] hover:border-amber-200/30 hover:bg-white/[.045]")}>
            <Cover url={book.coverUrl} title={book.title} />
            <div className="min-w-0 flex-1 py-1"><p className="mb-1 text-[10px] uppercase tracking-widest text-amber-100/50">#{book.id} · {book.languages.map(gutenbergLanguageName).join(" / ")}</p>
              <h3 className="line-clamp-2 break-words font-display text-base leading-snug text-zinc-100">{book.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{book.authors.map(author => author.name).join(" · ")}</p>
              {book.alreadyImported ? <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-100/80"><Check className="h-3 w-3" />{copy.existing}{book.existingStatus === "draft" ? " · " + t("drafts") : ""}</p>
                : <p className="mt-2 text-[11px] text-zinc-500">{Number(book.download_count || 0).toLocaleString(settings.language)} {t("downloads")}</p>}
            </div>
          </button>)}
        </div>
        {catalog.data && (catalog.data.previousPage || catalog.data.nextPage) && <nav aria-label={copy.page} className="mt-5 flex justify-between gap-3 pb-2">
          <button className={button} disabled={!catalog.data.previousPage || catalog.isFetching} onClick={() => editFilters({ page: catalog.data!.previousPage! })}><ArrowLeft className="h-4 w-4" />{copy.previous}</button>
          <button className={button} disabled={!catalog.data.nextPage || catalog.isFetching} onClick={() => editFilters({ page: catalog.data!.nextPage! })}>{copy.next}<ArrowRight className="h-4 w-4" /></button>
        </nav>}
      </div>

      <div ref={detailPane} className={"min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 " + (showDetail ? "" : "hidden lg:block")}>
        {showDetail && <button onClick={() => { setShowDetail(false); requestAnimationFrame(() => lastResult.current?.focus()) }} className={button + " mb-4 lg:hidden"}><ArrowLeft className="h-4 w-4" />{copy.back}</button>}
        <h2 ref={detailHeading} tabIndex={-1} className="sr-only">{requested?.title || copy.choose}</h2>
        {!requested && <div className="flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-amber-100/10 bg-gradient-to-b from-amber-100/[.045] to-transparent p-8 text-center">
          <LibraryBig className="mb-6 h-12 w-12 stroke-[1] text-amber-100/50" /><h3 className="font-display text-2xl text-amber-50">{copy.choose}</h3><p className="mt-3 max-w-xs text-sm leading-relaxed text-zinc-400">{copy.chooseHint}</p>
        </div>}
        {previewBusy && <div role="status" className="rounded-2xl border border-white/10 p-8 text-center"><Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-amber-100/70" /><p className="text-sm text-zinc-300">{copy.loading}</p></div>}
        {previewError && <div role="alert" className="rounded-2xl border border-amber-100/20 p-5"><p className="text-sm text-zinc-300">{previewError}</p><button className={button + " mt-4"} onClick={() => requested && void openEdition(requested)}>{copy.retry}</button></div>}
        {selected && <div className="space-y-5">
          <div className="flex items-start gap-4"><Cover url={selected.coverUrl} title={selected.title} large /><div className="min-w-0 pt-1">
            <p className="text-[10px] uppercase tracking-widest text-amber-100/60">{selected.languages.map(gutenbergLanguageName).join(" / ")}</p>
            <h3 className="mt-2 break-words font-display text-xl leading-tight text-amber-50 sm:text-2xl">{selected.title}</h3><p className="mt-2 text-sm text-zinc-400">{selected.author}</p>
            {selected.translators.length > 0 && <p className="mt-2 text-xs text-zinc-400">{copy.translators}: {selected.translators.join(" · ")}</p>}
            <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-amber-100/75 underline underline-offset-4">Gutenberg #{selected.gutenbergId}<ExternalLink className="h-3 w-3" /></a>
          </div></div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[.025] p-3 text-center">
            {[[selected.chapterCount, t("chapters")], [selected.wordCount.toLocaleString(settings.language), copy.words], [selected.readingMinutes, copy.minutes]].map(([number, label]) => <div key={label} className="min-w-0"><p className="font-display text-lg text-amber-50">{number}</p><p className="mt-1 text-[10px] leading-tight text-zinc-400">{label}</p></div>)}
          </div>
          <div><p className="mb-2 text-[10px] uppercase tracking-widest text-amber-100/60">{selected.synopsisSource === "gutendex" ? copy.sourceSummary : copy.metadataSummary}</p><p dir="auto" className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">{selected.synopsis}</p></div>
          <p className="text-xs leading-relaxed text-zinc-500">{copy.original}</p>
          <section className="rounded-2xl border border-amber-100/15 bg-amber-50/[.025] p-4">
            <h4 className="mb-3 font-display text-lg text-amber-50">{copy.sample}</h4>
            <label className="block space-y-2 text-xs text-zinc-400">{t("chapters")}<select aria-label={t("chapters")} className={field} value={chapter} onChange={event => setChapter(Number(event.target.value))}>
              {selected.chapters.map((item, i) => <option key={i} value={i} className="bg-zinc-900">{i + 1}. {item.title.slice(0, 150)}</option>)}
            </select></label>
            <div dir="auto" data-testid="gutenberg-sample" className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-black/20 p-4 font-serif text-base leading-8 text-[#d5d0c5]">{currentChapter?.content.slice(0, 4_000)}</div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">{copy.sampleHint}</p>
          </section>
          <p className="text-xs leading-relaxed text-zinc-400">{selected.chapterStrategy === "full-text" ? copy.full : copy.detected}</p>
          {isAdmin && <details className="rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer text-sm text-amber-100/80">{copy.ready}</summary><div className="mt-4 space-y-3">
            <label className="block space-y-1 text-xs text-zinc-400">{t("title")}<input className={field} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
            <label className="block space-y-1 text-xs text-zinc-400">{t("genre_label")}<input className={field} value={genre} maxLength={60} onChange={event => setGenre(event.target.value)} /></label>
            <label className="block space-y-1 text-xs text-zinc-400">{t("synopsis")}<textarea className={field + " min-h-32"} value={synopsis} maxLength={8000} onChange={event => setSynopsis(event.target.value)} /></label>
          </div></details>}
          <p className="text-[11px] leading-relaxed text-zinc-500">{t("gutenbergRightsNotice")}</p>
          {saveError && <p role="alert" className="rounded-xl border border-amber-200/20 p-3 text-sm text-amber-100">{saveError}</p>}
          {isAdmin && <label className="block space-y-1 text-xs text-zinc-400">{copy.importAs}<select aria-label={copy.importAs} className={field} value={destination} onChange={event => setDestination(event.target.value as "draft" | "published")} disabled={!!saving}>
            <option value="draft" className="bg-zinc-900">{copy.draft}</option><option value="published" className="bg-zinc-900">{copy.publish}</option>
          </select></label>}
          <div className="grid gap-3 pb-3 sm:grid-cols-2"><button className={button} onClick={() => void savePrivate()} disabled={!!saving}>{saving === "private" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{t("saveBook")}</button>
            {isAdmin && <button className={button + " border-transparent"} style={accent} onClick={() => void importEdition()} disabled={!!saving}>{saving === "catalog" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{destination === "draft" ? copy.draft : copy.publish}</button>}
          </div>
        </div>}
      </div>
    </div>
  </div>
}
