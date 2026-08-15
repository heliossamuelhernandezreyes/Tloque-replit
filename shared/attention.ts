export interface ParagraphBox {
  index: number
  top: number
  bottom: number
}

export interface AttentionEstimate {
  paragraphIndex: number
  progress: number
  confidence: number
}

export function estimateReadingAttention(input: {
  paragraphs: ParagraphBox[]
  viewportHeight: number
  attentionBand?: number
  scrollVelocity?: number
}): AttentionEstimate {
  const viewport = Math.max(1, input.viewportHeight)
  const band = Math.min(0.75, Math.max(0.2, input.attentionBand ?? 0.42))
  const target = viewport * band
  const ordered = input.paragraphs
    .filter(box => Number.isInteger(box.index) && Number.isFinite(box.top) && Number.isFinite(box.bottom))
    .sort((a, b) => a.index - b.index)
  if (ordered.length === 0) return { paragraphIndex: 0, progress: 0, confidence: 0 }

  let winner = ordered[0]
  let winnerDistance = Number.POSITIVE_INFINITY
  for (const box of ordered) {
    const distance = target < box.top ? box.top - target
      : target > box.bottom ? target - box.bottom
        : 0
    if (distance < winnerDistance) {
      winner = box
      winnerDistance = distance
    }
  }

  const spatial = Math.max(0, 1 - winnerDistance / (viewport * 0.3))
  const velocity = Math.abs(Number.isFinite(input.scrollVelocity) ? input.scrollVelocity! : 0)
  const stability = Math.max(0.25, 1 - velocity / 1_400)
  const count = Math.max(1, ordered[ordered.length - 1].index + 1)
  return {
    paragraphIndex: winner.index,
    progress: count <= 1 ? 0 : winner.index / (count - 1),
    confidence: Math.min(1, spatial * stability),
  }
}
