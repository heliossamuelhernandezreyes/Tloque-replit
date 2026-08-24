import type { LinearScoreRecipe } from "@shared/audio"
import { nativePhysicalModelByModuleId } from "@shared/native-acoustic-source"
import { NATIVE_AUTO_MODULE_ID, nativeModuleGroupsForRecipe } from "./NativeAutoModule"

export interface NativeRouterUiModel {
  virtual: boolean
  label: string
  moduleIds: readonly string[]
  trackCount: number
  sampleSources: number
  physicalModels: number
}

/** Modelo de presentación: native-auto es un router de fuentes acústicas, no un banco descargable único. */
export function nativeRouterUiModel(recipe: LinearScoreRecipe): NativeRouterUiModel | null {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return null
  if (recipe.plan.moduleId !== NATIVE_AUTO_MODULE_ID) {
    const physicalModels = nativePhysicalModelByModuleId(recipe.plan.moduleId) ? 1 : 0
    return {
      virtual: false,
      label: `${physicalModels ? "Modelo físico" : "Banco acústico"} ${recipe.plan.moduleId}`,
      moduleIds: [recipe.plan.moduleId],
      trackCount: recipe.plan.tracks.length,
      sampleSources: physicalModels ? 0 : 1,
      physicalModels,
    }
  }
  const groups = nativeModuleGroupsForRecipe(recipe)
  const physicalModels = groups.filter(group => nativePhysicalModelByModuleId(group.moduleId)).length
  const sampleSources = groups.length - physicalModels
  const details = [sampleSources ? `${sampleSources} sampleados` : "", physicalModels ? `${physicalModels} modelados` : ""].filter(Boolean).join(" · ")
  return {
    virtual: true,
    label: `Router acústico automático · ${details || "sin fuentes"}`,
    moduleIds: groups.map(group => group.moduleId),
    trackCount: recipe.plan.tracks.length,
    sampleSources,
    physicalModels,
  }
}
