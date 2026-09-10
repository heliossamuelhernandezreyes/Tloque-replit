import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef, useState } from "react"
import { PMREMGenerator, type WebGLRenderTarget } from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { visualDpr, visualViewport, type visualBudget } from "@shared/visual-experience"
import type { VisualEntry, VisualOptions } from "./VisualEngine"
import { createVisualScene, sceneKey, type VisualScene } from "./scenes"

type Budget = ReturnType<typeof visualBudget>
function Compositor({ entries, budget, onFailure, onDprChange }: { entries: VisualEntry[]; budget: Budget; onFailure: () => void; onDprChange: (dpr: number) => void }) {
  const { gl, invalidate, size } = useThree()
  const resources = useRef(new Map<string, { key: string; scene: VisualScene; entry: VisualEntry; options: VisualOptions; textureEdge: number }>())
  const environment = useRef<WebGLRenderTarget | null>(null)
  const last = useRef(0)
  const slow = useRef(0)
  const degraded = useRef(false)
  const initialDpr = useRef(1)
  useEffect(() => {
    const generator = new PMREMGenerator(gl), room = new RoomEnvironment()
    try { environment.current = generator.fromScene(room, .04); invalidate() }
    catch { onFailure() }
    finally { generator.dispose(); room.dispose() }
    const previousError = gl.debug.onShaderError
    gl.debug.onShaderError = () => onFailure()
    return () => { gl.debug.onShaderError = previousError; environment.current?.dispose(); environment.current = null }
  }, [gl, invalidate, onFailure])
  useEffect(() => {
    // Fullscreen transparent backing store is bounded even on high-DPI phones.
    const dpr = visualDpr(size.width, size.height, devicePixelRatio || 1, budget.dpr)
    initialDpr.current = dpr; onDprChange(dpr); degraded.current = false; slow.current = 0
  }, [size.width, size.height, budget.dpr, onDprChange])
  useEffect(() => {
    let raf = 0, previous = 0
    const draw = (now: number) => {
      if (now - previous >= 1000 / budget.fps - 1) { previous = now; invalidate() }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    gl.domElement.addEventListener("webglcontextlost", lost)
    return () => { cancelAnimationFrame(raf); gl.domElement.removeEventListener("webglcontextlost", lost) }
  }, [gl, invalidate, budget.fps, onFailure])
  useEffect(() => {
    const active = new Set(entries.map(entry => entry.id))
    for (const [id, resource] of resources.current) if (!active.has(id)) { resource.entry.ready(false); resource.scene.dispose(); resources.current.delete(id) }
  }, [entries])
  useEffect(() => () => { resources.current.forEach(resource => { resource.entry.ready(false); resource.scene.dispose() }); resources.current.clear() }, [])

  useFrame(({ clock }) => {
    if (!environment.current) return
    const now = clock.elapsedTime
    const dt = Math.min(0.05, last.current ? now - last.current : 1 / 30)
    last.current = now
    gl.autoClear = false
    gl.setScissorTest(false); gl.setClearColor(0x000000, 0); gl.clear(true, true, true)
    gl.setScissorTest(true)
    const started = performance.now()
    try {
      // Higher-priority art (the dock) composites last when slots overlap.
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        const rect = entry.element.getBoundingClientRect()
        const crop = visualViewport(rect, size.width, size.height)
        if (!entry.element.isConnected || !crop) { entry.ready(false); continue }
        let resource = resources.current.get(entry.id)
        const key = resource?.options === entry.options.current && resource.textureEdge === budget.maxTextureEdge ? resource.key : `${budget.maxTextureEdge}:${sceneKey(entry.options.current)}`
        if (!resource || resource.key !== key) {
          resource?.scene.dispose(); entry.ready(false)
          resource = { key, scene: createVisualScene(entry.options.current, budget.maxTextureEdge, environment.current?.texture), entry, options: entry.options.current, textureEdge: budget.maxTextureEdge }
          resources.current.set(entry.id, resource)
        }
        resource.options = entry.options.current
        gl.setViewport(...crop.viewport)
        gl.setScissor(...crop.scissor)
        gl.clear(false, true, true)
        resource.scene.update(now, dt, rect.width / rect.height, entry.pointer.current, entry.options.current)
        if (resource.scene.ready()) {
          resource.scene.render(gl)
          entry.ready(true)
        } else entry.ready(false)
      }
    } catch (error) {
      console.warn("Tloque visual: restaurando presentación esencial", error)
      onFailure()
    } finally { gl.setScissorTest(false) }
    // Conservative one-way quality reduction for sustained CPU submission pressure.
    slow.current = performance.now() - started > 12 ? slow.current + 1 : Math.max(0, slow.current - 1)
    if (slow.current > 25 && !degraded.current) { degraded.current = true; onDprChange(initialDpr.current * .75) }
  }, 1)
  return null
}

export default function VisualSurface(props: { entries: VisualEntry[]; budget: Budget; onFailure: () => void }) {
  // Canvas reconfigures on React updates: retain adaptive DPR in its owner.
  const [dpr, setDpr] = useState(() => visualDpr(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, props.budget.dpr))
  // R3F mounts Canvas.fallback as normal DOM children even with WebGL support.
  // It must be inert; real initialization failures are handled by VisualBoundary.
  return <Canvas frameloop="demand" dpr={dpr} gl={{ alpha: true, antialias: true, stencil: true, powerPreference: "low-power", preserveDrawingBuffer: false }}
    fallback={null} style={{ pointerEvents: "none" }}>
    <Compositor {...props} onDprChange={setDpr} />
  </Canvas>
}
