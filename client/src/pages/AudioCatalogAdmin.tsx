import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft, CheckCircle2, Download, Headphones, LibraryBig, Loader2, Music2,
  Package, Pencil, Play, Plus, RotateCcw, SlidersHorizontal, Square, Trash2, Upload,
} from "lucide-react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/useAuth"
import { useMusic } from "@/audio/MusicProvider"
import { useSoundFX } from "@/hooks/useSoundFX"
import {
  DEFAULT_PROCEDURAL_RECIPE, DEFAULT_TLOQUE_SCORE, DEFAULT_UI_SOUND_RECIPE,
  anyLinearScoreRecipeSchema, proceduralRecipeSchema, uiSoundRecipeSchema,
  type LinearScoreRecipe, type ProceduralRecipe, type TloqueScoreCompileResult,
  type UiSoundEventKey, type UiSoundRecipe,
} from "@shared/audio"
import { musicCueFor, type CatalogAudioAsset as AudioAsset } from "@/audio/catalog"
import { cacheAudioResource, isAudioResourceCached, removeCachedAudioResource } from "@/audio/AudioResourceCache"
import { downloadWav, estimateScoreExport, renderTloqueScoreToWav } from "@/audio/ScoreExporter"

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
  const [scoreSource, setScoreSource] = useState(DEFAULT_TLOQUE_SCORE)
  const [scoreMeta, setScoreMeta] = useState({ ...SCORE_META })
  const [compiled, setCompiled] = useState<LinearScoreRecipe | null>(null)
  const [exportProgress, setExportProgress] = useState(0)
  const [uploadMessage, setUploadMessage] = useState("")
  const [moduleCache, setModuleCache] = useState<Record<number, boolean>>({})
  const [bindingDrafts, setBindingDrafts] = useState<Record<string, BindingDraft>>({})

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
      const res = await fetch("/api/admin/audio/score/compile", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      })
      const body = await res.json() as TloqueScoreCompileResult & { message?: string }
      if (!res.ok || !body.ok) throw new Error(body.ok ? body.message || "No se pudo compilar" : body.diagnostics.map(item => `L${item.line}: ${item.message}`).join("\n"))
      return body.recipe
    },
    onSuccess: setCompiled,
  })

  const saveScore = useMutation({
    mutationFn: async () => {
      const compileResponse = await fetch("/api/admin/audio/score/compile", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: scoreSource }),
      })
      const compileBody = await compileResponse.json() as TloqueScoreCompileResult
      if (!compileResponse.ok || !compileBody.ok) {
        throw new Error(compileBody.ok ? "No se pudo compilar" : compileBody.diagnostics.map(item => `L${item.line}: ${item.message}`).join("\n"))
      }
      const recipe = compileBody.recipe
      const moduleAsset = resolveScoreModule(recipe)
      if (recipe.version === 2 && recipe.plan.moduleId !== "builtin" && !moduleAsset) {
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
      const blob = await renderTloqueScoreToWav(compiled, { onProgress: setExportProgress })
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
    if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return null
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
              <h2 className="text-sm font-semibold">Compositor de obras · TloqueScore V2</h2>
              <p className="mt-1 text-xs text-zinc-500">El código es la obra maestra: editarlo recompila y cambia el audio. La reproducción no crea archivos; Exportar genera un WAV sólo cuando lo pides.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <input className={inputClass} placeholder="Título del tema" value={scoreMeta.title} onChange={e => setScoreMeta(meta => ({ ...meta, title: e.target.value }))} />
              <input className={inputClass} placeholder="Compositor / DA" value={scoreMeta.artist} onChange={e => setScoreMeta(meta => ({ ...meta, artist: e.target.value }))} />
            </div>
            <textarea
              className={`${inputClass} min-h-[360px] font-mono text-[12px] leading-5 resize-y`}
              spellCheck={false}
              aria-label="Código TloqueScore"
              value={scoreSource}
              onChange={event => { setScoreSource(event.target.value); setCompiled(null) }}
            />
            <details className="rounded-xl border border-white/10 p-3 text-xs text-zinc-400">
              <summary className="cursor-pointer text-zinc-300">Referencia rápida del lenguaje</summary>
              <p className="mt-2 font-mono leading-5">quality core|studio|master · module builtin|id<br />track id synth=… instrument=… program=0..127 role=… gain=… pan=…<br />section id form=exposition|development|recapitulation|coda bars=N repeat=N fade=N tempo=32..180<br />use track · compás:tiempo C3,Eb3,G3 duración velocity=… articulation=… · rest posición duración · end</p>
            </details>
            {compiled && (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 flex gap-2 text-xs text-emerald-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Compilada: {compiled.plan.totalBars} compases · {compiled.plan.tracks.length} pistas · {compiled.plan.events.length} eventos · {compiled.plan.bpm} BPM · {compiled.plan.sourceHash}{compiled.version === 2 ? ` · ${compiled.plan.quality} · módulo ${compiled.plan.moduleId}` : ""}</span>
              </div>
            )}
            {compiled?.version === 2 && compiled.plan.moduleId !== "builtin" && !compiledModule && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">Falta el módulo <code>module:{compiled.plan.moduleId}</code>. Tloque puede previsualizar con síntesis base, pero exige el banco publicado para guardar esta versión.</p>
            )}
            {compile.isError && <pre className="whitespace-pre-wrap rounded-xl bg-red-950/30 p-3 text-xs text-red-200">{(compile.error as Error).message}</pre>}
            <div className="grid sm:grid-cols-3 gap-3">
              <input className={inputClass} placeholder="Licencia / autorización" value={scoreMeta.license} onChange={e => setScoreMeta(meta => ({ ...meta, license: e.target.value }))} />
              <input className={inputClass} placeholder="Procedencia" value={scoreMeta.sourceName} onChange={e => setScoreMeta(meta => ({ ...meta, sourceName: e.target.value }))} />
              <select className={inputClass} value={scoreMeta.status} onChange={e => setScoreMeta(meta => ({ ...meta, status: e.target.value as AudioAsset["status"] }))}>
                <option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={compile.isPending} onClick={() => compile.mutate(scoreSource)} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-50">
                {compile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Validar y compilar"}
              </button>
              <button disabled={!compiled} onClick={() => compiled && music.playCue({ id: -11, title: scoreMeta.title || "Vista previa", sourceType: "score", recipe: compiled, packUrl: compiledModule?.packUrl, packBytes: compiledModule?.packBytes, packSha256: compiledModule?.packSha256, loop: compiled.plan.loop, volume: 0.35, crossfadeSeconds: 0.25 })} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"><Play className="inline w-4 h-4 mr-1" /> Escuchar</button>
              <button onClick={() => music.stop()} className="rounded-lg bg-white/10 px-4 py-2 text-sm"><Square className="inline w-4 h-4 mr-1" /> Detener</button>
              <button disabled={!compiled || exportScore.isPending} onClick={() => exportScore.mutate()} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"><Download className="inline w-4 h-4 mr-1" /> {exportScore.isPending ? `Exportando ${Math.round(exportProgress * 100)}%` : "Exportar WAV"}</button>
              <button disabled={saveScore.isPending || !scoreMeta.title.trim()} onClick={() => saveScore.mutate()} className="sm:ml-auto rounded-lg bg-amber-400 text-black px-4 py-2 text-sm font-semibold disabled:opacity-40">
                {saveScore.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `${scoreEditingId ? "Actualizar" : "Guardar"} en Fonoteca`}
              </button>
            </div>
            {exportEstimate && <p className="text-[10px] text-zinc-500">Exportación {exportEstimate.bitDepth}-bit / {(exportEstimate.sampleRate / 1000).toFixed(0)} kHz · tamaño estimado {(exportEstimate.bytes / 1024 / 1024).toFixed(1)} MB. El render se procesa por bloques para obras largas.</p>}
            {(saveScore.isError || exportScore.isError) && <pre className="whitespace-pre-wrap text-xs text-red-300">{((saveScore.error || exportScore.error) as Error).message}</pre>}
          </section>
        )}

        {tab === "modules" && (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Módulos instrumentales bajo demanda</h2>
              <p className="mt-1 text-xs text-zinc-500">La síntesis base siempre está incluida. Los bancos SF2/SF3 de mayor fidelidad se descargan uno por uno y pueden retirarse sin borrar partituras.</p>
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium">Síntesis base Tloque</p><p className="text-[10px] text-zinc-500">Incluida · sin descarga · <code>module builtin</code></p></div>
              <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            </div>
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
                  <button disabled={manageModule.isPending || !moduleTag.startsWith("module:")} onClick={() => manageModule.mutate({ asset, install: !installed })} className={`rounded-lg px-3 py-2 text-xs disabled:opacity-40 ${installed ? "bg-white/10" : "bg-amber-400 text-black font-semibold"}`}>
                    {installed ? <><Trash2 className="inline w-3.5 h-3.5 mr-1" /> Retirar del dispositivo</> : <><Download className="inline w-3.5 h-3.5 mr-1" /> Descargar módulo</>}
                  </button>
                </div>
              )
            })}
            {!qualityModules.length && <p className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-zinc-500">Aún no hay bancos instrumentales. Créalo en Fonoteca como “Instrumentos SF2/SF3” y añade una etiqueta única como <code>module:orchestra-core</code>.</p>}
            {manageModule.isError && <p className="text-xs text-red-300">{(manageModule.error as Error).message}</p>}
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
