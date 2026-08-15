import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Headphones, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/useAuth"
import { useMusic } from "@/audio/MusicProvider"
import { DEFAULT_PROCEDURAL_RECIPE, type ProceduralRecipe } from "@shared/audio"
import { musicCueFor, type CatalogAudioAsset as AudioAsset } from "@/audio/catalog"

type AudioAssetForm = Omit<AudioAsset, "id" | "favorite">

const EMPTY: AudioAssetForm = {
  title: "", artist: "", kind: "music", sourceType: "stream", url: "", recipe: null,
  musicalKey: "", musicalMode: "", brightness: 0.5, texture: "", tags: [],
  packUrl: "", packBytes: null, packSha256: "", instrumentProgram: null,
  emotion: "neutral", bpm: null, energy: 0.5, durationSeconds: null,
  loop: true, license: "", sourceName: "", sourceUrl: "", status: "draft",
}

export default function AudioCatalogAdmin() {
  const { isAdmin, isLoading: authLoading } = useAuth()
  const music = useMusic()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AudioAssetForm>({ ...EMPTY })
  const [preview, setPreview] = useState<number | null>(null)

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audio/assets"] })
      queryClient.invalidateQueries({ queryKey: ["/api/audio/assets"] })
      setEditingId(null)
      setForm({ ...EMPTY })
    },
  })

  const archive = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/audio/assets/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error("No se pudo retirar")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audio/assets"] })
      queryClient.invalidateQueries({ queryKey: ["/api/audio/assets"] })
    },
  })

  const grouped = useMemo(() => ({
    "Catálogo narrativo": assets.filter(asset => asset.kind !== "system"),
    "Sonidos del sistema": assets.filter(asset => asset.kind === "system"),
  }), [assets])

  function edit(asset: AudioAsset) {
    const { id: _id, favorite: _favorite, ...editable } = asset
    setEditingId(asset.id)
    setForm({
      ...EMPTY,
      ...editable,
      sourceType: asset.sourceType || "stream",
      tags: asset.tags || [],
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function updateRecipe(patch: Partial<ProceduralRecipe>) {
    setForm(current => ({ ...current, recipe: { ...(current.recipe || DEFAULT_PROCEDURAL_RECIPE), ...patch } }))
  }

  function togglePreview(asset: AudioAsset) {
    if (preview === asset.id) {
      music.stop()
      return setPreview(null)
    }
    music.playCue(musicCueFor(asset, { volume: 0.3, crossfadeSeconds: 0.4 }))
    setPreview(asset.id)
  }

  if (authLoading) return <div className="min-h-screen bg-zinc-950" />
  if (!isAdmin) return (
    <div className="min-h-screen bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center gap-4">
      <p>Esta sección es sólo para administradores.</p>
      <button onClick={() => setLocation("/")} className="text-amber-400">Volver</button>
    </div>
  )

  const inputClass = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none"
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-12">
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-zinc-950/95 border-b border-white/10">
        <button onClick={() => setLocation("/library")}><ArrowLeft className="w-4 h-4" /></button>
        <Headphones className="w-4 h-4 text-amber-400" />
        <h1 className="font-semibold">Fonoteca oficial</h1>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-8">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div><h2 className="text-sm font-semibold">{editingId ? "Editar activo" : "Nuevo activo"}</h2><p className="mt-1 text-[10px] text-zinc-600">La receta y sus tonos se clasifican; el audio pesado queda fuera del repositorio.</p></div>
            {editingId && <button onClick={() => { setEditingId(null); setForm({ ...EMPTY }) }} className="text-xs text-zinc-500">Cancelar</button>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <input className={inputClass} placeholder="Título" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <input className={inputClass} placeholder="Artista / autor" value={form.artist} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))} />
            <select className={inputClass} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as AudioAsset["kind"] }))}>
              <option value="music">Música</option><option value="ambience">Ambiente</option><option value="system">Sonido del sistema</option>
            </select>
            <select className={inputClass} value={form.sourceType} onChange={e => {
              const sourceType = e.target.value as AudioAsset["sourceType"]
              setForm(current => ({ ...current, sourceType, recipe: sourceType === "stream" ? null : current.recipe || DEFAULT_PROCEDURAL_RECIPE }))
            }}>
              <option value="stream">Pista / streaming</option>
              <option value="procedural">Síntesis procedural · Tone.js</option>
              <option value="soundfont">Instrumentos SF2/SF3 · SpessaSynth</option>
            </select>
          </div>

          <fieldset className="rounded-xl border border-white/10 p-3">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Clasificación musical</legend>
            <div className="grid sm:grid-cols-3 gap-3 items-center">
              <input className={inputClass} placeholder="Emoción" value={form.emotion} onChange={e => setForm(f => ({ ...f, emotion: e.target.value }))} />
              <input className={inputClass} type="number" min={20} max={300} placeholder="BPM" value={form.bpm ?? ""} onChange={e => setForm(f => ({ ...f, bpm: e.target.value ? Number(e.target.value) : null }))} />
              <label className="text-xs text-zinc-500">Energía {Math.round(form.energy * 100)}%<input className="w-full mt-2" type="range" min={0} max={1} step={0.05} value={form.energy} onChange={e => setForm(f => ({ ...f, energy: Number(e.target.value) }))} /></label>
              <input className={inputClass} placeholder="Tonalidad (p. ej. C minor)" value={form.musicalKey} onChange={e => setForm(f => ({ ...f, musicalKey: e.target.value }))} />
              <input className={inputClass} placeholder="Textura (pad, cuerdas…)" value={form.texture} onChange={e => setForm(f => ({ ...f, texture: e.target.value }))} />
              <input className={inputClass} placeholder="Etiquetas, separadas por coma" value={form.tags.join(", ")} onChange={e => setForm(f => ({ ...f, tags: e.target.value.split(",").map(value => value.trim()).filter(Boolean).slice(0, 24) }))} />
            </div>
          </fieldset>

          {form.sourceType === "stream" && <input className={inputClass} placeholder="https://cdn.../pista.mp3" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />}
          {form.sourceType !== "stream" && <input className={inputClass} placeholder="Pista HTTPS de respaldo para dispositivos sin Web Audio (opcional)" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />}

          {form.sourceType !== "stream" && form.recipe && (
            <fieldset className="rounded-xl border border-white/10 p-3 space-y-3">
              <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Receta de síntesis</legend>
              <div className="grid sm:grid-cols-3 gap-3">
                <select className={inputClass} value={form.recipe.preset} onChange={e => updateRecipe({ preset: e.target.value as ProceduralRecipe["preset"] })}>
                  <option value="quiet_observatory">Observatorio sereno</option><option value="warm_memory">Memoria cálida</option><option value="cold_suspense">Suspenso frío</option><option value="deep_focus">Concentración</option>
                </select>
                <select className={inputClass} value={form.recipe.scale} onChange={e => updateRecipe({ scale: e.target.value as ProceduralRecipe["scale"] })}>
                  <option value="minor">Menor</option><option value="major">Mayor</option><option value="dorian">Dórica</option><option value="pentatonic">Pentatónica</option>
                </select>
                <input className={inputClass} type="number" min={32} max={140} value={form.recipe.bpm} onChange={e => updateRecipe({ bpm: Number(e.target.value) })} />
              </div>
              <div className="grid sm:grid-cols-3 gap-3 text-xs text-zinc-500">
                <label>Raíz MIDI<input className={inputClass + " mt-1"} type="number" min={36} max={72} value={form.recipe.rootMidi} onChange={e => updateRecipe({ rootMidi: Number(e.target.value) })} /></label>
                <label>Densidad {Math.round(form.recipe.density * 100)}%<input className="w-full mt-3" type="range" min={0} max={1} step={0.05} value={form.recipe.density} onChange={e => updateRecipe({ density: Number(e.target.value) })} /></label>
                <label>Movimiento {Math.round(form.recipe.movement * 100)}%<input className="w-full mt-3" type="range" min={0} max={1} step={0.05} value={form.recipe.movement} onChange={e => updateRecipe({ movement: Number(e.target.value) })} /></label>
              </div>
            </fieldset>
          )}

          {form.sourceType === "soundfont" && (
            <fieldset className="rounded-xl border border-white/10 p-3 space-y-3">
              <legend className="px-2 text-[10px] uppercase tracking-widest text-zinc-500">Módulo instrumental descargable</legend>
              <input className={inputClass} placeholder="https://cdn.../banco.sf3" value={form.packUrl} onChange={e => setForm(f => ({ ...f, packUrl: e.target.value }))} />
              <div className="grid sm:grid-cols-3 gap-3">
                <input className={inputClass} type="number" min={0} max={127} placeholder="Programa MIDI" value={form.instrumentProgram ?? ""} onChange={e => setForm(f => ({ ...f, instrumentProgram: e.target.value === "" ? null : Number(e.target.value) }))} />
                <input className={inputClass} type="number" min={1} placeholder="Tamaño en bytes" value={form.packBytes ?? ""} onChange={e => setForm(f => ({ ...f, packBytes: e.target.value === "" ? null : Number(e.target.value) }))} />
                <input className={inputClass} placeholder="SHA-256 (opcional)" value={form.packSha256} onChange={e => setForm(f => ({ ...f, packSha256: e.target.value }))} />
              </div>
            </fieldset>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <input className={inputClass} placeholder="Licencia / autorización" value={form.license} onChange={e => setForm(f => ({ ...f, license: e.target.value }))} />
            <input className={inputClass} placeholder="Nombre de procedencia" value={form.sourceName} onChange={e => setForm(f => ({ ...f, sourceName: e.target.value }))} />
          </div>
          <input className={inputClass} placeholder="URL de procedencia (HTTPS, opcional)" value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} />
          <div className="flex flex-wrap gap-3 items-center">
            <select className={inputClass + " !w-auto"} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as AudioAsset["status"] }))}>
              <option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option>
            </select>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={form.loop} onChange={e => setForm(f => ({ ...f, loop: e.target.checked }))} /> Loop</label>
            <button disabled={save.isPending} onClick={() => save.mutate()} className="ml-auto rounded-lg bg-amber-400 text-black px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="inline w-4 h-4 mr-1" /> Guardar</>}
            </button>
          </div>
          {save.isError && <p className="text-xs text-red-300">{(save.error as Error).message}</p>}
        </section>

        {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (Object.entries(grouped) as [string, AudioAsset[]][]).map(([area, list]) => (
          <section key={area} className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">{area}</h2>
            {list.length === 0 && <p className="text-xs text-zinc-600">Todavía no hay activos en esta sección.</p>}
            {list.map(asset => (
              <div key={asset.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex gap-3 items-center">
                <button onClick={() => togglePreview(asset)} className="p-2 rounded-full bg-white/5"><Headphones className="w-4 h-4" /></button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{asset.title}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{asset.status} · {asset.sourceType || "stream"} · {asset.kind} · {asset.emotion} · {asset.bpm ? `${asset.bpm} BPM · ` : ""}{asset.license}</p>
                </div>
                <button onClick={() => edit(asset)} className="p-2"><Pencil className="w-4 h-4" /></button>
                {asset.status !== "archived" && <button onClick={() => archive.mutate(asset.id)} className="p-2 text-red-300"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </section>
        ))}
      </main>
    </div>
  )
}
