import { motion } from "framer-motion"
import { Lock, Droplets, Heart, Loader2, Sparkles } from "lucide-react"
import ParallaxCover from "@/components/ParallaxCover"
import FrameRenderer from "@/components/FrameRenderer"
import { useFrames } from "@/hooks/useFrames"
import { useCardViewer } from "@/components/CardViewer"
import CardParticles, { type ParticleEffect } from "@/components/CardParticles"
import { materialFor, frameGradient } from "@/lib/rarities"
import { useSettings } from "@/context/SettingsContext"

export interface CardData {
  id:          number
  name:        string
  subtitle:    string
  description: string
  fx:          any
  effect?:     ParticleEffect
  effectIntensity?: number
  unlock:      "support" | "tinta"
  priceTinta:  number
  owned:       boolean
}

interface Props {
  card:        CardData
  accentColor: string
  accentGlow:  string
  onBuy?:      (card: CardData) => void
  buying?:     boolean
  preview?:    boolean
  zoomable?:    boolean   // por defecto SÍ: tocarla abre el visor
  onTap?:       () => void // si se pasa, gana sobre el visor
}

function tintFor(effect: ParticleEffect, accent: string): string {
  if (effect === "embers" || effect === "fire") return "#ff7a3c"
  if (effect === "snow")   return "#ffffff"
  if (effect === "rain" || effect === "rainGlass") return "#b4c8e6"
  if (effect === "smoke")  return "#8a8a95"
  return accent
}

// Tarjeta coleccionable de Tloque. Viva (parallax 3D + clima por capa)
// cuando es tuya o en previsualización; silueta con candado si falta.
export default function CollectibleCard({ card, accentColor, accentGlow, onBuy, buying, preview , zoomable = true, onTap }: Props) {
  const { t } = useSettings()
  const backArt = card.fx?.layers?.back || ""
  const rarity = card.fx?.rarity || "silver"
  const mat = materialFor(rarity)

  // Marco de la galería (si el autor eligió uno). Si no, el anillo de rareza.
  const { byId } = useFrames()
  const galleryFrame = byId(card.fx?.frameId)

  // Cualquier tarjeta, en cualquier pantalla: se toca y se abre en el visor.
  const viewer = useCardViewer()
  const handleTap = onTap ?? (zoomable ? () => viewer.open(card, accentColor, accentGlow) : undefined)
  const frame = mat.base

  // Clima global (compat) y por capa (nuevo)
  const globalEffect = (card.fx?.effect || card.effect || "none") as ParticleEffect
  const globalIntensity = typeof card.fx?.effectIntensity === "number" ? card.fx.effectIntensity
                        : (card.effectIntensity ?? 0.5)
  const layerFx = card.fx?.layerFx || {}
  const alive = card.owned || preview

  // Construye el overlay de partículas de una capa (o null si "none")
  const slot = (which: "back" | "mid" | "front") => {
    const lf = layerFx[which]
    if (!lf || lf.effect === "none" || (lf.intensity ?? 0) <= 0) return undefined
    return <CardParticles effect={lf.effect} intensity={lf.intensity} tint={tintFor(lf.effect, accentColor)} />
  }
  const hasLayerFx = ["back", "mid", "front"].some(k => layerFx[k]?.effect && layerFx[k].effect !== "none")

  if (!alive) {
    return (
      <div className="relative rounded-[20px] overflow-hidden select-none aspect-[5/7]"
        style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
        {backArt && (
          <img src={backArt} alt="" loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "grayscale(1) brightness(0.28) blur(1px)" }} />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-3"
          style={{ background: "radial-gradient(circle at 50% 40%, rgba(8,8,12,0.35), rgba(8,8,12,0.72))" }}>
          <div className="p-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <Lock className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
          </div>
          <p className="text-[11px] font-display font-semibold text-center leading-snug"
            style={{ color: "rgba(255,255,255,0.7)" }}>
            {card.name}
          </p>
          {card.unlock === "support" ? (
            <span className="flex items-center gap-1 text-[8.5px] font-sans px-2 py-1 rounded-full"
              style={{ background: `${accentGlow}18`, color: accentColor, border: `1px solid ${accentColor}30` }}>
              <Heart className="w-2.5 h-2.5" /> {t("cardBySupport")}
            </span>
          ) : (
            <motion.button
              whileTap={{ scale: 0.95 }}
              disabled={buying}
              onClick={() => onBuy?.(card)}
              className="flex items-center gap-1 text-[10px] font-sans font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #e6cd82, #d4af5a)", color: "rgba(0,0,0,0.85)" }}
            >
              {buying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Droplets className="w-3 h-3" />}
              {t("cardBuyFor").replace("{n}", String(card.priceTinta))}
            </motion.button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative select-none"
      onClick={handleTap}
      style={{ cursor: handleTap ? "pointer" : undefined }}>
      {/* Halo exterior (no rota: es la luz ambiental, no la carta) */}
      <div className="rounded-[22px] relative"
        style={{ boxShadow: `0 8px 28px -8px ${mat.glow}55` }}>
        <div className="relative rounded-[22px] overflow-hidden aspect-[5/7]">
          <ParallaxCover
            title={card.name}
            coverUrl={backArt}
            coverFx={card.fx}
            accentColor={accentColor}
            accentGlow={accentGlow}
            className="!rounded-[22px] h-full"
            layerSlots={hasLayerFx ? { back: slot("back"), mid: slot("mid"), front: slot("front") } : undefined}
            frameOverlay={
              /* TODO el chrome rota pegado a la carta: marco, textos, sello */
              <div className="absolute inset-0 pointer-events-none">
                {/* El marco: el de la galería si lo eligieron; si no, el anillo de rareza */}
                {galleryFrame ? (
                  <FrameRenderer preset={galleryFrame.pkg} shape="card" asOverlay
                    nameText={card.name} />
                ) : (
                  <div className="absolute inset-0 rounded-[22px] overflow-hidden"
                    style={{
                      padding: 2,
                      background: frameGradient(mat),
                      WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                      WebkitMaskComposite: "xor",
                      maskComposite: "exclude",
                    }}>
                    {/* Destello de gemas/diamante — recorrido recortado al anillo */}
                    {mat.shimmer && (
                      <motion.div
                        className="absolute inset-0"
                        style={{ background: `linear-gradient(115deg, transparent 30%, ${mat.light}cc 50%, transparent 70%)` }}
                        animate={{ x: ["-120%", "120%"] }}
                        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", repeatDelay: 1.5 }}
                      />
                    )}
                  </div>
                )}

                <div className="absolute inset-x-0 bottom-0 h-[38%]"
                  style={{ background: "linear-gradient(to top, rgba(6,6,10,0.92), transparent)" }} />

                <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] font-display font-bold leading-tight tracking-wide"
                      style={{ color: "#fff", textShadow: `0 1px 8px ${frame}80` }}>
                      {card.name}
                    </p>
                    {(hasLayerFx || globalEffect !== "none") && (
                      <Sparkles className="w-3 h-3 flex-shrink-0" style={{ color: mat.light, opacity: 0.8 }} />
                    )}
                  </div>
                  {card.subtitle && (
                    <p className="text-[9.5px] font-sans italic leading-tight mt-0.5"
                      style={{ color: "rgba(255,255,255,0.7)" }}>
                      {card.subtitle}
                    </p>
                  )}
                  {card.description && (
                    <p className="text-[8.5px] font-sans leading-snug mt-1.5"
                      style={{
                        color: "rgba(255,255,255,0.52)",
                        display: "-webkit-box", WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>
                      {card.description}
                    </p>
                  )}
                </div>

                {/* Sello del método, esquina superior */}
                <div className={`absolute top-2.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full ${galleryFrame ? "right-2.5" : "left-2.5"}`}
                  style={{ background: "rgba(6,6,10,0.82)", border: `1px solid ${frame}50` }}>
                  {card.unlock === "tinta"
                    ? <Droplets className="w-2.5 h-2.5" style={{ color: mat.light }} />
                    : <Heart className="w-2.5 h-2.5" style={{ color: mat.light }} />}
                </div>
              </div>
            }
          >
            {/* Clima global (si no hay efectos por capa configurados) */}
            {!hasLayerFx && (
              <CardParticles effect={globalEffect} intensity={globalIntensity} tint={tintFor(globalEffect, accentColor)} />
            )}
          </ParallaxCover>
        </div>
      </div>
    </div>
  )
}
