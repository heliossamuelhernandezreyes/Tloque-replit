import { useCallback, useState } from "react"
import type { MusicCue, MusicState } from "../../client/src/audio/MusicEngine"

// Explicit test adapters only, aliased by composer-browser-qa.mjs.
// No authentication bypass or fake playback is shipped in the application.
export function useAuth() { return { isAdmin: true, isLoading: false } }
export function useSoundFX() { return { reloadManifest: async () => undefined, preview: () => undefined } }
export function useMusic() {
  const [state, setState] = useState<MusicState>("idle")
  const [cue, setCue] = useState<MusicCue | null>(null)
  const stop = useCallback(() => { setState("idle"); setCue(null) }, [])
  const playCue = useCallback((next: MusicCue | null) => { setCue(next); setState(next ? "playing" : "idle") }, [])
  return { state, cue, stop, playCue }
}
