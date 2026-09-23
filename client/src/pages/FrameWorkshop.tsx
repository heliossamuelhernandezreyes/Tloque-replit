import { useAuth } from "@/hooks/useAuth"
import FrameStudio from "@/visual/FrameStudio"

export default function FrameWorkshop() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <p role="status" className="p-8 text-zinc-400">Cargando taller…</p>
  if (!user?.capabilities?.manageFrames) return <p className="p-8 text-zinc-400">El taller de marcos requiere acceso de administración.</p>
  return <FrameStudio/>
}
