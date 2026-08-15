import { useRef, useState } from "react"
import { Headphones, Loader2, Sparkles } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useSettings } from "@/context/SettingsContext"
import { apiRequest } from "@/lib/queryClient"
import { speechUi } from "@shared/speech-i18n"

interface Availability {
  authorReady: boolean
  cached: boolean
  generating?: boolean
  estimatedPaper: number | null
  paperBalance?: number | null
  subscriptionRequired?: boolean
  canRequest: boolean
  playbackUrl?: string | null
  playbackAccess?: boolean
  accessReason?: "subscription" | "author" | "admin" | "book" | "card" | null
}

export default function AudiobookChapterControl({ bookId, chapterIndex, accent }: { bookId: number; chapterIndex: number; accent: string }) {
  const { settings } = useSettings()
  const copy = speechUi(settings.language)
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState("")
  const requestStorageKey = `tloque:audiobook-request:${bookId}:${chapterIndex}`
  const requestKey = useRef<string>(
    sessionStorage.getItem(requestStorageKey) || crypto.randomUUID(),
  )
  const query = useQuery<Availability>({
    queryKey: ["/api/books", bookId, "audiobook", chapterIndex],
    queryFn: async () => {
      const response = await fetch(`/api/books/${bookId}/audiobook/${chapterIndex}`, { credentials: "include" })
      if (!response.ok) throw new Error(copy.error)
      return response.json()
    },
    refetchInterval: data => data.state.data?.generating ? 5_000 : false,
  })
  const availability = query.data
  if (!availability?.authorReady) return null

  async function requestAudiobook() {
    setRequesting(true)
    setNotice("")
    try {
      sessionStorage.setItem(requestStorageKey, requestKey.current)
      await apiRequest("POST", `/api/books/${bookId}/audiobook/${chapterIndex}/request`, { requestKey: requestKey.current })
      sessionStorage.removeItem(requestStorageKey)
      requestKey.current = crypto.randomUUID()
      await query.refetch()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy.error)
    } finally {
      setRequesting(false)
    }
  }

  const enoughPaper = (availability.paperBalance ?? 0) >= (availability.estimatedPaper ?? 0)
  return (
    <section className="mb-6 rounded-2xl p-3" style={{ background: `${accent}0d`, border: `1px solid ${accent}25` }}>
      <div className="flex items-center gap-2">
        <Headphones className="w-4 h-4 shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-sans font-semibold" style={{ color: accent }}>{copy.listen}</p>
          <p className="text-[9px] text-zinc-500 font-sans">
            {availability.cached ? (availability.playbackUrl ? copy.cached : copy.audioSubscription)
              : availability.generating ? copy.generating
                : availability.subscriptionRequired ? copy.audioSubscription
                  : `${copy.estimated}: ${availability.estimatedPaper} ${copy.paper}`}
          </p>
        </div>
      </div>
      {availability.playbackUrl && (
        <audio controls preload="none" className="mt-3 w-full h-9" src={availability.playbackUrl} />
      )}
      {!availability.cached && !availability.generating && !availability.subscriptionRequired && (
        <button type="button" onClick={requestAudiobook} disabled={requesting || !availability.canRequest || !enoughPaper} className="mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-sans font-semibold disabled:opacity-40" style={{ color: accent, background: `${accent}16`, border: `1px solid ${accent}32` }}>
          {requesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {!enoughPaper ? copy.insufficient : availability.canRequest ? `${copy.request} · ${availability.estimatedPaper} ${copy.paper}` : copy.generationOff}
        </button>
      )}
      {notice && <p role="status" className="mt-2 text-[9px] text-red-300/70 font-sans">{notice}</p>}
    </section>
  )
}
