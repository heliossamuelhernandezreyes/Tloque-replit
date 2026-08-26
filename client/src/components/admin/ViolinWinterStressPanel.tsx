import { useState } from "react"
import { Flame, Loader2, Pause, Play, Snowflake } from "lucide-react"
import { hybridBlindAssignment, type HybridAbBlindAssignment, type HybridAbBlindSide, type HybridAbBlindVote } from "@shared/hybrid-ab-blind"
import { NATIVE_HYBRID_SOURCES } from "@shared/native-hybrid-source"
import { VIOLIN_WINTER_STRESS_SEGMENTS } from "@shared/violin-winter-stress"
import { runViolinWinterStressV1 } from "@/audio/ViolinWinterStressRunner"

function randomBlindAssignment() {
  try {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return hybridBlindAssignment((value[0] & 1) === 1)
  } catch {
    return hybridBlindAssignment(Math.random() >= 0.5)
  }
}

export function ViolinWinterStressPanel() {
  const source = NATIVE_HYBRID_SOURCES.find(item => item.instrumentId === "strings.violin")
  const [urls, setUrls] = useState<{ sampled: string; hybrid: string } | null>(null)
  const [assignment, setAssignment] = useState<HybridAbBlindAssignment | null>(null)
  const [vote, setVote] = useState<HybridAbBlindVote | null>(null)
  const [running, setRunning] = useState(false)
  const [playing, setPlaying] = useState<HybridAbBlindSide | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)
  const [error, setError] = useState("")

  if (!source) return null

  async function run() {
    if (running) return
    setRunning(true)
    setError("")
    try {
      audio?.pause()
      setAudio(null)
      setPlaying(null)
      const result = await runViolinWinterStressV1(source)
      if (urls) {
        URL.revokeObjectURL(urls.sampled)
        URL.revokeObjectURL(urls.hybrid)
      }
      setUrls({ sampled: URL.createObjectURL(result.sampled), hybrid: URL.createObjectURL(result.hybrid) })
      setAssignment(randomBlindAssignment())
      setVote(null)
      setDurationSeconds(result.durationSeconds)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo ejecutar Winter Stress v1")
    } finally {
      setRunning(false)
    }
  }

  function play(side: HybridAbBlindSide) {
    const actual = assignment?.[side]
    const url = actual && urls ? urls[actual] : null
    if (!url) return
    audio?.pause()
    if (playing === side) {
      setPlaying(null)
      setAudio(null)
      return
    }
    const next = new Audio(url)
    next.onended = () => { setPlaying(null); setAudio(null) }
    void next.play()
    setAudio(next)
    setPlaying(side)
  }

  return <div className="mt-5 rounded-2xl border border-sky-200/10 bg-sky-200/[.025] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-2 text-xs font-medium text-sky-100/75"><Snowflake className="h-3.5 w-3.5" /> Winter Stress v1 · strings.violin</p>
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-white/35">Prueba musical extrema, original y determinista: ataques repetidos, repetición tipo tremolo, legato, saltos de registro, p→ff y agudo fuerte. Complementa la matriz 3×3; nunca puede aprobar Master por sí sola.</p>
      </div>
      <span className="rounded-full bg-sky-300/[.06] px-2 py-1 text-[10px] text-sky-100/55">{source.engineVersion}</span>
    </div>

    <div className="mt-3 flex flex-wrap gap-1.5">{VIOLIN_WINTER_STRESS_SEGMENTS.map(segment => <span key={segment.id} className="rounded-full border border-white/[.06] px-2 py-1 text-[9px] text-white/35">{segment.label}</span>)}</div>

    <div className="mt-4 flex flex-wrap gap-2">
      <button onClick={() => void run()} disabled={running} className="inline-flex items-center gap-2 rounded-lg border border-sky-300/15 bg-sky-300/[.06] px-3 py-2 text-xs text-sky-100/75 disabled:opacity-45">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flame className="h-3.5 w-3.5" />}{running ? "Renderizando estrés…" : urls ? "Nueva corrida Winter" : "Generar Winter A/B"}</button>
      {urls && assignment && <>
        <button onClick={() => play("A")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === "A" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Escuchar A</button>
        <button onClick={() => play("B")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55">{playing === "B" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Escuchar B</button>
      </>}
    </div>

    {durationSeconds !== null && <p className="mt-2 text-[10px] text-white/25">Render comparable · {durationSeconds.toFixed(1)} s · misma partitura, seed, sample base y mezcla; sólo cambia la capa física.</p>}
    {error && <p className="mt-3 rounded-lg border border-red-300/10 bg-red-300/[.04] px-3 py-2 text-[10px] text-red-100/65">{error}</p>}

    {assignment && !vote && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[10px] text-white/30">Preferencia musical ciega:</span>{(["A", "B", "tie"] as const).map(value => <button key={value} onClick={() => setVote(value)} className="rounded-md bg-white/[.04] px-2 py-1 text-[10px] text-white/50 hover:bg-white/[.09]">{value === "tie" ? "Empate" : `Prefiero ${value}`}</button>)}</div>}

    {assignment && vote && <div className="mt-3 rounded-xl border border-white/[.06] bg-black/15 px-3 py-2 text-[10px] leading-5 text-white/45">
      <p>Voto Winter bloqueado: {vote === "tie" ? "empate" : `preferiste ${vote}`}.</p>
      <p>Revelación: A = {assignment.A} · B = {assignment.B}.</p>
      <p className={vote !== "tie" && assignment[vote] === "hybrid" ? "text-emerald-200/65" : "text-amber-100/55"}>{vote === "tie" ? "Sin ganador perceptual en esta corrida." : assignment[vote] === "hybrid" ? "Hybrid ganó el stress test perceptual. Aún necesita 3×3 PASS y promoción/versionado para Master." : "Sample ganó el stress test perceptual. No promover Hybrid con esta evidencia."}</p>
    </div>}
  </div>
}
