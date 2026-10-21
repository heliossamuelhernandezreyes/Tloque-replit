import type { GlyphPath, TextOp } from "./model"

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
const cache = new WeakMap<GlyphPath, Bounds>()
// Bezier control points bound the entire curve. A conservative hull also
// prevents clipping a swash outside its advance width inside a PDF Form.
export function glyphBounds(path: GlyphPath): Bounds {
  const cached = cache.get(path)
  if (cached) return cached
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const command of path.commands) for (let i = 0; i < command.c.length; i += 2) {
    minX = Math.min(minX, command.c[i]); maxX = Math.max(maxX, command.c[i])
    minY = Math.min(minY, command.c[i + 1]); maxY = Math.max(maxY, command.c[i + 1])
  }
  const bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  cache.set(path, bounds); return bounds
}
export function inkOutside(op: TextOp, width: number, height: number): boolean {
  return (op.ink || []).some(item => {
    let x1: number, x2: number, y1: number, y2: number
    if (item.kind === "image") { x1 = item.x; x2 = item.x + item.width; y1 = item.y; y2 = item.y + item.height }
    else {
      const b = glyphBounds(item.path)
      x1 = item.x + b.minX * item.scale; x2 = item.x + b.maxX * item.scale
      y1 = item.y - b.maxY * item.scale; y2 = item.y - b.minY * item.scale
    }
    return ![x1, x2, y1, y2].every(Number.isFinite) || x1 < -.01 || x2 > width + .01 || y1 < -.01 || y2 > height + .01
  })
}
