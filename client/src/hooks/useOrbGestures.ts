import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"

interface OrbGestureOptions {
  tap?:       () => void
  holdShort?: () => void   // 650 ms
  holdLong?:  () => void   // 1.4 s — se activa AUNQUE holdShort ya haya disparado
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
  const cancelled      = useRef(false)
  const startPoint     = useRef({ x: 0, y: 0 })

  function clearTimers() {
    if (timerShort.current) { clearTimeout(timerShort.current); timerShort.current = null }
    if (timerLong.current)  { clearTimeout(timerLong.current);  timerLong.current  = null }
  }

  function onDown(event?: ReactPointerEvent) {
    clearTimers()
    startTime.current = Date.now()
    didHold.current   = false
    cancelled.current = false
    startPoint.current = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }
    try { event?.currentTarget.setPointerCapture(event.pointerId) } catch { /* no disponible */ }

    // 650 ms se siente deliberado sin convertir cada acceso en una espera.
    timerShort.current = setTimeout(() => {
      didHold.current    = true
      timerShort.current = null
      holdShort?.()
      // El timer largo sigue corriendo hasta completar el gesto largo.
    }, 650)

    // El gesto largo sigue siendo distinto, pero cabe en una interacción ágil.
    timerLong.current = setTimeout(() => {
      didHold.current   = true
      timerLong.current = null
      holdLong?.()
    }, 1400)
  }

  function onMove(event: ReactPointerEvent) {
    const dx = event.clientX - startPoint.current.x
    const dy = event.clientY - startPoint.current.y
    if (Math.hypot(dx, dy) > 14) {
      cancelled.current = true
      clearTimers()
    }
  }

  function onUp(event?: ReactPointerEvent) {
    clearTimers()
    try {
      if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch { /* no disponible */ }

    if (didHold.current || cancelled.current) return

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

  function onCancel(event?: ReactPointerEvent) {
    clearTimers()
    didHold.current    = false
    cancelled.current  = true
    try {
      if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch { /* no disponible */ }
  }

  function onLeave(event: ReactPointerEvent) {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) return
    } catch { /* continuar con cancelación segura */ }
    onCancel(event)
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return
    event.preventDefault()
    tap?.()
  }

  useEffect(() => clearTimers, [])

  return {
    onPointerDown:   onDown,
    onPointerMove:   onMove,
    onPointerUp:     onUp,
    onPointerLeave:  onLeave,
    onPointerCancel: onCancel,
    onKeyDown,
  }
}
