import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Heart, Loader2, Music2, Play, Square } from "lucide-react"
import { LANGUAGE_META, useSettings } from "@/context/SettingsContext"

interface Asset {
  id: number
  title: string
  artist: string
  kind: "music" | "ambience" | "system"
  url: string
  emotion: string
  bpm: number | null
  energy: number
  loop: boolean
  favorite: boolean
}

interface Assignment {
  chapterIndex: number
  assetId: number
  volume: number
  loop: boolean
  crossfadeSeconds: number
  asset: Asset
}

export default function ChapterSoundtrackPicker({ bookId, chapterIndex, accent }: {
  bookId: number
  chapterIndex: number
  accent: string
}) {
  const queryClient = useQueryClient()
  const { t, settings } = useSettings()
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const { data: catalog } = useQuery<{ assets: Asset[] }>({
    queryKey: ["/api/audio/assets"],
    queryFn: async () => {
      const res = await fetch("/api/audio/assets", { credentials: "include" })
      if (!res.ok) throw new Error("No se pudo cargar la Fonoteca")
      return res.json()
    },
  })
  const { data: bookAudio } = useQuery<{ assignments: Assignment[] }>({
    queryKey: ["/api/books/audio", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/books/${bookId}/audio`, { credentials: "include" })
      if (!res.ok) throw new Error("No se pudo cargar la asignación")
      return res.json()
    },
  })
  const assets = useMemo(() => (catalog?.assets || [])
    .filter(asset => asset.kind !== "system")
    .sort((a, b) => Number(b.favorite) - Number(a.favorite)
      || a.title.localeCompare(b.title, LANGUAGE_META[settings.language].locale)), [catalog, settings.language])
  const current = bookAudio?.assignments.find(item => item.chapterIndex === chapterIndex)
  const currentAsset = assets.find(asset => asset.id === current?.assetId) || current?.asset

  useEffect(() => () => {
    previewRef.current?.pause()
    previewRef.current?.removeAttribute("src")
    previewRef.current = null
  }, [])

  const assign = useMutation({
    mutationFn: async (asset: Asset | null) => {
      const url = `/api/books/${bookId}/audio/${chapterIndex}`
      const res = await fetch(url, asset ? {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, volume: current?.volume ?? 0.35, loop: asset.loop, crossfadeSeconds: 6 }),
      } : { method: "DELETE", credentials: "include" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || "No se pudo asignar")
      return body
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/books/audio", bookId] }),
  })

  const favorite = useMutation({
    mutationFn: async (asset: Asset) => {
      const res = await fetch(`/api/audio/assets/${asset.id}/favorite`, {
        method: asset.favorite ? "DELETE" : "PUT", credentials: "include",
      })
      if (!res.ok) throw new Error("No se pudo actualizar el favorito")
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/audio/assets"] }),
  })

  function togglePreview(asset: Asset) {
    previewRef.current?.pause()
    previewRef.current?.removeAttribute("src")
    if (previewUrl === asset.url) {
      previewRef.current = null
      return setPreviewUrl(null)
    }
    const audio = new Audio(asset.url)
    audio.volume = 0.3
    audio.onended = () => { previewRef.current = null; setPreviewUrl(null) }
    void audio.play().then(() => {
      previewRef.current = audio
      setPreviewUrl(asset.url)
    }).catch(() => setPreviewUrl(null))
  }

  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${accent}25` }}>
      <div className="flex items-center gap-2 mb-2">
        <Music2 className="w-3.5 h-3.5" style={{ color: accent }} />
        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-sans">{t("soundtrackChapter")}</span>
        {assign.isPending && <Loader2 className="ml-auto w-3 h-3 animate-spin" />}
      </div>
      <select
        value={current?.assetId ?? ""}
        onChange={event => assign.mutate(assets.find(asset => asset.id === Number(event.target.value)) || null)}
        className="w-full rounded-lg bg-zinc-900 border border-white/10 px-2.5 py-2 text-xs text-white outline-none"
      >
        <option value="">{t("noMusic")}</option>
        {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.favorite ? "♥ " : ""}{asset.title}{asset.artist ? ` · ${asset.artist}` : ""}</option>)}
      </select>
      {current && currentAsset && (
        <div className="flex items-center gap-2 mt-2 text-[10px] font-sans text-zinc-500">
          <button onClick={() => togglePreview(currentAsset)} className="p-1 rounded-md bg-white/5" title={t("previewAction")} aria-label={t("previewAction")}>
            {previewUrl === currentAsset.url ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
          <span>{currentAsset.emotion}{currentAsset.bpm ? ` · ${currentAsset.bpm} BPM` : ""} · {t("crossfadeSeconds").replace("{n}", "6")}</span>
          <button onClick={() => favorite.mutate(currentAsset)} className="ml-auto p-1" title={t("favoriteAction")} aria-label={t("favoriteAction")}>
            <Heart className="w-3 h-3" fill={currentAsset.favorite ? accent : "none"} style={{ color: accent }} />
          </button>
        </div>
      )}
      {assign.isError && <p className="text-[10px] text-red-300 mt-2">{(assign.error as Error).message}</p>}
    </div>
  )
}
