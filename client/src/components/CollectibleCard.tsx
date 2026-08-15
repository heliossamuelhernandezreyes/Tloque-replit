import { motion } from "framer-motion"
import { memo } from "react"
import { Lock, Droplets, Heart, Loader2, Sparkles } from "lucide-react"
import ParallaxCover from "@/components/ParallaxCover"
import FrameRenderer from "@/components/FrameRenderer"
import { useFrames } from "@/hooks/useFrames"
import { useCardViewer } from "@/components/CardViewer"
import CardParticles, { type ParticleEffect } from "@/components/CardParticles"
import { collectionMaterialFor, collectionTier, frameGradient } from "@/lib/rarities"
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
  rarity?:     string
  inGachaPool?: boolean
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
function CollectibleCard({ card, accentColor, accentGlow, onBuy, buying, preview , zoomable = true, onTap }: Props) {
  const { t, settings } = useSettings()
  const backArt = card.fx?.layers?.back || ""
  const authoredMaterial = card.fx?.rarity || "silver"
  const mat = collectionMaterialFor(card.rarity, card.inGachaPool, authoredMaterial)
  const tier = card.inGachaPool ? collectionTier(card.rarity) : 0
  const collectionRarity = card.inGachaPool && card.rarity ? card.rarity : ""
  const serial = `TQ-${String(card.id).padStart(6, "0")}`
  const premiumFoil = tier >= 2
  const absolute = collectionRarity === "absolute"

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
    <div className="relative select-none rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      onClick={handleTap}
      onKeyDown={event => {
        if (!handleTap || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        handleTap()
      }}
      role={handleTap ? "button" : undefined}
      tabIndex={handleTap ? 0 : undefined}
      aria-label={handleTap ? card.name : undefined}
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
                {/* Foil coleccionable: material ligado a la rareza realmente adquirida. */}
                {premiumFoil && (
                  <motion.div
                    className="absolute inset-[2px] rounded-[20px]"
                    style={{
                      background: absolute
                        ? "linear-gradient(118deg, transparent 15%, rgba(137,220,255,.18) 31%, rgba(255,255,255,.28) 42%, rgba(242,153,255,.2) 55%, transparent 72%)"
                        : `linear-gradient(118deg, transparent 18%, ${mat.glow}10 30%, ${mat.light}34 46%, ${mat.glow}12 61%, transparent 76%)`,
                      backgroundSize: "240% 240%",
                      mixBlendMode: "screen",
                      opacity: 0.25 + tier * 0.075,
                    }}
                    animate={settings.reduceMotion ? undefined : { backgroundPosition: ["120% 0%", "-80% 100%", "120% 0%"] }}
                    transition={{ duration: Math.max(4.5, 9 - tier * 0.55), repeat: Infinity, ease: "linear" }}
                  />
                )}

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
                        animate={settings.reduceMotion ? { x: "10%" } : { x: ["-120%", "120%"] }}
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

                {/* Número de pieza y jerarquía visibles sin depender del idioma. */}
                <div className={`absolute top-2.5 ${galleryFrame ? "left-2.5" : "right-2.5"} flex items-center gap-1.5 rounded-full px-2 py-0.5`}
                  style={{
                    background: "rgba(3,3,6,.78)",
                    border: `1px solid ${mat.light}38`,
                    boxShadow: tier >= 5 ? `0 0 12px ${mat.glow}36` : undefined,
                  }}>
                  {collectionRarity && (
                    <span className="text-[7px] tracking-[-0.08em]" style={{ color: mat.light }}>
                      {"◆".repeat(Math.min(3, Math.max(1, Math.ceil((tier + 1) / 3))))}
                    </span>
                  )}
                  <span className="font-mono text-[7px] tracking-[0.08em] text-white/45">{serial}</span>
                </div>

                {collectionRarity && (
                  <div className="absolute bottom-2.5 right-2.5 font-mono text-[6px] uppercase tracking-[0.2em]"
                    style={{ color: `${mat.light}80`, writingMode: "vertical-rl" }}>
                    {collectionRarity.replace("_", "-")}
                  </div>
                )}
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

export default memo(CollectibleCard)
