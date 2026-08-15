import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"
import { BookCard } from "@/components/book-card"
import { Plus, User, Camera, BookOpen, FileText, Edit3, Trash2, Archive, Eye, EyeOff, Star, Sparkles, UserCircle, Frame, Hammer, WalletCards, Ticket, MoreHorizontal, Shield } from "lucide-react"
import CardCollection from "@/components/CardCollection"
import { useToast } from "@/hooks/use-toast"
import { motion, AnimatePresence } from "framer-motion"
import { useGenre } from "@/context/GenreContext"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"
import { useBooks } from "@/hooks/use-books"
import ImportPanel from "@/components/ImportPanel"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const STORAGE_DRAFTS    = "novareads_drafts"
const STORAGE_PUBLISHED = "novareads_authored"
const STORAGE_SAVED     = "novareads_saved"
const STORAGE_PROFILE   = "novareads_profile_name"

function loadAll(key: string): any[] {
  try { return JSON.parse(localStorage.getItem(key) || "[]") } catch { return [] }
}

export default function Library() {
  const { toast }  = useToast()
  const { cfg }    = useGenre()
  const { user, logout, isAdmin } = useAuth()
  const { t, settings } = useSettings()
  const isAdminActive = isAdmin && (settings?.adminMode ?? true)
  const { data: serverBooks, refetch: refetchBooks } = useBooks()

  const [, setLocation] = useLocation()
  const searchQuery = useMemo(() => {
    return new URLSearchParams(window.location.search).get("search")?.toLowerCase().trim() || ""
  }, [location])

  const [drafts,        setDrafts]        = useState<any[]>([])
  const [published,     setPublished]     = useState<any[]>([])
  const [savedBooks,    setSavedBooks]    = useState<any[]>([])
  const [profileImage,  setProfileImage]  = useState<string | null>(null)
  const [coverImage,    setCoverImage]    = useState<string | null>(null)
  const [profileName,   setProfileName]   = useState("")
  const [editingName,   setEditingName]   = useState(false)
  const [nameInput,     setNameInput]     = useState("")
  const [activeTab,     setActiveTab]     = useState<"published"|"drafts"|"saved"|"cards"|"catalog">("published")
  const [deleteConfirm, setDeleteConfirm] = useState<{id:any, store:string, isServer?:boolean} | null>(null)
  const [showImport,    setShowImport]    = useState(false)
  const [deletingServer, setDeletingServer] = useState(false)
  const [reviewBooks,   setReviewBooks]   = useState<any[]>([])

  const profileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef   = useRef<HTMLInputElement>(null)
  const nameInputRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDrafts(loadAll(STORAGE_DRAFTS))
    setPublished(loadAll(STORAGE_PUBLISHED))
    setSavedBooks(loadAll(STORAGE_SAVED))
    setProfileImage(localStorage.getItem("novareads_profile"))
    setCoverImage(localStorage.getItem("novareads_cover"))
    const savedName = localStorage.getItem(STORAGE_PROFILE)
    if (savedName) setProfileName(savedName)
    else if (user?.name) setProfileName(user.name)
  }, [user?.name])

  const allBooks = useMemo(() => {
    const seen = new Set<string>()
    return [...published, ...savedBooks, ...(serverBooks || [])].filter((book: any) => {
      const id = String(book.id)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  }, [published, savedBooks, serverBooks])
  const searchResults = useMemo(() => {
    if (!searchQuery) return []
    return allBooks.filter((b: any) =>
      b.title?.toLowerCase().includes(searchQuery)  ||
      b.author?.toLowerCase().includes(searchQuery) ||
      b.genre?.toLowerCase().includes(searchQuery)
    )
  }, [searchQuery, allBooks])

  // Catálogo del servidor para el admin — solo clásicos
  const serverClassics = useMemo(() =>
    (serverBooks || []).filter((b: any) => b.isClassic),
    [serverBooks]
  )

  // Libros ocultos en revisión — solo visibles para el admin
  useEffect(() => {
    if (!isAdminActive) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/admin/books/all", { credentials: "include" })
        if (!res.ok) return
        const all = await res.json()
        if (!cancelled) setReviewBooks(all.filter((b: any) => b.status === "review"))
      } catch { /* sin conexión */ }
    })()
    return () => { cancelled = true }
  }, [isAdminActive, activeTab, serverBooks])

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, target: "profile"|"cover") {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      const b64 = reader.result as string
      if (target === "profile") {
        setProfileImage(b64)
        localStorage.setItem("novareads_profile", b64)
      } else {
        setCoverImage(b64)
        localStorage.setItem("novareads_cover", b64)
      }
    }
    reader.readAsDataURL(file)
  }

  function saveName() {
    const n = nameInput.trim()
    if (!n) return
    setProfileName(n)
    localStorage.setItem(STORAGE_PROFILE, n)
    setEditingName(false)
  }

  function startEditName() {
    setNameInput(profileName)
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }

  function deleteLocalBook(id: any, storageKey: string) {
    const current = loadAll(storageKey)
    const updated = current.filter((b: any) => String(b.id) !== String(id))
    localStorage.setItem(storageKey, JSON.stringify(updated))
    if (storageKey === STORAGE_DRAFTS)    setDrafts(updated)
    if (storageKey === STORAGE_PUBLISHED) setPublished(updated)
    if (storageKey === STORAGE_SAVED)     setSavedBooks(updated)
    setDeleteConfirm(null)
    toast({ title: t("storyDeleted") })
  }

  async function deleteServerBook(id: any) {
    setDeletingServer(true)
    try {
      const res = await fetch(`/api/admin/books/${id}`, {
        method:      "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || "Error eliminando")
      }
      await refetchBooks()
      setDeleteConfirm(null)
      toast({ title: `${t("catalogBookRemoved")} ✓` })
    } catch (err: any) {
      toast({ title: err.message || "Error eliminando libro", variant: "destructive" })
    } finally {
      setDeletingServer(false)
    }
  }

  // Vista de búsqueda
  if (searchQuery) {
    return (
      <Layout>
        <div className="pt-16 px-4 pb-32 space-y-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => setLocation("/")} className="text-zinc-600 hover:text-white transition p-1">←</button>
            <div>
              <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-sans">{t("searching")}</p>
              <h1 className="text-base text-white font-semibold font-sans">"{searchQuery}"</h1>
            </div>
          </div>
          {searchResults.length === 0 ? (
            <div className="py-20 text-center space-y-2">
              <p className="text-zinc-600 text-sm font-sans">{t("noResults")}</p>
            </div>
          ) : (
            <>
              <p className="text-zinc-700 text-xs font-sans">{t("searchResultCount").replace("{n}", String(searchResults.length))}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                {searchResults.map(book => <BookCard key={book.id} {...book} />)}
              </div>
            </>
          )}
        </div>
      </Layout>
    )
  }

  const tabs = [
    { key: "published" as const, label: t("published"), icon: BookOpen, count: published.length },
    { key: "drafts"    as const, label: t("drafts"), icon: FileText, count: drafts.length },
    { key: "saved"     as const, label: t("readingsList"),   icon: BookOpen, count: savedBooks.length },
    { key: "cards"     as const, label: t("cardsTab"), icon: Sparkles },
    // Tab de catálogo — solo visible para admin
    ...(isAdminActive ? [{ key: "catalog" as const, label: t("catalog"), icon: Star, count: serverClassics.length }] : []),
  ]

  return (
    <>
    <Layout>
      <div className="min-h-screen pb-28 overflow-x-hidden">

        {/* COVER */}
        <div className="relative h-44 sm:h-56 w-full">
          <div className="absolute inset-0 bg-zinc-950 overflow-hidden">
            {coverImage && <img loading="lazy" src={coverImage} className="w-full h-full object-cover opacity-50" />}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black" />
          </div>
          <button
            onClick={() => coverInputRef.current?.click()}
            className="absolute top-3 right-3 p-2 rounded-full border backdrop-blur-xl transition"
            style={{ background: "rgba(0,0,0,0.6)", borderColor: "rgba(255,255,255,0.1)" }}
          >
            <Camera className="w-3.5 h-3.5 text-white/60" />
          </button>
          <input type="file" ref={coverInputRef} className="hidden" accept="image/*"
            onChange={e => handleImageUpload(e, "cover")} />

          <div className="absolute -bottom-10 left-4 sm:left-6">
            <motion.div
              whileTap={{ scale: 0.96 }}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-zinc-900 border-[3px] border-black overflow-hidden flex items-center justify-center cursor-pointer shadow-xl"
              onClick={() => profileInputRef.current?.click()}
            >
              {profileImage
                ? <img loading="lazy" src={profileImage} className="w-full h-full object-cover" />
                : <User className="w-9 h-9 text-zinc-700" />
              }
            </motion.div>
            <input type="file" ref={profileInputRef} className="hidden" accept="image/*"
              onChange={e => handleImageUpload(e, "profile")} />
          </div>
        </div>

        {/* NOMBRE + BOTONES */}
        <div className="mt-14 flex items-end justify-between gap-3 px-4 sm:mt-16 sm:px-6">
          <div className="min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  ref={nameInputRef}
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false) }}
                  className="bg-transparent text-white text-xl font-bold outline-none border-b pb-0.5 font-sans"
                  style={{ borderColor: cfg.color + "60", caretColor: cfg.color, minWidth: 120 }}
                />
                <button onClick={saveName} className="text-xs px-2 py-0.5 rounded font-sans"
                  style={{ background: cfg.bg, color: cfg.color }}>✓</button>
              </div>
            ) : (
              <button onClick={startEditName} className="text-left group">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight group-hover:text-zinc-300 transition-colors">
                  {profileName || user?.name || "Mi perfil"}
                </h1>
              </button>
            )}
            <p className="text-xs text-zinc-600 mt-0.5 font-sans">
              {t("profileWorkCounts").replace("{published}", String(published.length)).replace("{drafts}", String(drafts.length))}
            </p>
            <div className="flex items-center gap-3 mt-1.5">
              {(profileName || user?.name) && (
                <button
                  onClick={() => setLocation(`/author/${encodeURIComponent(profileName || user?.name || "")}`)}
                  className="flex items-center gap-1 text-[11px] font-sans font-medium transition-colors"
                  style={{ color: cfg.color }}
                >
                  <UserCircle className="w-3.5 h-3.5" />
                  {t("myAuthorProfile")}
                </button>
              )}
              <button onClick={logout}
                className="text-[10px] text-zinc-700 hover:text-zinc-500 transition-colors font-sans">
                {t("signOut")}
              </button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  aria-label={t("toolsMenu")}
                  title={t("toolsMenu")}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] text-white/65 transition-colors hover:bg-white/[.08] hover:text-white"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </motion.button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-64 rounded-2xl border-white/10 bg-zinc-950/95 p-2 text-white shadow-2xl backdrop-blur-xl"
              >
                <DropdownMenuLabel className="px-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
                  Tloque
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setLocation("/sorteo")} className="rounded-xl px-3 py-2.5 focus:bg-white/[.07] focus:text-white">
                  <Ticket className="text-amber-200/80" />
                  {t("gachaTitle")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLocation("/tarjetas")} className="rounded-xl px-3 py-2.5 focus:bg-white/[.07] focus:text-white">
                  <WalletCards className="text-amber-200/70" />
                  {t("cardsStudio")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLocation("/marcos")} className="rounded-xl px-3 py-2.5 focus:bg-white/[.07] focus:text-white">
                  <Frame className="text-amber-200/70" />
                  {t("frames")}
                </DropdownMenuItem>
                {isAdminActive && (
                  <>
                    <DropdownMenuSeparator className="my-2 bg-white/[.07]" />
                    <DropdownMenuLabel className="flex items-center gap-2 px-3 text-[10px] uppercase tracking-[0.2em] text-violet-200/45">
                      <Shield className="h-3 w-3" />
                      Admin
                    </DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setShowImport(true)} className="rounded-xl px-3 py-2.5 focus:bg-white/[.07] focus:text-white">
                      <Archive className="text-violet-200/70" />
                      {t("importClassics")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setLocation("/admin/marcos")} className="rounded-xl px-3 py-2.5 focus:bg-white/[.07] focus:text-white">
                      <Hammer className="text-violet-200/70" />
                      {t("frameWorkshop")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setLocation("/admin")} className="rounded-xl px-3 py-2.5 focus:bg-white/[.07] focus:text-white">
                      <Shield className="text-violet-200/70" />
                      Admin
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => setLocation("/editor")}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-semibold text-black shadow-lg sm:px-4 sm:text-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("newStory")}</span>
            </motion.button>
          </div>
        </div>

        {/* TABS */}
        <div className="mt-7 px-4 sm:px-6 flex border-b overflow-x-auto hide-scrollbar"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="relative flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0"
              style={{ color: activeTab === tab.key ? "white" : "rgba(255,255,255,0.3)" }}
            >
              <tab.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              {tab.label}
              {tab.count > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: tab.key === "catalog"
                      ? "rgba(255,210,100,0.15)"
                      : "rgba(255,255,255,0.07)",
                    color: tab.key === "catalog"
                      ? "rgba(255,210,100,0.6)"
                      : "rgba(255,255,255,0.4)",
                  }}>
                  {tab.count}
                </span>
              )}
              {activeTab === tab.key && (
                <motion.div layoutId="tab-line"
                  className="absolute bottom-0 left-0 right-0 h-[1.5px] rounded-full"
                  style={{ background: tab.key === "catalog" ? "rgba(255,210,100,0.8)" : "white" }} />
              )}
            </button>
          ))}
        </div>

        {/* CONTENIDO */}
        <div className="mt-6 px-4 sm:px-6 pb-32">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === "published" && (
                published.length === 0
                  ? <Empty msg={t("noPublished")} btn={t("writeNow")} onClick={() => setLocation("/editor")} />
                  : <BookGrid books={published}
                      onEdit={id => setLocation(`/editor?id=${id}&status=published`)}
                      onDelete={id => setDeleteConfirm({ id, store: STORAGE_PUBLISHED })}
                      showEdit showDelete />
              )}
              {activeTab === "drafts" && (
                drafts.length === 0
                  ? <Empty msg={t("noDrafts")} btn={t("startDraft")} onClick={() => setLocation("/editor")} />
                  : <BookGrid books={drafts} isDraft
                      onRead={id   => setLocation(`/book/${id}`)}
                      onEdit={id   => setLocation(`/editor?id=${id}&status=draft`)}
                      onDelete={id => setDeleteConfirm({ id, store: STORAGE_DRAFTS })}
                      showEdit showDelete />
              )}
              {activeTab === "saved" && (
                savedBooks.length === 0
                  ? <Empty msg={t("noSaved")} />
                  : <BookGrid books={savedBooks}
                      onDelete={id => setDeleteConfirm({ id, store: STORAGE_SAVED })}
                      showDelete />
              )}
              {activeTab === "cards" && (
                <CardCollection />
              )}
              {activeTab === "catalog" && isAdminActive && (
                <div className="space-y-6">

                  {/* ── EN REVISIÓN — libros ocultos del catálogo público ── */}
                  {reviewBooks.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5">
                        <EyeOff className="w-3 h-3" style={{ color: "rgba(255,170,100,0.8)" }} />
                        <p className="text-[10px] uppercase tracking-widest font-sans"
                          style={{ color: "rgba(255,170,100,0.8)" }}>
                          En revisión · {reviewBooks.length}
                        </p>
                      </div>
                      <p className="text-[11px] text-zinc-600 font-sans -mt-1">
                        Ocultos del catálogo público. Toca uno para auditarlo, corregirlo o restaurarlo.
                      </p>
                      <BookGrid books={reviewBooks} />
                    </div>
                  )}

                  {/* ── CATÁLOGO DE CLÁSICOS ── */}
                  {serverClassics.length === 0 && reviewBooks.length === 0 ? (
                    <Empty
                      msg={t("noCatalog")} btn={t("importClassic2")} onClick={() => setShowImport(true)}
                    />
                  ) : (
                    <div className="space-y-4">
                      {/* Header informativo */}
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-sans">
                          {serverClassics.length} clásico{serverClassics.length !== 1 ? "s" : ""} en el catálogo
                        </p>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setShowImport(true)}
                          className="text-[10px] font-sans px-2.5 py-1 rounded-lg"
                          style={{
                            background: "rgba(255,210,100,0.08)",
                            border:     "1px solid rgba(255,210,100,0.2)",
                            color:      "rgba(255,210,100,0.7)",
                          }}
                        >
                          + Importar
                        </motion.button>
                      </div>

                      {/* Grid de libros del servidor */}
                      <BookGrid
                        books={serverClassics}
                        onDelete={id => setDeleteConfirm({ id, store: "", isServer: true })}
                        showDelete
                      />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>

      {/* MODAL CONFIRMACIÓN DE BORRADO */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
              className="w-full max-w-sm p-6 rounded-2xl space-y-4"
              style={{
                background: "rgba(14,14,18,0.98)",
                border:     "1px solid rgba(255,255,255,0.1)",
                boxShadow:  "0 24px 64px rgba(0,0,0,0.8)",
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center space-y-2">
                <p className="text-white font-semibold font-sans">
                  {deleteConfirm.isServer ? t("deleteConfirmServer") : t("deleteConfirmTitle")}
                </p>
                <p className="text-zinc-500 text-sm font-sans leading-relaxed">
                  {deleteConfirm.isServer
                    ? t("deleteConfirmServer2")
                    : t("deleteConfirmBody")
                  }
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-sans text-zinc-400 border border-white/10 hover:bg-white/5 transition"
                >
                  {t("cancelBtn")}
                </button>
                <button
                  disabled={deletingServer}
                  onClick={() => {
                    if (deleteConfirm.isServer) {
                      deleteServerBook(deleteConfirm.id)
                    } else {
                      deleteLocalBook(deleteConfirm.id, deleteConfirm.store)
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-sans font-medium bg-red-900/50 text-red-300 border border-red-800/50 hover:bg-red-900/70 transition disabled:opacity-50"
                >
                  {deletingServer ? t("deletingBtn") : t("deleteBtn")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>

    {isAdminActive && (
      <ImportPanel open={showImport} onClose={() => setShowImport(false)} />
    )}
    </>
  )
}

// ── SUBCOMPONENTES ──────────────────────────────────────
// ── Tarjeta con gesto press-largo para editar ────────────
function BookItem({ book, onEdit, onDelete, onRead, showEdit, showDelete, isDraft }: {
  book: any
  onEdit?:     (id: any) => void
  onDelete?:   (id: any) => void
  onRead?:     (id: any) => void
  showEdit?:   boolean
  showDelete?: boolean
  isDraft?:    boolean
}) {
  const [pressing,   setPressing]   = useState(false)
  const [showMenu,   setShowMenu]   = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { cfg } = useGenre()
  const [, setLocation] = useLocation()

  const startPress = useCallback(() => {
    setPressing(true)
    timerRef.current = setTimeout(() => {
      setPressing(false)
      setShowMenu(true)
    }, 600) // 600ms = intencional, no accidental
  }, [])

  const cancelPress = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPressing(false)
  }, [])

  const handleTap = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (pressing) { setPressing(false); return }
    // Tap corto — leer
    const target = onRead ? onRead : (id: any) => setLocation(`/book/${id}`)
    target(book.id)
  }, [pressing, onRead, book.id, setLocation])

  return (
    <div className="relative">
      {/* Press indicator */}
      {pressing && (
        <motion.div
          className="absolute inset-0 rounded-lg z-10 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}40` }}
        />
      )}

      <div
        className={isDraft ? "opacity-55" : ""}
        onPointerDown={startPress}
        onPointerUp={handleTap}
        onPointerLeave={cancelPress}
        onContextMenu={e => { e.preventDefault(); setShowMenu(true) }}
        style={{ cursor: "pointer", WebkitUserSelect: "none", userSelect: "none" }}
      >
        <BookCard {...book} />
      </div>

      {/* Badge borrador */}
      {isDraft && (
        <div
          className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest font-sans backdrop-blur-sm pointer-events-none"
          style={{ background: "rgba(0,0,0,0.8)", color: "rgba(255,255,255,0.3)" }}
        >
          borrador
        </div>
      )}

      {/* Menú contextual (press largo) */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[400]"
              onClick={() => setShowMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 4 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
              className="absolute top-0 right-0 z-[401] rounded-2xl overflow-hidden min-w-[160px]"
              style={{
                background: "rgba(18,18,24,0.98)",
                border:     "1px solid rgba(255,255,255,0.1)",
                boxShadow:  "0 12px 40px rgba(0,0,0,0.8)",
              }}
            >
              <div className="p-1.5 space-y-0.5">
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest font-sans px-2 py-1">
                  {book.title?.slice(0,20)}{book.title?.length > 20 ? "…" : ""}
                </p>
                {onRead && (
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => { setShowMenu(false); onRead(book.id) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans text-left"
                    style={{ color: "rgba(255,255,255,0.7)" }}
                  >
                    <Eye className="w-3.5 h-3.5" /> Leer
                  </motion.button>
                )}
                {showEdit && onEdit && (
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => { setShowMenu(false); onEdit(book.id) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans text-left"
                    style={{ color: cfg.color + "cc" }}
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Editar
                  </motion.button>
                )}
                {showDelete && onDelete && (
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => { setShowMenu(false); onDelete(book.id) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans text-left"
                    style={{ color: "rgba(255,80,80,0.8)" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Eliminar
                  </motion.button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function BookGrid({ books, onEdit, onDelete, onRead, showEdit, showDelete, isDraft }: {
  books:       any[]
  onEdit?:     (id: any) => void
  onDelete?:   (id: any) => void
  onRead?:     (id: any) => void
  showEdit?:   boolean
  showDelete?: boolean
  isDraft?:    boolean
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-5">
      {books.map(book => (
        <BookItem
          key={book.id}
          book={book}
          onEdit={onEdit}
          onDelete={onDelete}
          onRead={onRead}
          showEdit={showEdit}
          showDelete={showDelete}
          isDraft={isDraft}
        />
      ))}
    </div>
  )
}

function Empty({ msg, btn, onClick }: { msg: string; btn?: string; onClick?: () => void }) {
  return (
    <div className="py-16 text-center space-y-4">
      <p className="text-zinc-600 italic text-sm font-sans">{msg}</p>
      {btn && onClick && (
        <motion.button whileTap={{ scale: 0.97 }} onClick={onClick}
          className="px-4 py-2 rounded-lg text-white/60 text-sm font-sans transition hover:bg-white/5"
          style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
          {btn}
        </motion.button>
      )}
    </div>
  )
}
