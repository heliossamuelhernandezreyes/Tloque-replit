import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft, CheckCircle2, Download, Headphones, LibraryBig, Loader2, Music2,
  ExternalLink, FileDown, Package, Pencil, Play, Plus, RotateCcw, SlidersHorizontal, Square, Trash2, Upload,
} from "lucide-react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/useAuth"
import { useMusic } from "@/audio/MusicProvider"
import { useSoundFX } from "@/hooks/useSoundFX"
import {
  DEFAULT_PROCEDURAL_RECIPE, DEFAULT_UI_SOUND_RECIPE,
  anyLinearScoreRecipeSchema, proceduralRecipeSchema, uiSoundRecipeSchema,
  type LinearScoreRecipe, type ProceduralRecipe,
  type UiSoundEventKey, type UiSoundRecipe,
} from "@shared/audio"
import {
  AUDIO_MODULE_SOURCES, AUDIO_SOURCE_REGISTRY_VERSION,
  type AudioSourceStatus,
} from "@shared/audio-module-sources"
import { musicCueFor, type CatalogAudioAsset as AudioAsset } from "@/audio/catalog"
import { cacheAudioResource, isAudioResourceCached, removeCachedAudioResource } from "@/audio/AudioResourceCache"
import { downloadWav, estimateScoreExport, renderTloqueScoreToWav } from "@/audio/ScoreExporter"
import { renderTloqueScoreWithModuleToWav } from "@/audio/ScoreSampledExporter"
import {
  assessAudioMasteringSafety,
  type AudioMasteringSafetyReport,
  type AudioRenderAnalysis,
} from "@/audio/AudioRenderAnalysis"
import { compileTloqueScoreOnServer } from "@/lib/tloqueScoreApi"
import { ORCHESTRAL_SYNTH_MODULE_ID, withOrchestralModule } from "@shared/orchestral-synthesis"

type AudioAssetForm = Omit<AudioAsset, "id" | "favorite">
type StudioTab = "library" | "composer" | "modules" | "interface"

interface EventBinding {
  eventKey: UiSoundEventKey
  assetId: number
  volume: number
  cooldownMs: number
  enabled: boolean
}

interface BindingDraft { assetId: number; volume: number; cooldownMs: number; enabled: boolean }

const EMPTY: AudioAssetForm = {
  title: "", artist: "", kind: "music", sourceType: "stream", url: "", recipe: null,
  musicalKey: "", musicalMode: "", brightness: 0.5, texture: "", tags: [],
  packUrl: "", packBytes: null, packSha256: "", instrumentProgram: null,
  emotion: "neutral", bpm: null, energy: 0.5, durationSeconds: null,
  loop: true, license: "", sourceName: "", sourceUrl: "", status: "draft",
}

const SCORE_META = {
  title: "", artist: "", license: "Propio · Tloque", sourceName: "Compositor TloqueScore",
  sourceUrl: "", status: "draft" as AudioAsset["status"],
}

const SOURCE_STATUS: Record<AudioSourceStatus, { label: string; className: string }> = {
  integrated: { label: "Integrado", className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" },
  approved: { label: "Aprobado", className: "border-sky-400/20 bg-sky-400/10 text-sky-200" },
  conversion: { label: "Requiere conversión", className: "border-amber-400/20 bg-amber-400/10 text-amber-200" },
  review: { label: "En revisión", className: "border-orange-400/20 bg-orange-400/10 text-orange-200" },
  excluded: { label: "Excluido", className: "border-red-400/20 bg-red-400/10 text-red-200" },
}

const SCORE_STARTER = `TLOQUE_SCORE 2
title "Obra sin título"
tempo 72
meter 4/4
loop false
seed 20260822
humanize 0.10
quality master
module builtin

track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.30 pan=-0.10 attack=0.04 release=1.8 expression=0.86 brightness=0.54 vibrato=0
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.24 pan=0.12 attack=0.14 release=1.6 expression=0.72 brightness=0.62 vibrato=0.14

section opening form=exposition bars=4 repeat=1 fade=2 tempo=72 rubato=0.08
use piano
1:1 C3,E3,G3 4 velocity=0.46 articulation=tenuto
2:1 F3,A3,C4 4 velocity=0.44
3:1 G3,B3,D4 4 velocity=0.46
4:1 C3,E3,G3 4 velocity=0.40 articulation=tenuto
use violin
control 1:1 expression=0.58 brightness=0.48 vibrato=0.08 ramp=0
1:1 E4 2 velocity=0.42 articulation=legato
2:1 A4 2 velocity=0.46 articulation=legato
control 3:1 expression=0.76 brightness=0.66 vibrato=0.24 ramp=2
3:1 B4 2 velocity=0.50 articulation=tenuto
4:1 E4 4 velocity=0.38 articulation=harmonic
end`

const SCORE_PALETTE = [
  {
    title: "Dinámica y color",
    items: [
      { label: "p · Suave", snippet: "control 1:1 expression=0.38 ramp=0\n" },
      { label: "mf · Presente", snippet: "control 1:1 expression=0.66 ramp=0\n" },
      { label: "f · Intenso", snippet: "control 1:1 expression=0.90 ramp=0\n" },
      { label: "Crescendo", snippet: "control 1:1 expression=0.86 ramp=4\n" },
      { label: "Diminuendo", snippet: "control 1:1 expression=0.34 ramp=4\n" },
      { label: "Oscuro", snippet: "control 1:1 brightness=0.24 ramp=2\n" },
      { label: "Brillante", snippet: "control 1:1 brightness=0.86 ramp=2\n" },
    ],
  },
  {
    title: "Cuerda y gesto",
    items: [
      { label: "Legato", snippet: "1:1 C5 1 velocity=0.48 articulation=legato\n" },
      { label: "Staccato", snippet: "1:1 C5 0.5 velocity=0.50 articulation=staccato\n" },
      { label: "Spiccato", snippet: "1:1 C5 0.5 velocity=0.52 articulation=spiccato\n" },
      { label: "Pizzicato", snippet: "1:1 C5 0.5 velocity=0.48 articulation=pizzicato\n" },
      { label: "Trémolo", snippet: "1:1 C5 2 velocity=0.46 articulation=tremolo\n" },
      { label: "Armónico", snippet: "1:1 C6 2 velocity=0.38 articulation=harmonic\n" },
      { label: "Acento", snippet: "1:1 C5 1 velocity=0.62 articulation=accent\n" },
      { label: "Tenuto", snippet: "1:1 C5 2 velocity=0.46 articulation=tenuto\n" },
    ],
  },
  {
    title: "Interpretación",
    items: [
      { label: "Vibrato natural", snippet: "control 1:1 vibrato=0.24 ramp=1\n" },
      { label: "Vibrato intenso", snippet: "control 1:1 vibrato=0.62 ramp=2\n" },
      { label: "Sin vibrato", snippet: "control 1:1 vibrato=0 ramp=1\n" },
      { label: "Pedal abajo", snippet: "control 1:1 pedal=down\n" },
      { label: "Pedal arriba", snippet: "control 2:1 pedal=up\n" },
      { label: "Bend arriba", snippet: "control 1:1 bend=1 ramp=1\n" },
      { label: "Bend al centro", snippet: "control 1:2 bend=0 ramp=0.5\n" },
    ],
  },
] as const

function moduleIdFor(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "instrument-bank"
}

export default function AudioCatalogAdmin() {
  const { isAdmin, isLoading: authLoading } = useAuth()
  const music = useMusic()
  const sound = useSoundFX()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<StudioTab>("library")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AudioAssetForm>({ ...EMPTY })
  const [preview, setPreview] = useState<number | null>(null)
  const [scoreEditingId, setScoreEditingId] = useState<number | null>(null)
  const [scoreSource, setScoreSource] = useState("")
  const [scoreMeta, setScoreMeta] = useState({ ...SCORE_META })
  const [compiled, setCompiled] = useState<LinearScoreRecipe | null>(null)
  const [exportProgress, setExportProgress] = useState(0)
  const [masteringResult, setMasteringResult] = useState<{
    analysis: AudioRenderAnalysis
    report: AudioMasteringSafetyReport
  } | null>(null)
  const [uploadMessage, setUploadMessage] = useState("")
  const [moduleCache, setModuleCache] = useState<Record<number, boolean>>({})
  const [bindingDrafts, setBindingDrafts] = useState<Record<string, BindingDraft>>({})
  const scoreEditorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => () => music.stop(), [music.stop])

  const { data, isLoading } = useQuery<{ assets: AudioAsset[] }>({
    queryKey: ["/api/admin/audio/assets"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audio/assets", { credentials: "include" })
      if (!res.ok) throw new Error("No se pudo cargar la Fonoteca")
      return res.json()
    },
    enabled: isAdmin,
  })
  const assets = data?.assets || []
  const qualityModules = assets.filter(asset => asset.sourceType === "soundfont" && asset.packUrl)

  useEffect(() => {
    let active = true
    void Promise.all(qualityModules.map(async asset => [asset.id, await isAudioResourceCached(asset.packUrl)] as const))
      .then(entries => { if (active) setModuleCache(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [qualityModules.map(asset => `${asset.id}:${asset.packUrl}`).join("|")])

  const bindingsQuery = useQuery<{
    events: readonly { key: UiSoundEventKey; label: string }[]
    bindings: EventBinding[]
    assets: AudioAsset[]
  }>({
    queryKey: ["/api/admin/audio/ui-bindings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audio/ui-bindings", { credentials: "include" })
      if (!res.ok) throw new Error("No se pudieron cargar los sonidos de interfaz")
      return res.json()
    },
    enabled: isAdmin,
  })

  useEffect(() => {
    if (!bindingsQuery.data) return
    const next: Record<string, BindingDraft> = {}
    for (const event of bindingsQuery.data.events) {
      const binding = bindingsQuery.data.bindings.find(item => item.eventKey === event.key)
      next[event.key] = binding
        ? { assetId: binding.assetId, volume: binding.volume, cooldownMs: binding.cooldownMs, enabled: binding.enabled }
        : { assetId: 0, volume: 0.8, cooldownMs: 70, enabled: true }
    }
    setBindingDrafts(next)
  }, [bindingsQuery.data])

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audio/assets"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/audio/assets"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audio/ui-bindings"] }),
    ])
    await sound.reloadManifest()
  }

  const save = useMutation({
    mutationFn: async () => {
      const url = editingId ? `/api/admin/audio/assets/${editingId}` : "/api/admin/audio/assets"
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(form),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || "No se pudo guardar")
      return body
    },
    onSuccess: async () => {
      await invalidate()
      setEditingId(null)
      setForm({ ...EMPTY })
    },
  })

  const archive = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/audio/assets/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error("No se pudo retirar")
    },
    onSuccess: invalidate,
  })

  const compile = useMutation({
    mutationFn: async (source: string) => {
      return compileTloqueScoreOnServer(source)
    },
    onSuccess: setCompiled,
  })

  const saveScore = useMutation({
    mutationFn: async () => {
      const recipe = await compileTloqueScoreOnServer(scoreSource)
      const moduleAsset = resolveScoreModule(recipe)
      if (recipe.version === 2 && !["builtin", "native-auto", ORCHESTRAL_SYNTH_MODULE_ID].includes(recipe.plan.moduleId) && !moduleAsset) {
        throw new Error(`Publica un banco instrumental con la etiqueta module:${recipe.plan.moduleId}`)
      }
      const payload: AudioAssetForm = {
        ...EMPTY,
        title: scoreMeta.title,
        artist: scoreMeta.artist,
        kind: "music",
        sourceType: "score",
        recipe,
        musicalMode: `${recipe.plan.meter.numerator}/${recipe.plan.meter.denominator}`,
        tags: ["theme", "instrumental", "tloque-score", ...(recipe.version === 2 ? [`module:${recipe.plan.moduleId}`, `quality:${recipe.plan.quality}`] : [])],
        texture: "partitura lineal TloqueScore",
        packUrl: moduleAsset?.packUrl || "",
        packBytes: moduleAsset?.packBytes ?? null,
        packSha256: moduleAsset?.packSha256 || "",
        bpm: recipe.plan.bpm,
        energy: 0.45,
        durationSeconds: Math.ceil("totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * 60 / recipe.plan.bpm),
        loop: recipe.plan.loop,
        license: scoreMeta.license,
        sourceName: scoreMeta.sourceName,
        sourceUrl: scoreMeta.sourceUrl,
        status: scoreMeta.status,
      }
      const url = scoreEditingId ? `/api/admin/audio/assets/${scoreEditingId}` : "/api/admin/audio/assets"
      const res = await fetch(url, {
        method: scoreEditingId ? "PUT" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || "No se pudo guardar el tema")
      return recipe
    },
    onSuccess: async recipe => {
      setCompiled(recipe)
      setScoreEditingId(null)
      await invalidate()
    },
  })

  const exportScore = useMutation({
    mutationFn: async () => {
      if (!compiled) throw new Error("Valida y compila el código antes de exportar")
      setExportProgress(0)
      setMasteringResult(null)
      const moduleAsset = resolveScoreModule(compiled)
      const measurement: { current: AudioRenderAnalysis | null } = { current: null }
      const options = {
        onProgress: setExportProgress,
        onAnalysis: (analysis: AudioRenderAnalysis) => { measurement.current = analysis },
      }
      const blob = moduleAsset
        ? await renderTloqueScoreWithModuleToWav(compiled, moduleAsset.packUrl, options)
        : await renderTloqueScoreToWav(compiled, options)
      if (!measurement.current) throw new Error("El render terminó sin medición de masterización")
      const report = assessAudioMasteringSafety(measurement.current)
      setMasteringResult({ analysis: measurement.current, report })
      if (report.status === "fail") {
        throw new Error(`Master rechazado por control de calidad:\n${report.reasons.map(reason => `• ${reason}`).join("\n")}`)
      }
      downloadWav(blob, scoreMeta.title || (compiled.version === 2 ? compiled.plan.title : "tloque-score"))
      return blob.size
    },
  })

  const uploadAudio = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 96 * 1024 * 1024) throw new Error("El archivo supera 96 MB; usa un enlace CDN para maestros mayores")
      const res = await fetch("/api/admin/audio/uploads", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Tloque-Filename": encodeURIComponent(file.name),
        },
        body: file,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || "No se pudo importar el audio")
      return body as { url: string; sha256: string; bytes: number; originalName: string; deduplicated: boolean }
    },
    onSuccess: upload => {
      const title = upload.originalName.replace(/\.(mp3|wav)$/i, "")
      setForm(current => ({
        ...current,
        title: current.title || title,
        sourceType: "stream",
        url: upload.url,
        recipe: null,
        packBytes: upload.bytes,
        packSha256: upload.sha256,
        sourceName: "Carga directa · Replit App Storage",
        tags: [...new Set([...current.tags, "imported-audio", `sha256:${upload.sha256.slice(0, 16)}`])].slice(0, 24),
      }))
      setUploadMessage(`${upload.deduplicated ? "Archivo ya existente" : "Carga terminada"} · ${(upload.bytes / 1024 / 1024).toFixed(1)} MB · ahora completa la licencia y guarda el activo.`)
    },
  })

  const uploadModule = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 500 * 1024 * 1024) throw new Error("El banco supera 500 MB. Usa SF3 comprimido o una URL HTTPS para módulos mayores.")
      const res = await fetch("/api/admin/audio/module-uploads", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Tloque-Filename": encodeURIComponent(file.name),
        },
        body: file,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || "No se pudo importar el banco instrumental")
      return body as {
        url: string
        sha256: string
        bytes: number
        extension: "sf2" | "sf3" | "dls"
        originalName: string
        deduplicated: boolean
      }
    },
    onSuccess: upload => {
      const title = upload.originalName.replace(/\.(sf2|sf3|dls)$/i, "") || "Banco instrumental"
      setEditingId(null)
      setForm({
        ...EMPTY,
        title,
        kind: "music",
        sourceType: "soundfont",
        recipe: DEFAULT_PROCEDURAL_RECIPE,
        texture: `Banco ${upload.extension.toUpperCase()}`,
        tags: [`module:${moduleIdFor(title)}`, "instrument-bank", `format:${upload.extension}`, `sha256:${upload.sha256.slice(0, 16)}`],
        packUrl: upload.url,
        packBytes: upload.bytes,
        packSha256: upload.sha256,
        instrumentProgram: 0,
        license: "Pendiente de verificar antes de publicar",
        sourceName: `Carga directa · ${upload.originalName}`,
        status: "draft",
      })
      setUploadMessage(`${upload.deduplicated ? "Banco ya existente" : "Banco importado"} · ${(upload.bytes / 1024 / 1024).toFixed(1)} MB · completa procedencia y licencia; permanecerá como borrador hasta que lo publiques.`)
      setTab("library")
      window.scrollTo({ top: 0, behavior: "smooth" })
    },
  })

  const installCuratedModule = useMutation({
    mutationFn: async (source: (typeof AUDIO_MODULE_SOURCES)[number]) => {
      if (!source.install) throw new Error("Este recurso todavía requiere conversión manual")
      const existing = qualityModules.find(asset => asset.tags.includes(`module:${source.install!.moduleId}`))
      if (existing) return { asset: existing, deduplicated: true, bytes: existing.packBytes || 0 }
      const installResponse = await fetch(`/api/admin/audio/module-catalog/${source.id}/install`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgement: source.install.acknowledgement }),
      })
      const installed = await installResponse.json().catch(() => ({}))
      if (!installResponse.ok) throw new Error(installed.message || "No se pudo instalar el banco")
      const payload: AudioAssetForm = {
        ...EMPTY,
        title: `${source.name} ${source.install.version}`,
        kind: "music",
        sourceType: "soundfont",
        recipe: DEFAULT_PROCEDURAL_RECIPE,
        texture: `${installed.extension.toUpperCase()} · ${source.install.presetCount} presets · ${source.install.drumKitCount} baterías`,
        tags: [
          `module:${source.install.moduleId}`, "instrument-bank", `format:${installed.extension}`,
          "curated-install", `source:${source.id}`, `sha256:${installed.sha256.slice(0, 16)}`,
        ],
        packUrl: installed.url,
        packBytes: installed.bytes,
        packSha256: installed.sha256,
        instrumentProgram: 0,
        license: source.license,
        sourceName: `${source.name} ${source.install.version} · commit ${source.install.pinnedCommit.slice(0, 12)}`,
        sourceUrl: source.repositoryUrl,
        status: "draft",
      }
      const assetResponse = await fetch("/api/admin/audio/assets", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await assetResponse.json().catch(() => ({}))
      if (!assetResponse.ok) throw new Error(body.message || "El banco se descargó, pero no se pudo registrar en Fonoteca")
      return { asset: body.asset as AudioAsset, deduplicated: installed.deduplicated, bytes: installed.bytes as number }
    },
    onSuccess: async result => {
      await invalidate()
      setUploadMessage(`${result.deduplicated ? "Banco verificado" : "Banco instalado"} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB · ya puedes usarlo en el Compositor. Queda como borrador hasta que revises su licencia y lo publiques.`)
    },
  })

  const manageModule = useMutation({
    mutationFn: async ({ asset, install }: { asset: AudioAsset; install: boolean }) => {
      if (install) await cacheAudioResource(asset.packUrl, asset.packSha256)
      else await removeCachedAudioResource(asset.packUrl)
      return { id: asset.id, install }
    },
    onSuccess: ({ id, install }) => setModuleCache(current => ({ ...current, [id]: install })),
  })

  const saveBinding = useMutation({
    mutationFn: async (eventKey: UiSoundEventKey) => {
      const draft = bindingDrafts[eventKey]
      if (!draft?.assetId) throw new Error("Elige un sonido publicado")
      const res = await fetch(`/api/admin/audio/ui-bindings/${eventKey}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || "No se pudo asignar")
    },
    onSuccess: invalidate,
  })

  const resetBinding = useMutation({
    mutationFn: async (eventKey: UiSoundEventKey) => {
      const res = await fetch(`/api/admin/audio/ui-bindings/${eventKey}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error("No se pudo restaurar el fallback")
    },
    onSuccess: invalidate,
  })

  const grouped = useMemo(() => ({
    "Música y temas": assets.filter(asset => asset.kind === "music"),
    "Ambientes": assets.filter(asset => asset.kind === "ambience"),
    "Interfaz y sistema": assets.filter(asset => asset.kind === "system"),
  }), [assets])

  function resolveScoreModule(recipe: LinearScoreRecipe) {
    if (recipe.version !== 2 || ["builtin", "native-auto", ORCHESTRAL_SYNTH_MODULE_ID].includes(recipe.plan.moduleId)) return null
    return qualityModules.find(asset => asset.tags.includes(`module:${recipe.plan.moduleId}`)) || null
  }

  const compiledModule = compiled ? resolveScoreModule(compiled) : null
  const exportEstimate = compiled ? estimateScoreExport(compiled) : null

  const procedural = proceduralRecipeSchema.safeParse(form.recipe).success
    ? proceduralRecipeSchema.parse(form.recipe) : DEFAULT_PROCEDURAL_RECIPE
  const sfx = uiSoundRecipeSchema.safeParse(form.recipe).success
    ? uiSoundRecipeSchema.parse(form.recipe) : DEFAULT_UI_SOUND_RECIPE

  function edit(asset: AudioAsset) {
    if (asset.sourceType === "score") {
      const recipe = anyLinearScoreRecipeSchema.safeParse(asset.recipe)
      if (!recipe.success) return
      setScoreEditingId(asset.id)
      setScoreSource(recipe.data.source)
      setCompiled(recipe.data)
      setScoreMeta({
        title: asset.title, artist: asset.artist, license: asset.license,
        sourceName: asset.sourceName, sourceUrl: asset.sourceUrl, status: asset.status,
      })
      setTab("composer")
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const { id: _id, favorite: _favorite, ...editable } = asset
    setEditingId(asset.id)
    setForm({ ...EMPTY, ...editable, sourceType: asset.sourceType || "stream", tags: asset.tags || [] })
    setTab("library")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function updateProcedural(patch: Partial<ProceduralRecipe>) {
    setForm(current => ({ ...current, recipe: { ...procedural, ...patch } }))
  }

  function updateSfxVoice(patch: Partial<UiSoundRecipe["voices"][number]>) {
    setForm(current => ({ ...current, recipe: { ...sfx, voices: [{ ...sfx.voices[0], ...patch }] } }))
  }

  function insertScoreSnippet(snippet: string) {
    const editor = scoreEditorRef.current
    const start = editor?.selectionStart ?? scoreSource.length
    const end = editor?.selectionEnd ?? start
    const before = scoreSource.slice(0, start)
    const needsLineBreak = Boolean(before && !before.endsWith("\n") && !snippet.startsWith("\n"))
    const insertion = `${needsLineBreak ? "\n" : ""}${snippet}`
    const next = `${before}${insertion}${scoreSource.slice(end)}`
    setScoreSource(next)
    setCompiled(null)
    compile.reset()
    window.requestAnimationFrame(() => {
      const cursor = start + insertion.length
      scoreEditorRef.current?.focus()
      scoreEditorRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  function loadScoreStarter() {
    setScoreSource(SCORE_STARTER)
    setCompiled(null)
    compile.reset()
    window.requestAnimationFrame(() => scoreEditorRef.current?.focus())
  }

  function useModuleInComposer(asset: AudioAsset) {
    const moduleId = asset.tags.find(tag => tag.startsWith("module:"))?.slice("module:".length)
    if (!moduleId) return
    setScoreSource(current => {
      const base = current.trim() ? current : SCORE_STARTER
      if (/^module\s+\S+/m.test(base)) return base.replace(/^module\s+\S+/m, `module ${moduleId}`)
      if (/^quality\s+\S+/m.test(base)) return base.replace(/^(quality\s+\S+)$/m, `$1\nmodule ${moduleId}`)
      return base.replace(/^(TLOQUE_SCORE\s+2)$/m, `$1\nmodule ${moduleId}`)
    })
    setCompiled(null)
    compile.reset()
    setTab("composer")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function requestCuratedInstall(source: (typeof AUDIO_MODULE_SOURCES)[number]) {
    if (!source.install) return
    if (window.confirm(`${source.install.acknowledgement}\n\n¿Descargar ${source.install.estimatedMegabytes} MB e instalarlo en Tloque?`)) {
      setUploadMessage("")
      installCuratedModule.mutate(source)
    }
  }

  function togglePreview(asset: AudioAsset) {
    if (preview === asset.id) {
      music.stop()
      setPreview(null)
      return
    }
    if (asset.kind === "system") sound.preview(asset)
    else music.playCue(musicCueFor(asset, { volume: 0.3, crossfadeSeconds: 0.35 }))
    setPreview(asset.id)
  }

  if (authLoading) return <div className="min-h-screen bg-zinc-950" />
  if (!isAdmin) return (
    <div className="min-h-screen bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center gap-4">
      <p>Esta sección es sólo para administradores.</p>
      <button onClick={() => setLocation("/")} className="text-amber-400">Volver</button>
    </div>
  )

  const inputClass = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
  const tabClass = (value: StudioTab) => `flex-1 min-w-[105px] flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs transition ${tab === value ? "bg-amber-400 text-black font-semibold" : "bg-white/5 text-zinc-400"}`

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-12">
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-zinc-950/95 border-b border-white/10">
        <button aria-label="Volver" onClick={() => setLocation("/library")}><ArrowLeft className="w-4 h-4" /></button>
        <Headphones className="w-4 h-4 text-amber-400" />
        <div><h1 className="font-semibold leading-tight">Estudio de audio</h1><p className="text-[10px] text-zinc-500">Código musical · módulos · Fonoteca total</p></div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.025] p-2">
          <button className={tabClass("library")} onClick={() => setTab("library")}><LibraryBig className="w-4 h-4" /> Fonoteca</button>
          <button className={tabClass("composer")} onClick={() => setTab("composer")}><Music2 className="w-4 h-4" /> Compositor</button>
          <button className={tabClass("modules")} onClick={() => setTab("modules")}><Package className="w-4 h-4" /> Módulos</button>
          <button className={tabClass("interface")} onClick={() => setTab("interface")}><SlidersHorizontal className="w-4 h-4" /> Interfaz</button>
        </nav>

        {tab === "composer" && (
          <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.035] p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Compositor de obras · TloqueScore 2.2</h2>
              <p className="mt-1 text-xs text-zinc-500">El código es la obra maestra: editarlo recompila y cambia el audio. La reproducción no crea archivos; Exportar genera un WAV sólo cuando lo pides.</p>
              <p className="mt-1 text-[10px] text-zinc-600"><code>quality master</code>: síntesis clásica u orquestal a 24-bit / 96 kHz; bancos nativos y SF2/SF3 a 24-bit / 48 kHz. La frecuencia de exportación no certifica realismo acústico. La síntesis orquestal admite hasta 192 fuentes simultáneas, incluidas sus colas; una nota puede usar varias fuentes.</p>
            </div>
            <fieldset className="rounded-xl border border-sky-300/20 bg-sky-300/5 p-3">
              <legend className="px-1 text-xs font-semibold text-sky-100">Fuente de interpretación</legend>
              <div className="flex flex-wrap gap-2">
                {([
                  ["native-auto", "Instrumentos grabados"],
                  [ORCHESTRAL_SYNTH_MODULE_ID, "Síntesis orquestal"],
                  ["builtin", "Síntesis clásica"],
                ] as const).map(([moduleId, label]) => (
                  <button key={moduleId} type="button" aria-pressed={scoreSource.match(/^module\s+(\S+)/m)?.[1] === moduleId} disabled={!/^TLOQUE_SCORE\s+2\s*$/m.test(scoreSource) || compile.isPending || saveScore.isPending || exportScore.isPending} onClick={() => {
                    music.stop()
                    setScoreSource(source => withOrchestralModule(source, moduleId))
                    setCompiled(null); compile.reset(); setMasteringResult(null)
                  }} className="min-h-11 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs aria-pressed:border-sky-300/60 aria-pressed:bg-sky-300/15 disabled:opacity-40">{label}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-400">La síntesis orquestal tiene timbres por familia, secciones de cuerda, respiración y sala compartida con el WAV. No necesita bancos; sigue siendo síntesis, no una grabación certificada. Los instrumentos grabados requieren sus bancos instalados. Cambiar la fuente conserva las notas: vuelve a compilar para escuchar.</p>
            </fieldset>
            <div className="grid sm:grid-cols-2 gap-3">
              <input className={inputClass} placeholder="Título del tema" value={scoreMeta.title} onChange={e => setScoreMeta(meta => ({ ...meta, title: e.target.value }))} />
              <input className={inputClass} placeholder="Compositor / DA" value={scoreMeta.artist} onChange={e => setScoreMeta(meta => ({ ...meta, artist: e.target.value }))} />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 rounded-xl border border-amber-400/20 bg-black/20 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-amber-100">Empieza desde cero o usa una estructura limpia</p>
                <p className="mt-1 text-[10px] text-zinc-500">El editor permanece vacío hasta que tú escribes, pegas o cargas esta plantilla.</p>
              </div>
              <button type="button" onClick={loadScoreStarter} className="min-h-11 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-100">
                Crear obra base
              </button>
            </div>
            <textarea
              ref={scoreEditorRef}
              className={`${inputClass} min-h-[360px] font-mono text-[12px] leading-5 resize-y`}
              spellCheck={false}
              aria-label="Código TloqueScore"
              placeholder="Pega o escribe aquí una obra TLOQUE_SCORE 2"
              value={scoreSource}
              onChange={event => { setScoreSource(event.target.value); setCompiled(null); compile.reset() }}
            />
            <details className="rounded-xl border border-amber-300/20 bg-amber-300/[0.035] p-3 text-xs" open>
              <summary className="cursor-pointer font-medium text-amber-100">Paleta expresiva táctil</summary>
              <p className="mt-2 text-[10px] leading-4 text-zinc-500">Coloca el cursor dentro de una sección, después de <code>use nombre-del-track</code>, y toca un gesto. Cambia <code>1:1</code> por el compás y tiempo deseados.</p>
              <div className="mt-3 space-y-3">
                {SCORE_PALETTE.map(group => (
                  <div key={group.title}>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{group.title}</p>
                    <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
                      {group.items.map(item => (
                        <button
                          type="button"
                          key={item.label}
                          onClick={() => insertScoreSnippet(item.snippet)}
                          className="min-h-11 shrink-0 snap-start rounded-lg border border-white/10 bg-white/[0.055] px-3 py-2 text-left text-[11px] text-zinc-200 active:bg-amber-300 active:text-black"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
            <details className="rounded-xl border border-white/10 p-3 text-xs text-zinc-400">
              <summary className="cursor-pointer text-zinc-300">Referencia rápida del lenguaje</summary>
              <p className="mt-2 font-mono leading-5">humanize 0..1 · quality core|studio|master · module builtin|id<br />track id synth=… instrument=… program=0..127 role=… gain=… pan=… expression=… brightness=… vibrato=…<br />section id form=exposition|development|recapitulation|coda bars=N repeat=N fade=N tempo=32..180 rubato=0..0.35<br />use track · control compás:tiempo expression=… brightness=… vibrato=… pedal=down|up bend=-2..2 ramp=0..16<br />compás:tiempo C3,Eb3,G3 duración velocity=… articulation=normal|legato|staccato|tenuto|accent|spiccato|pizzicato|tremolo|harmonic · rest posición duración · end</p>
            </details>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-sky-400/20 bg-sky-400/5 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-sky-100">¿Quieres componer con una IA?</p>
                <p className="mt-1 text-[11px] text-zinc-400">Descarga la skill oficial, entrégasela a tu IA y pídele una obra. Después pega aquí únicamente el código TloqueScore.</p>
              </div>
              <a
                href="/downloads/TLOQUE_SCORE_AI_SKILL.md"
                download="TLOQUE_SCORE_AI_SKILL.md"
                className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-sky-300 px-4 py-2 text-xs font-semibold text-sky-950"
              >
                <FileDown className="mr-2 h-4 w-4" /> Descargar skill para IA
              </a>
            </div>
            {compiled && (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 flex gap-2 text-xs text-emerald-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Compilada: {compiled.plan.totalBars} compases · {compiled.plan.tracks.length} pistas · {compiled.plan.events.length} notas{compiled.version === 2 ? ` · ${compiled.plan.controls.length} gestos` : ""} · {compiled.plan.bpm} BPM · {compiled.plan.sourceHash}{compiled.version === 2 ? ` · ${compiled.plan.quality} · módulo ${compiled.plan.moduleId}` : ""}</span>
              </div>
            )}
            {compiled?.version === 2 && !["builtin", "native-auto", ORCHESTRAL_SYNTH_MODULE_ID].includes(compiled.plan.moduleId) && !compiledModule && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">Falta el módulo <code>module:{compiled.plan.moduleId}</code>. Tloque puede previsualizar con síntesis base, pero exige el banco publicado para guardar esta versión.</p>
            )}
            {compile.isError && <pre role="alert" className="whitespace-pre-wrap rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-xs text-red-200">{(compile.error as Error).message}</pre>}
            <div className="grid sm:grid-cols-3 gap-3">
              <input className={inputClass} placeholder="Licencia / autorización" value={scoreMeta.license} onChange={e => setScoreMeta(meta => ({ ...meta, license: e.target.value }))} />
              <input className={inputClass} placeholder="Procedencia" value={scoreMeta.sourceName} onChange={e => setScoreMeta(meta => ({ ...meta, sourceName: e.target.value }))} />
              <select className={inputClass} value={scoreMeta.status} onChange={e => setScoreMeta(meta => ({ ...meta, status: e.target.value as AudioAsset["status"] }))}>
                <option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={compile.isPending || !scoreSource.trim()} onClick={() => compile.mutate(scoreSource)} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-50">
                {compile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Validar y compilar"}
              </button>
              <button disabled={!compiled} onClick={() => compiled && music.playCue({ id: -11, title: scoreMeta.title || "Vista previa", sourceType: "score", recipe: compiled, packUrl: compiledModule?.packUrl, packBytes: compiledModule?.packBytes, packSha256: compiledModule?.packSha256, loop: compiled.plan.loop, volume: 1, crossfadeSeconds: 0.25, monitoring: "reference" })} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"><Play className="inline w-4 h-4 mr-1" /> Escuchar al 100%</button>
              <button onClick={() => music.stop()} className="rounded-lg bg-white/10 px-4 py-2 text-sm"><Square className="inline w-4 h-4 mr-1" /> Detener</button>
              <button disabled={!compiled || exportScore.isPending} onClick={() => exportScore.mutate()} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"><Download className="inline w-4 h-4 mr-1" /> {exportScore.isPending ? `Exportando ${Math.round(exportProgress * 100)}%` : compiledModule ? "Exportar WAV muestreado" : "Exportar WAV"}</button>
              <button disabled={saveScore.isPending || !scoreMeta.title.trim() || !scoreSource.trim()} onClick={() => saveScore.mutate()} className="sm:ml-auto rounded-lg bg-amber-400 text-black px-4 py-2 text-sm font-semibold disabled:opacity-40">
                {saveScore.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `${scoreEditingId ? "Actualizar" : "Guardar"} en Fonoteca`}
              </button>
            </div>
            {exportEstimate && <p className="text-[10px] text-zinc-500">Monitoreo de referencia independiente del volumen de lectura · {compiledModule ? `Render muestreado ${compiledModule.title} · 24-bit / 48 kHz` : `Render ${exportEstimate.bitDepth}-bit / ${(exportEstimate.sampleRate / 1000).toFixed(0)} kHz`} · {exportEstimate.audioProfile} · tamaño estimado {(exportEstimate.bytes / 1024 / 1024).toFixed(1)} MB · las obras muy largas pueden requerir exportación por movimientos para proteger la memoria.</p>}
            {masteringResult && (
              <div className={`rounded-xl border p-3 text-xs ${masteringResult.report.status === "pass" ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : masteringResult.report.status === "warn" ? "border-amber-400/20 bg-amber-400/5 text-amber-200" : "border-red-400/20 bg-red-400/5 text-red-200"}`}>
                <p className="font-semibold">Control de master: {masteringResult.report.status === "pass" ? "aprobado" : masteringResult.report.status === "warn" ? "aprobado con revisión" : "rechazado"}</p>
                <p className="mt-1 tabular-nums">{Number.isFinite(masteringResult.analysis.integratedLufs) ? `${masteringResult.analysis.integratedLufs.toFixed(1)} LUFS-I` : "silencio"} · {masteringResult.analysis.truePeak4xDbtp.toFixed(2)} dBTP · crest {masteringResult.analysis.crestFactorDb.toFixed(1)} dB · {masteringResult.analysis.clippedSampleCount} clips</p>
                {masteringResult.report.reasons.length > 0 && <ul className="mt-1 list-disc pl-4">{masteringResult.report.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
              </div>
            )}
            {(saveScore.isError || exportScore.isError) && <pre className="whitespace-pre-wrap text-xs text-red-300">{((saveScore.error || exportScore.error) as Error).message}</pre>}
          </section>
        )}

        {tab === "modules" && (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Módulos instrumentales bajo demanda</h2>
              <p className="mt-1 text-xs text-zinc-500">La síntesis base siempre está incluida. Los bancos SF2/SF3 de mayor fidelidad se descargan uno por uno y pueden retirarse sin borrar partituras.</p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Importar banco desde este teléfono</p>
                <p className="mt-1 text-[10px] text-zinc-500">SF2, SF3 o DLS · máximo 500 MB · contenido verificado · SHA-256 · deduplicación. Para móvil se recomienda SF3.</p>
              </div>
              <label className="cursor-pointer rounded-lg bg-amber-400 px-3 py-2 text-center text-xs font-semibold text-black">
                {uploadModule.isPending ? <Loader2 className="inline w-4 h-4 animate-spin mr-1" /> : <Upload className="inline w-4 h-4 mr-1" />} Seleccionar banco
                <input className="sr-only" type="file" accept=".sf2,.sf3,.dls,application/octet-stream" disabled={uploadModule.isPending} onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) { setUploadMessage(""); uploadModule.mutate(file) }
                  event.target.value = ""
                }} />
              </label>
            </div>
            {uploadModule.isError && <p className="rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-200">{(uploadModule.error as Error).message}</p>}
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium">Síntesis base Tloque</p><p className="text-[10px] text-zinc-500">Incluida · sin descarga · <code>module builtin</code></p></div>
              <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            </div>
            {AUDIO_MODULE_SOURCES.filter(source => source.install).map(source => (
              <article key={source.id} className="rounded-xl border border-sky-400/20 bg-sky-400/[0.045] p-3 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-sky-100">{source.name} {source.install!.version}</p>
                    <p className="mt-1 text-[10px] leading-4 text-zinc-400">{source.install!.presetCount} presets · {source.install!.drumKitCount} baterías · {source.install!.estimatedMegabytes} MB · {source.formats.join("/")}</p>
                    <p className="mt-1 text-[10px] leading-4 text-orange-200/80">Instalación comunitaria con aceptación de procedencia. Se guarda internamente y se fija por SHA-256.</p>
                  </div>
                  <Package className="h-5 w-5 shrink-0 text-sky-300" />
                </div>
                <button
                  disabled={installCuratedModule.isPending}
                  onClick={() => requestCuratedInstall(source)}
                  className="min-h-11 w-full rounded-lg bg-sky-300 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-40"
                >
                  {installCuratedModule.isPending ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Download className="mr-1 inline h-4 w-4" />}
                  Descargar, verificar e instalar
                </button>
              </article>
            ))}
            {uploadMessage && <p className="rounded-lg bg-emerald-400/5 px-3 py-2 text-xs leading-5 text-emerald-200">{uploadMessage}</p>}
            {installCuratedModule.isError && <p className="rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-200">{(installCuratedModule.error as Error).message}</p>}
            {qualityModules.map(asset => {
              const moduleTag = asset.tags.find(tag => tag.startsWith("module:")) || "Falta etiqueta module:id"
              const installed = Boolean(moduleCache[asset.id])
              return (
                <div key={asset.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{asset.title}</p>
                    <p className="text-[10px] text-zinc-500">{moduleTag} · {asset.packBytes ? `${(asset.packBytes / 1024 / 1024).toFixed(1)} MB` : "tamaño no declarado"} · {asset.license}</p>
                    <p className="text-[10px] text-zinc-600 truncate">{asset.sourceName}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <button disabled={!moduleTag.startsWith("module:")} onClick={() => useModuleInComposer(asset)} className="rounded-lg bg-sky-300 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-40"><Music2 className="mr-1 inline h-3.5 w-3.5" /> Usar</button>
                    <button disabled={manageModule.isPending || !moduleTag.startsWith("module:")} onClick={() => manageModule.mutate({ asset, install: !installed })} className={`rounded-lg px-3 py-2 text-xs disabled:opacity-40 ${installed ? "bg-white/10" : "bg-amber-400 text-black font-semibold"}`}>
                      {installed ? <><Trash2 className="inline w-3.5 h-3.5 mr-1" /> Retirar</> : <><Download className="inline w-3.5 h-3.5 mr-1" /> Al dispositivo</>}
                    </button>
                  </div>
                </div>
              )
            })}
            {!qualityModules.length && <p className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-zinc-500">Aún no hay bancos instrumentales. Créalo en Fonoteca como “Instrumentos SF2/SF3” y añade una etiqueta única como <code>module:orchestra-core</code>.</p>}
            {manageModule.isError && <p className="text-xs text-red-300">{(manageModule.error as Error).message}</p>}
            <details className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <summary className="cursor-pointer text-sm font-medium">Motores, herramientas y bibliotecas evaluadas · {AUDIO_MODULE_SOURCES.length}</summary>
              <p className="mt-2 text-[10px] leading-4 text-zinc-500">Registro {AUDIO_SOURCE_REGISTRY_VERSION}. Estos enlaces documentan procedencia; Tloque nunca consulta GitHub durante la reproducción. Cada banco publicado queda en la app y fijado por SHA-256.</p>
              <div className="mt-3 grid gap-2">
                {AUDIO_MODULE_SOURCES.map(source => {
                  const status = SOURCE_STATUS[source.status]
                  return (
                    <article key={source.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-zinc-200">{source.name}</p>
                          <p className="mt-1 text-[10px] text-zinc-500">{source.license} · {source.formats.join(" · ")}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[9px] ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-2 text-[11px] leading-4 text-zinc-400">{source.role}</p>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-500">{source.decision}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-[10px]">
                        <a href={source.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300">Repositorio <ExternalLink className="h-3 w-3" /></a>
                        {source.documentationUrl && <a href={source.documentationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300">Guía <ExternalLink className="h-3 w-3" /></a>}
                      </div>
                    </article>
                  )
                })}
              </div>
            </details>
          </section>
        )}

        {tab === "interface" && (
          <section className="space-y-3">
            <div><h2 className="text-sm font-semibold">Mapa de sonidos de interfaz</h2><p className="mt-1 text-xs text-zinc-500">Cada gesto apunta a un activo publicado. Quitar una asignación activa el fallback silencioso incorporado.</p></div>
            {bindingsQuery.isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
            {bindingsQuery.data?.events.map(event => {
              const draft = bindingDrafts[event.key] || { assetId: 0, volume: 0.8, cooldownMs: 70, enabled: true }
              const selected = bindingsQuery.data?.assets.find(asset => asset.id === draft.assetId)
              return (
                <div key={event.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{event.label}</p><code className="text-[10px] text-zinc-600">{event.key}</code></div>{selected && <button aria-label="Escuchar" onClick={() => sound.preview(selected)} className="p-2 rounded-full bg-white/5"><Headphones className="w-4 h-4" /></button>}</div>
                  <div className="grid sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-center">
                    <select className={inputClass} value={draft.assetId} onChange={e => setBindingDrafts(all => ({ ...all, [event.key]: { ...draft, assetId: Number(e.target.value) } }))}>
                      <option value={0}>Fallback incorporado</option>
                      {bindingsQuery.data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.title} · {asset.sourceType}</option>)}
                    </select>
                    <label className="text-[10px] text-zinc-500">Volumen {Math.round(draft.volume * 100)}%<input className="w-full mt-2" type="range" min={0} max={1} step={0.05} value={draft.volume} onChange={e => setBindingDrafts(all => ({ ...all, [event.key]: { ...draft, volume: Number(e.target.value) } }))} /></label>
                    <label className="text-[10px] text-zinc-500">Cooldown ms<input className={inputClass + " mt-1"} type="number" min={0} max={10000} value={draft.cooldownMs} onChange={e => setBindingDrafts(all => ({ ...all, [event.key]: { ...draft, cooldownMs: Number(e.target.value) } }))} /></label>
                    <div className="flex gap-1 justify-end">
                      <button disabled={!draft.assetId || saveBinding.isPending} onClick={() => saveBinding.mutate(event.key)} className="rounded-lg bg-amber-400 text-black px-3 py-2 text-xs disabled:opacity-40">Guardar</button>
                      <button title="Usar fallback" onClick={() => resetBinding.mutate(event.key)} className="rounded-lg bg-white/5 p-2"><RotateCcw className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              )
            })}
            {(saveBinding.isError || resetBinding.isError) && <p className="text-xs text-red-300">{((saveBinding.error || resetBinding.error) as Error).message}</p>}
          </section>
        )}

        {tab === "library" && (
          <>
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div><h2 className="text-sm font-semibold">{editingId ? "Editar activo" : "Nuevo activo"}</h2><p className="mt-1 text-[10px] text-zinc-600">Música, ambientes y efectos comparten procedencia; cada dominio conserva su propio reproductor.</p></div>
                {editingId && <button onClick={() => { setEditingId(null); setForm({ ...EMPTY }) }} className="text-xs text-zinc-500">Cancelar</button>}
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1"><p className="text-xs font-medium">Importar MP3 o WAV desde este dispositivo</p><p className="mt-1 text-[10px] text-zinc-600">Máximo 96 MB. El original se guarda por huella en App Storage; los duplicados no ocupan espacio dos veces.</p></div>
                <label className="cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-xs text-center">
                  {uploadAudio.isPending ? <Loader2 className="inline w-4 h-4 animate-spin mr-1" /> : <Upload className="inline w-4 h-4 mr-1" />} Seleccionar audio
                  <input className="sr-only" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={uploadAudio.isPending} onChange={event => {
                    const file = event.target.files?.[0]
                    if (file) { setUploadMessage(""); uploadAudio.mutate(file) }
                    event.target.value = ""
                  }} />
                </label>
              </div>
              {uploadMessage && <p className="rounded-lg bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">{uploadMessage}</p>}
              {uploadAudio.isError && <p className="rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-200">{(uploadAudio.error as Error).message}</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                <input className={inputClass} placeholder="Título" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                <input className={inputClass} placeholder="Artista / autor" value={form.artist} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))} />
                <select className={inputClass} value={form.kind} onChange={e => {
                  const kind = e.target.value as AudioAsset["kind"]
                  setForm(current => ({ ...current, kind, sourceType: kind === "system" ? "sfx" : current.sourceType === "sfx" ? "stream" : current.sourceType, recipe: kind === "system" ? DEFAULT_UI_SOUND_RECIPE : current.sourceType === "sfx" ? null : current.recipe }))
                }}>
                  <option value="music">Música</option><option value="ambience">Ambiente</option><option value="system">Interfaz / sistema</option>
                </select>
                <select className={inputClass} value={form.sourceType} onChange={e => {
                  const sourceType = e.target.value as AudioAsset["sourceType"]
                  const recipe = sourceType === "stream" ? null : sourceType === "sfx" ? DEFAULT_UI_SOUND_RECIPE : DEFAULT_PROCEDURAL_RECIPE
                  setForm(current => ({ ...current, sourceType, recipe }))
                }}>
                  <option value="stream">Archivo / streaming</option>
                  {form.kind === "system" ? <option value="sfx">Microsonido procedural</option> : <><option value="procedural">Música procedural · Tone.js</option><option value="soundfont">Instrumentos SF2/SF3</option></>}
                </select>
              </div>

              {form.kind !== "system" && (
                <fieldset className="rounded-xl border border-white/10 p-3">
                  <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Clasificación musical</legend>
                  <div className="grid sm:grid-cols-3 gap-3 items-center">
                    <input className={inputClass} placeholder="Emoción" value={form.emotion} onChange={e => setForm(f => ({ ...f, emotion: e.target.value }))} />
                    <input className={inputClass} type="number" min={20} max={300} placeholder="BPM" value={form.bpm ?? ""} onChange={e => setForm(f => ({ ...f, bpm: e.target.value ? Number(e.target.value) : null }))} />
                    <label className="text-xs text-zinc-500">Energía {Math.round(form.energy * 100)}%<input className="w-full mt-2" type="range" min={0} max={1} step={0.05} value={form.energy} onChange={e => setForm(f => ({ ...f, energy: Number(e.target.value) }))} /></label>
                    <input className={inputClass} placeholder="Tonalidad" value={form.musicalKey} onChange={e => setForm(f => ({ ...f, musicalKey: e.target.value }))} />
                    <input className={inputClass} placeholder="Textura" value={form.texture} onChange={e => setForm(f => ({ ...f, texture: e.target.value }))} />
                    <input className={inputClass} placeholder="Etiquetas, separadas por coma" value={form.tags.join(", ")} onChange={e => setForm(f => ({ ...f, tags: e.target.value.split(",").map(value => value.trim()).filter(Boolean).slice(0, 24) }))} />
                  </div>
                </fieldset>
              )}

              <input className={inputClass} placeholder={form.sourceType === "stream" ? "https://cdn.../audio.mp3" : "Pista HTTPS de respaldo (opcional)"} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />

              {["procedural", "soundfont"].includes(form.sourceType) && (
                <fieldset className="rounded-xl border border-white/10 p-3 space-y-3">
                  <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Receta musical</legend>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <select className={inputClass} value={procedural.preset} onChange={e => updateProcedural({ preset: e.target.value as ProceduralRecipe["preset"] })}>
                      <option value="quiet_observatory">Observatorio sereno</option><option value="warm_memory">Memoria cálida</option><option value="cold_suspense">Suspenso frío</option><option value="deep_focus">Concentración</option>
                    </select>
                    <select className={inputClass} value={procedural.scale} onChange={e => updateProcedural({ scale: e.target.value as ProceduralRecipe["scale"] })}>
                      <option value="minor">Menor</option><option value="major">Mayor</option><option value="dorian">Dórica</option><option value="pentatonic">Pentatónica</option>
                    </select>
                    <input className={inputClass} type="number" min={32} max={140} value={procedural.bpm} onChange={e => updateProcedural({ bpm: Number(e.target.value) })} />
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 text-xs text-zinc-500">
                    <label>Raíz MIDI<input className={inputClass + " mt-1"} type="number" min={36} max={72} value={procedural.rootMidi} onChange={e => updateProcedural({ rootMidi: Number(e.target.value) })} /></label>
                    <label>Densidad {Math.round(procedural.density * 100)}%<input className="w-full mt-3" type="range" min={0} max={1} step={0.05} value={procedural.density} onChange={e => updateProcedural({ density: Number(e.target.value) })} /></label>
                    <label>Movimiento {Math.round(procedural.movement * 100)}%<input className="w-full mt-3" type="range" min={0} max={1} step={0.05} value={procedural.movement} onChange={e => updateProcedural({ movement: Number(e.target.value) })} /></label>
                  </div>
                </fieldset>
              )}

              {form.sourceType === "sfx" && (
                <fieldset className="rounded-xl border border-white/10 p-3 space-y-3">
                  <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Diseñador de microsonido</legend>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <select className={inputClass} value={sfx.voices[0].wave} onChange={e => updateSfxVoice({ wave: e.target.value as UiSoundRecipe["voices"][number]["wave"] })}><option value="sine">Seno suave</option><option value="triangle">Triangular</option><option value="square">Cuadrada</option><option value="sawtooth">Sierra</option><option value="noise">Ruido / papel</option></select>
                    <label className="text-[10px] text-zinc-500">Frecuencia inicial<input className={inputClass + " mt-1"} type="number" min={35} max={8000} value={sfx.voices[0].startHz} onChange={e => updateSfxVoice({ startHz: Number(e.target.value) })} /></label>
                    <label className="text-[10px] text-zinc-500">Frecuencia final<input className={inputClass + " mt-1"} type="number" min={35} max={8000} value={sfx.voices[0].endHz ?? ""} onChange={e => updateSfxVoice({ endHz: e.target.value ? Number(e.target.value) : null })} /></label>
                    <label className="text-[10px] text-zinc-500">Duración s<input className={inputClass + " mt-1"} type="number" min={0.02} max={4} step={0.01} value={sfx.voices[0].duration} onChange={e => updateSfxVoice({ duration: Number(e.target.value) })} /></label>
                    <label className="text-[10px] text-zinc-500">Ganancia {Math.round(sfx.voices[0].gain * 100)}%<input className="w-full mt-3" type="range" min={0.001} max={0.35} step={0.005} value={sfx.voices[0].gain} onChange={e => updateSfxVoice({ gain: Number(e.target.value) })} /></label>
                    <button type="button" onClick={() => sound.preview({ id: -22, title: form.title || "SFX", sourceType: "sfx", url: "", recipe: sfx })} className="self-end rounded-lg bg-white/10 px-3 py-2 text-sm"><Headphones className="inline w-4 h-4 mr-1" /> Probar</button>
                  </div>
                </fieldset>
              )}

              {form.sourceType === "soundfont" && (
                <fieldset className="rounded-xl border border-white/10 p-3 space-y-3">
                  <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Banco instrumental</legend>
                  <input className={inputClass} placeholder="https://cdn.../banco.sf3" value={form.packUrl} onChange={e => setForm(f => ({ ...f, packUrl: e.target.value }))} />
                  <div className="grid sm:grid-cols-3 gap-3"><input className={inputClass} type="number" min={0} max={127} placeholder="Programa MIDI" value={form.instrumentProgram ?? ""} onChange={e => setForm(f => ({ ...f, instrumentProgram: e.target.value === "" ? null : Number(e.target.value) }))} /><input className={inputClass} type="number" min={1} placeholder="Tamaño en bytes" value={form.packBytes ?? ""} onChange={e => setForm(f => ({ ...f, packBytes: e.target.value === "" ? null : Number(e.target.value) }))} /><input className={inputClass} placeholder="SHA-256" value={form.packSha256} onChange={e => setForm(f => ({ ...f, packSha256: e.target.value }))} /></div>
                </fieldset>
              )}

              <div className="grid sm:grid-cols-2 gap-3"><input className={inputClass} placeholder="Licencia / autorización" value={form.license} onChange={e => setForm(f => ({ ...f, license: e.target.value }))} /><input className={inputClass} placeholder="Nombre de procedencia" value={form.sourceName} onChange={e => setForm(f => ({ ...f, sourceName: e.target.value }))} /></div>
              <input className={inputClass} placeholder="URL de procedencia (HTTPS, opcional)" value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} />
              <div className="flex flex-wrap gap-3 items-center">
                <select className={inputClass + " !w-auto"} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as AudioAsset["status"] }))}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option></select>
                {form.kind !== "system" && <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={form.loop} onChange={e => setForm(f => ({ ...f, loop: e.target.checked }))} /> Loop</label>}
                <button disabled={save.isPending || !form.title.trim()} onClick={() => save.mutate()} className="ml-auto rounded-lg bg-amber-400 text-black px-4 py-2 text-sm font-semibold disabled:opacity-40">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="inline w-4 h-4 mr-1" /> Guardar</>}</button>
              </div>
              {save.isError && <p className="text-xs text-red-300">{(save.error as Error).message}</p>}
            </section>

            {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (Object.entries(grouped) as [string, AudioAsset[]][]).map(([area, list]) => (
              <section key={area} className="space-y-2">
                <h2 className="text-xs uppercase tracking-widest text-zinc-500">{area} · {list.length}</h2>
                {list.length === 0 && <p className="text-xs text-zinc-600">Todavía no hay activos en esta sección.</p>}
                {list.map(asset => (
                  <div key={asset.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex gap-3 items-center">
                    <button aria-label={`Escuchar ${asset.title}`} onClick={() => togglePreview(asset)} className="p-2 rounded-full bg-white/5"><Headphones className="w-4 h-4" /></button>
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{asset.title}</p><p className="text-[10px] text-zinc-500 truncate">{asset.status} · {asset.sourceType || "stream"} · {asset.kind} · {asset.bpm ? `${asset.bpm} BPM · ` : ""}{asset.license}</p></div>
                    <button aria-label="Editar" onClick={() => edit(asset)} className="p-2"><Pencil className="w-4 h-4" /></button>
                    {asset.status !== "archived" && <button aria-label="Archivar" onClick={() => archive.mutate(asset.id)} className="p-2 text-red-300"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
