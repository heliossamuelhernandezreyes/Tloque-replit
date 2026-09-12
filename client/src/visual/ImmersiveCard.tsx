import type { CSSProperties } from "react"
import { useFrames } from "@/hooks/useFrames"
import { collectionMaterialFor } from "@/lib/rarities"
import CollectibleCard, { type CardData } from "@/components/CollectibleCard"
import VisualSlot from "./VisualEngine"
import { readFrameScene } from "@shared/frame-scene"
import FrameInspection from "./FrameInspection"

export default function ImmersiveCard({ card, accentColor, priority = 100, onReadyChange }: { card: CardData; accentColor: string; priority?: number; onReadyChange?: (ready: boolean) => void }) {
  const { byId } = useFrames()
  if (!card.owned) return <CollectibleCard card={card} accentColor={accentColor} accentGlow={accentColor} zoomable={false} />
  const frame = byId(card.fx?.frameId)
  const material = collectionMaterialFor(card.rarity, card.inGachaPool, card.fx?.rarity || "silver")
  const layers = card.fx?.layers
  const images = [layers?.back, layers?.mid, layers?.front].filter((url): url is string => typeof url === "string" && !!url)
  if (readFrameScene(frame?.pkg)) return <FrameInspection key={card.id} pkg={frame!.pkg} images={images} onReadyChange={onReadyChange}>
    {images.map((src, i) => <img key={i} src={src} alt="" className="absolute inset-0 h-full w-full object-cover" decoding="async"/>)}
  </FrameInspection>
  return <VisualSlot priority={priority} interactive className="tq-portal-visual" label={card.name} onReadyChange={onReadyChange}
    options={{ kind: "portal", color: material.base || accentColor, images, frame: frame?.pkg }}>
    <div className="absolute inset-[5%] rounded-2xl overflow-hidden border-[5px] bg-zinc-950"
      style={{ borderColor: material.base, boxShadow: `0 8px 35px ${material.glow}30` } as CSSProperties}>
      {images.map((src, i) => <img key={`${i}-${src.length}`} src={src} alt="" className="absolute inset-0 h-full w-full object-cover" decoding="async" />)}
      {!images.length && <div className="absolute inset-0 grid place-items-center text-4xl text-white/30">✦</div>}
    </div>
  </VisualSlot>
}
