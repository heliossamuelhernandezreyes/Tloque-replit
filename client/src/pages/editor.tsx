import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useLocation } from "wouter"
import { motion, AnimatePresence } from "framer-motion"
import { useToast } from "@/hooks/use-toast"
import { BookConflictError, useCreateBook, useUpdateBook } from "@/hooks/use-books"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"
import {
  ArrowLeft, Plus, Trash2, BookOpen, FileText,
  Upload, Save, Globe, EyeOff, ChevronDown, ChevronUp,
  Check, AlertCircle, Layers, ListChecks,
  Maximize2, Minimize2, Bot,
} from "lucide-react"
import ParallaxCover from "@/components/ParallaxCover"
import { type CoverFxConfig } from "@/lib/cover-effects"
import { LayerUpload } from "@/components/LayerUpload"
import {
  classifyDurableDraft,
  loadDurableEditorDraft,
  removeDurableEditorDraft,
  saveDurableEditorDraft,
} from "@/lib/editor-drafts"
import { buildDirectionWorkspaceUrl, isServerBookId } from "@/lib/editor-workspace"

// ── TIPOS ────────────────────────────────────────────────
type Chapter  = { title: string; content: string }
type CoverMode = "simple" | "double" | "triple"

type BookForm = {
  title:        string
  author:       string
  synopsis:     string
  genre:        string
  type:         "book" | "story"
  coverUrl:     string
  coverFx:      CoverFxConfig
  backCoverUrl: string          // contraportada — para tokens de impresión futuros
  premiumCoverUrl: string       // vestido premium — regalo para quienes apoyan
  premiumBackUrl:  string
  chapters:     Chapter[]
  status:       "draft" | "published" | "review"
  spotifyLink:  string
}

type EditableBook = BookForm & {
  id?: number
  revision?: number
  updatedAt?: string
  localSavedAt?: number
}

const genres = [
  { key: "",            label: "Sin género",  tKey: "genreSinGenero",  color: "#d0d0d0", glow: "#888888" },
  { key: "melancolico", label: "Melancólico", tKey: "genreMelancolico",color: "#8aabff", glow: "#3355dd" },
  { key: "terror",      label: "Terror",      tKey: "genreTerror",     color: "#ff7070", glow: "#cc1111" },
  { key: "fantasia",    label: "Fantasía",    tKey: "genreFantasia",   color: "#ffe090", glow: "#cc8800" },
  { key: "misterio",    label: "Misterio",    tKey: "genreMisterio",   color: "#cc99ff", glow: "#8833ee" },
  { key: "romance",     label: "Romance",     tKey: "genreRomance",    color: "#ffaadd", glow: "#dd2288" },
]

const STORAGE_DRAFTS    = "novareads_drafts"
const STORAGE_PUBLISHED = "novareads_authored"

function loadAll(key: string): any[] {
  try { return JSON.parse(localStorage.getItem(key) || "[]") } catch { return [] }
}
function saveAll(key: string, items: any[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(items))
    return true
  } catch (e) {
    // La memoria local es pequeña; los libros grandes (clásicos) no caben.
    // No es un error fatal: el guardado real va al servidor.
    console.warn("No se pudo guardar en memoria local (cuota llena):", e)
    return false
  }
}
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

type SaveStatus = "idle" | "saving" | "saved" | "recovered" | "error"

// ── PANEL DE PORTADA ─────────────────────────────────────
function CoverPanel({
  form, gc, coverMode, setCoverMode, onPremiumCoverChange, onPremiumBackChange,
  onCoverChange, onLayerChange, onBackCoverChange,
}: {
  form:            BookForm
  gc:              typeof genres[0]
  coverMode:       CoverMode
  onPremiumCoverChange: (url: string) => void
  onPremiumBackChange:  (url: string) => void
  setCoverMode:    (m: CoverMode) => void
  onCoverChange:   (url: string) => void
  onLayerChange:   (layer: "back" | "mid" | "front", url: string) => void
  onBackCoverChange: (url: string) => void
}) {
  const mainRef      = useRef<HTMLInputElement>(null)
  const backRef      = useRef<HTMLInputElement>(null)
  const midRef       = useRef<HTMLInputElement>(null)
  const frontRef     = useRef<HTMLInputElement>(null)
  const backCoverRef = useRef<HTMLInputElement>(null)
  const premiumCoverRef = useRef<HTMLInputElement>(null)
  const premiumBackRef  = useRef<HTMLInputElement>(null)

  // Construir coverFx según el modo
  const previewFx: CoverFxConfig = useMemo(() => {
    if (coverMode === "simple") return { mode: "simple", layers: {} }
    if (coverMode === "double") return {
      mode: "layered",
      layers: { back: form.coverUrl, mid: form.coverFx?.layers?.mid || "" }
    }
    return {
      mode: "layered",
      layers: {
        back:  form.coverFx?.layers?.back  || form.coverUrl,
        mid:   form.coverFx?.layers?.mid   || "",
        front: form.coverFx?.layers?.front || "",
      }
    }
  }, [coverMode, form.coverUrl, form.coverFx])

  const modes: { key: CoverMode; label: string; desc: string }[] = [
    { key: "simple", label: "Simple",  desc: "1 imagen" },
    { key: "double", label: "Doble",   desc: "2 capas" },
    { key: "triple", label: "3D",      desc: "3 capas" },
  ]

  return (
    <div className="space-y-4">

      {/* Preview 3D en tiempo real */}
      <div className="flex justify-center">
        <ParallaxCover
          title={form.title || "Tu portada"}
          coverUrl={coverMode === "simple" ? form.coverUrl : undefined}
          coverFx={coverMode !== "simple" ? previewFx : undefined}
          accentColor={gc.color}
          accentGlow={gc.glow}
          className="w-36"
        />
      </div>

      {/* Selector de modo */}
      <div>
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2 font-sans">
          Modo de portada
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {modes.map(m => (
            <button
              key={m.key}
              onClick={() => setCoverMode(m.key)}
              className="py-2 rounded-xl text-center transition-all"
              style={coverMode === m.key ? {
                background: `${gc.glow}20`,
                border:     `1px solid ${gc.color}50`,
                color:      gc.color,
              } : {
                background: "rgba(255,255,255,0.03)",
                border:     "1px solid rgba(255,255,255,0.07)",
                color:      "rgba(255,255,255,0.3)",
              }}
            >
              <p className="text-[10px] font-semibold font-sans">{m.label}</p>
              <p className="text-[9px] opacity-60 font-sans">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Carga de imágenes según el modo */}
      {coverMode === "simple" && (
        <LayerUpload
          label="Portada"
          url={form.coverUrl}
          gc={gc}
          onUpload={url => onCoverChange(url)}
          inputRef={mainRef}
        />
      )}

      {coverMode === "double" && (
        <>
          <LayerUpload
            label="Fondo — capa trasera"
            url={form.coverFx?.layers?.back || form.coverUrl}
            gc={gc}
            onUpload={url => { onCoverChange(url); onLayerChange("back", url) }}
            inputRef={backRef}
            hint="El ambiente, el paisaje"
          />
          <LayerUpload
            label="Sujeto — capa central"
            url={form.coverFx?.layers?.mid || ""}
            gc={gc}
            onUpload={url => onLayerChange("mid", url)}
            inputRef={midRef}
            hint="El personaje o elemento principal"
          />
        </>
      )}

      {coverMode === "triple" && (
        <>
          <LayerUpload
            label="Fondo"
            url={form.coverFx?.layers?.back || ""}
            gc={gc}
            onUpload={url => onLayerChange("back", url)}
            inputRef={backRef}
            hint="Se mueve poco — ambiente"
          />
          <LayerUpload
            label="Sujeto"
            url={form.coverFx?.layers?.mid || ""}
            gc={gc}
            onUpload={url => onLayerChange("mid", url)}
            inputRef={midRef}
            hint="Se mueve — elemento principal"
          />
          <LayerUpload
            label="Primer plano"
            url={form.coverFx?.layers?.front || ""}
            gc={gc}
            onUpload={url => onLayerChange("front", url)}
            inputRef={frontRef}
            hint="Se mueve más — partículas o niebla"
          />
        </>
      )}

      {/* Contraportada — futura impresión física */}
      <div>
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1 font-sans flex items-center gap-1">
          Contraportada
          <span className="text-[8px] px-1.5 py-0.5 rounded-full"
            style={{ background: `${gc.glow}15`, color: gc.color + "88" }}>
            Para impresión física
          </span>
        </p>
        <LayerUpload
          label=""
          url={form.backCoverUrl}
          gc={gc}
          onUpload={url => onBackCoverChange(url)}
          inputRef={backCoverRef}
          hint="Texto de contraportada, autor, editorial"
          compact
        />
      </div>

      {/* ── Vestido PREMIUM (regalo para quienes apoyan la obra) ── */}
      <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1 font-sans flex items-center gap-1">
          Portada premium ✦
          <span className="text-[8px] px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(201,168,87,0.12)", color: "#c9a857cc" }}>
            Se desbloquea al apoyar
          </span>
        </p>
        <p className="text-[9px] text-zinc-500 font-sans mb-2 leading-snug">
          Un vestido alterno de tu obra —colores distintos, otro acabado— como
          regalo para quienes la apoyan. Opcional; si lo dejas vacío, todos ven la portada normal.
        </p>
        <LayerUpload
          label=""
          url={form.premiumCoverUrl}
          gc={gc}
          onUpload={url => onPremiumCoverChange(url)}
          inputRef={premiumCoverRef}
          hint="Portada premium (frente)"
          compact
        />
        <div className="mt-2">
          <LayerUpload
            label=""
            url={form.premiumBackUrl}
            gc={gc}
            onUpload={url => onPremiumBackChange(url)}
            inputRef={premiumBackRef}
            hint="Contraportada premium (opcional)"
            compact
          />
        </div>
      </div>
    </div>
  )
}



// ── COMPONENTE PRINCIPAL ─────────────────────────────────
export default function Editor() {
  const [, setLocation] = useLocation()
  const { toast }       = useToast()
  const { user }        = useAuth()
  const { t }           = useSettings()
  const createBook      = useCreateBook()
  const updateBook      = useUpdateBook()
  const autoSaveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const durableSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const cloudDraftRevision = useRef(0)

  const [activeChapter, setActiveChapter] = useState(0)
  const [metaOpen,      setMetaOpen]      = useState(true)
  const [coverTab,      setCoverTab]      = useState<"cover" | "meta">("meta")
  const [coverMode,     setCoverMode]     = useState<CoverMode>("simple")
  const [saveStatus,    setSaveStatus]    = useState<SaveStatus>("idle")
  const [manuscriptDirty, setManuscriptDirty] = useState(false)
  const [focusMode,     setFocusMode]     = useState(false)
  const [showChecklist, setShowChecklist] = useState(false)
  // Metadata del libro de servidor que se está editando (admin/clásicos).
  // Se preserva al guardar para no corromper autor, idioma, etc.
  const [serverMeta,    setServerMeta]    = useState<any>(null)
  // Ref espejo: el autoguardado lo lee sin quedar "desactualizado"
  const serverMetaRef = useRef<any>(null)
  useEffect(() => { serverMetaRef.current = serverMeta }, [serverMeta])

  const [form, setForm] = useState<EditableBook>({
    title: "", author: "", synopsis: "",
    genre: "", type: "book", coverUrl: "",
    coverFx:      { mode: "simple", layers: {} },
    backCoverUrl: "",
    premiumCoverUrl: "", premiumBackUrl: "",
    chapters:     [{ title: "Capítulo 1", content: "" }],
    spotifyLink:  "",
    status:       "draft",
  })
  const formRef = useRef(form)
  const manuscriptDirtyRef = useRef(manuscriptDirty)
  useEffect(() => {
    formRef.current = form
    manuscriptDirtyRef.current = manuscriptDirty
  }, [form, manuscriptDirty])

  // Las obras nuevas heredan el nombre autenticado; no se presenta un campo
  // editable que sugiera la posibilidad de publicar como otra persona.
  useEffect(() => {
    if (!serverMeta && user?.name) {
      setForm(current => current.author ? current : { ...current, author: user.name })
    }
  }, [user?.name, serverMeta])

  // Cargar libro existente si editamos
  useEffect(() => {
    const params     = new URLSearchParams(window.location.search)
    const editId     = params.get("id")
    const editStatus = params.get("status") as "draft" | "published" | null
    const editSource = params.get("source")
    const configureCover = (book: EditableBook) => {
      if (book.coverFx?.mode !== "layered") return
      const layers = book.coverFx.layers || {}
      if (layers.front) setCoverMode("triple")
      else if (layers.mid) setCoverMode("double")
    }
    const recoverCopies = async (id: string, canonical: EditableBook | null) => {
      try {
        const candidates: Array<{
          label: "local" | "cloud"
          savedAt: number
          value: EditableBook
          decision: ReturnType<typeof classifyDurableDraft>
        }> = []
        const durable = await loadDurableEditorDraft<EditableBook>(id)
        if (durable) {
          candidates.push({
            label: "local",
            savedAt: durable.savedAt,
            value: durable.value,
            decision: canonical
              ? classifyDurableDraft(durable, {
                  value: canonical,
                  revision: canonical.revision,
                  updatedAt: canonical.updatedAt,
                })
              : "recover",
          })
        }
        if (canonical && isServerBookId(Number(id))) {
          const response = await fetch(`/api/books/${id}/draft`, { credentials: "include" })
          if (response.ok) {
            const payload = await response.json()
            if (payload.draft) {
              cloudDraftRevision.current = payload.draft.draftRevision ?? 0
              const cloudEnvelope = {
                schemaVersion: 2 as const,
                savedAt: Date.parse(payload.draft.updatedAt) || 0,
                baseRevision: payload.draft.baseRevision ?? null,
                baseUpdatedAt: canonical.updatedAt ?? null,
                contentHash: "cloud",
                value: payload.draft.data as EditableBook,
              }
              // Un hash deliberadamente distinto obliga a clasificar por
              // revisión/fecha; el servidor ya validó y normalizó el JSON.
              candidates.push({
                label: "cloud",
                savedAt: cloudEnvelope.savedAt,
                value: cloudEnvelope.value,
                decision: cloudEnvelope.baseRevision < (canonical.revision ?? 1)
                  ? "stale"
                  : "recover",
              })
            }
          }
        }
        const useful = candidates
          .filter(candidate => candidate.decision !== "same")
          .sort((a, b) => b.savedAt - a.savedAt)
        const candidate = useful[0]
        if (!candidate) return
        const when = candidate.savedAt
          ? new Date(candidate.savedAt).toLocaleString()
          : "fecha desconocida"
        const stale = candidate.decision === "stale"
        const accept = window.confirm(stale
          ? `Hay una copia ${candidate.label === "cloud" ? "en la nube" : "local"} anterior a la revisión actual (${when}). No se aplicará automáticamente. ¿Quieres recuperarla como borrador para compararla?`
          : `Hay una copia de recuperación ${candidate.label === "cloud" ? "en la nube" : "local"} con cambios (${when}). ¿Quieres continuar desde esa copia?`)
        if (!accept) return
        setForm({
          ...(canonical ?? candidate.value),
          ...candidate.value,
          id: canonical?.id ?? candidate.value.id,
          revision: canonical?.revision ?? candidate.value.revision,
          updatedAt: canonical?.updatedAt ?? candidate.value.updatedAt,
          status: canonical?.status ?? candidate.value.status ?? "draft",
        })
        setManuscriptDirty(true)
        setMetaOpen(false)
        setSaveStatus("recovered")
        setTimeout(() => setSaveStatus("idle"), 3500)
      } catch (error) {
        console.warn("No se pudieron comparar las copias de recuperación", error)
      }
    }

    if (!editId) return
    const source = editStatus === "draft" ? STORAGE_DRAFTS : STORAGE_PUBLISHED
    const found = loadAll(source).find((b: any) => String(b.id) === editId) as EditableBook | undefined
    if (found) {
      setForm(found)
      setManuscriptDirty(false)
      setMetaOpen(false)
      configureCover(found)
    }

    if (!isServerBookId(Number(editId))) {
      void recoverCopies(editId, found ?? null)
      return
    }

    // Para toda obra persistida, el servidor es canónico. La copia local solo
    // se propone después de comparar revisión y fecha.
    void (async () => {
      try {
        const res = await fetch(`/api/books/${editId}`, { credentials: "include" })
        if (!res.ok) {
          await recoverCopies(editId, found ?? null)
          return
        }
        const book = await res.json() as EditableBook & Record<string, any>
        setForm(book)
        setManuscriptDirty(false)
        setMetaOpen(false)
        configureCover(book)
        if (editSource === "server") {
          setServerMeta({
            id: book.id,
            author: book.author ?? "",
            authorId: book.authorId ?? null,
            isClassic: !!book.isClassic,
            isAuthored: !!book.isAuthored,
            status: book.status || "published",
            originalLanguage: book.originalLanguage || "",
            gutenbergId: book.gutenbergId ?? null,
            publicationYear: book.publicationYear ?? null,
          })
        }
        await recoverCopies(editId, book)
      } catch {
        await recoverCopies(editId, found ?? null)
      }
    })()
  }, [])

  function update<K extends keyof BookForm>(key: K, value: BookForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setManuscriptDirty(true)
    triggerAutoSave()
  }

  function updateChapter(i: number, key: keyof Chapter, value: string) {
    setForm(f => {
      const chapters = [...f.chapters]
      chapters[i] = { ...chapters[i], [key]: value }
      return { ...f, chapters }
    })
    setManuscriptDirty(true)
    triggerAutoSave()
  }

  async function saveCloudDraft(currentForm: EditableBook): Promise<void> {
    if (!isServerBookId(currentForm.id) || !Number.isInteger(currentForm.revision)) return
    const response = await fetch(`/api/books/${currentForm.id}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        baseRevision: currentForm.revision,
        expectedDraftRevision: cloudDraftRevision.current,
        data: currentForm,
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 409) {
      throw new BookConflictError(
        payload.message || "Existe una copia más reciente del manuscrito.",
        Number(payload.currentRevision ?? currentForm.revision),
      )
    }
    if (!response.ok) throw new Error(payload.message || "No se pudo sincronizar el borrador")
    cloudDraftRevision.current = payload.draft?.draftRevision ?? cloudDraftRevision.current
  }

  // ── AUTOGUARDADO ─────────────────────────────────────
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setSaveStatus("idle")
    autoSaveTimer.current = setTimeout(() => {
      setForm(current => {
        doSaveDraft(current, true)
        return current
      })
    }, 2000)
  }, [])

  function doSaveDraft(currentForm: EditableBook, isAuto = false) {
    // Las obras de servidor no se duplican en localStorage porque pueden ser
    // enormes. Sí reciben una copia durable en IndexedDB para recuperación.
    if (isServerBookId(currentForm.id)) {
      if (!currentForm.id) return
      setSaveStatus("saving")
      const durableSave = durableSaveQueue.current
        .catch(() => undefined)
        .then(() => saveDurableEditorDraft(currentForm.id!, currentForm))
      durableSaveQueue.current = durableSave
      void durableSave.then(async () => {
        await saveCloudDraft(currentForm)
        setSaveStatus("saved")
        if (!isAuto) toast({ title: "Copia de recuperación guardada ✓" })
        setTimeout(() => setSaveStatus("idle"), 2500)
      }).catch(error => {
        console.warn("No se pudo respaldar la edición de servidor", error)
        setSaveStatus("error")
        setTimeout(() => setSaveStatus("idle"), 3000)
      })
      return
    }
    setSaveStatus("saving")
    try {
      const id   = currentForm.id || Date.now()
      const book = { ...currentForm, id, status: "draft" as const, localSavedAt: Date.now() }
      const drafts = loadAll(STORAGE_DRAFTS)
      const existingDraft = drafts.some((draft: any) => draft.id === id)
      const fallbackSaved = saveAll(STORAGE_DRAFTS,
        existingDraft
          ? drafts.map((b: any) => b.id === id ? book : b)
          : [...drafts, book]
      )
      setForm(f => ({ ...f, id }))

      const durableSave = durableSaveQueue.current
        .catch(() => undefined)
        .then(() => saveDurableEditorDraft(id, book))
      durableSaveQueue.current = durableSave
      void durableSave.then(async () => {
        await saveCloudDraft(book)
        setSaveStatus("saved")
        if (!isAuto) toast({ title: "Borrador guardado ✓" })
        setTimeout(() => setSaveStatus("idle"), 2500)
      }).catch(error => {
        console.warn("No se pudo crear la copia durable del manuscrito", error)
        if (fallbackSaved && !isServerBookId(id)) {
          setSaveStatus("saved")
          if (!isAuto) toast({ title: "Borrador guardado localmente" })
          setTimeout(() => setSaveStatus("idle"), 2500)
          return
        }
        if (error instanceof BookConflictError) {
          toast({
            title: "Conflicto de edición",
            description: "Hay una copia más reciente en otra sesión. Tu borrador local sigue intacto.",
          })
        }
        setSaveStatus("error")
        setTimeout(() => setSaveStatus("idle"), 3000)
      })
    } catch {
      setSaveStatus("error")
      setTimeout(() => setSaveStatus("idle"), 3000)
    }
  }

  function saveDraft() {
    if (!form.title.trim()) {
      toast({ title: "Escribe un título primero" })
      return
    }
    doSaveDraft(form)
  }

  useEffect(() => {
    const persistPendingChanges = () => {
      if (document.visibilityState === "hidden" && manuscriptDirtyRef.current) {
        doSaveDraft(formRef.current, true)
      }
    }
    const persistBeforePageExit = () => {
      if (manuscriptDirtyRef.current) doSaveDraft(formRef.current, true)
    }
    document.addEventListener("visibilitychange", persistPendingChanges)
    window.addEventListener("pagehide", persistBeforePageExit)
    return () => {
      document.removeEventListener("visibilitychange", persistPendingChanges)
      window.removeEventListener("pagehide", persistBeforePageExit)
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        saveDraft()
      }
      if (event.key === "Escape" && focusMode) setFocusMode(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [form, focusMode])

  async function publish() {
    if (!form.title.trim() || !form.synopsis.trim()) {
      toast({ title: "Faltan datos", description: "Título y sinopsis son obligatorios." })
      return
    }
    if (form.chapters.every(c => !c.content.trim())) {
      toast({ title: "Sin contenido", description: "Escribe al menos un capítulo." })
      return
    }

    setSaveStatus("saving")

    // Construir coverFx final según el modo
    let finalCoverFx: CoverFxConfig = { mode: "simple", layers: {} }
    if (coverMode === "double" || coverMode === "triple") {
      finalCoverFx = {
        mode:   "layered",
        layers: {
          back:  form.coverFx?.layers?.back  || form.coverUrl || "",
          mid:   form.coverFx?.layers?.mid   || "",
          front: coverMode === "triple" ? (form.coverFx?.layers?.front || "") : "",
        }
      }
    }

    try {
      const localId      = (form as any).id
      const serverPayload = {
        title:        form.title,
        // Si es edición de servidor (admin/clásico), preservar autor original
        author:       serverMeta ? form.author : (user?.name || form.author),
        authorId:     serverMeta ? serverMeta.authorId : (user?.id ?? null),
        synopsis:     form.synopsis,
        genre:        form.genre,
        type:         form.type,
        status:       (serverMeta?.status === "review" ? "review" : "published") as any,
        chapters:     form.chapters,
        coverUrl:     form.coverUrl || "",
        coverFx:      finalCoverFx,
        backCoverUrl: form.backCoverUrl || "",
        premiumCoverUrl: form.premiumCoverUrl || "",
        premiumBackUrl:  form.premiumBackUrl  || "",
        content:      form.chapters[0]?.content || "",
        spotifyLink:  form.spotifyLink || "",
        isSaved:      false,
        isAuthored:   serverMeta ? serverMeta.isAuthored : true,
        // Preservar identidad de clásico para no corromperlo
        ...(serverMeta ? {
          isClassic:        serverMeta.isClassic,
          originalLanguage: serverMeta.originalLanguage,
          gutenbergId:      serverMeta.gutenbergId,
        } : {}),
      }

      let serverId: number | undefined
      let serverBook: any

      if (isServerBookId(localId)) {
        serverBook = await updateBook.mutateAsync({
          id: localId,
          ...serverPayload,
          ...(Number.isInteger(form.revision) ? { expectedRevision: form.revision } : {}),
        })
        serverId = localId
      } else {
        serverBook = await createBook.mutateAsync(serverPayload)
        serverId = serverBook.id
      }

      // Edición de servidor (admin/clásico): NO se guarda en la lista local
      // del admin; vive en el servidor. Solo confirmar y volver.
      if (serverMeta) {
        setManuscriptDirty(false)
        if (form.id) void removeDurableEditorDraft(form.id).catch(() => undefined)
        setSaveStatus("saved")
        toast({
          title: "Cambios guardados ✦",
          description: serverMeta.status === "review"
            ? "El libro sigue en revisión con tus correcciones."
            : "El libro del catálogo se actualizó para todos.",
        })
        setLocation("/library")
        return
      }

      const finalId = serverId || localId || Date.now()
      const finalStatus = serverBook?.status === "review" ? "review" : "published"
      const book = {
        ...form,
        ...serverBook,
        id: finalId,
        status: finalStatus,
        coverFx: finalCoverFx,
        localSavedAt: Date.now(),
      }
      saveAll(STORAGE_DRAFTS, loadAll(STORAGE_DRAFTS).filter((b: any) => b.id !== localId))
      saveAll(STORAGE_PUBLISHED, loadAll(STORAGE_PUBLISHED).filter((b: any) => b.id !== localId && b.id !== finalId))
      const destination = finalStatus === "published" ? STORAGE_PUBLISHED : STORAGE_DRAFTS
      const current = loadAll(destination)
      saveAll(destination, current.some((b: any) => b.id === localId || b.id === finalId)
        ? current.map((b: any) => (b.id === localId || b.id === finalId) ? book : b)
        : [...current, book])
      setForm(book)
      setManuscriptDirty(false)
      if (localId) void removeDurableEditorDraft(localId).catch(() => undefined)
      setSaveStatus("saved")
      toast(finalStatus === "review"
        ? { title: "Correcciones guardadas", description: "La obra permanece en revisión hasta que administración la restaure." }
        : { title: "¡Historia publicada! ✦", description: "Ya visible para todos los lectores." })
      setLocation("/library")
    } catch (err) {
      setSaveStatus("error")
      if (err instanceof BookConflictError) {
        void saveDurableEditorDraft(form.id ?? Date.now(), form).catch(() => undefined)
        toast({
          title: "La obra cambió en otra sesión",
          description: `El servidor está en la revisión ${err.currentRevision}. Tu versión se conservó como borrador y no se publicó encima.`,
        })
        return
      }
      // Para libros de servidor (clásicos/admin), no intentamos guardar en
      // memoria local (son enormes). Solo avisamos del fallo de conexión.
      if (serverMeta) {
        toast({ title: "No se pudo guardar", description: "Revisa tu conexión e inténtalo de nuevo." })
        return
      }
      const id = form.id || Date.now()
      const book = { ...form, id, status: "draft" as const, localSavedAt: Date.now() }
      void saveDurableEditorDraft(id, book).catch(() => undefined)
      if (!isServerBookId(id)) {
        const drafts = loadAll(STORAGE_DRAFTS)
        saveAll(STORAGE_DRAFTS,
          drafts.some((entry: any) => entry.id === id)
            ? drafts.map((entry: any) => entry.id === id ? book : entry)
            : [...drafts, book],
        )
      }
      toast({
        title: "No se publicó",
        description: "La copia quedó como borrador local. Revisa la conexión e inténtalo nuevamente.",
      })
    }
  }

  async function unpublish() {
    const id = form.id
    if (!id) return
    setSaveStatus("saving")
    try {
      let canonical: EditableBook = { ...form, status: "draft" }
      if (isServerBookId(id)) {
        canonical = await updateBook.mutateAsync({
          id,
          status: "draft",
          ...(Number.isInteger(form.revision) ? { expectedRevision: form.revision } : {}),
        }) as EditableBook
      }
      const book = { ...canonical, id, status: "draft" as const, localSavedAt: Date.now() }
      if (!serverMeta) {
        saveAll(STORAGE_PUBLISHED, loadAll(STORAGE_PUBLISHED).filter((entry: any) => entry.id !== id))
        const drafts = loadAll(STORAGE_DRAFTS)
        saveAll(STORAGE_DRAFTS,
          drafts.some((entry: any) => entry.id === id)
            ? drafts.map((entry: any) => entry.id === id ? book : entry)
            : [...drafts, book],
        )
        await saveDurableEditorDraft(id, book)
      }
      setForm(book)
      setManuscriptDirty(false)
      setSaveStatus("saved")
      toast({ title: "Historia despublicada", description: "Ya no aparece en el catálogo público." })
      setLocation("/library")
    } catch (error) {
      setSaveStatus("error")
      toast({
        title: "No se pudo despublicar",
        description: error instanceof BookConflictError
          ? "La obra cambió en otra sesión. Recarga antes de intentarlo de nuevo."
          : "El servidor no confirmó el cambio; la obra sigue publicada.",
      })
    }
  }

  function addChapter() {
    const n = form.chapters.length + 1
    setForm(f => ({ ...f, chapters: [...f.chapters, { title: `Capítulo ${n}`, content: "" }] }))
    setActiveChapter(form.chapters.length)
    setManuscriptDirty(true)
    triggerAutoSave()
  }

  function removeChapter(index: number) {
    if (form.chapters.length <= 1) return
    const chapter = form.chapters[index]
    if (chapter?.content.trim() && !window.confirm(`¿Eliminar “${chapter.title || `Capítulo ${index + 1}`}”? Esta acción no se puede deshacer.`)) return
    const updated = form.chapters.filter((_, i) => i !== index)
    setForm(f => ({ ...f, chapters: updated }))
    setActiveChapter(Math.min(activeChapter, updated.length - 1))
    setManuscriptDirty(true)
    triggerAutoSave()
  }

  const gc           = genres.find(g => g.key === form.genre) || genres[0]
  const totalWords   = form.chapters.reduce((acc, c) => acc + wordCount(c.content), 0)
  const chapterWords = wordCount(form.chapters[activeChapter]?.content || "")
  const publishingChecks = [
    { label: t("title"), done: !!form.title.trim() },
    { label: t("synopsis"), done: !!form.synopsis.trim() },
    { label: t("profileBanner"), done: !!(form.coverUrl || form.coverFx?.layers?.back) },
    { label: t("chapter"), done: form.chapters.some(chapter => wordCount(chapter.content) >= 50) },
  ]
  const publishingReady = publishingChecks.every(item => item.done)
  const directionUrl = buildDirectionWorkspaceUrl(form.id, activeChapter)

  function openDirectionWorkspace() {
    if (!directionUrl) {
      toast({
        title: "Guarda la obra en Tloque primero",
        description: "Dirección trabaja sobre una versión persistida del manuscrito.",
      })
      return
    }
    if (manuscriptDirty) {
      toast({
        title: "Hay cambios sin sincronizar",
        description: "Publica o actualiza la obra antes de abrir Dirección para evitar una partitura desfasada.",
      })
      return
    }
    setLocation(directionUrl)
  }

  return (
    <div className="min-h-screen bg-black text-zinc-300 overflow-x-hidden">

      {/* ── BARRA SUPERIOR ── */}
      <div
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-4 py-2.5"
        style={{
          background:     "rgba(0,0,0,0.92)",
          backdropFilter: "blur(20px)",
          borderBottom:   "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setLocation("/library")}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg"
            style={{ color: "rgba(255,255,255,0.4)" }}
            aria-label="Volver a la biblioteca"
          >
            <ArrowLeft className="w-4 h-4" />
          </motion.button>

          {/* Indicador de guardado */}
          <AnimatePresence mode="wait">
            {saveStatus === "saving" && (
              <motion.span key="saving"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-[10px] font-sans text-zinc-600">
                Guardando...
              </motion.span>
            )}
            {saveStatus === "saved" && (
              <motion.span key="saved"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-[10px] font-sans"
                style={{ color: gc.color + "aa" }}>
                <Check className="w-3 h-3" /> Guardado
              </motion.span>
            )}
            {saveStatus === "recovered" && (
              <motion.span key="recovered"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-[10px] font-sans text-violet-200/70">
                <Check className="w-3 h-3" /> Borrador recuperado
              </motion.span>
            )}
            {saveStatus === "error" && (
              <motion.span key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-[10px] font-sans text-red-400">
                <AlertCircle className="w-3 h-3" /> Error
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChecklist(value => !value)}
            className="relative hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-sans"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: publishingReady ? "#86efac" : "rgba(255,255,255,0.45)" }}
            aria-expanded={showChecklist}
          >
            <ListChecks className="w-3.5 h-3.5" /> {publishingChecks.filter(item => item.done).length}/{publishingChecks.length}
          </button>
          <button
            onClick={() => setFocusMode(value => !value)}
            className="hidden sm:flex p-2 rounded-lg text-white/40 border border-white/[.07] bg-white/[.03]"
            aria-label={focusMode ? "Salir del modo enfoque" : "Modo enfoque"}
          >
            {focusMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={openDirectionWorkspace}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-sans transition"
            style={directionUrl && !manuscriptDirty ? {
              borderColor: "rgba(196,181,253,.22)",
              background: "rgba(196,181,253,.08)",
              color: "rgba(221,214,254,.78)",
            } : {
              borderColor: "rgba(255,255,255,.06)",
              background: "rgba(255,255,255,.025)",
              color: "rgba(255,255,255,.25)",
            }}
            title={manuscriptDirty ? "Sincroniza el manuscrito antes de abrir Dirección" : "Abrir Dirección avanzada"}
            aria-label="Abrir Dirección avanzada"
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dirección</span>
          </button>
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={saveDraft}
            className="flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-sans"
            style={{
              background: "rgba(255,255,255,0.05)",
              border:     "1px solid rgba(255,255,255,0.1)",
              color:      "rgba(255,255,255,0.5)",
            }}
            aria-label="Guardar borrador"
          >
            <Save className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Borrador</span>
          </motion.button>

          {form.status === "published" && (
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={unpublish}
              className="flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-sans"
              style={{ background: "rgba(255,100,100,0.1)", color: "rgba(255,100,100,0.7)" }}
              aria-label="Despublicar obra"
            >
              <EyeOff className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Despublicar</span>
            </motion.button>
          )}

          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={publish}
            className="flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-sans font-semibold"
            style={{
              background: `linear-gradient(135deg, ${gc.glow}cc, ${gc.color})`,
              color:      "rgba(0,0,0,0.85)",
              boxShadow:  `0 2px 12px ${gc.glow}50`,
            }}
            aria-label="Publicar obra"
          >
            <Globe className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Publicar</span>
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {showChecklist && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="fixed right-4 top-16 z-[70] w-64 rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl">
            <p className="mb-3 text-[10px] uppercase tracking-[.2em] text-white/35">Publicación</p>
            <div className="space-y-2">{publishingChecks.map(item => <div key={item.label} className="flex items-center gap-2 text-xs"><span className={`grid h-4 w-4 place-items-center rounded-full ${item.done ? "bg-emerald-300/20 text-emerald-200" : "bg-white/5 text-white/20"}`}>{item.done && <Check className="h-3 w-3" />}</span><span className={item.done ? "text-white/65" : "text-white/30"}>{item.label}</span></div>)}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── LAYOUT PRINCIPAL ── */}
      <div className={`pt-16 flex flex-col md:flex-row md:gap-0 mx-auto transition-[max-width] duration-300 ${focusMode ? "max-w-4xl" : "max-w-6xl"}`}>

        {/* ── PANEL IZQUIERDO — METADATA + PORTADA ── */}
        {!focusMode && <div
          className="w-full md:w-[300px] lg:w-[320px] shrink-0 md:border-r"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          {/* Toggle móvil */}
          <button
            onClick={() => setMetaOpen(o => !o)}
            className="md:hidden w-full flex items-center gap-3 px-4 py-3 border-b"
            style={{ borderColor: "rgba(255,255,255,0.07)" }}
          >
            <div className="w-8 h-11 rounded-md overflow-hidden shrink-0"
              style={{ background: `${gc.glow}18`, border: `1px solid ${gc.color}25` }}>
              {form.coverUrl
                ? <img loading="lazy" src={form.coverUrl} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center">
                    <Upload className="w-3 h-3" style={{ color: gc.color + "60" }} />
                  </div>
              }
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-white text-xs font-medium truncate">{form.title || "Sin título"}</p>
              <p className="text-zinc-600 text-[10px] font-sans mt-0.5">
                {form.author || "Sin autor"} · {totalWords} palabras
              </p>
            </div>
            {metaOpen ? <ChevronUp className="w-3.5 h-3.5 text-zinc-600" />
                      : <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />}
          </button>

          <AnimatePresence>
            {metaOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="md:sticky md:top-16 overflow-y-auto md:max-h-[calc(100vh-64px)]">

                  {/* Tabs: Meta / Portada */}
                  <div className="flex border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    {[
                      { key: "meta",  label: "Detalles",  icon: FileText },
                      { key: "cover", label: "Portada 3D", icon: Layers   },
                    ].map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => setCoverTab(key as any)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-sans transition-all"
                        style={coverTab === key ? {
                          color:        gc.color,
                          borderBottom: `2px solid ${gc.color}`,
                        } : {
                          color:        "rgba(255,255,255,0.3)",
                          borderBottom: "2px solid transparent",
                        }}
                      >
                        <Icon className="w-3 h-3" /> {label}
                      </button>
                    ))}
                  </div>

                  <div className="p-4 space-y-4">

                    {/* ── TAB META ── */}
                    {coverTab === "meta" && (
                      <>
                        {/* Portada simple preview */}
                        <div
                          onClick={() => setCoverTab("cover")}
                          className="relative mx-auto cursor-pointer"
                          style={{ width: "100%", maxWidth: 140 }}
                        >
                          <ParallaxCover
                            title={form.title || "Tu portada"}
                            coverUrl={form.coverUrl}
                            coverFx={form.coverFx}
                            accentColor={gc.color}
                            accentGlow={gc.glow}
                            className="w-full aspect-[2/3]"
                          />
                          <div className="absolute inset-0 flex items-end justify-center pb-2 opacity-0 hover:opacity-100 transition-opacity">
                            <span className="text-[9px] font-sans px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(0,0,0,0.8)", color: gc.color }}>
                              Editar portada
                            </span>
                          </div>
                        </div>

                        {/* Campos de texto */}
                        {[
                          { label: "Título",   field: "title"       as const, placeholder: "El nombre de tu historia" },
                          { label: "Autor",    field: "author"      as const, placeholder: "Tu nombre"                },
                          { label: "Spotify",  field: "spotifyLink" as const, placeholder: "https://open.spotify.com/playlist/..." },
                        ].map(({ label, field, placeholder }) => (
                          <div key={field}>
                            <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1 block font-sans">
                              {label}
                            </label>
                            <input
                              value={(form as any)[field]}
                              onChange={e => update(field, e.target.value)}
                              readOnly={field === "author" && !serverMeta}
                              placeholder={placeholder}
                              className="w-full text-white text-sm outline-none font-sans rounded-lg px-3 py-2"
                              style={{
                                background: "rgba(255,255,255,0.04)",
                                border:     "1px solid rgba(255,255,255,0.08)",
                                caretColor: gc.color,
                              }}
                              onFocus={e => e.target.style.borderColor = gc.color + "50"}
                              onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
                            />
                          </div>
                        ))}

                        {/* Tipo */}
                        <div>
                          <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1.5 block font-sans">
                            Tipo
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {(["book", "story"] as const).map(tp => (
                              <button
                                key={tp}
                                onClick={() => update("type", tp)}
                                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-sans transition-all"
                                style={form.type === tp ? {
                                  background: `${gc.glow}20`,
                                  border:     `1px solid ${gc.color}50`,
                                  color:      gc.color,
                                } : {
                                  background: "rgba(255,255,255,0.03)",
                                  border:     "1px solid rgba(255,255,255,0.07)",
                                  color:      "rgba(255,255,255,0.35)",
                                }}
                              >
                                {tp === "book"
                                  ? <><BookOpen className="w-3 h-3" /> Libro</>
                                  : <><FileText className="w-3 h-3" /> Relato</>
                                }
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Género */}
                        <div>
                          <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1.5 block font-sans">
                            Género
                          </label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {genres.map(g => (
                              <button
                                key={g.key}
                                onClick={() => update("genre", g.key)}
                                className="py-1.5 rounded-lg text-[10px] font-sans transition-all"
                                style={form.genre === g.key ? {
                                  background: `${g.glow}20`,
                                  border:     `1px solid ${g.color}55`,
                                  color:      g.color,
                                  boxShadow:  `0 0 10px ${g.glow}30`,
                                } : {
                                  background: "rgba(255,255,255,0.03)",
                                  border:     "1px solid rgba(255,255,255,0.07)",
                                  color:      "rgba(255,255,255,0.3)",
                                }}
                              >
                                {t(g.tKey)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Sinopsis */}
                        <div>
                          <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1 block font-sans">
                            Sinopsis
                          </label>
                          <textarea
                            value={form.synopsis}
                            onChange={e => update("synopsis", e.target.value)}
                            placeholder={t("synopsisPlaceholder")}
                            rows={3}
                            className="w-full text-white text-xs font-sans outline-none rounded-lg px-3 py-2 resize-none leading-relaxed"
                            style={{
                              background: "rgba(255,255,255,0.04)",
                              border:     "1px solid rgba(255,255,255,0.08)",
                              caretColor: gc.color,
                            }}
                            onFocus={e => e.target.style.borderColor = gc.color + "50"}
                            onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
                          />
                        </div>

                        {/* Status */}
                        <div
                          className="text-center py-1.5 rounded-lg text-[10px] font-sans font-medium"
                          style={form.status === "published" ? {
                            background: "rgba(52,211,153,0.1)",
                            border:     "1px solid rgba(52,211,153,0.25)",
                            color:      "#6ee7b7",
                          } : {
                            background: "rgba(255,255,255,0.03)",
                            border:     "1px solid rgba(255,255,255,0.07)",
                            color:      "rgba(255,255,255,0.25)",
                          }}
                        >
                          {form.status === "published" ? "✦ Publicada" : "◌ Borrador"}
                        </div>
                      </>
                    )}

                    {/* ── TAB PORTADA 3D ── */}
                    {coverTab === "cover" && (
                      <CoverPanel
                        form={form}
                        gc={gc}
                        coverMode={coverMode}
                        setCoverMode={m => {
                          setCoverMode(m)
                          // Actualizar coverFx según el modo
                          if (m === "simple") {
                            update("coverFx", { mode: "simple", layers: {} })
                          } else {
                            update("coverFx", {
                              mode: "layered",
                              layers: form.coverFx?.layers || {},
                            })
                          }
                        }}
                        onCoverChange={url => {
                          update("coverUrl", url)
                          setForm(f => {
                            const updated = { ...f, coverUrl: url }
                            if (updated.title?.trim()) doSaveDraft(updated, true)
                            return updated
                          })
                        }}
                        onLayerChange={(layer, url) => {
                          update("coverFx", {
                            mode: "layered",
                            layers: { ...form.coverFx?.layers, [layer]: url },
                          })
                        }}
                        onBackCoverChange={url => update("backCoverUrl", url)}
                        onPremiumCoverChange={url => update("premiumCoverUrl", url)}
                        onPremiumBackChange={url => update("premiumBackUrl", url)}
                      />
                    )}

                    {/* Tarjetas coleccionables: ahora viven en su propio estudio */}
                    {typeof form.id === "number" && (
                      <motion.button whileTap={{ scale: 0.97 }}
                        onClick={() => setLocation(`/tarjetas/${form.id}`)}
                        className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-sans"
                        style={{ background: `${gc.glow}10`, color: gc.color, border: `1px dashed ${gc.color}40` }}>
                        🃏 {t("cardsOfWork")}
                      </motion.button>
                    )}

                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>}

        {/* ── PANEL DERECHO — ESCRITURA ── */}
        <div className="flex-1 flex flex-col min-h-[calc(100vh-64px)]">

          {/* Tabs de capítulos */}
          {form.type === "book" && (
            <div
              className="flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              {form.chapters.map((ch, i) => (
                <div key={i} className="relative group shrink-0">
                  <button
                    onClick={() => setActiveChapter(i)}
                    className="min-h-11 whitespace-nowrap rounded-lg px-3 text-xs font-sans transition-all"
                    style={activeChapter === i ? {
                      background: `${gc.glow}20`,
                      border:     `1px solid ${gc.color}45`,
                      color:      gc.color,
                    } : {
                      background: "rgba(255,255,255,0.04)",
                      border:     "1px solid rgba(255,255,255,0.07)",
                      color:      "rgba(255,255,255,0.35)",
                    }}
                  >
                    {ch.title || `Cap. ${i + 1}`}
                  </button>
                  {form.chapters.length > 1 && (
                    <button
                      onClick={() => removeChapter(i)}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(180,50,50,0.8)" }}
                    >
                      <Trash2 className="w-2 h-2 text-red-200" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addChapter}
                className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-sans"
                style={{
                  background: "transparent",
                  border:     "1px dashed rgba(255,255,255,0.12)",
                  color:      "rgba(255,255,255,0.25)",
                }}
              >
                <Plus className="w-3 h-3" /> Capítulo
              </button>
            </div>
          )}

          {/* Área de escritura */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeChapter}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="flex flex-col flex-1 px-4 sm:px-8 py-4 gap-3"
            >
              {form.type === "book" && (
                <input
                  value={form.chapters[activeChapter]?.title || ""}
                  onChange={e => updateChapter(activeChapter, "title", e.target.value)}
                  placeholder={t("chapterTitlePlaceholder")}
                  className="bg-transparent text-white text-sm font-semibold font-sans outline-none border-b pb-2"
                  style={{ borderColor: "rgba(255,255,255,0.08)", caretColor: gc.color }}
                />
              )}

              <textarea
                value={form.chapters[activeChapter]?.content || ""}
                onChange={e => updateChapter(activeChapter, "content", e.target.value)}
                placeholder={t("chapterContentPlaceholder")}
                className="flex-1 resize-none bg-transparent font-serif leading-[2] text-zinc-300 outline-none"
                style={{ fontSize: focusMode ? "18px" : "16px", minHeight: focusMode ? "78vh" : "60vh", caretColor: gc.color, maxWidth: focusMode ? 760 : undefined, width: "100%", marginInline: focusMode ? "auto" : undefined }}
                onFocus={e => {
                  // En móvil, evita que el teclado tape el cursor
                  setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 350)
                }}
              />

              {/* Pie */}
              <div className="flex items-center justify-between py-1 border-t"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <span className="text-[10px] text-zinc-700 font-sans">
                  {chapterWords} palabras en este capítulo
                </span>
                <span className="text-[10px] text-zinc-700 font-sans">
                  {totalWords} total
                </span>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
