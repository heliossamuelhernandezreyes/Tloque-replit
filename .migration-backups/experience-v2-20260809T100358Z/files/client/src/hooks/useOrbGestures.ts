import { useRef } from "react"

interface OrbGestureOptions {
  tap?:       () => void
  holdShort?: () => void   // 1.5s
  holdLong?:  () => void   // 3s  — se activa AUNQUE holdShort ya haya disparado
  doubleTap?: () => void
}

export default function useOrbGestures({
  tap,
  holdShort,
  holdLong,
  doubleTap,
}: OrbGestureOptions) {

  const startTime      = useRef<number>(0)
  const lastTap        = useRef<number>(0)
  const timerShort     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerLong      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didHold        = useRef(false)
  const firedShort     = useRef(false)  // saber si holdShort ya se ejecutó

  function clearTimers() {
    if (timerShort.current) { clearTimeout(timerShort.current); timerShort.current = null }
    if (timerLong.current)  { clearTimeout(timerLong.current);  timerLong.current  = null }
  }

  function onDown() {
    startTime.current = Date.now()
    didHold.current   = false
    firedShort.current = false

    // holdShort — 1.5s — NO cancela el timer largo
    timerShort.current = setTimeout(() => {
      didHold.current    = true
      firedShort.current = true
      timerShort.current = null
      holdShort?.()
      // El timer largo sigue corriendo para los 3s
    }, 1500)

    // holdLong — 3s — se dispara incluso si holdShort ya corrió
    timerLong.current = setTimeout(() => {
      didHold.current   = true
      timerLong.current = null
      holdLong?.()
    }, 3000)
  }

  function onUp() {
    clearTimers()

    if (didHold.current) return

    const duration = Date.now() - startTime.current
    if (duration >= 300) return

    const now = Date.now()
    if (now - lastTap.current < 280) {
      lastTap.current = 0
      doubleTap?.()
      return
    }

    lastTap.current = now
    tap?.()
  }

  function onCancel() {
    clearTimers()
    didHold.current    = false
    firedShort.current = false
  }

  return {
    onPointerDown:   onDown,
    onPointerUp:     onUp,
    onPointerLeave:  onCancel,
    onPointerCancel: onCancel,
  }
}
