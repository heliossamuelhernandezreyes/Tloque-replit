import { Component, Suspense, createContext, lazy, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useLocation } from "wouter"
import { useSettings } from "@/context/SettingsContext"
import { useAuth } from "@/hooks/useAuth"
import { allowedOrbTheme, selectVisualEntries, visualBudget, type OrbTheme, type VisualQuality } from "@shared/visual-experience"
import "./visual-experience.css"

export interface VisualOptions {
  kind: "orb" | "portal" | "frame" | "reveal" | "book"
  color?: string
  theme?: OrbTheme
  active?: boolean
  pressed?: boolean
  pulse?: boolean
  images?: string[]
  frame?: unknown
  shape?: "card" | "profile"
}
export interface VisualEntry {
  id: string
  element: HTMLElement
  options: { current: VisualOptions }
  pointer: { current: { x: number; y: number } }
  priority: number
  ready: (value: boolean) => void
}
interface EngineContext {
  enabled: boolean
  quality: VisualQuality
  theme: OrbTheme
  failed: boolean
  register: (entry: VisualEntry) => () => void
  holdOverlay: (priority: number) => () => void
}
const Context = createContext<EngineContext>({ enabled: false, quality: "essential", theme: "singularity", failed: false, register: () => () => {}, holdOverlay: () => () => {} })
export const useVisualEngine = () => useContext(Context)
const Surface = lazy(() => import("./VisualSurface"))

class VisualBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? null : this.props.children }
}

export function VisualEngineProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const { user } = useAuth()
  const [location] = useLocation()
  const [entries, setEntries] = useState<VisualEntry[]>([])
  const [overlays, setOverlays] = useState<Array<{ priority: number }>>([])
  const [visible, setVisible] = useState(document.visibilityState !== "hidden")
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  const [failed, setFailed] = useState(false)
  const [expiryTick, tickExpiry] = useState(0)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const changeMotion = () => setSystemReduced(media.matches)
    const changeVisibility = () => setVisible(document.visibilityState !== "hidden")
    media.addEventListener("change", changeMotion)
    document.addEventListener("visibilitychange", changeVisibility)
    return () => { media.removeEventListener("change", changeMotion); document.removeEventListener("visibilitychange", changeVisibility) }
  }, [])
  // Expire an already-open cosmetic session too; a stored preference is not an entitlement.
  useEffect(() => {
    const expiry = user?.visualEntitlements?.expiresAt
    if (!expiry || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()) return
    const timeout = setTimeout(() => tickExpiry(n => n + 1), Math.min(2_147_000_000, Math.max(0, Date.parse(expiry) - Date.now()) + 30))
    return () => clearTimeout(timeout)
  }, [user?.visualEntitlements, visible, expiryTick])
  const budget = visualBudget(settings.visualQuality, {
    reducedMotion: settings.reduceMotion || systemReduced,
    saveData: (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    cores: navigator.hardwareConcurrency,
  })
  const enabled = budget.enabled && visible && !failed && !/^\/(read|editor)(\/|$)/.test(location)
  const theme = allowedOrbTheme(settings.orbTheme, user?.visualEntitlements)
  const register = useCallback((entry: VisualEntry) => {
    setEntries(current => [...current.filter(item => item.id !== entry.id), entry])
    return () => { entry.ready(false); setEntries(current => current.filter(item => item.id !== entry.id)) }
  }, [])
  const onFailure = useCallback(() => setFailed(true), [])
  const holdOverlay = useCallback((priority: number) => {
    const token = { priority }; setOverlays(current => [...current, token])
    return () => setOverlays(current => current.filter(item => item !== token))
  }, [])
  const context = useMemo(() => ({ enabled, quality: settings.visualQuality, theme, failed, register, holdOverlay }), [enabled, settings.visualQuality, theme, failed, register, holdOverlay])
  const { priority, selected } = selectVisualEntries(entries, overlays, budget.maxViews)
  useEffect(() => {
    const ids = new Set(selected.map(entry => entry.id))
    entries.forEach(entry => { if (!enabled || !ids.has(entry.id)) entry.ready(false) })
  }, [entries, enabled, priority])
  return <Context.Provider value={context}>
    {children}
    {enabled && selected.length > 0 && createPortal(
      <div className="tq-visual-surface" style={{ zIndex: priority >= 100 ? 915 : priority >= 80 ? 510 : 110 }} aria-hidden="true" data-visual-engine="three-r3f">
        <VisualBoundary onFailure={onFailure}>
          <Suspense fallback={null}><Surface entries={selected} budget={budget} onFailure={onFailure} /></Suspense>
        </VisualBoundary>
      </div>, document.body,
    )}
  </Context.Provider>
}

/** DOM owns semantics and gestures; only the illustration is replaced after a successful draw. */
export default function VisualSlot({ options, priority = 10, className = "", children, interactive = false, label, onReadyChange }: {
  options: VisualOptions; priority?: number; className?: string; children: ReactNode; interactive?: boolean; label?: string; onReadyChange?: (ready: boolean) => void
}) {
  const engine = useVisualEngine()
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const optionsRef = useRef(options); optionsRef.current = options
  const pointer = useRef({ x: 0, y: 0 })
  const [inView, setInView] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => { onReadyChange?.(ready && engine.enabled) }, [ready, engine.enabled, onReadyChange])
  useEffect(() => {
    if (!root.current) return
    if (typeof IntersectionObserver === "undefined") { setInView(true); return }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.01 })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!engine.enabled || !inView || !root.current) { setReady(false); return }
    return engine.register({ id, element: root.current, options: optionsRef, pointer, priority, ready: setReady })
  }, [engine.enabled, engine.register, id, inView, priority])
  return <div ref={root} className={`tq-visual-slot ${className}`} data-visual-ready={ready && engine.enabled ? "true" : "false"}
    role={label ? "img" : undefined} aria-label={label}
    onPointerMove={interactive ? event => {
      const rect = event.currentTarget.getBoundingClientRect()
      pointer.current = { x: Math.max(-1, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1)), y: Math.max(-1, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1)) }
    } : undefined}
    onPointerLeave={() => { pointer.current = { x: 0, y: 0 } }} onPointerCancel={() => { pointer.current = { x: 0, y: 0 } }}>
    <div className="tq-visual-fallback">{children}</div>
  </div>
}
