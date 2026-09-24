import { CARD_LAYERS, cardLayerStyle, type CardScene } from "@shared/card-scene-runtime"
import FrameRenderer from "@/components/FrameRenderer"
import "./card-director.css"
import { coveredBackgroundScale } from "@shared/portal-card"
import { readFrameScene } from "@shared/frame-scene"
import "./portal-card.css"
import { resolvePortalCard } from "@shared/portal-card-recipe"

export default function CardScenePoster({ scene, images, frame, color = "#c9b88a", fill = false }: { scene: CardScene; images: string[]; frame?: unknown; color?: string; fill?: boolean }) {
  if (scene.portalCard) {
    const recipe=resolvePortalCard(scene.portalCard,frame),bezel=recipe.frame
    return <div className="tq-card-scene-poster" data-testid="card-scene-poster" style={{border:`${bezel.width*55}px solid ${bezel.color}`,borderRadius:bezel.radius*65,background:recipe.world.background,...(fill?{width:"100%",maxWidth:"100%",height:"100%"}:{})}}>
      {CARD_LAYERS.map((name,i)=>{if(!images[i])return null;const t=scene.layers[name].transform;return <img key={name} alt="" src={images[i]} draggable={false} style={i?cardLayerStyle(scene,name):{transform:`translate(${t.x*100}%,${t.y*100}%) rotate(${t.rotation}deg) scale(${coveredBackgroundScale(t.x,t.y,t.rotation,t.scale,5/7)})`,opacity:1}}/>})}
      {recipe.mica.enabled && <div className="tq-portal-poster-mica"/>}
      {frame!=null && !readFrameScene(frame)?.portalCard && <FrameRenderer preset={frame} asOverlay shape="card"/>}
    </div>
  }
  return <div className="tq-card-scene-poster" style={{ borderColor: color, background: scene.content?.background, ...(fill ? { width: "100%", maxWidth: "100%", height: "100%", border: 0 } : {}) }} data-testid="card-scene-poster">
    {CARD_LAYERS.map((name, i) => images[i] ? <img key={name} src={images[i]} alt="" draggable={false} style={cardLayerStyle(scene, name)}/> : null)}
    {!!scene.content?.objects.length && <div className="tq-model-poster"><strong aria-hidden="true">◇</strong><span>Escena 3D · {scene.content.objects.length} piezas</span></div>}
    {frame != null && <FrameRenderer preset={frame} asOverlay shape="card"/>}
  </div>
}
