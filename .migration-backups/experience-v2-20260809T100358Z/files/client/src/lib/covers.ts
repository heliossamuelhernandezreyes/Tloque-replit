// ¿Qué portada le corresponde ver a este usuario?
// La PREMIUM es el regalo para quienes apoyaron la obra (token de apoyo
// o ejemplar reclamado) — y para su autor, que siempre ve su mejor vestido.
import { getUnlockedSet } from "./library"

export function hasPremiumAccess(book: any, userId?: number | null): boolean {
  if (!book) return false
  if (userId && book.authorId && book.authorId === userId) return true
  return getUnlockedSet().has(String(book.id))
}

// Portada a mostrar (premium si la desbloqueó y existe; si no, la normal)
export function coverFor(book: any, userId?: number | null): string {
  if (book?.premiumCoverUrl && hasPremiumAccess(book, userId)) return book.premiumCoverUrl
  return book?.coverUrl || ""
}

// ¿Está viendo el vestido premium? (para el distintivo ✦)
export function showingPremium(book: any, userId?: number | null): boolean {
  return !!book?.premiumCoverUrl && hasPremiumAccess(book, userId)
}

// Contraportada para el kit físico: premium si tiene acceso; si no, la normal
export function backCoverFor(book: any, userId?: number | null): string {
  if (book?.premiumBackUrl && hasPremiumAccess(book, userId)) return book.premiumBackUrl
  return book?.backCoverUrl || ""
}
