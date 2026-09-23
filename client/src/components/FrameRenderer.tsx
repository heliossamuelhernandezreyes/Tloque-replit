import { useMemo, type ReactNode } from "react"
import { sceneFromLegacy } from "@shared/frame-scene"
import FramePoster from "@/visual/FramePoster"

/** Stable gallery poster; all motion is confined to the shared 3D inspector. */
export default function FrameRenderer({ preset, shape, className, children, asOverlay }: {
  preset: any; shape?: "card" | "profile"; className?: string; nameText?: string; children?: ReactNode; asOverlay?: boolean
}) {
  const scene = useMemo(() => sceneFromLegacy(preset), [preset])
  return <FramePoster scene={scene} shape={shape ?? (preset?.runtimePreset?.target === "profile" ? "profile" : "card")} className={className} asOverlay={asOverlay}>{children}</FramePoster>
}
