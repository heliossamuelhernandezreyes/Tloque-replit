import { linearScoreRecipeFor } from "@shared/audio"
import { encodeAudioBufferToWav, type ScoreExportOptions } from "./ScoreExporter"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"
import { createSampledMixMaster } from "./ScoreMixMaster"
import { createAcousticStage } from "./ScoreAcousticStage"
import { nativeModuleGroupsForRecipe, recipeForNativeModule, NATIVE_AUTO_MODULE_ID } from "./NativeAutoModule"

const MAX_OFFLINE_FLOAT_BYTES = 220 * 1024 * 1024

function nativeSampleQuality(value: unknown, options: ScoreExportOptions) {
  const recipe = linearScoreRecipeFor(value)
  const requested = options.quality ?? (recipe.version === 2 && recipe.plan.quality === "core" ? "preview" : recipe.version === 2 ? recipe.plan.quality : "studio")
  return requested === "preview"
    ? { quality: requested, sampleRate: 32_000, bitDepth: 16 as const, tail: 2.5 }
    : { quality: requested, sampleRate: 48_000, bitDepth: 24 as const, tail: requested === "master" ? 8 : 5 }
}
function assertNotAborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError") }

interface LoadedOfflinePlan { moduleId: string; plan: NativeSampleScorePlan }

export interface NativeSamplePackPreflightItem {
  moduleId: string
  trackIds: readonly string[]
  instruments: readonly string[]
  status: "ready" | "missing" | "invalid"
  message?: string
}

export interface NativeSamplePackPreflight {
  ready: boolean
  items: readonly NativeSamplePackPreflightItem[]
  missing: readonly NativeSamplePackPreflightItem[]
}

function modulePackUrlFor(recipe: ReturnType<typeof linearScoreRecipeFor>, moduleId: string, packUrl?: string) {
  if (recipe.version !== 2) throw new Error("La partitura no usa módulos nativos")
  if (recipe.plan.moduleId === NATIVE_AUTO_MODULE_ID) return `/api/audio/sample-packs/modules/${encodeURIComponent(moduleId)}.json`
  if (!packUrl?.startsWith("/api/audio/sample-packs/modules/")) throw new Error("El módulo nativo debe provenir del almacenamiento interno de Tloque")
  return packUrl
}

export async function preflightNativeSamplePacks(
  value: unknown,
  packUrl?: string,
  signal?: AbortSignal,
): Promise<NativeSamplePackPreflight> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return { ready: true, items: [], missing: [] }

  const groups = nativeModuleGroupsForRecipe(recipe)
  const trackById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const items: NativeSamplePackPreflightItem[] = []

  for (const group of groups) {
    assertNotAborted(signal)
    const instruments = [...new Set(group.trackIds.map(id => trackById.get(id)?.instrument).filter((value): value is string => Boolean(value)))]
    const url = modulePackUrlFor(recipe, group.moduleId, packUrl)
    try {
      const response = await fetch(url, { credentials: "include", signal, cache: "no-store" })
      if (!response.ok) {
        items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "missing", message: `HTTP ${response.status}` })
        continue
      }
      const manifest = await response.json().catch(() => null) as { instrumentManifestId?: string } | null
      if (!manifest || manifest.instrumentManifestId !== group.moduleId) {
        items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "invalid", message: "El manifest publicado no corresponde al módulo solicitado" })
        continue
      }
      items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "ready" })
    } catch (error) {
      if (signal?.aborted) throw error
      items.push({
        moduleId: group.moduleId,
        trackIds: group.trackIds,
        instruments,
        status: "missing",
        message: error instanceof Error ? error.message : "No se pudo comprobar el banco",
      })
    }
  }

  const missing = items.filter(item => item.status !== "ready")
  return { ready: missing.length === 0, items, missing }
}

function premiumPreflightError(preflight: NativeSamplePackPreflight) {
  const rows = preflight.missing.map(item => {
    const instruments = item.instruments.length ? item.instruments.join(", ") : "instrumento sin identificar"
    return `• ${instruments} → module:${item.moduleId}`
  })
  return [
    `Master premium no puede exportarse: faltan ${preflight.missing.length} banco${preflight.missing.length === 1 ? "" : "s"} acústico${preflight.missing.length === 1 ? "" : "s"}.`,
    ...rows,
    "Abre Instrumentos premium e instala los bancos faltantes. Tloque no sustituirá silenciosamente estos instrumentos por síntesis base.",
  ].join("\n")
}

async function renderBaseFallback(recipe: ReturnType<typeof linearScoreRecipeFor>, options: ScoreExportOptions) {
  if (recipe.version !== 2) throw new Error("La partitura no puede usar el fallback de síntesis base")
  const baseRecipe = { ...recipe, plan: { ...recipe.plan, moduleId: "builtin" } }
  const { renderTloqueScoreToWav } = await import("./ScoreExporter")
  return renderTloqueScoreToWav(baseRecipe, options)
}

export async function renderTloqueScoreWithNativeSamplePackToWav(value: unknown, packUrl: string, options: ScoreExportOptions = {}): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita paquetes nativos")
  if (recipe.plan.moduleId !== NATIVE_AUTO_MODULE_ID && !packUrl.startsWith("/api/audio/sample-packs/modules/")) throw new Error("El módulo nativo debe provenir del almacenamiento interno de Tloque")

  const profile = nativeSampleQuality(recipe, options)
  assertNotAborted(options.signal); options.onProgress?.(0.01)

  const preflight = await preflightNativeSamplePacks(recipe, packUrl, options.signal)
  if (!preflight.ready) {
    if (profile.quality === "master") throw new Error(premiumPreflightError(preflight))
    options.onProgress?.(0)
    return renderBaseFallback(recipe, options)
  }

  options.onProgress?.(0.03)
  const decodeContext = new OfflineAudioContext(2, 1, profile.sampleRate)
  const decodedByUrl = new Map<string, AudioBuffer>()
  const loaded: LoadedOfflinePlan[] = []
  const groups = nativeModuleGroupsForRecipe(recipe)

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    const decodePlayer = new NativeSamplePackPlayer(decodeContext, decodedByUrl)
    const modulePackUrl = modulePackUrlFor(recipe, group.moduleId, packUrl)
    const pack = await decodePlayer.loadPack(modulePackUrl)
    if (pack.instrumentManifestId !== group.moduleId) throw new Error(`El paquete nativo ${group.moduleId} no corresponde al módulo solicitado`)
    const plan = buildNativeSampleScorePlan(recipeForNativeModule(recipe, group), pack)
    const decoded = await decodePlayer.preload(plan.zones)
    plan.zones.forEach((zone, zoneIndex) => { const buffer = decoded[zoneIndex]; if (buffer) decodedByUrl.set(zone.sampleUrl, buffer) })
    loaded.push({ moduleId: group.moduleId, plan })
    options.onProgress?.(0.04 + ((index + 1) / Math.max(1, groups.length)) * 0.08)
    assertNotAborted(options.signal)
  }

  let naturalEnd = recipe.plan.totalSeconds
  for (const { plan } of loaded) {
    for (const voice of plan.voices) {
      if (!voice.oneShot) continue
      const physical = decodedByUrl.get(voice.sampleUrl)?.duration ?? 0
      naturalEnd = Math.max(naturalEnd, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate))
    }
    for (const voice of plan.auxiliaryVoices) {
      const physical = decodedByUrl.get(voice.sampleUrl)?.duration ?? 0
      naturalEnd = Math.max(naturalEnd, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate))
    }
  }

  const durationSeconds = Math.max(recipe.plan.totalSeconds, naturalEnd) + profile.tail
  const totalFrames = Math.ceil(durationSeconds * profile.sampleRate), floatBytes = totalFrames * 2 * Float32Array.BYTES_PER_ELEMENT
  if (floatBytes > MAX_OFFLINE_FLOAT_BYTES) throw new Error("La obra muestreada excede la memoria segura del navegador móvil; expórtala por movimientos")
  options.onProgress?.(0.20)

  const context = new OfflineAudioContext(2, totalFrames, profile.sampleRate)
  const mix = createSampledMixMaster(context, 1); mix.output.connect(context.destination)
  const stage = createAcousticStage(context, mix.input)
  const trackGain = new Map<string, GainNode>(), trackNodes: AudioNode[] = []
  const recipeTrackById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  for (const { plan } of loaded) {
    for (const track of plan.tracks) {
      if (trackGain.has(track.id)) continue
      const gain = context.createGain(); gain.gain.value = track.gain; trackNodes.push(gain)
      const semanticTrack = recipeTrackById.get(track.id)
      const stageInput = stage.createTrackInput(semanticTrack?.instrument ?? "unknown", track.pan)
      gain.connect(stageInput); trackGain.set(track.id, gain)
    }
  }

  for (const { plan } of loaded) {
    for (const control of plan.controls) {
      const gain = trackGain.get(control.trackId); if (!gain) continue
      const at = control.timeSeconds; gain.gain.cancelScheduledValues(at)
      if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds)
      else gain.gain.setValueAtTime(control.gain, at)
    }
  }

  const scheduled: Promise<unknown>[] = []
  for (const { plan } of loaded) {
    const player = new NativeSamplePackPlayer(context, decodedByUrl)
    const zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))
    for (const voice of plan.voices) {
      const destination = trackGain.get(voice.trackId), zone = zoneById.get(voice.zoneId)
      if (!destination || !zone) continue
      scheduled.push(player.playSelection(
        { zone, playbackRate: voice.playbackRate, gain: voice.sampleGain }, voice.startSeconds, voice.durationSeconds, destination, 0, voice.oneShot,
        voice.fadeInSeconds > 0 ? { fadeInSeconds: voice.fadeInSeconds } : undefined,
      ))
    }
    for (const auxiliary of plan.auxiliaryVoices) {
      const destination = trackGain.get(auxiliary.trackId), zone = zoneById.get(auxiliary.zoneId)
      if (!destination || !zone) continue
      scheduled.push(player.playSelection(
        { zone, playbackRate: auxiliary.playbackRate, gain: auxiliary.sampleGain }, auxiliary.startSeconds, auxiliary.durationSeconds, destination, 0, true,
        auxiliary.fadeOutSeconds > 0 ? { fadeOutSeconds: auxiliary.fadeOutSeconds } : undefined,
      ))
    }
  }

  await Promise.all(scheduled); assertNotAborted(options.signal); options.onProgress?.(0.28)
  const rendered = await context.startRendering(); options.onProgress?.(0.82)
  for (const node of trackNodes) node.disconnect(); stage.disconnect(); mix.disconnect()
  return encodeAudioBufferToWav(rendered, profile.bitDepth, progress => { options.onProgress?.(0.82 + progress * 0.18) })
}
