import { useCallback, useEffect, useRef, useState } from "react"
import type { LinearScoreRecipe } from "@shared/audio"
import { AUTO_COMPILE_MAX_CHARACTERS, type ScoreDiagnostic } from "@/lib/tloqueComposer"

export function useScoreValidation(source: string, onCompiled: (recipe: LinearScoreRecipe) => void) {
  const [state, setState] = useState<"empty" | "waiting" | "compiling" | "valid" | "invalid" | "manual">("empty")
  const [diagnostics, setDiagnostics] = useState<ScoreDiagnostic[]>([])
  const [message, setMessage] = useState("")
  const latest = useRef(source)
  const callback = useRef(onCompiled)
  const generation = useRef(0)
  latest.current = source
  callback.current = onCompiled

  const run = useCallback(async () => {
    const input = latest.current
    if (!input.trim()) return
    const token = ++generation.current
    setState("compiling"); setDiagnostics([]); setMessage("")
    try {
      const { compileTloqueScore } = await import("@shared/audio")
      if (token !== generation.current || input !== latest.current) return
      const result = compileTloqueScore(input)
      if (token !== generation.current || input !== latest.current) return
      if (result.ok) { setState("valid"); callback.current(result.recipe) }
      else { setState("invalid"); setDiagnostics(result.diagnostics) }
    } catch (error) {
      if (token !== generation.current || input !== latest.current) return
      setState("invalid"); setMessage(error instanceof Error ? error.message : "No se pudo validar la partitura")
    }
  }, [])

  useEffect(() => {
    generation.current++
    setDiagnostics([]); setMessage("")
    if (!source.trim()) { setState("empty"); return }
    if (source.length > AUTO_COMPILE_MAX_CHARACTERS) { setState("manual"); return }
    setState("waiting")
    const timer = window.setTimeout(() => { void run() }, 650)
    return () => { window.clearTimeout(timer); generation.current++ }
  }, [source, run])

  useEffect(() => () => { generation.current++ }, [])
  return { state, diagnostics, message, run }
}
