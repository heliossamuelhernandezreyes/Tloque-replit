import { compileTloqueScore } from "../../shared/audio"
import { withOrchestralModule } from "../../shared/orchestral-synthesis"
import { renderTloqueScoreToWav } from "../../client/src/audio/ScoreExporter"
import { analyzeAudioBuffer } from "../../client/src/audio/AudioRenderAnalysis"
import { NativeSampleScoreEngine } from "../../client/src/audio/NativeSampleScoreEngine"
import { scheduleOrchestralSynthVoice } from "../../client/src/audio/OrchestralSynthVoice"
import { ORCHESTRAL_QA_SCORE } from "../fixtures/orchestral-score"

const output = document.querySelector<HTMLPreElement>("#result")!
const state = document.querySelector<HTMLParagraphElement>("#state")!
const listening = document.querySelector<HTMLDivElement>("#listening")!
const compile = (source: string) => {
  const result = compileTloqueScore(source)
  if (!result.ok || result.recipe.version !== 2) throw new Error(JSON.stringify(result))
  return result.recipe
}
const score = compile(ORCHESTRAL_QA_SCORE)
const engine = new NativeSampleScoreEngine((status, cue) => { state.textContent = `${status} · ${cue?.playbackTier ?? "—"}` })
const cue = { id: -500, title: "Prueba orquestal", sourceType: "score" as const, recipe: score, volume: 1, loop: false, crossfadeSeconds: 0.08, monitoring: "reference" as const }
document.querySelector("#play")!.addEventListener("click", () => { void engine.play(cue) })
document.querySelector("#pause")!.addEventListener("click", () => engine.pause())
document.querySelector("#resume")!.addEventListener("click", () => { void engine.resume() })
document.querySelector("#stop")!.addEventListener("click", () => engine.stop())
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }

async function hash(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("")
}
function stereo(buffer: AudioBuffer) {
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1)
  let side = 0, mid = 0, dot = 0, ll = 0, rr = 0
  for (let i = 0; i < left.length; i++) {
    side += (left[i] - right[i]) ** 2; mid += (left[i] + right[i]) ** 2
    dot += left[i] * right[i]; ll += left[i] ** 2; rr += right[i] ** 2
  }
  return { sideToMid: Math.sqrt(side / Math.max(mid, 1e-15)), correlation: dot / Math.sqrt(Math.max(ll * rr, 1e-15)) }
}

document.querySelector<HTMLButtonElement>("#render")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true; output.textContent = "Renderizando…"
  try {
    const started = performance.now(), results: Record<string, unknown> = {}, hashes: string[] = []
    for (const mode of ["studio-a", "studio-b", "preview", "master", "builtin"] as const) {
      output.textContent = `Renderizando ${mode}…`
      const quality = mode === "master" ? "master" : mode === "preview" ? "preview" : "studio"
      const value = mode === "builtin" ? compile(withOrchestralModule(ORCHESTRAL_QA_SCORE, "builtin")) : score
      const blob = await renderTloqueScoreToWav(value, { quality })
      const bytes = await blob.arrayBuffer()
      const context = new OfflineAudioContext(2, 1, quality === "master" ? 96_000 : quality === "preview" ? 32_000 : 48_000)
      const buffer = await context.decodeAudioData(bytes.slice(0))
      const analysis = analyzeAudioBuffer(buffer), spatial = stereo(buffer), digest = await hash(bytes)
      assert(analysis.clippedSampleCount === 0, `${mode}: clipping`)
      assert(Number.isFinite(analysis.integratedLufs), `${mode}: render silencioso/no finito`)
      results[mode] = { ...analysis, ...spatial, sha256: digest, bytes: blob.size }
      if (mode.startsWith("studio")) hashes.push(digest)
      if (mode === "studio-a" || mode === "builtin") {
        const label = document.createElement("p"); label.textContent = mode === "builtin" ? "Síntesis clásica — referencia" : "Nueva síntesis orquestal"
        const player = document.createElement("audio"); player.controls = true; player.src = URL.createObjectURL(blob)
        listening.append(label, player)
      }
    }
    assert(hashes[0] === hashes[1], "Los renders repetidos no son idénticos")
    const profiles: Record<string, unknown> = {}
    for (const instrument of ["strings.violin", "strings.violin-section", "woodwinds.flute", "woodwinds.clarinet", "brass.trumpet", "brass.horn", "piano.grand", "strings.harp", "keys.celesta", "percussion.marimba"]) {
      const context = new OfflineAudioContext(2, 48_000 * 4, 48_000)
      const track = { ...score.plan.tracks[0], instrument, gain: 0.5, vibrato: 0.25 }
      scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0.1, durationSeconds: 1.5, notes: [60], velocity: 0.6 }, track)
      const buffer = await context.startRendering(), analysis = analyzeAudioBuffer(buffer)
      assert(analysis.clippedSampleCount === 0 && Number.isFinite(analysis.integratedLufs), `${instrument}: voz inválida`)
      profiles[instrument] = { peak: analysis.peakLinear, lufs: analysis.integratedLufs }
    }
    output.textContent = JSON.stringify({ status: "PASS", identical: hashes[0] === hashes[1], milliseconds: Math.round(performance.now() - started), results, profiles }, null, 2)
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.stack : String(error)}` }
  finally { button.disabled = false }
})
