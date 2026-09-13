/** Named, bounded curves shared by cards and frames. No executable expressions. */
export const MOTION_EASES = {
  smooth: "Suave · sin rebote",
  cinematic: "Cinemática · arranque y llegada lentos",
  "ease-in": "Aceleración",
  "ease-out": "Frenado",
  linear: "Lineal",
  hold: "Mantener hasta la siguiente clave",
} as const
export type MotionEase = keyof typeof MOTION_EASES
export function easeMotion(progress: number, ease: MotionEase) {
  const t = Math.max(0, Math.min(1, progress))
  if (ease === "hold") return t === 1 ? 1 : 0
  if (ease === "cinematic") return t * t * t * (t * (t * 6 - 15) + 10)
  if (ease === "ease-in") return t * t * t
  if (ease === "ease-out") return 1 - (1 - t) ** 3
  return ease === "smooth" ? t * t * (3 - 2 * t) : t
}
