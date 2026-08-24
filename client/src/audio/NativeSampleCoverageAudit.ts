import { linearScoreRecipeFor } from "@shared/audio"
import { validateTloqueSamplePack, type TloqueSamplePack, type TloqueSampleZone } from "@shared/native-sample-pack"
import { nativeModuleGroupsForRecipe, recipeForNativeModule } from "./NativeAutoModule"
import { buildNativeSampleScorePlan } from "./NativeSampleScorePlan"

export type NativeCoverageDensity = "dense" | "good" | "sparse" | "risk" | "missing"

export interface NativeCoverageSlice {
  key: string
  articulation: string
  vibratoColour: string
  mute: string
  microphone: string
  roots: number
  midiMin: number
  midiMax: number
  maxRootGap: number
  maxTransposeNeed: number
  uncoveredMidi: readonly number[]
}

export interface NativeCoverageSummary {
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
  slices: readonly NativeCoverageSlice[]
  weakSlices: readonly NativeCoverageSlice[]
}

export interface NativeCoverageItem extends NativeCoverageSummary {
  moduleId: string
  trackIds: readonly string[]
  instruments: readonly string[]
  status: "ready" | "missing" | "invalid"
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

function vibratoColour(zone: TloqueSampleZone) {
  return zone.vibratoColour ?? (zone.vibrato ? "vibrato" : "none")
}

function microphone(pack: TloqueSamplePack, zone: TloqueSampleZone) {
  return zone.micPosition ?? pack.defaultMicPosition ?? "default"
}

function summarizeSlice(key: string, zones: readonly TloqueSampleZone[]): NativeCoverageSlice {
  const [articulation, colour, mute, mic] = key.split("|")
  const roots = [...new Set(zones.map(zone => zone.rootMidi))].sort((a, b) => a - b)
  const midiMin = Math.min(...zones.map(zone => zone.loMidi))
  const midiMax = Math.max(...zones.map(zone => zone.hiMidi))
  let maxRootGap = 0
  for (let index = 1; index < roots.length; index += 1) maxRootGap = Math.max(maxRootGap, roots[index] - roots[index - 1])
  let maxTransposeNeed = 0
  const uncoveredMidi: number[] = []
  for (let midi = midiMin; midi <= midiMax; midi += 1) {
    if (!zones.some(zone => midi >= zone.loMidi && midi <= zone.hiMidi)) uncoveredMidi.push(midi)
    maxTransposeNeed = Math.max(maxTransposeNeed, Math.min(...roots.map(root => Math.abs(root - midi))))
  }
  return {
    key,
    articulation,
    vibratoColour: colour,
    mute,
    microphone: mic,
    roots: roots.length,
    midiMin,
    midiMax,
    maxRootGap,
    maxTransposeNeed,
    uncoveredMidi,
  }
}

export function summarizeNativeSamplePackCoverage(pack: TloqueSamplePack): NativeCoverageSummary {
  const attacks = attackZones(pack)
  const allRoots = [...new Set(attacks.map(zone => zone.rootMidi))].sort((a, b) => a - b)
  const midiMin = attacks.length ? Math.min(...attacks.map(zone => zone.loMidi)) : null
  const midiMax = attacks.length ? Math.max(...attacks.map(zone => zone.hiMidi)) : null
  const globallyUncovered: number[] = []
  if (midiMin !== null && midiMax !== null) {
    for (let midi = midiMin; midi <= midiMax; midi += 1) {
      if (!attacks.some(zone => midi >= zone.loMidi && midi <= zone.hiMidi)) globallyUncovered.push(midi)
    }
  }

  const bySlice = new Map<string, TloqueSampleZone[]>()
  for (const zone of attacks) {
    const key = `${zone.articulation}|${vibratoColour(zone)}|${zone.mute ?? "none"}|${microphone(pack, zone)}`
    const zones = bySlice.get(key) ?? []
    zones.push(zone)
    bySlice.set(key, zones)
  }
  const slices = [...bySlice.entries()].map(([key, zones]) => summarizeSlice(key, zones))
    .sort((a, b) => a.key.localeCompare(b.key))
  const maxRootGap = slices.length ? Math.max(...slices.map(slice => slice.maxRootGap)) : null
  const maxTransposeNeed = slices.length ? Math.max(...slices.map(slice => slice.maxTransposeNeed)) : null
  const weakSlices = slices.filter(slice => slice.uncoveredMidi.length > 0 || slice.maxTransposeNeed > 2 || slice.maxRootGap > 4)

  const articulations = [...new Set(attacks.map(zone => zone.articulation))].sort()
  const vibratoColours = [...new Set(attacks.map(vibratoColour))].sort()
  const mutes = [...new Set(attacks.map(zone => zone.mute ?? "none"))].sort()
  const microphones = [...new Set(pack.zones.map(zone => microphone(pack, zone)))].sort()
  const velocityLayers = new Set(attacks.map(zone => zone.velocityLayer)).size
  const roundRobins = new Set(attacks.map(zone => zone.roundRobin)).size
  const releaseZones = pack.zones.filter(zone => zone.trigger === "release").length
  const trueLegatoTransitions = pack.zones.filter(zone => zone.trigger === "legato-transition").length

  let density: NativeCoverageDensity = "missing"
  if (attacks.length) {
    if (globallyUncovered.length || slices.some(slice => slice.uncoveredMidi.length || slice.maxTransposeNeed > 4)) density = "risk"
    else if (slices.every(slice => slice.maxTransposeNeed <= 1 && slice.maxRootGap <= 2)) density = "dense"
    else if (slices.every(slice => slice.maxTransposeNeed <= 2 && slice.maxRootGap <= 4)) density = "good"
    else density = "sparse"
  }

  return {
    density,
    zones: pack.zones.length,
    roots: allRoots.length,
    midiMin,
    midiMax,
    maxRootGap,
    maxTransposeNeed,
    uncoveredMidi: globallyUncovered,
    articulations,
    vibratoColours,
    mutes,
    microphones,
    velocityLayers,
    roundRobins,
    releaseZones,
    trueLegatoTransitions,
    slices,
    weakSlices,
  }
}

function emptyCoverage(): NativeCoverageSummary {
  return {
    density: "missing", zones: 0, roots: 0, midiMin: null, midiMax: null, maxRootGap: null, maxTransposeNeed: null,
    uncoveredMidi: [], articulations: [], vibratoColours: [], mutes: [], microphones: [], velocityLayers: 0,
    roundRobins: 0, releaseZones: 0, trueLegatoTransitions: 0, slices: [], weakSlices: [],
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
        items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "missing", ...emptyCoverage(), message: `HTTP ${response.status}` })
        continue
      }
      const pack = validateTloqueSamplePack(await response.json())
      if (pack.instrumentManifestId !== group.moduleId) throw new Error("El manifest publicado no corresponde al módulo indexado")
      const stats = summarizeNativeSamplePackCoverage(pack)
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
        moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "invalid", ...emptyCoverage(),
        message: error instanceof Error ? error.message : "No se pudo auditar el banco",
      })
    }
  }

  const missingModules = items.filter(item => item.status !== "ready")
  const riskyModules = items.filter(item => item.status === "ready" && (item.density === "risk" || item.weakSlices.length > 0 || Boolean(item.message)))
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
