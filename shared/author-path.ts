export function authorPath(author: { author?: string; authorId?: number | null; isClassic?: boolean }) {
  if (author.authorId) return `/author/id/${author.authorId}`
  return `/author/classic/${encodeURIComponent(author.author || "")}`
}
