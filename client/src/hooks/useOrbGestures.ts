import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"

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
  const firedShort     = useRef(false)  // saber si holdShort ya se ejecutó
  const startPoint     = useRef({ x: 0, y: 0 })

  function clearTimers() {
    if (timerShort.current) { clearTimeout(timerShort.current); timerShort.current = null }
    if (timerLong.current)  { clearTimeout(timerLong.current);  timerLong.current  = null }
  }

  function onDown(event?: ReactPointerEvent) {
    startTime.current = Date.now()
    didHold.current   = false
    firedShort.current = false
    startPoint.current = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }

    // 650 ms se siente deliberado sin convertir cada acceso en una espera.
    timerShort.current = setTimeout(() => {
      didHold.current    = true
      firedShort.current = true
      timerShort.current = null
      holdShort?.()
      // El timer largo sigue corriendo para los 3s
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
    if (Math.hypot(dx, dy) > 12 && !didHold.current) clearTimers()
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

  useEffect(() => clearTimers, [])

  return {
    onPointerDown:   onDown,
    onPointerMove:   onMove,
    onPointerUp:     onUp,
    onPointerLeave:  onCancel,
    onPointerCancel: onCancel,
  }
}
