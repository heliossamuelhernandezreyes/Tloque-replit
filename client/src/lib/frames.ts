// Marcos del avatar. Los "base" están disponibles para todos.
// Los "special" se desbloquean (por ahora solo admins) — la lógica de
// desbloqueo por género/logro llegará cuando exista el seguimiento de lectura.

export interface FrameDef {
  id:    string
  label: string
  group: "base" | "special"
  ring:  string        // fondo CSS del aro
  glow?: string        // color del resplandor
}

export const FRAMES: FrameDef[] = [
  // Base — para todos
  { id: "",        label: "Sin marco", group: "base", ring: "transparent" },
  { id: "silver",  label: "Plata",     group: "base", ring: "linear-gradient(135deg,#e8e8ec,#a0a0a8,#d8d8dc)", glow: "rgba(200,200,210,0.40)" },
  { id: "purple",  label: "Amatista",  group: "base", ring: "linear-gradient(135deg,#b98fd9,#7d4fb0,#a374cc)", glow: "rgba(150,90,200,0.45)" },
  { id: "crimson", label: "Carmesí",   group: "base", ring: "linear-gradient(135deg,#e08a8a,#b04545,#d06a6a)", glow: "rgba(200,80,80,0.45)" },
  { id: "azure",   label: "Azur",      group: "base", ring: "linear-gradient(135deg,#8fb8e0,#4f7db0,#74a0cc)", glow: "rgba(90,140,200,0.45)" },
  { id: "emerald", label: "Esmeralda", group: "base", ring: "linear-gradient(135deg,#8fd9a8,#4fb070,#74cc92)", glow: "rgba(90,200,130,0.40)" },

  // Especiales — se ganan (por ahora solo admins)
  { id: "metallic", label: "Metal líquido", group: "special", ring: "conic-gradient(from 0deg,#d8d8dc,#8a8a92,#f4f4f8,#9a9aa2,#c8c8d0,#8a8a92,#d8d8dc)", glow: "rgba(220,220,230,0.50)" },
  { id: "cosmic",   label: "Halo cósmico",  group: "special", ring: "conic-gradient(from 0deg,#7d4fb0,#4f7db0,#b98fd9,#5f9fd0,#9d6fd0,#7d4fb0)", glow: "rgba(120,90,210,0.55)" },
  { id: "oldgold",  label: "Oro viejo",     group: "special", ring: "linear-gradient(135deg,#c9a857,#8a6d2f,#e0c878,#9a7d3f,#c9a857)", glow: "rgba(180,140,70,0.45)" },
]

export function getFrame(id?: string | null): FrameDef | undefined {
  if (!id) return undefined
  return FRAMES.find(f => f.id === id)
}
