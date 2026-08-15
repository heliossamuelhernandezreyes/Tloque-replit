import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  BookOpen, Download, ExternalLink,
  Loader2, Search, Sparkles, Upload, X,
} from "lucide-react"
import { useLocation } from "wouter"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useBooks } from "@/hooks/use-books"
import { useSettings } from "@/context/SettingsContext"
import { useGenre } from "@/context/GenreContext"
import { slimBook, saveOfflineContent } from "@/lib/offline"

interface Props {
  open:    boolean
  onClose: () => void
}

type SearchResult = {
  id:            number
  title:         string
  authors:       { name: string }[]
  languages:     string[]
  subjects:      string[]
  download_count: number
  existingBookId?: number | null
  alreadyImported?: boolean
}

type PreviewResult = {
  gutenbergId:      number
  title:            string
  author:           string
  synopsis:         string
  coverUrl:         string
  originalLanguage: string
  publicationYear:  number | null
  detectedGenre:    string
  type:             "book" | "story"
  existingBookId?:  number | null
  alreadyImported?: boolean
  chapterCount:     number
  previewText:      string
}

const LANGUAGE_OPTIONS = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "ar", label: "العربية" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
  { value: "fi", label: "Suomi" },
  { value: "sv", label: "Svenska" },
  { value: "la", label: "Latina" },
  { value: "el", label: "Ελληνικά" },
]

function normalizeText(v: string) {
  return v.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function savePrivateClassic(book: any) {
  const current = JSON.parse(localStorage.getItem("novareads_saved") || "[]")
  const slim = { ...slimBook(book), isSaved: true }
  const next = current.some((i: any) => String(i.id) === String(book.id))
    ? current.map((i: any) => String(i.id) === String(book.id) ? slim : i)
    : [slim, ...current]
  localStorage.setItem("novareads_saved", JSON.stringify(next))
  saveOfflineContent(book.id, book)   // contenido pesado → IndexedDB
}

export default function ImportPanel({ open, onClose }: Props) {
  const [, setLocation] = useLocation()
  const { toast }       = useToast()
  const { isAdmin }     = useAuth()
  const { data: catalogBooks, refetch } = useBooks()
  const { settings, t } = useSettings()
  const { cfg }         = useGenre()
  // El panel solo se expone desde superficies administrativas; la API vuelve
  // a comprobar el rol. No depende de un ajuste visual del lector.
  const canPublish      = isAdmin

  const [query,          setQuery]          = useState("")
  const [lang,           setLang]           = useState("es")
  const [results,        setResults]        = useState<SearchResult[]>([])
  const [selected,       setSelected]       = useState<PreviewResult | null>(null)
  const [adminTitle,     setAdminTitle]     = useState("")
  const [adminSynopsis,  setAdminSynopsis]  = useState("")
  const [adminGenre,     setAdminGenre]     = useState("")
  const [searching,      setSearching]      = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [downloading,    setDownloading]    = useState(false)
  const [importing,      setImporting]      = useState(false)

  // Detectar idioma preferido al abrir
  useEffect(() => {
    if (!open) return
    const preferred = LANGUAGE_OPTIONS.some(o => o.value === settings.language)
      ? settings.language : "es"
    setLang(preferred)
  }, [open, settings.language])

  // Limpiar al cerrar
  useEffect(() => {
    if (open) return
    setQuery(""); setResults([]); setSelected(null)
    setAdminTitle(""); setAdminSynopsis(""); setAdminGenre("")
  }, [open])

  const exactCatalogMatch = useMemo(() => {
    const nq = normalizeText(query)
    if (!nq) return null
    return (catalogBooks || []).find((b: any) =>
      !!b?.isClassic && (
        normalizeText(b.title || "") === nq ||
        normalizeText(b.author || "") === nq
      )
    ) || null
  }, [catalogBooks, query])

  async function runSearch(overrideQuery?: string) {
    const trimmed = (overrideQuery ?? query).trim()
    if (!trimmed) return

    // Si ya está en el catálogo, redirigir directo
    if (exactCatalogMatch?.id) {
      toast({ title: t("alreadyImported"), description: "" })
      setLocation(`/book/${exactCatalogMatch.id}`)
      onClose(); return
    }

    setSearching(true); setSelected(null)
    try {
      const res = await fetch(
        `/api/gutenberg/search?q=${encodeURIComponent(trimmed)}&lang=${lang}`,
        { credentials: "include" }
      )
      if (!res.ok) throw new Error(t("noResults"))
      const data = await res.json()
      setResults(Array.isArray(data) ? data : [])
    } catch (err: any) {
      toast({ title: err.message || t("noResults"), variant: "destructive" })
    } finally { setSearching(false) }
  }

  async function openResult(result: SearchResult) {
    if (result.existingBookId) {
      setLocation(`/book/${result.existingBookId}`)
      onClose(); return
    }
    setLoadingPreview(true)
    try {
      const res = await fetch(
        `/api/gutenberg/preview/${result.id}?lang=${lang}`,
        { credentials: "include" }
      )
      if (!res.ok) throw new Error(t("noResults"))
      const data = await res.json()
      setSelected(data)
      setAdminTitle(data.title || "")
      setAdminSynopsis(data.synopsis || "")
      setAdminGenre(data.detectedGenre || "")
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" })
    } finally { setLoadingPreview(false) }
  }

  async function downloadForMe() {
    if (!selected) return
    if (selected.existingBookId) {
      setLocation(`/book/${selected.existingBookId}`)
      onClose(); return
    }
    setDownloading(true)
    try {
      const res = await fetch(
        `/api/gutenberg/preview/${selected.gutenbergId}?lang=${lang}`,
        { credentials: "include" }
      )
      if (!res.ok) throw new Error(t("noResults"))
      const data = await res.json()
      const localId = `gutenberg-${data.gutenbergId}-${lang}`
      savePrivateClassic({
        ...data,
        id:        localId,
        genre:     data.genre || data.detectedGenre || "",  // tema visual correcto
        isClassic: true,
        isSaved:   true,
        status:    "saved",
      })
      toast({ title: t("importButton") + " ✓" })
      setLocation(`/book/${localId}`)
      onClose()
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" })
    } finally { setDownloading(false) }
  }

  async function publishToCatalog() {
    if (!selected || !canPublish) return
    setImporting(true)
    try {
      const res = await fetch("/api/admin/gutenberg/import", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gutenbergId:      selected.gutenbergId,
          genre:            adminGenre || selected.detectedGenre || "",
          overrideTitle:    adminTitle.trim() || selected.title,
          overrideSynopsis: adminSynopsis.trim() || selected.synopsis,
          lang,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || t("noResults"))
      await refetch()
      toast({ title: t("importButton") + " ✓" })
      if (data.book?.id) { setLocation(`/book/${data.book.id}`); onClose() }
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" })
    } finally { setImporting(false) }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[290]"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="fixed inset-x-3 top-4 bottom-4 z-[300] overflow-hidden rounded-[28px]"
            style={{
              background:  "rgba(8,10,14,0.97)",
              border:      `1px solid ${cfg.color}20`,
              boxShadow:   "0 30px 120px rgba(0,0,0,0.65)",
            }}
          >
            {/* Glow superior */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(circle at 50% 0%, ${cfg.glow}18, transparent 55%)` }} />

            <div className="relative flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: `1px solid ${cfg.color}15` }}>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] font-sans"
                    style={{ color: cfg.color + "66" }}>
                    Project Gutenberg
                  </p>
                  <h2 className="text-white font-display text-xl font-bold">
                    {canPublish ? t("importTitle") : t("importTitle")}
                  </h2>
                </div>
                <button onClick={onClose}
                  className="rounded-full p-2 transition-colors"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body — dos columnas en pantallas grandes */}
              <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">

                {/* Columna izquierda — búsqueda */}
                <div className="overflow-y-auto" style={{ borderRight: `1px solid ${cfg.color}10` }}>
                  <div className="p-5 space-y-4">

                    {/* Barra de búsqueda */}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-zinc-500" />
                        <input
                          value={query}
                          onChange={e => setQuery(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && runSearch()}
                          placeholder={t("searchGutenberg")}
                          className="w-full rounded-2xl py-3 pl-10 pr-4 text-sm text-white outline-none"
                          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${cfg.color}20` }}
                        />
                      </div>
                      <select
                        value={lang}
                        onChange={e => setLang(e.target.value)}
                        className="rounded-2xl px-3 text-sm text-white outline-none"
                        style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${cfg.color}20` }}
                      >
                        {LANGUAGE_OPTIONS.map(o => (
                          <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>
                        ))}
                      </select>
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => runSearch()}
                        disabled={searching || !query.trim()}
                        className="rounded-2xl px-4 text-sm font-semibold text-black disabled:opacity-40"
                        style={{ background: cfg.color }}
                      >
                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : t("preview").slice(0,6)}
                      </motion.button>
                    </div>

                    {/* Ya en catálogo */}
                    {exactCatalogMatch?.id && (
                      <motion.button
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { setLocation(`/book/${exactCatalogMatch.id}`); onClose() }}
                        className="w-full rounded-2xl px-4 py-3 text-left text-sm"
                        style={{
                          background: `${cfg.glow}15`,
                          border:     `1px solid ${cfg.color}30`,
                          color:      cfg.color,
                        }}
                      >
                        ✦ {t("alreadyImported")} — {exactCatalogMatch.title}
                      </motion.button>
                    )}

                    {/* Resultados */}
                    <div className="space-y-2">
                      {results.map(result => (
                        <motion.button
                          key={result.id}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => openResult(result)}
                          className="w-full rounded-[20px] p-4 text-left transition-colors"
                          style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${cfg.color}12` }}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-xl"
                              style={{ background: `${cfg.glow}20` }}>
                              <BookOpen className="w-4 h-4" style={{ color: cfg.color + "88" }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="line-clamp-1 text-sm font-semibold text-white">
                                  {result.title}
                                </p>
                                {result.alreadyImported && (
                                  <span className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]"
                                    style={{ background: `${cfg.glow}20`, color: cfg.color }}>
                                    {t("alreadyImported")}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">
                                {result.authors[0]?.name || ""}
                              </p>
                              <div className="mt-1.5 flex gap-3 text-[11px] text-zinc-600">
                                <span>{result.languages?.[0] || "en"}</span>
                                <span>{(result.download_count || 0).toLocaleString()} descargas</span>
                              </div>
                            </div>
                            <ExternalLink className="w-4 h-4 shrink-0 text-zinc-700" />
                          </div>
                        </motion.button>
                      ))}

                      {!searching && query.trim() && results.length === 0 && (
                        <div className="rounded-2xl px-4 py-8 text-center text-sm text-zinc-600"
                          style={{ border: `1px dashed ${cfg.color}20` }}>
                          {t("noResults")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Columna derecha — preview + acciones */}
                <div className="overflow-y-auto">
                  <div className="p-5 space-y-4">

                    {!selected && !loadingPreview && (
                      <div className="rounded-[28px] p-6 text-center"
                        style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${cfg.color}10` }}>
                        <Sparkles className="mx-auto mb-4 w-6 h-6" style={{ color: cfg.color + "80" }} />
                        <p className="text-white font-medium text-sm">
                          {t("searchGutenberg").split("...")[0]}...
                        </p>
                        <p className="mt-2 text-xs text-zinc-600">
                          {canPublish
                            ? "Publica al catálogo o guarda para ti"
                            : "Descarga a tu biblioteca privada"}
                        </p>
                      </div>
                    )}

                    {loadingPreview && (
                      <div className="rounded-[28px] p-8 text-center"
                        style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${cfg.color}10` }}>
                        <Loader2 className="mx-auto mb-3 w-6 h-6 animate-spin" style={{ color: cfg.color }} />
                        <p className="text-sm text-zinc-500">{t("searching")}...</p>
                      </div>
                    )}

                    {selected && (
                      <div className="space-y-4">
                        {/* Portada + info */}
                        <div className="overflow-hidden rounded-[24px]"
                          style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${cfg.color}12` }}>
                          <div className="grid gap-0 sm:grid-cols-[160px_1fr]">
                            <div className="p-4" style={{ background: `${cfg.glow}12` }}>
                              <div className="aspect-[2/3] overflow-hidden rounded-[18px]"
                                style={{ border: `1px solid ${cfg.color}20`, background: "rgba(0,0,0,0.4)" }}>
                                {selected.coverUrl
                                  ? <img loading="lazy" src={selected.coverUrl} alt={selected.title}
                                      className="w-full h-full object-cover" />
                                  : <div className="flex h-full items-center justify-center">
                                      <BookOpen className="w-8 h-8" style={{ color: cfg.color + "40" }} />
                                    </div>
                                }
                              </div>
                            </div>
                            <div className="p-4 space-y-3">
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em]"
                                  style={{ background: `${cfg.glow}15`, color: cfg.color }}>
                                  {selected.originalLanguage.toUpperCase()}
                                </span>
                                {selected.alreadyImported && (
                                  <span className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/50"
                                    style={{ background: "rgba(255,255,255,0.05)" }}>
                                    {t("alreadyImported")}
                                  </span>
                                )}
                              </div>
                              <div>
                                <h3 className="text-lg font-display font-bold text-white leading-tight">
                                  {selected.title}
                                </h3>
                                <p className="mt-0.5 text-sm text-zinc-500">{selected.author}</p>
                              </div>
                              <p className="text-sm leading-relaxed text-zinc-400 line-clamp-4">
                                {selected.synopsis}
                              </p>
                              <div className="flex gap-3 text-xs text-zinc-600">
                                <span>{selected.chapterCount} {t("chapters")}</span>
                                {selected.publicationYear && <span>{selected.publicationYear}</span>}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Curación — solo admin */}
                        {canPublish && !selected.alreadyImported && (
                          <div className="rounded-[24px] p-4 space-y-3"
                            style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${cfg.color}12` }}>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-600">{t("genre_label")}</p>
                            <input value={adminTitle}
                              onChange={e => setAdminTitle(e.target.value)}
                              className="w-full rounded-2xl px-4 py-2.5 text-sm text-white outline-none"
                              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${cfg.color}15` }}
                              placeholder={t("title")} />
                            <input value={adminGenre}
                              onChange={e => setAdminGenre(e.target.value)}
                              className="w-full rounded-2xl px-4 py-2.5 text-sm text-white outline-none"
                              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${cfg.color}15` }}
                              placeholder={t("genre_label")} />
                            <textarea value={adminSynopsis}
                              onChange={e => setAdminSynopsis(e.target.value)}
                              className="min-h-[100px] w-full rounded-2xl px-4 py-2.5 text-sm text-white outline-none resize-none"
                              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${cfg.color}15` }}
                              placeholder={t("synopsis")} />
                          </div>
                        )}

                        {/* Botones de acción */}
                        <div className="grid grid-cols-2 gap-3">
                          {/* Descargar para mí — disponible para todos */}
                          <motion.button whileTap={{ scale: 0.97 }}
                            onClick={downloadForMe}
                            disabled={downloading}
                            className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${cfg.color}20` }}>
                            {downloading
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Download className="w-4 h-4" />}
                            {t("saveBook")}
                          </motion.button>

                          {/* Publicar al catálogo — solo admin */}
                          {selected.existingBookId ? (
                            <motion.button whileTap={{ scale: 0.97 }}
                              onClick={() => { setLocation(`/book/${selected.existingBookId}`); onClose() }}
                              className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-black"
                              style={{ background: cfg.color }}>
                              <ExternalLink className="w-4 h-4" />
                              {t("readBook")}
                            </motion.button>
                          ) : canPublish ? (
                            <motion.button whileTap={{ scale: 0.97 }}
                              onClick={publishToCatalog}
                              disabled={importing}
                              className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                              style={{ background: cfg.color }}>
                              {importing
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Upload className="w-4 h-4" />}
                              {t("importButton")}
                            </motion.button>
                          ) : (
                            <div className="rounded-2xl px-4 py-3 text-xs text-zinc-600 flex items-center justify-center text-center"
                              style={{ border: `1px dashed ${cfg.color}15` }}>
                              {t("importSubtitle")}
                            </div>
                          )}
                        </div>

                        {/* Vista previa del texto */}
                        {selected.previewText && (
                          <div className="rounded-[20px] p-4"
                            style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${cfg.color}10` }}>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-600 mb-2">
                              {t("preview")}
                            </p>
                            <p className="text-sm leading-relaxed text-zinc-500 line-clamp-6">
                              {selected.previewText}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
