import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { VIOLIN_WINTER_STRESS_INSTRUMENT, compileViolinWinterStressV1 } from "@shared/violin-winter-stress"
import { preferredNativeModuleForInstrument } from "./NativeAutoModule"
import { preflightNativeSamplePacks, renderTloqueScoreWithNativeSamplePackToWav } from "./NativeSampleScoreExporter"

export interface ViolinWinterStressResult {
  sampled: Blob
  hybrid: Blob
  durationSeconds: number
  moduleId: string
  engineVersion: string
}

export async function runViolinWinterStressV1(source: NativeHybridSource, signal?: AbortSignal): Promise<ViolinWinterStressResult> {
  if (source.instrumentId !== VIOLIN_WINTER_STRESS_INSTRUMENT) {
    throw new Error(`Winter Stress v1 sólo certifica ${VIOLIN_WINTER_STRESS_INSTRUMENT}`)
  }
  if (source.physicalLayer !== "bowed-string-resonator") {
    throw new Error("Winter Stress v1 requiere la capa física de arco + cuerda")
  }

  const compiled = compileViolinWinterStressV1()
  if (!compiled.ok || compiled.recipe.version !== 2) {
    throw new Error(`No se pudo compilar Winter Stress v1: ${compiled.ok ? "versión inválida" : compiled.diagnostics.map(item => item.message).join(" · ")}`)
  }

  const recipe = compiled.recipe
  const moduleId = preferredNativeModuleForInstrument(source.instrumentId)
  if (!moduleId) throw new Error(`No existe sample base para ${source.instrumentId}`)

  const preflight = await preflightNativeSamplePacks(recipe, "/api/audio/sample-packs/modules/native-auto.json", signal)
  const violinItem = preflight.items.find(item => item.moduleId === moduleId)
  if (!preflight.ready || violinItem?.status !== "ready") {
    const detail = violinItem?.message ? ` (${violinItem.message})` : ""
    throw new Error(`Winter Stress cancelado: el banco real ${moduleId} no está listo${detail}. No se usará síntesis fallback.`)
  }

  const sampled = await renderTloqueScoreWithNativeSamplePackToWav(
    recipe,
    "/api/audio/sample-packs/modules/native-auto.json",
    { quality: "studio", signal, hybridMode: "none", strictNativeSources: true },
  )
  if (signal?.aborted) throw new DOMException("Winter Stress cancelado", "AbortError")
  const hybrid = await renderTloqueScoreWithNativeSamplePackToWav(
    recipe,
    "/api/audio/sample-packs/modules/native-auto.json",
    { quality: "studio", signal, hybridMode: "quality", strictNativeSources: true },
  )
  if (signal?.aborted) throw new DOMException("Winter Stress cancelado", "AbortError")

  return {
    sampled,
    hybrid,
    durationSeconds: recipe.plan.totalSeconds + 5,
    moduleId,
    engineVersion: source.engineVersion,
  }
}
