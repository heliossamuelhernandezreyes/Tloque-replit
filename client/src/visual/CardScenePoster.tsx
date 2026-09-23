import { CARD_LAYERS, cardLayerStyle, type CardScene } from "@shared/card-scene-runtime"
import FrameRenderer from "@/components/FrameRenderer"
import "./card-director.css"

export default function CardScenePoster({ scene, images, frame, color = "#c9b88a", fill = false }: { scene: CardScene; images: string[]; frame?: unknown; color?: string; fill?: boolean }) {
  return <div className="tq-card-scene-poster" style={{ borderColor: color, background: scene.content?.background, ...(fill ? { width: "100%", maxWidth: "100%", height: "100%", border: 0 } : {}) }} data-testid="card-scene-poster">
    {CARD_LAYERS.map((name, i) => images[i] ? <img key={name} src={images[i]} alt="" draggable={false} style={cardLayerStyle(scene, name)}/> : null)}
    {!!scene.content?.objects.length && <div className="tq-model-poster"><strong aria-hidden="true">◇</strong><span>Escena 3D · {scene.content.objects.length} piezas</span></div>}
    {frame != null && <FrameRenderer preset={frame} asOverlay shape="card"/>}
  </div>
}
