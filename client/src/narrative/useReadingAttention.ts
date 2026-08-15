import { useEffect, useRef, useState } from "react"
import { estimateReadingAttention, type AttentionEstimate } from "@shared/attention"

const DEFAULT_ATTENTION: AttentionEstimate = { paragraphIndex: 0, progress: 0, confidence: 0 }

function savedBand(): number {
  try {
    const value = Number(localStorage.getItem("tloque_attention_band"))
    return Number.isFinite(value) ? Math.min(0.75, Math.max(0.2, value)) : 0.42
  } catch {
    return 0.42
  }
}

export function useReadingAttention(chapterKey: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [estimate, setEstimate] = useState<AttentionEstimate>(DEFAULT_ATTENTION)

  useEffect(() => {
    setEstimate(DEFAULT_ATTENTION)
    let raf = 0
    let lastY = 0
    let lastAt = performance.now()

    const measure = () => {
      raf = 0
      const now = performance.now()
      const elapsed = Math.max(16, now - lastAt)
      const scroller = containerRef.current?.closest(".overflow-y-auto") as HTMLElement | null
      const scrollY = scroller?.scrollTop ?? window.scrollY
      const velocity = ((scrollY - lastY) / elapsed) * 1_000
      lastY = scrollY
      lastAt = now
      const nodes = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-tloque-paragraph]") ?? [])
      const next = estimateReadingAttention({
        paragraphs: nodes.map((node, index) => {
          const rect = node.getBoundingClientRect()
          return { index, top: rect.top, bottom: rect.bottom }
        }),
        viewportHeight: window.innerHeight,
        attentionBand: savedBand(),
        scrollVelocity: velocity,
      })
      setEstimate(current => (
        current.paragraphIndex === next.paragraphIndex && Math.abs(current.confidence - next.confidence) < 0.04
          ? current
          : next
      ))
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure) }
    const settle = window.setTimeout(measure, 120)
    measure()
    document.addEventListener("scroll", schedule, { capture: true, passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.clearTimeout(settle)
      cancelAnimationFrame(raf)
      document.removeEventListener("scroll", schedule, true)
      window.removeEventListener("resize", schedule)
    }
  }, [chapterKey])

  return { containerRef, attention: estimate }
}
