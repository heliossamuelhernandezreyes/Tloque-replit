import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpRight, Download, Upload, Undo2, Redo2, Save, Plus, Trash2, Sparkles } from "lucide-react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/useAuth"
import { createFrameScene, evaluateFrameScene, FRAME_CHANNELS, frameSceneSchema, packageFrameScene, readFrameScene, sceneFromLegacy, type FrameChannel, type FrameScene, type FrameTarget } from "@shared/frame-scene"
import { InspectionControls, InspectionStage, useInspection } from "./FrameInspection"
import FramePoster from "./FramePoster"
import "./frame-studio.css"

interface Draft { name: string; price: number; target: FrameTarget; scene: FrameScene }
interface SavedFrame { id: number; name: string; priceTinta: number; target: FrameTarget; pkg: unknown; visible?: boolean }
const templates = [{ id: "astral", name: "Atlas astral", note: "Órbitas · cristal · cosmos" }, { id: "reliquary", name: "Relicario solar", note: "Bronce · mecanismo · ámbar" }, { id: "bloom", name: "Flor nocturna", note: "Pétalos · rosa · bioluz" }] as const
const initialDraft = (): Draft => ({ name: "Atlas astral", price: 0, target: "both", scene: createFrameScene() })

function Slider({ label, value, min, max, step = .01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="tq-studio-field"><span>{label}<output>{Number(value.toFixed(2))}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/></label>
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return <label className="tq-color-field"><input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)}/><span>{label}<small>{value.toUpperCase()}</small></span></label>
}

export default function FrameStudio({ onLegacy }: { onLegacy: () => void }) {
  const [, navigate] = useLocation(), { user } = useAuth(), query = useQueryClient()
  const draftKey = `tloque-frame-studio-v2:${user?.id ?? "admin"}`
  const [history, setHistory] = useState<Draft[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey) || "null")
      if (frameSceneSchema.safeParse(stored?.scene).success && typeof stored.name === "string" && stored.name.length <= 60 && ["card", "profile", "both"].includes(stored.target) && Number.isInteger(stored.price) && stored.price >= 0 && stored.price <= 1000) return [stored]
    } catch { /* A damaged local draft never blocks entry. */ }
    return [initialDraft()]
  })
  const [index, setIndex] = useState(0), draft = history[index]
  const [shape, setShape] = useState<"card" | "profile">("card")
  const [tab, setTab] = useState<"design" | "motion">("design")
  const [channel, setChannel] = useState<FrameChannel>("orbit")
  const [notice, setNotice] = useState("")
  const [draftSaved, setDraftSaved] = useState(true)
  const [ready, setReady] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const controller = useInspection(draft.scene.animation.duration)
  const pkg = useMemo(() => packageFrameScene(draft.scene, draft.name, draft.target), [draft])
  const track = draft.scene.animation.tracks[channel]
  const bounds = FRAME_CHANNELS[channel]
  const time = Math.round(controller.time * 100) / 100
  const pose = evaluateFrameScene(draft.scene, time)
  const currentKey = track.find(key => Math.abs(key.time - time) < .005)

  const change = (next: Draft) => {
    const list = [...history.slice(0, index + 1), next].slice(-60)
    setHistory(list); setIndex(list.length - 1)
  }
  const edit = (fn: (next: FrameScene) => void) => {
    const scene = structuredClone(draft.scene); fn(scene)
    const result = frameSceneSchema.safeParse(scene)
    if (result.success) change({ ...draft, scene: result.data })
    else setNotice("Ese cambio excede los límites de la escena.")
  }
  const load = (next: Draft) => { controller.reset(); change(next); setShape(next.target === "profile" ? "profile" : "card") }
  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); setDraftSaved(true) }
    catch { setDraftSaved(false) }
  }, [draft, draftKey])

  const { data: gallery } = useQuery<{ frames: SavedFrame[] }>({ queryKey: ["/api/frames"], queryFn: async () => {
    const response = await fetch("/api/frames", { credentials: "include" })
    if (!response.ok) throw new Error("No se pudo cargar la galería")
    return response.json()
  } })
  const save = useMutation({ mutationFn: async () => {
    const response = await fetch("/api/admin/frames", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, priceTinta: draft.price, target: draft.target, pkg }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || "No se pudo guardar el marco")
    return data
  }, onSuccess: () => { query.invalidateQueries({ queryKey: ["/api/frames"] }); setNotice("Versión guardada en la galería. Puedes inspeccionarla y equiparla desde allí.") }, onError: (error: Error) => setNotice(error.message) })

  const exportScene = () => {
    const blob = new Blob([JSON.stringify({ name: draft.name, priceTinta: draft.price, target: draft.target, pkg }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob), link = document.createElement("a")
    link.href = url; link.download = `tloque-frame-${draft.scene.style}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importScene = async (selected?: File) => {
    if (!selected) return
    if (selected.size > 400_000) { setNotice("El archivo supera el límite de 400 KB."); return }
    try {
      const input = JSON.parse(await selected.text()), source = input.pkg ?? input
      if (!readFrameScene(source) && (source.scene !== undefined || !source.runtimePreset)) throw new Error("El archivo no contiene un marco válido de Tloque.")
      load({ name: String(input.name ?? source.runtimePreset?.name ?? "Marco importado").slice(0, 60), price: 0, target: ["card", "profile", "both"].includes(input.target ?? source.runtimePreset?.target) ? input.target ?? source.runtimePreset.target : "both", scene: sceneFromLegacy(source) })
      setNotice(readFrameScene(source) ? "Escena importada con su secuencia editable." : "Copia convertida: material y proporciones recuperados. Los ornamentos antiguos no se traducen automáticamente; conserva el archivo original.")
    } catch (error) { setNotice(error instanceof Error ? error.message : "Archivo no válido") }
  }
  const setKey = (value: number) => {
    if (!currentKey && track.length >= 16) { setNotice("Esta pista ya tiene 16 claves. Elimina una antes de añadir otra."); return }
    controller.seek(time)
    edit(scene => {
      const keys = scene.animation.tracks[channel]
      const existing = keys.find(key => Math.abs(key.time - time) < .005)
      if (existing) existing.value = value
      else if (keys.length < 16) { keys.push({ time, value, ease: "smooth" }); keys.sort((a, b) => a.time - b.time) }
    })
  }

  return <div className="tq-studio">
    <header className="tq-studio-header">
      <button onClick={() => navigate("/")} aria-label="Volver al inicio"><ArrowLeft size={18}/></button>
      <div className="tq-studio-brand"><small>TLOQUE / CREATIVE TOOLS</small><h1>Estudio de marcos <span>3D</span></h1></div>
      <div className="tq-studio-actions">
        <button aria-label="Deshacer" disabled={index === 0} onClick={() => { controller.pause(); setIndex(index - 1) }}><Undo2 size={16}/></button>
        <button aria-label="Rehacer" disabled={index === history.length - 1} onClick={() => { controller.pause(); setIndex(index + 1) }}><Redo2 size={16}/></button>
        <button title="Importar escena JSON" aria-label="Importar escena" onClick={() => file.current?.click()}><Upload size={16}/></button>
        <button title="Exportar escena JSON" aria-label="Exportar escena" onClick={exportScene}><Download size={16}/></button>
        <button className="tq-studio-primary" disabled={save.isPending || !draft.name.trim()} onClick={() => save.mutate()}><Save size={15}/><span>{save.isPending ? "Guardando…" : "Guardar versión"}</span></button>
        <input hidden ref={file} type="file" accept="application/json,.json" onChange={e => { void importScene(e.target.files?.[0]); e.target.value = "" }}/>
      </div>
    </header>
    {notice && <div className="tq-studio-notice" role="status"><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice("")}>×</button></div>}
    <main className="tq-studio-workspace" data-visual-clip>
      <aside className="tq-studio-library">
        <div className="tq-studio-section-title"><span>01 / COLECCIÓN</span><Sparkles size={14}/></div>
        <h2>Un objeto.<br/>Un pequeño universo.</h2>
        <p>Elige un punto de partida. Construye su identidad en movimiento.</p>
        <div className="tq-template-list">{templates.map(template => <button key={template.id} className="tq-template" aria-pressed={draft.scene.style === template.id} onClick={() => load({ ...draft, name: template.name, scene: createFrameScene(template.id) })}>
          <div className="tq-template-art"><FramePoster scene={createFrameScene(template.id)}/></div>
          <span>{template.name}<small>{template.note}</small></span><ArrowUpRight size={14}/>
        </button>)}</div>
        <div className="tq-studio-section-title"><span>VERSIONES GUARDADAS</span><span>{gallery?.frames.filter(frame => frame.visible !== false).length ?? 0}</span></div>
        <div className="tq-saved-list">{gallery?.frames.filter(frame => frame.visible !== false).map(frame => <button key={frame.id} onClick={() => {
          load({ name: `${frame.name.slice(0, 52)} · copia`, price: frame.priceTinta, target: frame.target, scene: sceneFromLegacy(frame.pkg) })
          setNotice(readFrameScene(frame.pkg) ? "Copia abierta: guardar creará una versión nueva, sin modificar la original." : "Copia convertida al motor 3D. Se recuperan material y proporciones; el diseño antiguo completo sigue intacto en la galería y el taller clásico.")
        }}><span>{frame.name}<small>{readFrameScene(frame.pkg) ? "Escena 3D" : "Clásico · convertir copia"}</small></span><Plus size={14}/></button>)}</div>
        <button className="tq-legacy-link" onClick={onLegacy}>Abrir taller clásico <ArrowUpRight size={14}/></button>
      </aside>
      <section className="tq-studio-center" aria-label="Vista previa y secuencia">
        <div className="tq-studio-stage-title"><div><small>02 / ESCENARIO</small><h2>{draft.name || "Sin título"}</h2></div><div className="tq-segmented"><button aria-pressed={shape === "card"} onClick={() => setShape("card")}>Carta</button><button aria-pressed={shape === "profile"} onClick={() => setShape("profile")}>Perfil</button></div></div>
        <InspectionStage pkg={pkg} shape={shape} priority={80} controller={controller} onReadyChange={setReady}/>
        <InspectionControls controller={controller} duration={draft.scene.animation.duration} disabled={!ready}/>
        <div className="tq-sequence-header"><span>SECUENCIA DE INSPECCIÓN</span><span>{draft.scene.animation.duration} s · {Object.values(draft.scene.animation.tracks).reduce((n, keys) => n + keys.length, 0)} claves</span></div>
        <div className="tq-timeline" aria-label="Pistas de animación">{Object.entries(FRAME_CHANNELS).map(([key, metadata]) => <div className="tq-timeline-row" key={key}>
          <button aria-pressed={channel === key} onClick={() => { setChannel(key as FrameChannel); setTab("motion") }}>{metadata.label}</button>
          <div className="tq-timeline-track"><div className="tq-playhead" style={{ left: `${controller.time / draft.scene.animation.duration * 100}%` }}/>{draft.scene.animation.tracks[key as FrameChannel].map(point => <button key={point.time} style={{ left: `${point.time / draft.scene.animation.duration * 100}%` }} aria-label={`${metadata.label}, ${point.time} segundos`} title={`${point.time} s · ${point.value}`} onClick={() => { controller.seek(point.time); setChannel(key as FrameChannel); setTab("motion") }}><span/></button>)}</div>
        </div>)}</div>
        <div className="tq-studio-footnote"><span>{draftSaved ? "Borrador guardado en este dispositivo" : "No se pudo guardar el borrador local; exporta una copia"}</span><span>Mismo motor en editor y galería</span></div>
      </section>
      <aside className="tq-studio-properties">
        <div className="tq-studio-section-title"><span>03 / DIRECCIÓN DE ARTE</span></div>
        <div className="tq-segmented tq-property-tabs"><button aria-pressed={tab === "design"} onClick={() => setTab("design")}>Diseño</button><button aria-pressed={tab === "motion"} onClick={() => setTab("motion")}>Animación</button></div>
        {tab === "design" ? <>
          <section><h3>Identidad</h3><label className="tq-studio-field">Nombre<input maxLength={60} value={draft.name} onChange={e => change({ ...draft, name: e.target.value })}/></label>
            <div className="tq-two-fields"><label className="tq-studio-field">Disponible para<select value={draft.target} onChange={e => change({ ...draft, target: e.target.value as FrameTarget })}><option value="both">Carta y perfil</option><option value="card">Cartas</option><option value="profile">Perfil</option></select></label><label className="tq-studio-field">Precio · Tinta<input type="number" min={0} max={1000} value={draft.price} onChange={e => change({ ...draft, price: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) })}/></label></div>
          </section>
          <section><h3>Materia & luz</h3><div className="tq-two-fields"><ColorField label="Metal" value={draft.scene.material.color} onChange={value => edit(s => { s.material.color = value })}/><ColorField label="Cristal" value={draft.scene.material.accent} onChange={value => edit(s => { s.material.accent = value })}/></div>
            <Slider label="Metalizado" value={draft.scene.material.metalness} min={0} max={1} onChange={v => edit(s => { s.material.metalness = v })}/>
            <Slider label="Rugosidad" value={draft.scene.material.roughness} min={.12} max={1} onChange={v => edit(s => { s.material.roughness = v })}/>
            <Slider label="Emisión del cristal" value={draft.scene.material.glow} min={0} max={1.5} onChange={v => edit(s => { s.material.glow = v })}/>
            <div className="tq-two-fields"><ColorField label="Luz principal" value={draft.scene.lighting.key} onChange={v => edit(s => { s.lighting.key = v })}/><ColorField label="Contraluz" value={draft.scene.lighting.rim} onChange={v => edit(s => { s.lighting.rim = v })}/></div>
            <Slider label="Intensidad de luz" value={draft.scene.lighting.intensity} min={.5} max={5} step={.1} onChange={v => edit(s => { s.lighting.intensity = v })}/>
          </section>
          <section><h3>Arquitectura</h3><Slider label="Grosor del marco" value={draft.scene.geometry.width} min={.06} max={.2} onChange={v => edit(s => { s.geometry.width = v })}/><Slider label="Profundidad del bisel" value={draft.scene.geometry.depth} min={.04} max={.22} onChange={v => edit(s => { s.geometry.depth = v })}/><Slider label="Curva de esquina" value={draft.scene.geometry.radius} min={.05} max={.3} onChange={v => edit(s => { s.geometry.radius = v })}/><Slider label="Ornamentos" value={draft.scene.geometry.ornaments} min={4} max={16} step={1} onChange={v => edit(s => { s.geometry.ornaments = v })}/></section>
          <section><h3>El mundo interior</h3><label className="tq-studio-check"><input type="checkbox" checked={draft.scene.portal.enabled} onChange={e => edit(s => { s.portal.enabled = e.target.checked })}/>Portal espacial</label><ColorField label="Atmósfera" value={draft.scene.portal.color} onChange={v => edit(s => { s.portal.color = v })}/><Slider label="Paralaje" value={draft.scene.portal.depth} min={.2} max={1} onChange={v => edit(s => { s.portal.depth = v })}/><Slider label="Partículas" value={draft.scene.portal.particles} min={0} max={96} step={1} onChange={v => edit(s => { s.portal.particles = v })}/><Slider label="Flujo del portal" value={draft.scene.portal.speed} min={0} max={1} onChange={v => edit(s => { s.portal.speed = v })}/><p>Las imágenes de la carta equipada se incorporan al portal. El paralaje entre figuras requiere capas separadas.</p></section>
        </> : <>
          <section><h3>Coreografía</h3><p>Selecciona una clave en la pista o sitúa el tiempo y cambia su valor. La galería reproduce esta misma secuencia.</p><Slider label="Duración · segundos" value={draft.scene.animation.duration} min={3} max={12} step={1} onChange={v => { controller.reset(); edit(s => { const ratio = v / s.animation.duration; for (const keys of Object.values(s.animation.tracks)) keys.forEach((key, i) => { key.time = i === keys.length - 1 ? v : key.time * ratio }); s.animation.duration = v }) }}/>
            <label className="tq-studio-field">Pista<select aria-label="Pista" value={channel} onChange={e => setChannel(e.target.value as FrameChannel)}>{Object.entries(FRAME_CHANNELS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
            <div className="tq-key-card"><small>{currentKey ? "CLAVE SELECCIONADA" : "NUEVA CLAVE"}</small><strong>{time.toFixed(2)} <span>segundos</span></strong><Slider label={bounds.label} value={pose[channel]} min={bounds.min} max={bounds.max} step={bounds.step} onChange={setKey}/>
              {currentKey && <label className="tq-studio-field">Llegada a esta clave<select value={currentKey.ease} onChange={e => edit(s => { s.animation.tracks[channel].find(key => key.time === currentKey.time)!.ease = e.target.value as "smooth" | "linear" })}><option value="smooth">Suave · sin rebote</option><option value="linear">Lineal</option></select></label>}
              <button disabled={!currentKey || currentKey.time === 0 || currentKey.time === draft.scene.animation.duration} onClick={() => edit(s => { s.animation.tracks[channel] = s.animation.tracks[channel].filter(key => key.time !== currentKey?.time) })}><Trash2 size={14}/>Eliminar clave</button>
              <small>{track.length}/16 claves en esta pista. Los extremos se conservan.</small>
            </div>
          </section><section><h3>Diseñado para leer</h3><p>La inspección se inicia al pulsar reproducir. Se pausa al ocultar la pestaña. Sin destellos de pantalla, sonido automático ni resorte en la cámara.</p></section>
        </>}
      </aside>
    </main>
  </div>
}
