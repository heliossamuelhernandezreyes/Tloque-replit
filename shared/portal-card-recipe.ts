import { readFrameScene } from "./frame-scene"
import { visualFrame } from "./visual-experience"
import type { PortalCard } from "./portal-card"

/** Equipped frames retain their geometry and rights. Card finishes are opt-in overrides. */
export function resolvePortalCard(recipe: PortalCard, pkg?: unknown): PortalCard {
  if (!pkg) return recipe
  const native=readFrameScene(pkg)
  if(native?.portalCard){
    const inherited=native.portalCard
    return recipe.inheritFrameFinish!==false ? {...recipe,frame:inherited.frame,mica:inherited.mica,weather:inherited.weather,back:inherited.back,world:inherited.world} : {...recipe,frame:inherited.frame}
  }
  const legacy=visualFrame(pkg)
  return {...recipe,frame:{...recipe.frame,color:native?.material.color??legacy.color,metalness:native?.material.metalness??legacy.metalness,roughness:native?.material.roughness??legacy.roughness,width:native?.geometry.width??Math.min(.28,Math.max(.035,legacy.thickness)),thickness:native?.geometry.depth??.12}}
}
