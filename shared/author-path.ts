export function authorPath(author: { author?: string; authorId?: number | null; isClassic?: boolean }) {
  if (author.authorId) return `/author/id/${author.authorId}`
  return `/author/classic/${encodeURIComponent(author.author || "")}`
}

export function isValidAuthorName(name: string): boolean {
  return name.trim().length > 0 && name.length <= 300 && !/[\u0000-\u001f\u007f]/.test(name)
}
