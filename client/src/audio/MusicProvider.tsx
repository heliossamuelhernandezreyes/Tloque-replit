import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { type MusicCue, type MusicState } from "./MusicEngine"
import { useSettings } from "@/context/SettingsContext"
import type { MusicBrainScoreV1 } from "@shared/music-brain"

type HybridMusicEngine = import("./HybridMusicEngine").HybridMusicEngine

let hybridEngineModule: Promise<typeof import("./HybridMusicEngine")> | null = null

function loadHybridEngine() {
  hybridEngineModule ||= import("./HybridMusicEngine")
  return hybridEngineModule
}

interface MusicContextValue {
  state: MusicState
  cue: MusicCue | null
  playCue: (cue: MusicCue | null) => void
  toggle: () => void
  duck: (active: boolean) => void
  loadNarrativeScore: (score: MusicBrainScoreV1 | null) => void
  direct: (intensity: number, silence: boolean, transitionSeconds: number, regionId?: string) => void
  stop: () => void
}

const MusicContext = createContext<MusicContextValue | null>(null)

export function MusicProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [state, setState] = useState<MusicState>("idle")
  const [cue, setCue] = useState<MusicCue | null>(null)
  const engineRef = useRef<HybridMusicEngine | null>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const desiredCueRef = useRef<MusicCue | null>(null)
  const narrativeScoreRef = useRef<MusicBrainScoreV1 | null>(null)
  const directionRef = useRef({ intensity: 0, silence: false, seconds: 1, regionId: undefined as string | undefined })
  const duckedRef = useRef(false)
  const volumeRef = useRef(settings.musicVolume)

  const ensureEngine = useCallback(async (): Promise<HybridMusicEngine | null> => {
    if (engineRef.current) return engineRef.current
    const { HybridMusicEngine } = await loadHybridEngine()
    if (!mountedRef.current) return null
    if (engineRef.current) return engineRef.current
    const engine = new HybridMusicEngine((nextState, nextCue) => {
      if (!mountedRef.current) return
      setState(nextState)
      setCue(nextCue)
    })
    engine.setMasterVolume(volumeRef.current)
    engine.setDucked(duckedRef.current)
    engine.setNarrativeScore(narrativeScoreRef.current)
    const direction = directionRef.current
    engine.setNarrativeDirection(direction.intensity, direction.silence, direction.seconds, direction.regionId)
    engineRef.current = engine
    return engine
  }, [])

  // Descarga el código pesado después del arranque, pero no construye ningún
  // AudioContext. La creación y reproducción siguen ocurriendo bajo el gesto
  // explícito del lector.
  useEffect(() => {
    const preload = () => { void loadHybridEngine().catch(() => undefined) }
    const idleWindow = window as any
    if (typeof idleWindow.requestIdleCallback === "function") {
      const id = idleWindow.requestIdleCallback(preload, { timeout: 4_000 })
      return () => idleWindow.cancelIdleCallback(id)
    }
    const id = globalThis.setTimeout(preload, 1_500)
    return () => globalThis.clearTimeout(id)
  }, [])

  useEffect(() => {
    volumeRef.current = settings.musicVolume
    engineRef.current?.setMasterVolume(settings.musicVolume)
  }, [settings.musicVolume])

  useEffect(() => {
    if (!settings.musicEnabled) engineRef.current?.pause()
  }, [settings.musicEnabled])

  useEffect(() => () => {
    mountedRef.current = false
    generationRef.current += 1
    engineRef.current?.dispose()
    engineRef.current = null
  }, [])

  const playCue = useCallback((next: MusicCue | null) => {
    desiredCueRef.current = next
    const generation = ++generationRef.current
    if (!next) {
      engineRef.current?.stop()
      return
    }
    // Se invoca desde un gesto real del usuario en el lector/editor. Llamar al
    // motor aquí conserva ese gesto para desbloquear Web Audio en móvil.
    void ensureEngine().then(engine => {
      if (engine && generation === generationRef.current) return engine.play(next)
    }).catch(() => {
      if (mountedRef.current && generation === generationRef.current) setState("error")
    })
  }, [ensureEngine])

  const toggle = useCallback(() => {
    if (!settings.musicEnabled) return
    if (state === "playing" || state === "crossfading" || state === "loading") {
      engineRef.current?.pause()
    } else if (cue) {
      const generation = generationRef.current
      void ensureEngine().then(engine => {
        if (!engine || generation !== generationRef.current) return
        return engineRef.current === engine ? engine.resume() : engine.play(cue)
      }).catch(() => setState("error"))
    }
  }, [cue, ensureEngine, settings.musicEnabled, state])

  const duck = useCallback((active: boolean) => {
    duckedRef.current = active
    engineRef.current?.setDucked(active)
  }, [])
  const loadNarrativeScore = useCallback((score: MusicBrainScoreV1 | null) => {
    narrativeScoreRef.current = score
    engineRef.current?.setNarrativeScore(score)
  }, [])
  const direct = useCallback((intensity: number, silence: boolean, seconds: number, regionId?: string) => {
    directionRef.current = { intensity, silence, seconds, regionId }
    engineRef.current?.setNarrativeDirection(intensity, silence, seconds, regionId)
  }, [])
  const stop = useCallback(() => {
    desiredCueRef.current = null
    generationRef.current += 1
    engineRef.current?.stop()
  }, [])

  return (
    <MusicContext.Provider value={{ state, cue, playCue, toggle, duck, loadNarrativeScore, direct, stop }}>
      {children}
    </MusicContext.Provider>
  )
}

export function useMusic() {
  const value = useContext(MusicContext)
  if (!value) throw new Error("useMusic debe usarse dentro de MusicProvider")
  return value
}
