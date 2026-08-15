// Reglas de la biblioteca offline gratuita.
// Clásicos, libros propios y libros DESBLOQUEADOS (token) no cuentan.

// Cuántos libros de OTROS autores puede guardar offline el usuario gratis.
export const FREE_SAVE_LIMIT = 4

// Libros desbloqueados con token (sincronizados desde la nube).
export function getUnlockedSet(): Set<string> {
  try {
    const raw = localStorage.getItem("novareads_unlocked")
    return new Set(raw ? (JSON.parse(raw) as any[]).map(String) : [])
  } catch { return new Set() }
}

// ¿Este libro cuenta para el límite gratuito?
export function countsTowardLimit(b: any, userId?: number | null): boolean {
  if (!b) return false
  if (b.isClassic) return false                                    // clásicos: libres
  if (userId && b.authorId && b.authorId === userId) return false  // propios: libres
  if (getUnlockedSet().has(String(b.id))) return false             // token: desbloqueado
  return true
}

// ¿Cuántos libros con límite hay ya guardados?
export function countLimitedSaved(savedList: any[], userId?: number | null): number {
  return (savedList || []).filter(b => countsTowardLimit(b, userId)).length
}
