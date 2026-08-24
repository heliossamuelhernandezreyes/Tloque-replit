import type { LinearScoreRecipeV2 } from "@shared/tloque-score-v2"
import { INSTRUMENT_MANIFEST_REGISTRY } from "@shared/instrument-manifest"

export const NATIVE_AUTO_MODULE_ID = "native-auto" as const

const NON_NATIVE_MANIFESTS = new Set(["gm-orchestral-strings"])

export function preferredNativeModuleForInstrument(instrumentId: string): string | null {
  const manifest = INSTRUMENT_MANIFEST_REGISTRY.find(item =>
    !NON_NATIVE_MANIFESTS.has(item.id) && item.instruments.includes(instrumentId),
  )
  return manifest?.id ?? null
}

export interface NativeModuleGroup {
  moduleId: string
  trackIds: readonly string[]
}

export function nativeModuleGroupsForRecipe(recipe: LinearScoreRecipeV2): readonly NativeModuleGroup[] {
  if (recipe.plan.moduleId !== NATIVE_AUTO_MODULE_ID) {
    return [{ moduleId: recipe.plan.moduleId, trackIds: recipe.plan.tracks.map(track => track.id) }]
  }

  const byModule = new Map<string, string[]>()
  for (const track of recipe.plan.tracks) {
    const moduleId = preferredNativeModuleForInstrument(track.instrument)
    if (!moduleId) throw new Error(`No hay un paquete nativo verificado para instrument=${track.instrument}`)
    const tracks = byModule.get(moduleId) ?? []
    tracks.push(track.id)
    byModule.set(moduleId, tracks)
  }
  return [...byModule.entries()].map(([moduleId, trackIds]) => ({ moduleId, trackIds }))
}

export function recipeForNativeModule(
  recipe: LinearScoreRecipeV2,
  group: NativeModuleGroup,
): LinearScoreRecipeV2 {
  const ids = new Set(group.trackIds)
  return {
    ...recipe,
    plan: {
      ...recipe.plan,
      moduleId: group.moduleId,
      tracks: recipe.plan.tracks.filter(track => ids.has(track.id)),
      events: recipe.plan.events.filter(event => ids.has(event.trackId)),
      rests: recipe.plan.rests.filter(rest => ids.has(rest.trackId)),
      controls: recipe.plan.controls.filter(control => ids.has(control.trackId)),
    },
  }
}
