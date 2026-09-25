import { useFrames } from "@/hooks/useFrames"
import { collectionMaterialFor } from "@/lib/rarities"
import CollectibleCard, { type CardData } from "@/components/CollectibleCard"
import FrameInspection from "./FrameInspection"
import { cardSceneFromFx } from "@shared/card-scene"
import CardScenePoster from "./CardScenePoster"

export default function ImmersiveCard({ card, accentColor, priority = 100, onReadyChange }: { card: CardData; accentColor: string; priority?: number; onReadyChange?: (ready: boolean) => void }) {
  const { byId } = useFrames()
  if (!card.owned) return <CollectibleCard card={card} accentColor={accentColor} accentGlow={accentColor} zoomable={false} />
  const frame = card.snapshotVersion ? { pkg: card.frameSnapshot } : byId(card.fx?.frameId)
  const material = collectionMaterialFor(card.rarity, card.inGachaPool, card.fx?.rarity || "silver")
  const layers = card.fx?.layers
  const images = [layers?.back, layers?.mid, layers?.front].map(url => typeof url === "string" ? url : "")
  const art = cardSceneFromFx(card.fx)
  return <FrameInspection key={card.id} pkg={frame?.pkg} images={images} cardScene={art} color={material.base || accentColor} priority={priority} onReadyChange={onReadyChange}>
    <CardScenePoster scene={art} images={images} frame={frame?.pkg} color={material.base}/>
  </FrameInspection>
}
