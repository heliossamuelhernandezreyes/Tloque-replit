/** Missing chapter totals are unknown, never fabricated percentages. */
export function readingProgress(chapter: number, total: number | undefined, completed = false): number | null {
  if (completed) return 100
  if (!Number.isInteger(total) || !total || total < 1 || !Number.isFinite(chapter)) return null
  return Math.min(100, Math.max(0, chapter) / total * 100)
}
