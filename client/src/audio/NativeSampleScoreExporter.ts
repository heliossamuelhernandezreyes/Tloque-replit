import { linearScoreRecipeFor } from "@shared/audio"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { hybridEnabledForArticulation, nativeHybridForInstrument } from "@shared/native-hybrid-source"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { scheduleHybridPhysicalOverlay } from "./HybridPhysicalOverlay"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"
import { nativeModuleGroupsForRecipe, recipeForNativeModule, NATIVE_AUTO_MODULE_ID } from "./NativeAutoModule"
import { assessNativePremiumReadiness, premiumReadinessError } from "./NativePremiumReadiness"
import { createAcousticStage } from "./ScoreAcousticStage"
import { encodeAudioBufferToWav, type ScoreExportOptions, type ScoreExportQuality } from "./ScoreExporter"
import { createSampledMixMaster } from "./ScoreMixMaster"

const MAX_OFFLINE_FLOAT_BYTES = 220 * 1024 * 1024
const MAX_OFFLINE_TOTAL_FLOAT_BYTES = 300 * 1024 * 1024

type HybridExportMode = "none" | "quality"
export interface NativeSampleScoreExportOptions extends ScoreExportOptions {
  hybridMode?: HybridExportMode
  /** Diagnostic/certification renders must never become builtin synthesis after preflight. */
  strictNativeSources?: boolean
}
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

function nativeSampleQuality(value: unknown, options: ScoreExportOptions) {
  const recipe = linearScoreRecipeFor(value)
  const recipeQuality: ScoreExportQuality = recipe.version === 2
    ? recipe.plan.quality === "core" ? "preview" : recipe.plan.quality
    : "studio"
  const requested: ScoreExportQuality = options.quality ?? recipeQuality
  return requested === "preview"
    ? { quality: requested, sampleRate: 32_000, bitDepth: 16 as const, tail: 2.5 }
    : { quality: requested, sampleRate: 48_000, bitDepth: 24 as const, tail: requested === "master" ? 8 : 5 }
}
function assertNotAborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError") }
function brightnessCutoff(value: number) { const amount = Math.max(0, Math.min(1, value)); return 3_400 + Math.pow(amount, 0.72) * 16_000 }
function modulePackUrlFor(recipe: ReturnType<typeof linearScoreRecipeFor>, moduleId: string, packUrl?: string) {
  if (recipe.version !== 2) throw new Error("La partitura no usa módulos nativos")
  if (recipe.plan.moduleId === NATIVE_AUTO_MODULE_ID) return `/api/audio/sample-packs/modules/${encodeURIComponent(moduleId)}.json`
  if (!packUrl?.startsWith("/api/audio/sample-packs/modules/")) throw new Error("El módulo nativo debe provenir del almacenamiento interno de Tloque")
  return packUrl
}
function trackAtEvent(track: LinearScoreTrackV2, controls: LinearScoreRecipeV2["plan"]["controls"], timeSeconds: number): LinearScoreTrackV2 {
  let expression = track.expression, brightness = track.brightness, vibrato = track.vibrato
  for (const control of controls) {
    if (control.timeSeconds > timeSeconds) continue
    if (control.expression !== null) expression = control.expression
    if (control.brightness !== null) brightness = control.brightness
    if (control.vibrato !== null) vibrato = control.vibrato
  }
  return { ...track, expression, brightness, vibrato }
}
function hybridEnabledForExport(source: NonNullable<ReturnType<typeof nativeHybridForInstrument>>, quality: ScoreExportQuality, mode: HybridExportMode) {
  if (mode === "none" || quality === "preview") return false
  return quality !== "master" || hybridSourceMasterApproved(source)
}
function decodedFloatBytes(buffers: ReadonlyMap<string, AudioBuffer>) {
  let bytes = 0
  for (const buffer of buffers.values()) bytes += buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
  return bytes
}

export async function preflightNativeSamplePacks(value: unknown, packUrl?: string, signal?: AbortSignal): Promise<NativeSamplePackPreflight> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return { ready: true, items: [], missing: [] }
  const groups = nativeModuleGroupsForRecipe(recipe), trackById = new Map(recipe.plan.tracks.map(track => [track.id, track])), items: NativeSamplePackPreflightItem[] = []
  for (const group of groups) {
    assertNotAborted(signal)
    const instruments = [...new Set(group.trackIds.map(id => trackById.get(id)?.instrument).filter((value): value is string => Boolean(value)))]
    const url = modulePackUrlFor(recipe, group.moduleId, packUrl)
    try {
      const response = await fetch(url, { credentials: "include", signal, cache: "no-store" })
      if (!response.ok) { items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "missing", message: `HTTP ${response.status}` }); continue }
      const manifest = await response.json().catch(() => null) as { instrumentManifestId?: string } | null
      if (!manifest || manifest.instrumentManifestId !== group.moduleId) { items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "invalid", message: "El manifest publicado no corresponde al módulo solicitado" }); continue }
      items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "ready" })
    } catch (error) {
      if (signal?.aborted) throw error
      items.push({ moduleId: group.moduleId, trackIds: group.trackIds, instruments, status: "missing", message: error instanceof Error ? error.message : "No se pudo comprobar el banco" })
    }
  }
  const missing = items.filter(item => item.status !== "ready")
  return { ready: missing.length === 0, items, missing }
}

function premiumPreflightError(preflight: NativeSamplePackPreflight) {
  return [
    `Master premium requiere todos los bancos acústicos nativos. Faltan ${preflight.missing.length}.`,
    ...preflight.missing.map(item => `• ${item.instruments.join(", ") || "instrumento"} → module:${item.moduleId}`),
    "Abre Instrumentos premium e instala los bancos faltantes. Tloque no sustituirá silenciosamente estos instrumentos por síntesis base.",
  ].join("\n")
}
function strictNativePreflightError(preflight: NativeSamplePackPreflight) {
  return [
    "El render acústico estricto requiere los bancos nativos reales y no permite síntesis fallback.",
    ...preflight.missing.map(item => `• ${item.instruments.join(", ") || "instrumento"} → module:${item.moduleId}${item.message ? ` (${item.message})` : ""}`),
  ].join("\n")
}
async function renderBaseFallback(recipe: ReturnType<typeof linearScoreRecipeFor>, options: ScoreExportOptions) {
  if (recipe.version !== 2) throw new Error("La partitura no puede usar el fallback de síntesis base")
  const baseRecipe = { ...recipe, plan: { ...recipe.plan, moduleId: "builtin" } }
  const { renderTloqueScoreToWav } = await import("./ScoreExporter")
  return renderTloqueScoreToWav(baseRecipe, options)
}

export async function renderTloqueScoreWithNativeSamplePackToWav(
  value: unknown,
  packUrl: string,
  options: NativeSampleScoreExportOptions = {},
): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita paquetes nativos")
  if (recipe.plan.moduleId !== NATIVE_AUTO_MODULE_ID && !packUrl.startsWith("/api/audio/sample-packs/modules/")) throw new Error("El módulo nativo debe provenir del almacenamiento interno de Tloque")
  const profile = nativeSampleQuality(recipe, options), hybridMode = options.hybridMode ?? "quality"
  assertNotAborted(options.signal); options.onProgress?.(0.01)
  const preflight = await preflightNativeSamplePacks(recipe, packUrl, options.signal)
  if (!preflight.ready) {
    if (profile.quality === "master") throw new Error(premiumPreflightError(preflight))
    if (options.strictNativeSources) throw new Error(strictNativePreflightError(preflight))
    options.onProgress?.(0)
    return renderBaseFallback(recipe, options)
  }
  if (profile.quality === "master") {
    const readiness = await assessNativePremiumReadiness(recipe, options.signal)
    if (!readiness.ready) throw new Error(premiumReadinessError(readiness))
  }

  options.onProgress?.(0.03)
  const decodeContext = new OfflineAudioContext(2, 1, profile.sampleRate), decodedByUrl = new Map<string, AudioBuffer>(), loaded: LoadedOfflinePlan[] = [], groups = nativeModuleGroupsForRecipe(recipe)
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index], decodePlayer = new NativeSamplePackPlayer(decodeContext, decodedByUrl), url = modulePackUrlFor(recipe, group.moduleId, packUrl)
    let pack
    try { pack = await decodePlayer.loadPack(url) }
    catch (error) {
      if (options.strictNativeSources) throw new Error(`El banco nativo ${group.moduleId} dejó de estar disponible durante el render: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    if (pack.instrumentManifestId !== group.moduleId) throw new Error(`El paquete nativo ${group.moduleId} no corresponde al módulo solicitado`)
    const plan = buildNativeSampleScorePlan(recipeForNativeModule(recipe, group), pack), decoded = await decodePlayer.preload(plan.zones)
    plan.zones.forEach((zone, i) => { const buffer = decoded[i]; if (buffer) decodedByUrl.set(zone.sampleUrl, buffer) })
    loaded.push({ moduleId: group.moduleId, plan })
    if (decodedFloatBytes(decodedByUrl) > MAX_OFFLINE_TOTAL_FLOAT_BYTES) throw new Error("Las muestras decodificadas exceden la memoria segura del navegador móvil; reduce instrumentos o exporta por movimientos")
    options.onProgress?.(0.04 + ((index + 1) / Math.max(1, groups.length)) * 0.08); assertNotAborted(options.signal)
  }

  let naturalEnd = recipe.plan.totalSeconds
  for (const { plan } of loaded) {
    for (const voice of plan.voices) if (voice.oneShot) { const physical = decodedByUrl.get(voice.sampleUrl)?.duration ?? 0; naturalEnd = Math.max(naturalEnd, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate)) }
    for (const voice of plan.auxiliaryVoices) { const physical = decodedByUrl.get(voice.sampleUrl)?.duration ?? 0; naturalEnd = Math.max(naturalEnd, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate)) }
  }
  const hybridTail = hybridMode === "none" || profile.quality === "preview" ? 0 : 7
  const durationSeconds = Math.max(recipe.plan.totalSeconds, naturalEnd) + Math.max(profile.tail, hybridTail), totalFrames = Math.ceil(durationSeconds * profile.sampleRate), floatBytes = totalFrames * 2 * Float32Array.BYTES_PER_ELEMENT
  if (floatBytes > MAX_OFFLINE_FLOAT_BYTES) throw new Error("La obra muestreada excede la memoria segura del navegador móvil; expórtala por movimientos")
  if (floatBytes + decodedFloatBytes(decodedByUrl) > MAX_OFFLINE_TOTAL_FLOAT_BYTES) throw new Error("El render y sus muestras exceden juntos la memoria segura del navegador móvil; expórtalo por movimientos")

  options.onProgress?.(0.20)
  const context = new OfflineAudioContext(2, totalFrames, profile.sampleRate), mix = createSampledMixMaster(context, 1); mix.output.connect(context.destination)
  const stage = createAcousticStage(context, mix.input), trackGain = new Map<string, GainNode>(), trackTone = new Map<string, BiquadFilterNode>(), trackNodes: AudioNode[] = [], recipeTrackById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const controlsByTrack = new Map<string, LinearScoreRecipeV2["plan"]["controls"]>()
  for (const track of recipe.plan.tracks) controlsByTrack.set(track.id, recipe.plan.controls.filter(control => control.trackId === track.id))
  for (const { plan } of loaded) for (const track of plan.tracks) {
    if (trackGain.has(track.id)) continue
    const gain = context.createGain(); gain.gain.value = track.gain
    const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = brightnessCutoff(track.brightness); tone.Q.value = 0.12
    trackNodes.push(gain, tone)
    const semanticTrack = recipeTrackById.get(track.id), stageInput = stage.createTrackInput(semanticTrack?.instrument ?? "unknown", track.pan)
    gain.connect(tone); tone.connect(stageInput); trackGain.set(track.id, gain); trackTone.set(track.id, tone)
  }
  for (const { plan } of loaded) for (const control of plan.controls) {
    const gain = trackGain.get(control.trackId), tone = trackTone.get(control.trackId), at = control.timeSeconds
    if (gain && control.gain !== null) { gain.gain.cancelScheduledValues(at); if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds); else gain.gain.setValueAtTime(control.gain, at) }
    if (tone && control.brightness !== null) { const cutoff = brightnessCutoff(control.brightness); tone.frequency.cancelScheduledValues(at); if (control.rampSeconds > 0) tone.frequency.exponentialRampToValueAtTime(cutoff, at + control.rampSeconds); else tone.frequency.setValueAtTime(cutoff, at) }
  }

  const scheduled: Promise<unknown>[] = []
  for (const { plan } of loaded) {
    const player = new NativeSamplePackPlayer(context, decodedByUrl), zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))
    for (const voice of plan.voices) {
      const destination = trackGain.get(voice.trackId), zone = zoneById.get(voice.zoneId)
      if (!destination || !zone) continue
      scheduled.push(player.playSelection({ zone, playbackRate: voice.playbackRate, gain: voice.sampleGain }, voice.startSeconds, voice.durationSeconds, destination, 0, voice.oneShot, voice.fadeInSeconds > 0 ? { fadeInSeconds: voice.fadeInSeconds } : undefined))
    }
    for (const auxiliary of plan.auxiliaryVoices) {
      const destination = trackGain.get(auxiliary.trackId), zone = zoneById.get(auxiliary.zoneId)
      if (!destination || !zone) continue
      scheduled.push(player.playSelection({ zone, playbackRate: auxiliary.playbackRate, gain: auxiliary.sampleGain }, auxiliary.startSeconds, auxiliary.durationSeconds, destination, 0, true, auxiliary.fadeOutSeconds > 0 ? { fadeOutSeconds: auxiliary.fadeOutSeconds } : undefined))
    }
  }

  const previousHybridEndByTrack = new Map<string, number>()
  for (const event of [...recipe.plan.events].sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    const track = recipeTrackById.get(event.trackId), destination = trackGain.get(event.trackId)
    if (!track || !destination || !hybridEnabledForArticulation(track.instrument, event.articulation)) continue
    const source = nativeHybridForInstrument(track.instrument)
    if (!source || !hybridEnabledForExport(source, profile.quality, hybridMode)) continue
    const previousEnd = previousHybridEndByTrack.get(event.trackId), legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
    const controls = controlsByTrack.get(event.trackId) ?? [], effectiveTrack = trackAtEvent(track, controls, event.timeSeconds)
    for (const midi of event.notes) scheduleHybridPhysicalOverlay(context, source, { startAt: 0, event, track: effectiveTrack, midi, destination, controls, legatoFromPrevious })
    previousHybridEndByTrack.set(event.trackId, event.timeSeconds + event.durationSeconds)
  }

  await Promise.all(scheduled); assertNotAborted(options.signal); options.onProgress?.(0.28)
  const rendered = await context.startRendering(); options.onProgress?.(0.82)
  for (const node of trackNodes) node.disconnect(); stage.disconnect(); mix.disconnect()
  return encodeAudioBufferToWav(rendered, profile.bitDepth, progress => options.onProgress?.(0.82 + progress * 0.18))
}
