import type { CSSProperties } from "react"
import { BookOpen } from "lucide-react"
import VisualSlot from "./VisualEngine"
import { visualColor } from "@shared/visual-experience"

export default function BookPresentation({ title, cover, color }: { title: string; cover?: string; color: string }) {
  const accent = visualColor(color)
  return <div className="tq-book-stage" style={{ "--book-light": `${accent}60` } as CSSProperties}>
    <VisualSlot interactive className="tq-book-visual" label={title}
      options={{ kind: "book", color: accent, images: cover ? [cover] : [] }}>
      <div className="tq-book-fallback">
        {cover ? <img src={cover} alt="" decoding="async" /> : <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center text-zinc-200"><BookOpen /><span className="font-display text-xl">{title}</span></div>}
      </div>
    </VisualSlot>
  </div>
}
