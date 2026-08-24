import { linearScoreRecipeFor } from "@shared/audio"
import { nativePhysicalModelByModuleId } from "@shared/native-acoustic-source"
import { validateTloqueSamplePack } from "@shared/native-sample-pack"
import { nativeModuleGroupsForRecipe, recipeForNativeModule } from "./NativeAutoModule"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"

export interface NativeSampleDemandAudit {
  voices: number
  exactPitchVoices: number
  shiftedVoices: number
  shiftedOverOneSemitone: number
  shiftedOverTwoSemitones: number
  shiftedOverThreeSemitones: number
  maxShiftSemitones: number
  meanShiftSemitones: number
  zoneChanges: number
  repeatedZoneRatio: number
  risk: "clean" | "moderate" | "high"
}

export interface NativeModuleDemandAudit extends NativeSampleDemandAudit {
  moduleId: string
  instruments: readonly string[]
}

function semitoneShift(playbackRate: number) { return Math.abs(12 * Math.log2(Math.max(0.0001, playbackRate))) }

/** Audita lo que la obra realmente exige a los bancos sampleados. Los modelos físicos generan pitch continuo y no participan en esta métrica. */
export function auditNativeSampleDemand(plan: NativeSampleScorePlan): NativeSampleDemandAudit {
  const voices = plan.voices.length
  if (!voices) return { voices: 0, exactPitchVoices: 0, shiftedVoices: 0, shiftedOverOneSemitone: 0, shiftedOverTwoSemitones: 0, shiftedOverThreeSemitones: 0, maxShiftSemitones: 0, meanShiftSemitones: 0, zoneChanges: 0, repeatedZoneRatio: 0, risk: "clean" }
  const shifts = plan.voices.map(voice => semitoneShift(voice.playbackRate))
  const exactPitchVoices = shifts.filter(value => value < 0.08).length
  const shiftedOverOneSemitone = shifts.filter(value => value > 1.05).length
  const shiftedOverTwoSemitones = shifts.filter(value => value > 2.05).length
  const shiftedOverThreeSemitones = shifts.filter(value => value > 3.05).length
  let zoneChanges = 0, repeated = 0
  const previousByTrack = new Map<string, string>()
  for (const voice of plan.voices) {
    const previous = previousByTrack.get(voice.trackId)
    if (previous) { if (previous === voice.zoneId) repeated += 1; else zoneChanges += 1 }
    previousByTrack.set(voice.trackId, voice.zoneId)
  }
  const maxShiftSemitones = Math.max(...shifts)
  const meanShiftSemitones = shifts.reduce((sum, value) => sum + value, 0) / shifts.length
  const shiftedRatio = shiftedOverTwoSemitones / voices
  const risk = shiftedOverThreeSemitones > 0 || shiftedRatio > 0.08 ? "high" : shiftedOverOneSemitone / voices > 0.2 || meanShiftSemitones > 0.8 ? "moderate" : "clean"
  return { voices, exactPitchVoices, shiftedVoices: voices - exactPitchVoices, shiftedOverOneSemitone, shiftedOverTwoSemitones, shiftedOverThreeSemitones, maxShiftSemitones, meanShiftSemitones, zoneChanges, repeatedZoneRatio: repeated / Math.max(1, repeated + zoneChanges), risk }
}

export async function auditNativeScoreDemand(value: unknown, signal?: AbortSignal): Promise<readonly NativeModuleDemandAudit[]> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return []
  const trackById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const result: NativeModuleDemandAudit[] = []
  for (const group of nativeModuleGroupsForRecipe(recipe)) {
    if (signal?.aborted) throw new DOMException("Auditoría cancelada", "AbortError")
    if (nativePhysicalModelByModuleId(group.moduleId)) continue
    const response = await fetch(`/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`, { credentials: "include", cache: "no-store", signal })
    if (!response.ok) continue
    const pack = validateTloqueSamplePack(await response.json())
    const plan = buildNativeSampleScorePlan(recipeForNativeModule(recipe, group), pack)
    const instruments = [...new Set(group.trackIds.map(id => trackById.get(id)?.instrument).filter((v): v is string => Boolean(v)))]
    result.push({ moduleId: group.moduleId, instruments, ...auditNativeSampleDemand(plan) })
  }
  return result
}
