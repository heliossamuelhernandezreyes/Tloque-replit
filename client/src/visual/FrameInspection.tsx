import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Pause, Play, RotateCcw } from "lucide-react"
import { readFrameScene, type SceneTransport } from "@shared/frame-scene"
import VisualSlot, { useVisualEngine } from "./VisualEngine"
import FrameRenderer from "@/components/FrameRenderer"
import "./frame-studio.css"

export function useInspection(duration: number) {
  const transport = useRef<SceneTransport>({ time: 0, mode: "idle" })
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false)
  const pause = useCallback(() => { setTime(transport.current.time); setPlaying(false) }, [])
  const seek = useCallback((value: number) => {
    transport.current = { time: Math.max(0, Math.min(duration, value)), mode: "inspection" }
    setTime(transport.current.time); setPlaying(false)
  }, [duration])
  const play = useCallback(() => {
    if (transport.current.time >= duration) transport.current.time = 0
    transport.current.mode = "inspection"; setPlaying(true)
  }, [duration])
  const reset = useCallback(() => { transport.current = { time: 0, mode: "idle" }; setTime(0); setPlaying(false) }, [])
  useEffect(() => {
    if (!playing) return
    let raf = 0, previous = performance.now(), lastPaint = previous
    const tick = (now: number) => {
      transport.current.time = Math.min(duration, transport.current.time + Math.max(0, now - previous) / 1000)
      previous = now
      if (now - lastPaint >= 80 || transport.current.time === duration) { setTime(transport.current.time); lastPaint = now }
      if (transport.current.time === duration) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    const visibility = () => { if (document.hidden) pause() }
    document.addEventListener("visibilitychange", visibility)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", visibility) }
  }, [playing, duration, pause])
  useEffect(() => { if (transport.current.time > duration) seek(duration) }, [duration, seek])
  return { transport, time, playing, play, pause, seek, reset }
}
export type InspectionController = ReturnType<typeof useInspection>

export function InspectionControls({ controller, duration, disabled = false }: { controller: InspectionController; duration: number; disabled?: boolean }) {
  return <div className="tq-inspection-controls">
    <button type="button" aria-label={controller.playing ? "Pausar inspección" : "Reproducir inspección"} disabled={disabled} onClick={controller.playing ? controller.pause : controller.play}><>{controller.playing ? <Pause size={16}/> : <Play size={16}/>}</></button>
    <button type="button" aria-label="Volver al reposo" onClick={controller.reset}><RotateCcw size={15}/></button>
    <input type="range" aria-label="Tiempo de inspección" min={0} max={duration} step={.01} value={controller.time} disabled={disabled} onChange={event => controller.seek(Number(event.target.value))}/>
    <output>{controller.time.toFixed(1)} <span>/ {duration.toFixed(1)} s</span></output>
  </div>
}

export function InspectionStage({ pkg, shape = "card", images, priority = 100, controller, children, onReadyChange }: {
  pkg: unknown; shape?: "card" | "profile"; images?: string[]; priority?: number; controller: InspectionController; children?: ReactNode; onReadyChange?: (ready: boolean) => void
}) {
  const engine = useVisualEngine()
  const [ready, setReady] = useState(false)
  const onReady = useCallback((value: boolean) => { setReady(value); onReadyChange?.(value) }, [onReadyChange])
  useEffect(() => { if (!ready) controller.pause() }, [ready, controller.pause])
  return <div className="tq-inspection-stage">
    <div className="tq-stage-meta"><span>SCENE / 02</span><span data-testid="scene-status">{ready ? "3D EN TIEMPO REAL" : engine.failed ? "VISTA ESENCIAL · GPU NO DISPONIBLE" : engine.enabled ? "PREPARANDO 3D" : "VISTA ESENCIAL"}</span></div>
    <VisualSlot priority={priority} options={{ kind: images?.length ? "portal" : "frame", frame: pkg, shape, images, transport: controller.transport }} interactive label="Escena del marco" onReadyChange={onReady} className="tq-cinematic-slot">
      <div className="tq-stage-poster"><FrameRenderer preset={pkg} shape={shape}>{children}</FrameRenderer></div>
    </VisualSlot>
    <div className="tq-stage-hint">{ready ? "Mueve el puntero o desliza sobre el marco para explorar" : "La vista esencial conserva el diseño sin animaciones 3D"}</div>
  </div>
}

export default function FrameInspection({ pkg, shape, images, children, onReadyChange }: { pkg: unknown; shape?: "card" | "profile"; images?: string[]; children?: ReactNode; onReadyChange?: (ready: boolean) => void }) {
  const scene = readFrameScene(pkg)
  const controller = useInspection(scene?.animation.duration ?? 8)
  const [ready, setReady] = useState(false)
  const onReady = useCallback((value: boolean) => { setReady(value); onReadyChange?.(value) }, [onReadyChange])
  return <div className="tq-inspection">
    <InspectionStage pkg={pkg} shape={shape} images={images} controller={controller} onReadyChange={onReady}>{children}</InspectionStage>
    {scene && <InspectionControls controller={controller} duration={scene.animation.duration} disabled={!ready}/>}
  </div>
}
