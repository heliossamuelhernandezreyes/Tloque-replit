import { createContext, useContext, useState, useCallback, ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import CollectibleCard, { type CardData } from "@/components/CollectibleCard"
import { useSettings } from "@/context/SettingsContext"

// ─────────────────────────────────────────────────────────────
// EL VISOR DE TARJETAS — uno solo, para toda la app.
//
// Cualquier tarjeta, en cualquier pantalla, se toca y se abre aquí.
//
// Y va con los cuatro arreglos contra el parpadeo de Android:
//   1. El blur del fondo es HERMANO, no ancestro del 3D.
//      (backdrop-filter sobre contenido preserve-3d rotando obliga al
//       navegador a recomponer el desenfoque en CADA frame.)
//   2. La animación de entrada SUELTA su transform al terminar: mientras
//      un ancestro tenga transform, el 3D del hijo vive en su capa.
//   3. La carta tiene capa propia y estable (translateZ + backface-visibility).
//   4. `contain: paint` encierra los repaints: lo de adentro no repinta lo de afuera.
// ─────────────────────────────────────────────────────────────

interface ViewerState {
  card: CardData
  accentColor: string
  accentGlow: string
}

interface Ctx {
  open: (card: CardData, accentColor?: string, accentGlow?: string) => void
  close: () => void
}

const CardViewerContext = createContext<Ctx>({ open: () => {}, close: () => {} })

export const useCardViewer = () => useContext(CardViewerContext)

export function CardViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState | null>(null)
  const [settled, setSettled] = useState(false)   // ¿la animación de entrada terminó?
  const { t } = useSettings()

  const open = useCallback((card: CardData, accentColor = "#c9a84c", accentGlow = "#c9a84c") => {
    setSettled(false)
    setState({ card, accentColor, accentGlow })
  }, [])

  const close = useCallback(() => {
    setState(null)
    setSettled(false)
  }, [])

  return (
    <CardViewerContext.Provider value={{ open, close }}>
      {children}

      <AnimatePresence>
        {state && (
          <div className="fixed inset-0 z-[900]">
            {/* (1) EL FONDO — hermano, nunca ancestro de la carta.
                   Su blur ya no obliga a recomponer el 3D en cada frame. */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={close}
              className="absolute inset-0"
              style={{ background: "rgba(0,0,0,0.9)", backdropFilter: "blur(10px)" }}
            />

            <button
              onClick={close}
              className="absolute top-6 right-6 z-10 p-2 rounded-full"
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
              aria-label="Cerrar">
              <X className="w-5 h-5" />
            </button>

            {/* La carta, en su propia rama. Nada con blur por encima. */}
            <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
              <motion.div
                initial={{ scale: 0.88, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.88, opacity: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 26 }}
                onAnimationComplete={() => setSettled(true)}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-[300px] pointer-events-auto"
                // (2) Al asentarse, SUELTA el transform: el 3D de adentro
                //     deja de vivir dentro de la capa del ancestro.
                style={settled
                  ? { transform: "none", willChange: "auto" }
                  : { willChange: "transform, opacity" }}
              >
                {/* (3) y (4): capa propia, estable, con los repaints contenidos */}
                <div style={{
                  transform: "translateZ(0)",
                  backfaceVisibility: "hidden",
                  contain: "paint",
                }}>
                  <CollectibleCard
                    card={state.card}
                    accentColor={state.accentColor}
                    accentGlow={state.accentGlow}
                    zoomable={false}          /* ya estamos dentro del visor */
                  />
                </div>
                <p className="text-center text-[10px] font-sans mt-4"
                  style={{ color: "rgba(255,255,255,0.4)" }}>
                  {t("cardZoomHint")}
                </p>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </CardViewerContext.Provider>
  )
}
