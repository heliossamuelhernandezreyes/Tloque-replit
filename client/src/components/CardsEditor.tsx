import { useRef, useState } from "react"
import { motion } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, Pencil, Loader2, Heart, Droplets, BookPlus } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"
import { LayerUpload } from "@/components/LayerUpload"
import { MATERIALS, RARITY_ORDER, frameGradient, type Rarity } from "@/lib/rarities"
import CollectibleCard from "@/components/CollectibleCard"
import FrameRenderer from "@/components/FrameRenderer"
import { useFrames } from "@/hooks/useFrames"
import { useLocation } from "wouter"

interface Card {
  id: number; name: string; subtitle: string; description: string
  fx: any; unlock: "support" | "tinta"; priceTinta: number
}
interface Props {
  bookId: number | null                       // null = tarjetas SUELTAS (sin libro aún)
  gc:     { color: string; glow: string }
  assignTargets?: { id: number; title: string }[]   // libros propios (para asignar sueltas)
  onAssigned?: () => void
}

const EMPTY = {
  name: "", subtitle: "", description: "",
  unlock: "support" as "support" | "tinta", priceTinta: 5,
  layers: { back: "", mid: "", front: "" },
  rarity: "silver" as Rarity,
  frameId: null as number | null,
  layerFx: {
    back:  { effect: "none", intensity: 0.5 },
    mid:   { effect: "none", intensity: 0.5 },
    front: { effect: "none", intensity: 0.5 },
  } as Record<"back" | "mid" | "front", { effect: string; intensity: number }>,
}

// Editor de tarjetas coleccionables (solo el autor, máx 6 por obra).
// El arte usa el motor de capas: fondo obligatorio, media y frente
// opcionales — al inclinarse, cada capa se mueve a su profundidad.
export default function CardsEditor({ bookId, gc, assignTargets, onAssigned }: Props) {
  const isLoose = bookId == null
  const maxCards = isLoose ? 24 : 6
  const { usable } = useFrames()
  const myFrames = usable("card")
  const [, navigate] = useLocation()
  const { t } = useSettings()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<null | { id?: number }>(null)
  const [assigning, setAssigning] = useState<null | number>(null)   // cardId con selector abierto
  const [form, setForm] = useState(EMPTY)
  const backRef  = useRef<HTMLInputElement>(null)
  const midRef   = useRef<HTMLInputElement>(null)
  const frontRef = useRef<HTMLInputElement>(null)

  const { data } = useQuery<{ cards: Card[] }>({
    queryKey: ["/api/books/cards", bookId],
    queryFn: async () => {
      const url = isLoose ? "/api/cards/loose" : `/api/books/${bookId}/cards`
      const res = await fetch(url, { credentials: "include" })
      if (!res.ok) return { cards: [] }
      return res.json()
    },
  })
  const cards = data?.cards || []

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name, subtitle: form.subtitle, description: form.description,
        unlock: form.unlock, priceTinta: form.priceTinta,
        fx: { layers: form.layers, rarity: form.rarity, layerFx: form.layerFx, frameId: form.frameId },
      }
      const url    = editing?.id ? `/api/cards/${editing.id}`
                   : isLoose     ? "/api/cards"
                   : `/api/books/${bookId}/cards`
      const method = editing?.id ? "PUT" : "POST"
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message || "Error al guardar")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books/cards", bookId] })
      setEditing(null); setForm(EMPTY)
    },
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/cards/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error("Error al borrar")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/books/cards", bookId] }),
  })

  const assign = useMutation({
    mutationFn: async ({ cardId, toBookId }: { cardId: number; toBookId: number }) => {
      const res = await fetch(`/api/cards/${cardId}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ bookId: toBookId }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message || "Error al asignar")
      }
      return res.json()
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/books/cards", null] })
      queryClient.invalidateQueries({ queryKey: ["/api/books/cards", vars.toBookId] })
      setAssigning(null)
      onAssigned?.()
    },
  })

  function startEdit(card: Card) {
    setEditing({ id: card.id })
    setForm({
      name: card.name, subtitle: card.subtitle, description: card.description,
      unlock: card.unlock, priceTinta: card.priceTinta || 5,
      layers: {
        back:  card.fx?.layers?.back  || "",
        mid:   card.fx?.layers?.mid   || "",
        front: card.fx?.layers?.front || "",
      },
      rarity: (card.fx?.rarity || "silver") as Rarity,
      frameId: card.fx?.frameId ?? null,
      layerFx: {
        back:  card.fx?.layerFx?.back  || { effect: "none", intensity: 0.5 },
        mid:   card.fx?.layerFx?.mid   || { effect: "none", intensity: 0.5 },
        front: card.fx?.layerFx?.front || { effect: "none", intensity: 0.5 },
      },
    })
    // Llevar el formulario a la vista (si estaba abajo, que no pase inadvertido)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60)
  }

  const setLayer = (k: "back" | "mid" | "front", url: string) =>
    setForm(f => ({ ...f, layers: { ...f.layers, [k]: url } }))

  // Selector de efecto para UNA capa (efecto + intensidad).
  // Solo aparece si esa capa tiene imagen.
  function LayerEffectPicker({ which, label }: { which: "back" | "mid" | "front"; label: string }) {
    if (!form.layers[which]) return null
    const cur = form.layerFx[which]
    const setFx = (patch: Partial<{ effect: string; intensity: number }>) =>
      setForm(f => ({ ...f, layerFx: { ...f.layerFx, [which]: { ...f.layerFx[which], ...patch } } }))
    const EFFECTS: [string, string][] = [
      ["none", "—"], ["snow", "Nieve"], ["rain", "Lluvia"], ["rainGlass", "Gotas"],
      ["embers", "Brasas"], ["fire", "Fuego"], ["smoke", "Humo"], ["sparkle", "Destello"],
    ]
    return (
      <div className="ml-2 pl-2 mb-1" style={{ borderLeft: `1px solid ${gc.color}20` }}>
        <p className="text-[8px] font-sans mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</p>
        <div className="flex flex-wrap gap-1">
          {EFFECTS.map(([val, lbl]) => {
            const sel = cur.effect === val
            return (
              <button key={val} onClick={() => setFx({ effect: val })}
                className="text-[8px] font-sans px-1.5 py-1 rounded-md"
                style={{ background: sel ? `${gc.glow}25` : "rgba(255,255,255,0.03)",
                         color: sel ? gc.color : "rgba(255,255,255,0.45)",
                         border: `1px solid ${sel ? gc.color + "50" : "rgba(255,255,255,0.07)"}` }}>
                {lbl}
              </button>
            )
          })}
        </div>
        {cur.effect !== "none" && (
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={0} max={1} step={0.05} value={cur.intensity}
              onChange={e => setFx({ intensity: Number(e.target.value) })}
              className="flex-1" style={{ accentColor: gc.color }} />
            <span className="text-[8px] font-sans w-7 text-right" style={{ color: gc.color }}>
              {Math.round(cur.intensity * 100)}%
            </span>
          </div>
        )}
      </div>
    )
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
  }

  return (
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1 font-sans flex items-center gap-1">
        {isLoose ? t("looseCards") : "Tarjetas coleccionables"} 🃏
        <span className="text-[8px] px-1.5 py-0.5 rounded-full"
          style={{ background: `${gc.glow}15`, color: gc.color + "88" }}>
          {cards.length}/{maxCards}
        </span>
      </p>
      <p className="text-[9px] text-zinc-500 font-sans mb-2 leading-snug">
        Personajes o escenas de tu obra. Se obtienen al apoyarla o con Tinta a precio
        visible — nunca al azar. Con capas, la tarjeta cobra vida al inclinarse.
      </p>

      {/* Lista */}
      <div className="space-y-1.5 mb-2">
        {cards.map(card => (
          <div key={card.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {card.fx?.layers?.back && (
              <img src={card.fx.layers.back} alt="" loading="lazy"
                className="w-7 h-10 object-cover rounded-md shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-sans font-semibold text-white truncate">{card.name}</p>
              <p className="text-[9px] font-sans flex items-center gap-1"
                style={{ color: "rgba(255,255,255,0.45)" }}>
                {card.unlock === "tinta"
                  ? <><Droplets className="w-2.5 h-2.5" /> {card.priceTinta} Tinta</>
                  : <><Heart className="w-2.5 h-2.5" /> Al apoyar</>}
              </p>
            </div>
            {isLoose && (assignTargets?.length ?? 0) > 0 && (
              assigning === card.id ? (
                <select autoFocus defaultValue=""
                  onChange={e => { const v = Number(e.target.value); if (v) assign.mutate({ cardId: card.id, toBookId: v }) }}
                  onBlur={() => setAssigning(null)}
                  className="text-[9px] rounded-lg px-1.5 py-1.5 outline-none max-w-[110px]"
                  style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: `1px solid ${gc.color}50` }}>
                  <option value="" disabled>{t("assignToBook")}</option>
                  {assignTargets!.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              ) : (
                <button onClick={() => setAssigning(card.id)} title={t("assignToBook")}
                  className="p-1.5 rounded-lg" style={{ color: gc.color }}>
                  {assign.isPending && assigning === card.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <BookPlus className="w-3 h-3" />}
                </button>
              )
            )}
            <button onClick={() => startEdit(card)} className="p-1.5 rounded-lg"
              style={{ color: gc.color }}>
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => window.confirm(`¿Borrar la tarjeta "${card.name}"? También saldrá de las colecciones.`) && remove.mutate(card.id)}
              className="p-1.5 rounded-lg" style={{ color: "rgba(255,120,120,0.7)" }}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Nueva / Form */}
      {!editing && cards.length < maxCards && (
        <motion.button whileTap={{ scale: 0.97 }}
          onClick={() => { setForm(EMPTY); setEditing({}) }}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-sans"
          style={{ background: `${gc.glow}10`, color: gc.color, border: `1px dashed ${gc.color}40` }}>
          <Plus className="w-3.5 h-3.5" /> Nueva tarjeta
        </motion.button>
      )}

      {editing && (
        <div ref={formRef} className="rounded-xl p-3 space-y-2"
          style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${gc.color}30` }}>
          <input value={form.name} maxLength={40}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Nombre (ej. Hall)"
            className="w-full text-white text-xs outline-none rounded-lg px-3 py-2 font-sans"
            style={inputStyle} />
          <input value={form.subtitle} maxLength={60}
            onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))}
            placeholder={t("cardSubtitlePlaceholder")}
            className="w-full text-white text-xs outline-none rounded-lg px-3 py-2 font-sans"
            style={inputStyle} />
          <textarea value={form.description} maxLength={240} rows={2}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Texto de sabor (una cita, un rasgo…)"
            className="w-full text-white text-xs outline-none rounded-lg px-3 py-2 font-sans resize-none"
            style={inputStyle} />

          {/* Método de obtención — nunca al azar */}
          <div className="flex gap-1.5">
            <button onClick={() => setForm(f => ({ ...f, unlock: "support" }))}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-sans py-2 rounded-lg"
              style={{
                background: form.unlock === "support" ? `${gc.glow}20` : "rgba(255,255,255,0.03)",
                color: form.unlock === "support" ? gc.color : "rgba(255,255,255,0.5)",
                border: `1px solid ${form.unlock === "support" ? gc.color + "50" : "rgba(255,255,255,0.1)"}`,
              }}>
              <Heart className="w-3 h-3" /> Al apoyar
            </button>
            <button onClick={() => setForm(f => ({ ...f, unlock: "tinta" }))}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-sans py-2 rounded-lg"
              style={{
                background: form.unlock === "tinta" ? "rgba(201,168,87,0.15)" : "rgba(255,255,255,0.03)",
                color: form.unlock === "tinta" ? "#c9a857" : "rgba(255,255,255,0.5)",
                border: `1px solid ${form.unlock === "tinta" ? "#c9a85760" : "rgba(255,255,255,0.1)"}`,
              }}>
              <Droplets className="w-3 h-3" /> Con Tinta
            </button>
          </div>
          {form.unlock === "tinta" && (
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={100} value={form.priceTinta}
                onChange={e => setForm(f => ({ ...f, priceTinta: Number(e.target.value) }))}
                className="w-20 text-white text-xs outline-none rounded-lg px-3 py-2 font-sans"
                style={inputStyle} />
              <span className="text-[10px] font-sans" style={{ color: "rgba(255,255,255,0.5)" }}>
                Tinta (1–100) · el precio siempre visible
              </span>
            </div>
          )}

          {/* Capas del arte */}
          <LayerUpload label="Fondo (obligatorio)" url={form.layers.back} gc={gc}
            onUpload={u => setLayer("back", u)} inputRef={backRef} compact />
          <LayerEffectPicker which="back" label="Efecto tras el fondo" />
          <LayerUpload label="Capa media (opcional)" url={form.layers.mid} gc={gc}
            onUpload={u => setLayer("mid", u)} inputRef={midRef}
            hint="Se mueve al inclinar" compact />
          <LayerEffectPicker which="mid" label="Efecto en la capa media" />
          <LayerUpload label="Capa frontal (opcional)" url={form.layers.front} gc={gc}
            onUpload={u => setLayer("front", u)} inputRef={frontRef}
            hint="La más cercana, se mueve más" compact />
          <LayerEffectPicker which="front" label="Efecto al frente (lluvia en el vidrio…)" />

          {/* Rareza — material del marco */}
          <div className="pt-1">
            {/* ── MARCO DE LA GALERÍA ── */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] text-zinc-500 font-sans">{t("cardFrame")}</p>
                <button onClick={() => navigate("/marcos")}
                  className="text-[9px] font-sans" style={{ color: gc.color }}>
                  {t("getMoreFrames")} →
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1"
                style={{ scrollbarWidth: "none" }}>
                {/* Sin marco: usa el anillo de rareza */}
                <button onClick={() => setForm(f => ({ ...f, frameId: null }))}
                  className="flex-shrink-0 rounded-lg flex flex-col items-center justify-center gap-1"
                  style={{
                    width: 54, height: 68,
                    background: form.frameId === null ? `${gc.glow}18` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${form.frameId === null ? gc.color + "70" : "rgba(255,255,255,0.08)"}`,
                  }}>
                  <span className="text-[13px]">◇</span>
                  <span className="text-[7px] font-sans" style={{ color: form.frameId === null ? gc.color : "rgba(255,255,255,0.4)" }}>
                    {t("rarityOnly")}
                  </span>
                </button>
                {myFrames.map(fr => (
                  <button key={fr.id} onClick={() => setForm(f => ({ ...f, frameId: fr.id }))}
                    title={fr.name}
                    className="flex-shrink-0 rounded-lg p-1 relative"
                    style={{
                      width: 54, height: 68,
                      background: form.frameId === fr.id ? `${gc.glow}18` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${form.frameId === fr.id ? gc.color + "70" : "rgba(255,255,255,0.08)"}`,
                    }}>
                    <div className="relative w-full h-full">
                      <div className="absolute inset-0 rounded-[3px]"
                        style={{ background: "radial-gradient(circle at 50% 35%, #33404e, #12161c)" }} />
                      <FrameRenderer preset={fr.pkg} shape="card" asOverlay />
                    </div>
                  </button>
                ))}
                {myFrames.length === 0 && (
                  <div className="flex items-center px-2">
                    <p className="text-[8.5px] text-zinc-600 font-sans leading-snug max-w-[150px]">
                      {t("noFramesYet")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <p className="text-[9px] text-zinc-500 font-sans mb-1.5">Rareza (material del marco)</p>
            <div className="grid grid-cols-4 gap-1.5">
              {RARITY_ORDER.map(r => {
                const m = MATERIALS[r]
                const sel = form.rarity === r
                return (
                  <button key={r}
                    onClick={() => setForm(f => ({ ...f, rarity: r }))}
                    title={m.label}
                    className="flex flex-col items-center gap-1 py-1.5 rounded-lg"
                    style={{ background: sel ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                             border: `1px solid ${sel ? m.base : "rgba(255,255,255,0.08)"}` }}>
                    <span className="w-6 h-6 rounded-full" style={{ background: frameGradient(m),
                      boxShadow: sel ? `0 0 8px ${m.glow}88` : "none" }} />
                    <span className="text-[7px] font-sans" style={{ color: sel ? m.base : "rgba(255,255,255,0.45)" }}>{m.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Previsualización EN VIVO */}
          {form.layers.back && (
            <div className="pt-2">
              <p className="text-[9px] text-zinc-500 font-sans mb-1.5 text-center">{t("cardPreviewHint")}</p>
              <div className="max-w-[160px] mx-auto">
                <CollectibleCard
                  preview
                  card={{
                    id: -1, name: form.name || "Nombre", subtitle: form.subtitle,
                    description: form.description, unlock: form.unlock, priceTinta: form.priceTinta,
                    owned: true,
                    fx: { layers: form.layers, rarity: form.rarity, layerFx: form.layerFx, frameId: form.frameId },
                  }}
                  accentColor={gc.color}
                  accentGlow={gc.glow}
                />
              </div>
            </div>
          )}

          {save.isError && (
            <p className="text-[10px] font-sans" style={{ color: "#e8a0a0" }}>
              {(save.error as Error)?.message}
            </p>
          )}
          <div className="flex gap-1.5">
            <motion.button whileTap={{ scale: 0.97 }}
              disabled={save.isPending || !form.name.trim() || !form.layers.back}
              onClick={() => save.mutate()}
              className="flex-1 py-2.5 rounded-lg text-[11px] font-sans font-semibold disabled:opacity-40"
              style={{ background: gc.color, color: "rgba(0,0,0,0.85)" }}>
              {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : (editing.id ? "Guardar cambios" : "Crear tarjeta")}
            </motion.button>
            <button onClick={() => { setEditing(null); setForm(EMPTY) }}
              className="px-3 py-2.5 rounded-lg text-[11px] font-sans"
              style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
