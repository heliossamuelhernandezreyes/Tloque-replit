import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Pause, Play, RotateCcw } from "lucide-react"
import { readFrameScene, type SceneTransport } from "@shared/frame-scene"
import type { CardScene } from "@shared/card-scene-runtime"
import VisualSlot, { useVisualEngine } from "./VisualEngine"
import FrameRenderer from "@/components/FrameRenderer"
import "./frame-studio.css"
import { portalView, wrapCardAngle, type CardOrientation } from "@shared/portal-card"
import "./portal-card.css"
import { resolvePortalCard } from "@shared/portal-card-recipe"

export function useInspection(duration: number) {
  const stage = useRef<HTMLDivElement>(null)
  const reveal = useCallback(() => { requestAnimationFrame(() => stage.current?.scrollIntoView({ block: "nearest" })) }, [])
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
  return { transport, time, playing, play, pause, seek, reset, stage, reveal }
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

export function InspectionStage({ pkg, shape = "card", images, cardScene, color, priority = 100, controller, children, onReadyChange }: {
  pkg: unknown; shape?: "card" | "profile"; images?: string[]; cardScene?: CardScene; color?: string; priority?: number; controller: InspectionController; children?: ReactNode; onReadyChange?: (ready: boolean) => void
}) {
  const engine = useVisualEngine()
  const [ready, setReady] = useState(false)
  const [issue, setIssue] = useState(""), [retry, setRetry] = useState(0)
  const recipe = cardScene?.portalCard ? resolvePortalCard(cardScene.portalCard,pkg) : readFrameScene(pkg)?.portalCard
  const orientation = useRef<CardOrientation>({ yaw: 0, pitch: 0, zoom: 1 })
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [front, setFront] = useState(true), [zoom, setZoom] = useState(1)
  const turn = (yaw: number, pitch: number) => { orientation.current = { ...orientation.current, yaw: wrapCardAngle(yaw), pitch: wrapCardAngle(pitch) }; setFront(portalView(orientation.current).front) }
  const onReady = useCallback((value: boolean) => { setReady(value); onReadyChange?.(value) }, [onReadyChange])
  useEffect(() => { if (!ready) controller.pause() }, [ready, controller.pause])
  return <div ref={controller.stage} className={`tq-inspection-stage ${recipe ? "tq-portal-inspection" : ""}`}>
    <div className="tq-stage-meta"><span>SCENE / 02</span><span data-testid="scene-status">{ready ? "3D EN TIEMPO REAL" : engine.failed ? "VISTA ESENCIAL · GPU NO DISPONIBLE" : engine.enabled ? "PREPARANDO 3D" : "VISTA ESENCIAL"}</span></div>
    <div className={recipe ? "tq-card-turntable" : undefined} tabIndex={recipe ? 0 : undefined} role={recipe ? "group" : undefined} aria-label={recipe ? "Girar tarjeta 360 grados. Arrastra o usa las flechas; Inicio vuelve al frente." : undefined} data-card-face={front ? "front" : "back"}
      onPointerDown={recipe ? e => { if (e.button !== 0) return; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) } : undefined}
      onPointerMove={recipe ? e => { const previous = drag.current; if (!previous || previous.id !== e.pointerId) return; turn(orientation.current.yaw + (e.clientX - previous.x) * .75, orientation.current.pitch - (e.clientY - previous.y) * .6); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY } } : undefined}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={recipe ? e => { const step=e.shiftKey?45:15; if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home"].includes(e.key)) return; e.preventDefault(); turn(e.key === "Home" ? 0 : orientation.current.yaw+(e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), e.key === "Home" ? 0 : orientation.current.pitch+(e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0)) } : undefined}>
    <VisualSlot priority={priority} options={{ kind: cardScene || images?.some(Boolean) ? "portal" : "frame", frame: pkg, shape, images, cardScene, color, transport: controller.transport, orientation: recipe ? orientation : undefined, retry, onAssetIssue: setIssue }} interactive={!recipe} label={cardScene ? "Escena de la tarjeta" : "Escena del marco"} onReadyChange={onReady} className="tq-cinematic-slot">
      <div className="tq-stage-poster">{recipe && !front ? <div className="tq-portal-back-poster" style={{ background: recipe.back.color, color: recipe.back.ink, borderColor: recipe.frame.color }}><strong>{recipe.back.title}</strong><p>{recipe.back.inscription}</p><small>{recipe.back.signature}</small></div> : cardScene ? children : <FrameRenderer preset={pkg} shape={shape}>{children}</FrameRenderer>}</div>
    </VisualSlot>
    </div>
    {recipe && <div className="tq-turn-controls"><button type="button" aria-pressed={front} onClick={() => turn(0, 0)}>Frente</button><button type="button" aria-pressed={!front} onClick={() => turn(180, 0)}>Reverso</button><label>Zoom<input type="range" aria-label="Zoom de inspección" min={.8} max={1.15} step={.01} value={zoom} onChange={e => { const value=Number(e.target.value); setZoom(value); orientation.current.zoom=value }}/></label></div>}
    <div className="tq-stage-hint">{ready ? recipe ? "Arrastra para girar 360° · flechas para inclinar · Inicio para centrar" : "Mueve el puntero o desliza sobre el marco para explorar" : "La vista esencial conserva el diseño sin animaciones 3D"}</div>
    {issue && <p className="tq-asset-status" role="status">{issue}{issue.startsWith("No se pudo") && <button type="button" onClick={() => { setIssue(""); setRetry(n => n + 1) }}>Reintentar vista</button>}</p>}
  </div>
}

export default function FrameInspection({ pkg, shape, images, cardScene, color, children, priority, onReadyChange }: { priority?: number; pkg: unknown; shape?: "card" | "profile"; images?: string[]; cardScene?: CardScene; color?: string; children?: ReactNode; onReadyChange?: (ready: boolean) => void }) {
  const scene = readFrameScene(pkg)
  const duration = cardScene?.duration ?? scene?.animation.duration ?? 8
  const controller = useInspection(duration)
  const [ready, setReady] = useState(false)
  const onReady = useCallback((value: boolean) => { setReady(value); onReadyChange?.(value) }, [onReadyChange])
  return <div className="tq-inspection">
    <InspectionStage priority={priority} pkg={pkg} shape={shape} images={images} cardScene={cardScene} color={color} controller={controller} onReadyChange={onReady}>{children}</InspectionStage>
    {(scene || cardScene) && <InspectionControls controller={controller} duration={duration} disabled={!ready}/>}
  </div>
}
