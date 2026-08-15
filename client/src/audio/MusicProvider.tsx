import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { MusicEngine, type MusicCue, type MusicState } from "./MusicEngine"
import { useSettings } from "@/context/SettingsContext"

interface MusicContextValue {
  state: MusicState
  cue: MusicCue | null
  playCue: (cue: MusicCue | null) => void
  toggle: () => void
  duck: (active: boolean) => void
  direct: (intensity: number, silence: boolean, transitionSeconds: number) => void
  stop: () => void
}

const MusicContext = createContext<MusicContextValue | null>(null)

export function MusicProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [state, setState] = useState<MusicState>("idle")
  const [cue, setCue] = useState<MusicCue | null>(null)
  const engineRef = useRef<MusicEngine | null>(null)
  if (!engineRef.current && typeof window !== "undefined") {
    engineRef.current = new MusicEngine((nextState, nextCue) => {
      setState(nextState)
      setCue(nextCue)
    })
  }

  useEffect(() => {
    engineRef.current?.setMasterVolume(settings.musicVolume)
  }, [settings.musicVolume])

  useEffect(() => {
    if (!settings.musicEnabled) {
      engineRef.current?.pause()
    } else if (cue) {
      void engineRef.current?.play(cue)
    }
  }, [cue?.id, cue?.url, cue?.loop, cue?.volume, cue?.crossfadeSeconds, settings.musicEnabled])

  useEffect(() => () => engineRef.current?.dispose(), [])

  const playCue = useCallback((next: MusicCue | null) => {
    if (!next) {
      engineRef.current?.stop()
      return
    }
    setCue(next)
  }, [])

  const toggle = useCallback(() => {
    if (!settings.musicEnabled) return
    if (state === "playing" || state === "crossfading" || state === "loading") {
      engineRef.current?.pause()
    } else if (cue) {
      void engineRef.current?.resume()
    }
  }, [cue, settings.musicEnabled, state])

  const duck = useCallback((active: boolean) => engineRef.current?.setDucked(active), [])
  const direct = useCallback((intensity: number, silence: boolean, seconds: number) => {
    engineRef.current?.setNarrativeDirection(intensity, silence, seconds)
  }, [])
  const stop = useCallback(() => engineRef.current?.stop(), [])

  return (
    <MusicContext.Provider value={{ state, cue, playCue, toggle, duck, direct, stop }}>
      {children}
    </MusicContext.Provider>
  )
}

export function useMusic() {
  const value = useContext(MusicContext)
  if (!value) throw new Error("useMusic debe usarse dentro de MusicProvider")
  return value
}
