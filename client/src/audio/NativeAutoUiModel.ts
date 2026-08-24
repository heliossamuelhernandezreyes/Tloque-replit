import type { LinearScoreRecipe } from "@shared/audio"
import { NATIVE_AUTO_MODULE_ID, nativeModuleGroupsForRecipe } from "./NativeAutoModule"

export interface NativeRouterUiModel {
  virtual: boolean
  label: string
  moduleIds: readonly string[]
  trackCount: number
}

/** Modelo de presentación: native-auto nunca debe mostrarse como un banco descargable único. */
export function nativeRouterUiModel(recipe: LinearScoreRecipe): NativeRouterUiModel | null {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return null
  if (recipe.plan.moduleId !== NATIVE_AUTO_MODULE_ID) {
    return { virtual: false, label: `Banco ${recipe.plan.moduleId}`, moduleIds: [recipe.plan.moduleId], trackCount: recipe.plan.tracks.length }
  }
  const groups = nativeModuleGroupsForRecipe(recipe)
  return {
    virtual: true,
    label: `Router acústico automático · ${groups.length} bancos físicos`,
    moduleIds: groups.map(group => group.moduleId),
    trackCount: recipe.plan.tracks.length,
  }
}
