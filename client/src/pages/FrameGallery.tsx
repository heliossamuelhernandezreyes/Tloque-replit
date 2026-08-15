import { useState } from "react"
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query"
import { useLocation } from "wouter"
import { ArrowLeft, Droplets, Frame, Check, Loader2, Lock } from "lucide-react"
import FrameRenderer from "@/components/FrameRenderer"
import WalletPanel from "@/components/WalletPanel"
import { useFrames, type GalleryFrame } from "@/hooks/useFrames"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"

const ACCENT = "#c9a84c"

// Arte de muestra dentro de cada marco: sobrio, para que el marco luzca.
function SampleArt() {
  return (
    <div className="absolute inset-0"
      style={{ background: "radial-gradient(circle at 50% 32%, #2c3744, #12161c 78%)" }}>
      <div className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{ top: "24%", width: "26%", aspectRatio: "1", background: "rgba(0,0,0,0.35)" }} />
      <div className="absolute left-1/2 -translate-x-1/2"
        style={{ bottom: "10%", width: "58%", height: "40%", borderRadius: "50% 50% 0 0", background: "rgba(0,0,0,0.35)" }} />
    </div>
  )
}

// La galería de marcos: los autores los ven dibujados y los desbloquean con Tinta.
export default function FrameGallery() {
  const [, setLocation] = useLocation()
  const { t } = useSettings()
  const { isLoggedIn } = useAuth()
  const queryClient = useQueryClient()
  const { frames, isLoading } = useFrames()
  const [showWallet, setShowWallet] = useState(false)
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string; missing?: number } | null>(null)

  const { data: wallet } = useQuery<{ tinta: number; papel: number }>({
    queryKey: ["/api/wallet"],
    queryFn: async () => {
      const res = await fetch("/api/wallet", { credentials: "include" })
      if (!res.ok) return { tinta: 0, papel: 0 }
      return res.json()
    },
    enabled: !!isLoggedIn,
  })
  const tinta = wallet?.tinta ?? 0

  const buy = useMutation({
    mutationFn: async (frame: GalleryFrame) => {
      const res = await fetch(`/api/frames/${frame.id}/buy`, {
        method: "POST", credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 402) {
          const err: any = new Error("tinta_insuficiente")
          err.missing = data.missing ?? Math.max(0, frame.priceTinta - tinta)
          throw err
        }
        throw new Error(data.message || t("frameBuyError"))
      }
      return data
    },
    onSuccess: (_d, frame) => {
      queryClient.invalidateQueries({ queryKey: ["/api/frames"] })
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] })
      setNotice({ kind: "ok", text: t("frameUnlocked").replace("{name}", frame.name) })
      setTimeout(() => setNotice(null), 4000)
    },
    onError: (e: any) => {
      if (e.message === "tinta_insuficiente") {
        setNotice({ kind: "err", missing: e.missing,
          text: t("notEnoughTinta").replace("{n}", String(e.missing)) })
      } else {
        setNotice({ kind: "err", text: e.message || t("frameBuyError") })
        setTimeout(() => setNotice(null), 4000)
      }
    },
  })

  const targetLabel = (tg: string) =>
    tg === "card" ? t("targetCards") : tg === "profile" ? t("targetProfile") : t("targetBoth")

  return (
    <div className="min-h-screen bg-zinc-950 pb-10">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/90"
        style={{ backdropFilter: "blur(8px)" }}>
        <button onClick={() => setLocation("/library")}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Volver">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-semibold text-zinc-200 tracking-wide"
          style={{ fontVariant: "small-caps" }}>
          {t("frameGallery")}
        </h1>
        {isLoggedIn && (
          <button onClick={() => setShowWallet(true)}
            className="ml-auto flex items-center gap-1 text-[11px] font-sans font-semibold px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)", color: ACCENT }}>
            <Droplets className="w-3 h-3" />
            {tinta}
          </button>
        )}
      </div>

      {notice && (
        <div className="px-4 py-2.5 flex items-center gap-2 text-[12px] font-sans"
          style={{
            background: notice.kind === "ok" ? "rgba(107,208,138,0.12)" : "rgba(224,122,122,0.12)",
            color: notice.kind === "ok" ? "#6bd08a" : "#e07a7a",
            borderBottom: "1px solid " + (notice.kind === "ok" ? "rgba(107,208,138,0.25)" : "rgba(224,122,122,0.25)"),
          }}>
          <span className="flex-1">{notice.text}</span>
          {notice.missing != null && (
            <button onClick={() => { setShowWallet(true); setNotice(null) }}
              className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold"
              style={{ background: ACCENT, color: "#1a1508" }}>
              {t("getTinta")}
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
        </div>
      ) : frames.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 px-8 text-center">
          <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800">
            <Frame className="w-5 h-5 text-zinc-600" />
          </div>
          <p className="text-[13px] text-zinc-500 font-sans max-w-[240px]">{t("frameGalleryEmpty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 px-4 pt-5 max-w-lg mx-auto">
          {frames.map(f => {
            const isBuying = buy.isPending && buy.variables?.id === f.id
            const canAfford = tinta >= f.priceTinta
            return (
              <div key={f.id} className="flex flex-col">
                <div className="relative">
                  <FrameRenderer preset={f.pkg}
                    shape={f.target === "profile" ? "profile" : "card"}>
                    <SampleArt />
                  </FrameRenderer>
                  {!f.owned && (
                    <div className="absolute inset-0 pointer-events-none"
                      style={{ background: "rgba(6,6,10,0.45)", borderRadius: f.target === "profile" ? "50%" : "8%" }} />
                  )}
                </div>

                <div className="mt-2.5 px-0.5">
                  <p className="text-[12.5px] font-display font-semibold text-zinc-200 truncate">{f.name}</p>
                  <p className="text-[9.5px] text-zinc-600 font-sans mt-0.5">{targetLabel(f.target)}</p>

                  {f.owned ? (
                    <div className="mt-1.5 flex items-center gap-1 text-[10.5px] font-sans font-semibold"
                      style={{ color: "#6bd08a" }}>
                      <Check className="w-3 h-3" />
                      {f.priceTinta > 0 ? t("frameOwned") : t("freeLabel")}
                    </div>
                  ) : (
                    <button
                      onClick={() => isLoggedIn ? buy.mutate(f) : setLocation("/")}
                      disabled={isBuying}
                      className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-sans font-semibold disabled:opacity-60"
                      style={{
                        background: canAfford ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${canAfford ? ACCENT + "60" : "rgba(255,255,255,0.1)"}`,
                        color: canAfford ? ACCENT : "rgba(255,255,255,0.45)",
                      }}>
                      {isBuying
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : canAfford ? <Droplets className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      {f.priceTinta} {t("unlockWord")}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <WalletPanel open={showWallet} onClose={() => setShowWallet(false)}
        accentColor={ACCENT} accentGlow={ACCENT} />
    </div>
  )
}
