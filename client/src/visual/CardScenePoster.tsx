import { CARD_LAYERS, cardLayerStyle, type CardScene } from "@shared/card-scene-runtime"
import FrameRenderer from "@/components/FrameRenderer"
import "./card-director.css"

export default function CardScenePoster({ scene, images, frame, color = "#c9b88a" }: { scene: CardScene; images: string[]; frame?: unknown; color?: string }) {
  return <div className="tq-card-scene-poster" style={{ borderColor: color }} data-testid="card-scene-poster">
    {CARD_LAYERS.map((name, i) => images[i] ? <img key={name} src={images[i]} alt="" draggable={false} style={cardLayerStyle(scene, name)}/> : null)}
    {frame != null && <FrameRenderer preset={frame} asOverlay shape="card"/>}
  </div>
}
