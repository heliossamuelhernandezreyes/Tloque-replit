import { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense, type ReactNode } from "react"
import { useLocation } from "wouter"
import type { CardData } from "@/components/CollectibleCard"
import { useSettings } from "@/context/SettingsContext"
import VisualDialog from "@/visual/VisualDialog"
const CollectibleCard = lazy(() => import("@/components/CollectibleCard"))
const ImmersiveCard = lazy(() => import("@/visual/ImmersiveCard"))

interface ViewerState { card: CardData; accentColor: string; accentGlow: string }
interface Ctx { open: (card: CardData, accentColor?: string, accentGlow?: string) => void; close: () => void }
const CardViewerContext = createContext<Ctx>({ open: () => {}, close: () => {} })
export const useCardViewer = () => useContext(CardViewerContext)

/** One accessible viewer; collections remain lightweight DOM previews. */
export function CardViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState | null>(null)
  const [immersive, setImmersive] = useState(true)
  const [portalReady, setPortalReady] = useState(false)
  const [location] = useLocation()
  const { t } = useSettings()
  const open = useCallback((card: CardData, accentColor = "#c9a84c", accentGlow = "#c9a84c") => {
    setImmersive(true)
    setPortalReady(false)
    setState({ card, accentColor, accentGlow })
  }, [])
  const close = useCallback(() => setState(null), [])
  useEffect(close, [location, close])
  return <CardViewerContext.Provider value={{ open, close }}>
    {children}
    <VisualDialog open={!!state} onClose={close} title={state?.card.name || t("portalView")} description={t("portalHint")}>
      {state && <div className="tq-viewer-layout">
        <div>
          <Suspense fallback={<div className="min-h-80 rounded-2xl border border-white/10 bg-white/5" aria-label="Preparando carta"/>}>
            {immersive ? <ImmersiveCard card={state.card} accentColor={state.accentColor} onReadyChange={setPortalReady} /> : <CollectibleCard card={state.card} accentColor={state.accentColor} accentGlow={state.accentGlow} zoomable={false} />}
          </Suspense>
          {immersive && portalReady && <p className="tq-portal-caption">{t("portalHint")}</p>}
        </div>
        <div className="space-y-4 pb-5">
          <div className="flex gap-2" aria-label={t("portalView")}>
            <button aria-pressed={immersive} onClick={() => setImmersive(true)} className="min-h-11 rounded-full border border-white/20 px-4 text-sm text-zinc-300 aria-pressed:bg-white/10">{t("visualPortal")}</button>
            <button aria-pressed={!immersive} onClick={() => setImmersive(false)} className="min-h-11 rounded-full border border-white/20 px-4 text-sm text-zinc-300 aria-pressed:bg-white/10">{t("visualOriginal")}</button>
          </div>
          <p className="text-xs tracking-[.2em] uppercase text-zinc-400">TQ-{String(state.card.id).padStart(6, "0")}</p>
          <h2 className="text-3xl font-display text-zinc-100 leading-tight">{state.card.name}</h2>
          {state.card.subtitle && <p className="text-base text-zinc-300">{state.card.subtitle}</p>}
          {state.card.description && <p className="text-[15px] leading-7 text-zinc-400 whitespace-pre-line">{state.card.description}</p>}
          {state.card.rarity && <p className="text-xs uppercase tracking-widest" style={{ color: state.accentColor }}>{state.card.rarity}</p>}
        </div>
      </div>}
    </VisualDialog>
  </CardViewerContext.Provider>
}
