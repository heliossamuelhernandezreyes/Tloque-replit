import { linearScoreRecipeFor } from "@shared/audio"
import { validateTloqueSamplePack, type TloqueSamplePack } from "@shared/native-sample-pack"
import { nativeModuleGroupsForRecipe, recipeForNativeModule } from "./NativeAutoModule"
import { buildNativeSampleScorePlan } from "./NativeSampleScorePlan"

export type NativeCoverageDensity = "dense" | "good" | "sparse" | "risk" | "missing"

export interface NativeCoverageItem {
  moduleId: string
  trackIds: readonly string[]
  instruments: readonly string[]
  status: "ready" | "missing" | "invalid"
  density: NativeCoverageDensity
  zones: number
  roots: number
  midiMin: number | null
  midiMax: number | null
  maxRootGap: number | null
  maxTransposeNeed: number | null
  uncoveredMidi: readonly number[]
  articulations: readonly string[]
  vibratoColours: readonly string[]
  mutes: readonly string[]
  microphones: readonly string[]
  velocityLayers: number
  roundRobins: number
  releaseZones: number
  trueLegatoTransitions: number
  message?: string
}

export interface NativeCoverageAudit {
  ready: boolean
  scorePlayable: boolean
  items: readonly NativeCoverageItem[]
  missingModules: readonly NativeCoverageItem[]
  riskyModules: readonly NativeCoverageItem[]
  totalZones: number
  totalRoots: number
}

function packUrl(moduleId: string) {
  return `/api/audio/sample-packs/modules/${encodeURIComponent(moduleId)}.json`
}

function attackZones(pack: TloqueSamplePack) {
  return pack.zones.filter(zone => (zone.trigger ?? "attack") === "attack")
}

function coverageStats(pack: TloqueSamplePack) {
  const attacks = attackZones(pack)
  const roots = [...new Set(attacks.map(zone => zone.rootMidi))].sort((a, b) => a - b)
  const midiMin = attacks.length ? Math.min(...attacks.map(zone => zone.loMidi)) : null
  const midiMax = attacks.length ? Math.max(...attacks.map(zone => zone.hiMidi)) : null
  let maxRootGap: number | null = null
  if (roots.length > 1) {
    maxRootGap = 0
    for (let index = 1; index < roots.length; index += 1) maxRootGap = Math.max(maxRootGap, roots[index] - roots[index - 1])
  }

  const uncoveredMidi: number[] = []
  let maxTransposeNeed: number | null = roots.length ? 0 : null
  if (midiMin !== null && midiMax !== null) {
    for (let midi = midiMin; midi <= midiMax; midi += 1) {
      const covered = attacks.some(zone => midi >= zone.loMidi && midi <= zone.hiMidi)
      if (!covered) uncoveredMidi.push(midi)
      if (roots.length) {
        const distance = Math.min(...roots.map(root => Math.abs(root - midi)))
        maxTransposeNeed = Math.max(maxTransposeNeed ?? 0, distance)
      }
    }
  }

  const articulations = [...new Set(attacks.map(zone => zone.articulation))].sort()
  const vibratoColours = [...new Set(attacks.map(zone => zone.vibratoColour ?? (zone.vibrato ? "vibrato" : "none")))].sort()
  const mutes = [...new Set(attacks.map(zone => zone.mute ?? "none"))].sort()
  const microphones = [...new Set(pack.zones.map(zone => zone.micPosition ?? pack.defaultMicPosition ?? "default"))].sort()
  const velocityLayers = new Set(attacks.map(zone => zone.velocityLayer)).size
  const roundRobins = new Set(attacks.map(zone => zone.roundRobin)).size
  const releaseZones = pack.zones.filter(zone => zone.trigger === "release").length
  const trueLegatoTransitions = pack.zones.filter(zone => zone.trigger === "legato-transition").length

  let density: NativeCoverageDensity = "missing"
  if (attacks.length) {
    if (uncoveredMidi.length || (maxTransposeNeed ?? 99) > 4) density = "risk"
    else if ((maxTransposeNeed ?? 99) <= 1 && (maxRootGap ?? 2) <= 2) density = "dense"
    else if ((maxTransposeNeed ?? 99) <= 2 && (maxRootGap ?? 4) <= 4) density = "good"
    else density = "sparse"
  }

  return {
    density,
    zones: pack.zones.length,
    roots: roots.length,
    midiMin,
    midiMax,
    maxRootGap,
    maxTransposeNeed,
    uncoveredMidi,
    articulations,
    vibratoColours,
    mutes,
    microphones,
    velocityLayers,
    roundRobins,
    releaseZones,
    trueLegatoTransitions,
  }
}

export async function auditNativeSampleCoverage(value: unknown, signal?: AbortSignal): Promise<NativeCoverageAudit> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") {
    return { ready: true, scorePlayable: true, items: [], missingModules: [], riskyModules: [], totalZones: 0, totalRoots: 0 }
  }

  const trackById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const items: NativeCoverageItem[] = []
  let scorePlayable = true

  for (const group of nativeModuleGroupsForRecipe(recipe)) {
    if (signal?.aborted) throw new DOMException("Auditoría cancelada", "AbortError")
    const instruments = [...new Set(group.trackIds.map(id => trackById.get(id)?.instrument).filter((value): value is string => Boolean(value)))]
    try {
      const response = await fetch(packUrl(group.moduleId), { credentials: "include", cache: "no-store", signal })
      if (!response.ok) {
        scorePlayable = false
        items.push({
          moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "missing", density: "missing",
          zones: 0, roots: 0, midiMin: null, midiMax: null, maxRootGap: null, maxTransposeNeed: null,
          uncoveredMidi: [], articulations: [], vibratoColours: [], mutes: [], microphones: [], velocityLayers: 0,
          roundRobins: 0, releaseZones: 0, trueLegatoTransitions: 0, message: `HTTP ${response.status}`,
        })
        continue
      }
      const pack = validateTloqueSamplePack(await response.json())
      if (pack.instrumentManifestId !== group.moduleId) throw new Error("El manifest publicado no corresponde al módulo indexado")
      const stats = coverageStats(pack)
      let message: string | undefined
      try {
        buildNativeSampleScorePlan(recipeForNativeModule(recipe, group), pack)
      } catch (error) {
        scorePlayable = false
        message = error instanceof Error ? error.message : "La partitura usa una zona no cubierta"
      }
      items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "ready", ...stats, message })
    } catch (error) {
      scorePlayable = false
      items.push({
        moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "invalid", density: "missing",
        zones: 0, roots: 0, midiMin: null, midiMax: null, maxRootGap: null, maxTransposeNeed: null,
        uncoveredMidi: [], articulations: [], vibratoColours: [], mutes: [], microphones: [], velocityLayers: 0,
        roundRobins: 0, releaseZones: 0, trueLegatoTransitions: 0,
        message: error instanceof Error ? error.message : "No se pudo auditar el banco",
      })
    }
  }

  const missingModules = items.filter(item => item.status !== "ready")
  const riskyModules = items.filter(item => item.status === "ready" && (item.density === "risk" || Boolean(item.message)))
  return {
    ready: missingModules.length === 0,
    scorePlayable,
    items,
    missingModules,
    riskyModules,
    totalZones: items.reduce((sum, item) => sum + item.zones, 0),
    totalRoots: items.reduce((sum, item) => sum + item.roots, 0),
  }
}
