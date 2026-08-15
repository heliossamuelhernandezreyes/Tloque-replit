import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Download, ExternalLink, Headphones, Loader2, Music2, Volume2, VolumeX } from "lucide-react"
import { useMusic } from "@/audio/MusicProvider"
import { cacheAudioResource, isAudioResourceCached } from "@/audio/AudioResourceCache"
import { musicCueFor, type ChapterAudioAssignment } from "@/audio/catalog"
import { useSettings } from "@/context/SettingsContext"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"

type Preference = "tloque" | "spotify" | "off"

const copy = {
  es: { title: "Audio de lectura", description: "Tú eliges. Nada se reproduce automáticamente.", tloque: "Original Tloque", original: "Fonoteca y síntesis de la obra", spotify: "Recomendación del autor", external: "Se abre fuera de Tloque", off: "Sin música", silence: "Lectura en silencio", volume: "Volumen", download: "Guardar módulo", saved: "Disponible sin conexión", procedural: "No necesita descarga" },
  en: { title: "Reading audio", description: "You choose. Nothing plays automatically.", tloque: "Tloque Original", original: "The work's library and synthesis", spotify: "Author recommendation", external: "Opens outside Tloque", off: "No music", silence: "Silent reading", volume: "Volume", download: "Save module", saved: "Available offline", procedural: "No download needed" },
  pt: { title: "Áudio de leitura", description: "Você escolhe. Nada toca automaticamente.", tloque: "Original Tloque", original: "Fonoteca e síntese da obra", spotify: "Recomendação do autor", external: "Abre fora do Tloque", off: "Sem música", silence: "Leitura silenciosa", volume: "Volume", download: "Salvar módulo", saved: "Disponível offline", procedural: "Não requer download" },
  fr: { title: "Audio de lecture", description: "Vous choisissez. Rien ne démarre automatiquement.", tloque: "Original Tloque", original: "Phonothèque et synthèse de l’œuvre", spotify: "Recommandation de l’auteur", external: "S’ouvre hors de Tloque", off: "Sans musique", silence: "Lecture silencieuse", volume: "Volume", download: "Enregistrer le module", saved: "Disponible hors ligne", procedural: "Aucun téléchargement" },
  de: { title: "Leseaudio", description: "Du entscheidest. Nichts startet automatisch.", tloque: "Tloque Original", original: "Fonothek und Synthese des Werks", spotify: "Empfehlung des Autors", external: "Öffnet außerhalb von Tloque", off: "Keine Musik", silence: "Stilles Lesen", volume: "Lautstärke", download: "Modul speichern", saved: "Offline verfügbar", procedural: "Kein Download nötig" },
  it: { title: "Audio di lettura", description: "Scegli tu. Nulla parte automaticamente.", tloque: "Originale Tloque", original: "Fonoteca e sintesi dell’opera", spotify: "Consiglio dell’autore", external: "Si apre fuori da Tloque", off: "Senza musica", silence: "Lettura silenziosa", volume: "Volume", download: "Salva modulo", saved: "Disponibile offline", procedural: "Nessun download" },
  ja: { title: "読書オーディオ", description: "選択するまで自動再生されません。", tloque: "Tloque オリジナル", original: "作品の音源と合成", spotify: "作者のおすすめ", external: "Tloque の外で開きます", off: "音楽なし", silence: "静かに読む", volume: "音量", download: "モジュールを保存", saved: "オフライン利用可", procedural: "ダウンロード不要" },
  zh: { title: "阅读音频", description: "由你选择，不会自动播放。", tloque: "Tloque 原声", original: "作品音库与合成", spotify: "作者推荐", external: "将在 Tloque 外打开", off: "无音乐", silence: "安静阅读", volume: "音量", download: "保存模块", saved: "可离线使用", procedural: "无需下载" },
  ar: { title: "صوت القراءة", description: "أنت تختار، ولا يبدأ شيء تلقائياً.", tloque: "Tloque الأصلي", original: "مكتبة العمل وتوليفه", spotify: "توصية المؤلف", external: "يفتح خارج Tloque", off: "بلا موسيقى", silence: "قراءة صامتة", volume: "مستوى الصوت", download: "حفظ الوحدة", saved: "متاح دون اتصال", procedural: "لا يحتاج إلى تنزيل" },
} as const

export default function ReaderAudioMenu({
  bookId,
  soundtrack,
  spotifyLink,
  accent,
  iconColor,
}: {
  bookId: string | number
  soundtrack: ChapterAudioAssignment | null
  spotifyLink?: string
  accent: string
  iconColor: string
}) {
  const { settings, updateSetting } = useSettings()
  const language = settings.language as keyof typeof copy
  const text = copy[language] ?? copy.es
  const music = useMusic()
  const preferenceKey = `tloque_audio_preference_${bookId}`
  const [preference, setPreference] = useState<Preference>(() => {
    const stored = localStorage.getItem(preferenceKey)
    return stored === "tloque" || stored === "spotify" || stored === "off" ? stored : "off"
  })
  const [open, setOpen] = useState(false)
  const [activated, setActivated] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [cached, setCached] = useState(false)
  const [downloadError, setDownloadError] = useState("")
  const lastCueKey = useRef("")
  const resource = soundtrack?.asset.sourceType === "soundfont" ? soundtrack.asset.packUrl : soundtrack?.asset.url || ""

  useEffect(() => {
    if (!activated || preference !== "tloque" || !soundtrack) return
    const cueKey = `${soundtrack.assetId}:${soundtrack.updatedAt || ""}`
    if (lastCueKey.current === cueKey) return
    lastCueKey.current = cueKey
    music.playCue(musicCueFor(soundtrack.asset, {
      volume: soundtrack.volume,
      loop: soundtrack.loop,
      crossfadeSeconds: soundtrack.crossfadeSeconds,
    }))
  }, [activated, preference, soundtrack?.assetId, soundtrack?.updatedAt])

  useEffect(() => {
    let active = true
    if (!resource || soundtrack?.asset.sourceType === "procedural") return setCached(false)
    void isAudioResourceCached(resource).then(value => active && setCached(value))
    return () => { active = false }
  }, [resource, soundtrack?.asset.sourceType])

  const selected = useMemo(() => preference === "tloque" && soundtrack
    ? `${soundtrack.asset.title}${soundtrack.asset.artist ? ` · ${soundtrack.asset.artist}` : ""}`
    : preference === "spotify" ? text.spotify : text.off, [preference, soundtrack, text.off, text.spotify])

  function remember(next: Preference) {
    setPreference(next)
    localStorage.setItem(preferenceKey, next)
  }

  function chooseTloque() {
    if (!soundtrack) return
    remember("tloque")
    setActivated(true)
    updateSetting("musicEnabled", true)
    lastCueKey.current = `${soundtrack.assetId}:${soundtrack.updatedAt || ""}`
    music.playCue(musicCueFor(soundtrack.asset, {
      volume: soundtrack.volume,
      loop: soundtrack.loop,
      crossfadeSeconds: soundtrack.crossfadeSeconds,
    }))
    setOpen(false)
  }

  function chooseSpotify() {
    if (!spotifyLink) return
    remember("spotify")
    music.stop()
    window.open(spotifyLink, "_blank", "noopener,noreferrer")
    setOpen(false)
  }

  function chooseOff() {
    remember("off")
    music.stop()
    setOpen(false)
  }

  async function download() {
    if (!resource || downloading) return
    setDownloading(true)
    setDownloadError("")
    try {
      await cacheAudioResource(resource, soundtrack?.asset.sourceType === "soundfont" ? soundtrack.asset.packSha256 : "")
      setCached(true)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "No se pudo guardar el audio")
    } finally {
      setDownloading(false)
    }
  }

  const active = music.state === "playing" || music.state === "crossfading" || music.state === "loading"
  const optionClass = "flex w-full items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3 text-left"
  return (
    <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
      <DrawerTrigger asChild>
        <button className="p-2 transition-colors" style={{ color: active ? accent : iconColor }} title={selected} aria-label={text.title}>
          <Headphones className="h-4 w-4" />
        </button>
      </DrawerTrigger>
      <DrawerContent className="border-white/10 bg-zinc-950 text-zinc-100">
        <div className="mx-auto w-full max-w-lg pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-base">{text.title}</DrawerTitle>
            <DrawerDescription className="text-xs text-zinc-500">{text.description}</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-2 px-4">
            {soundtrack && (
              <button onClick={chooseTloque} className={optionClass} style={preference === "tloque" ? { borderColor: `${accent}55`, background: `${accent}0d` } : undefined}>
                <Music2 className="h-4 w-4 shrink-0" style={{ color: accent }} />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{text.tloque}</span><span className="mt-0.5 block truncate text-[10px] text-zinc-500">{soundtrack.asset.title} · {text.original}</span></span>
                {preference === "tloque" && <Check className="h-4 w-4" style={{ color: accent }} />}
              </button>
            )}
            {downloadError && <p className="px-1 text-center text-[10px] text-red-300/70">{downloadError}</p>}
            {spotifyLink && (
              <button onClick={chooseSpotify} className={optionClass} style={preference === "spotify" ? { borderColor: `${accent}55`, background: `${accent}0d` } : undefined}>
                <ExternalLink className="h-4 w-4 shrink-0" style={{ color: accent }} />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{text.spotify}</span><span className="mt-0.5 block text-[10px] text-zinc-500">Spotify · {text.external}</span></span>
                {preference === "spotify" && <Check className="h-4 w-4" style={{ color: accent }} />}
              </button>
            )}
            <button onClick={chooseOff} className={optionClass} style={preference === "off" ? { borderColor: `${accent}55`, background: `${accent}0d` } : undefined}>
              <VolumeX className="h-4 w-4 shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{text.off}</span><span className="mt-0.5 block text-[10px] text-zinc-500">{text.silence}</span></span>
              {preference === "off" && <Check className="h-4 w-4" style={{ color: accent }} />}
            </button>

            <div className="mt-3 rounded-xl border border-white/[.07] bg-black/20 p-3">
              <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500"><Volume2 className="h-3.5 w-3.5" />{text.volume}<span className="ml-auto">{Math.round(settings.musicVolume * 100)}%</span></label>
              <input className="mt-3 w-full" type="range" min={0} max={1} step={0.05} value={settings.musicVolume} onChange={event => updateSetting("musicVolume", Number(event.target.value))} />
            </div>

            {soundtrack && (
              soundtrack.asset.sourceType === "procedural"
                ? <p className="px-1 py-2 text-center text-[10px] text-emerald-300/55">{text.procedural}</p>
                : resource && <button onClick={() => void download()} disabled={cached || downloading} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[.07] text-[11px] text-zinc-400 disabled:text-emerald-300/55">
                    {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : cached ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                    {cached ? text.saved : text.download}{!cached && soundtrack.asset.packBytes ? ` · ${(soundtrack.asset.packBytes / 1_048_576).toFixed(1)} MB` : ""}
                  </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
