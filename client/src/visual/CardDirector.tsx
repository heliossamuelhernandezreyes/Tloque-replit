import { accountStorage as localStorage } from "@/lib/account-context"
import { useEffect, useRef, useState } from "react"
import { Check, Download, Upload, Undo2, Redo2, Plus, Trash2 } from "lucide-react"
import { applyCardMotion, CARD_LAYERS, CARD_LAYER_LABELS, CARD_MOTION_PRESETS, CARD_REST, cardSceneSchema, createCardScene, evaluateCardOffset, readCardScene, resizeCardDuration, setCardKey, type CardLayer, type CardMotionPreset, type CardScene, type CardTransform } from "@shared/card-scene"
import { MOTION_EASES, type MotionEase } from "@shared/motion-easing"
import { InspectionControls, InspectionStage, useInspection } from "./FrameInspection"
import CardScenePoster from "./CardScenePoster"
import VisualDialog from "./VisualDialog"
import "./frame-studio.css"
import "./card-director.css"
import SceneContentEditor from "./SceneContentEditor"
import { contentDuration } from "@shared/scene-content"

const controls: Record<keyof CardTransform, { label: string; min: number; max: number; step: number }> = {
  x: { label: "Posición X", min: -.6, max: .6, step: .005 }, y: { label: "Posición Y", min: -.6, max: .6, step: .005 },
  scale: { label: "Escala", min: .5, max: 2, step: .01 }, rotation: { label: "Rotación", min: -45, max: 45, step: .5 }, opacity: { label: "Opacidad", min: 0, max: 1, step: .01 },
}

export default function CardDirector({ value, images, frame, color, name, draftKey, onApply, onClose }: {
  value?: CardScene | null; images: string[]; frame?: unknown; color: string; name: string; draftKey: string; onApply: (scene: CardScene) => void; onClose: () => void
}) {
  const [history, setHistory] = useState<CardScene[]>(() => [structuredClone(value ?? createCardScene())])
  const [index, setIndex] = useState(0), scene = history[index]
  const [layer, setLayer] = useState<CardLayer>("mid")
  const [tab, setTab] = useState<"composition" | "motion" | "objects">(images.some(Boolean) ? "composition" : "objects")
  const [importing, setImporting] = useState(false)
  const [ready, setReady] = useState(false), [notice, setNotice] = useState("")
  const [savedDraft, setSavedDraft] = useState<CardScene | null>(() => {
    try { return readCardScene(JSON.parse(localStorage.getItem(draftKey) || "null")) } catch { return null }
  })
  const file = useRef<HTMLInputElement>(null)
  const controller = useInspection(scene.duration)
  const time = Math.round(controller.time * 1000) / 1000
  const keys = scene.layers[layer].keys, selected = keys.find(key => Math.abs(key.time - time) < .005)
  const change = (next: CardScene) => {
    const list = [...history.slice(0, index + 1), cardSceneSchema.parse(next)].slice(-60)
    setHistory(list); setIndex(list.length - 1)
  }
  const edit = (fn: (draft: CardScene) => void) => { const next = structuredClone(scene); fn(next); change(next) }
  useEffect(() => {
    if (history.length === 1) return
    const timer = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(scene)) }
      catch { setNotice("No se pudo guardar el borrador en este dispositivo. Exporta la dirección como JSON.") }
    }, 300)
    return () => clearTimeout(timer)
  }, [scene, draftKey, history.length])
  const offset = () => evaluateCardOffset(scene, layer, time)
  const putKey = (patch: Partial<CardTransform> = {}) => {
    if (!selected && keys.length >= 16) { setNotice("Límite de 16 claves por capa. Elimina una clave intermedia."); return }
    controller.seek(time)
    change(setCardKey(scene, layer, { ...offset(), ...patch, time: selected?.time ?? time, ease: selected?.ease ?? "cinematic" }))
  }
  const exportScene = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: "tloque-card-direction", scene }, null, 2)], { type: "application/json" }))
    const link = document.createElement("a"); link.href = url; link.download = "tloque-card-direction.json"; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importScene = async (file?: File) => {
    if (!file) return
    if (file.size > 64_000) { setNotice("La dirección supera 64 KB. Importa solo la receta, sin imágenes."); return }
    try {
      const input = JSON.parse(await file.text()), next = readCardScene(input.scene ?? input)
      if (!next) throw new Error("Receta no válida. Usa una dirección de tarjeta de Tloque 1.0.0.")
      controller.reset(); change(next); setNotice("Dirección importada. El arte y el marco no han cambiado.")
    } catch (error) { setNotice(error instanceof Error ? error.message : "Archivo no válido") }
  }
  const close = () => {
    if (JSON.stringify(scene) !== JSON.stringify(value ?? createCardScene()) && !window.confirm("Hay cambios sin aplicar. ¿Cerrar la dirección? Puedes exportarla o recuperarla desde su borrador local.")) return
    onClose()
  }
  const animated = tab === "motion", values = animated ? offset() : scene.layers[layer].transform
  return <VisualDialog open onClose={close} title="Dirección de tarjeta" description="Compón las capas y dirige su secuencia con el mismo motor del lector.">
    <div className="tq-studio tq-card-director">
      <header className="tq-studio-header">
        <div className="tq-studio-brand"><small>TLOQUE / CARD DIRECTOR</small><h1>Dirección de tarjeta <span>3D</span></h1></div>
        <div className="tq-studio-actions">
          <button aria-label="Deshacer dirección" disabled={!index} onClick={() => { controller.pause(); setIndex(index - 1) }}><Undo2 size={16}/></button>
          <button aria-label="Rehacer dirección" disabled={index === history.length - 1} onClick={() => { controller.pause(); setIndex(index + 1) }}><Redo2 size={16}/></button>
          <button aria-label="Importar dirección" onClick={() => file.current?.click()}><Upload size={16}/></button>
          <button aria-label="Exportar dirección" onClick={exportScene}><Download size={16}/></button>
          <button className="tq-studio-primary" disabled={importing} onClick={() => { onApply(scene); onClose() }}><Check size={16}/>Usar esta dirección</button>
          <input ref={file} hidden type="file" accept=".json,application/json" onChange={e => { void importScene(e.target.files?.[0]); e.target.value = "" }}/>
        </div>
      </header>
      {notice && <div className="tq-studio-notice" role="status">{notice}<button aria-label="Cerrar aviso de dirección" onClick={() => setNotice("")}>×</button></div>}
      {savedDraft && <div className="tq-studio-notice"><span>Hay un borrador de dirección en este dispositivo.</span><button onClick={() => { controller.reset(); change(savedDraft); setSavedDraft(null) }}>Recuperar borrador</button><button aria-label="Ignorar borrador" onClick={() => setSavedDraft(null)}>×</button></div>}
      <main className="tq-card-director-grid">
        <section className="tq-studio-center" data-visual-clip>
          <div className="tq-studio-stage-title"><div><small>01 / COMPOSICIÓN EN VIVO</small><h2>{name || "Tu próxima tarjeta"}</h2></div><span className="tq-card-layer-count">{images.filter(Boolean).length} / 3 capas</span></div>
          <InspectionStage pkg={frame} cardScene={scene} images={images} color={color} controller={controller} onReadyChange={setReady}>
            <CardScenePoster scene={scene} images={images} frame={frame} color={color}/>
          </InspectionStage>
          <InspectionControls controller={controller} duration={scene.duration} disabled={!ready}/>
          <div className="tq-sequence-header"><span>02 / PARTITURA VISUAL</span><span>Claves por capa · {scene.duration} s</span></div>
          <div className="tq-timeline" aria-label="Pistas de las capas">{CARD_LAYERS.map((key, i) => <div className="tq-timeline-row" key={key}>
            <button aria-pressed={key === layer} onClick={() => { setLayer(key); setTab("motion") }}>{CARD_LAYER_LABELS[key]}{!images[i] ? " · sin arte" : ""}</button>
            <div className="tq-timeline-track"><div className="tq-playhead" style={{ left: `${controller.time / scene.duration * 100}%` }}/>{scene.layers[key].keys.map(point => <button key={point.time} style={{ left: `${point.time / scene.duration * 100}%` }} aria-label={`${CARD_LAYER_LABELS[key]}, ${point.time} segundos`} onClick={() => { controller.seek(point.time); setLayer(key); setTab("motion") }}><span/></button>)}</div>
          </div>)}</div>
          <div className="tq-motion-presets">{Object.entries(CARD_MOTION_PRESETS).map(([key, preset]) => <button key={key} title={preset.note} onClick={() => { controller.reset(); change(applyCardMotion(scene, key as CardMotionPreset)); setNotice(`${preset.name}: secuencia aplicada. Pulsa reproducir para inspeccionarla.`) }}><strong>{preset.name}</strong><small>{preset.note}</small></button>)}</div>
          <p className="tq-card-director-note">La composición es el póster en reposo. La secuencia se reproduce al inspeccionar; no hay autoplay en la colección. Un marco 3D equipado acompaña la duración de tu tarjeta.</p>
        </section>
        <aside className="tq-studio-properties">
          <div className="tq-studio-section-title"><span>03 / DIRECCIÓN DE ARTE</span></div>
          <div className="tq-segmented tq-property-tabs"><button aria-pressed={tab === "composition"} onClick={() => { setTab("composition"); controller.reset() }}>Composición</button><button aria-pressed={animated} onClick={() => { setTab("motion"); controller.seek(time) }}>Animación</button><button aria-pressed={tab === "objects"} onClick={() => setTab("objects")}>Objetos y efectos</button></div>
          {tab === "objects" ? <SceneContentEditor value={scene.content} onBusyChange={setImporting} onChange={content => { const duration = Math.max(scene.duration, Math.ceil(contentDuration(content))); const next = duration > scene.duration ? resizeCardDuration(scene, duration) : structuredClone(scene); next.content = content; change(next) }}/> : <>
          <label className="tq-studio-field">Capa activa<select aria-label="Capa activa" value={layer} onChange={e => setLayer(e.target.value as CardLayer)}>{CARD_LAYERS.map(key => <option key={key} value={key}>{CARD_LAYER_LABELS[key]}</option>)}</select></label>
          {!images[CARD_LAYERS.indexOf(layer)] && <p role="status">Esta capa aún no tiene arte. Añádelo en el formulario de la tarjeta.</p>}
          {animated && <div className="tq-key-card"><small>{selected ? "CLAVE SELECCIONADA" : "NUEVA CLAVE"} · {keys.length}/16</small><strong>{time.toFixed(2)} <span>segundos</span></strong><p>Los valores son desplazamientos respecto al encuadre, no cambian tu composición.</p><button onClick={() => putKey()} disabled={!selected && keys.length >= 16}><Plus size={14}/>Marcar clave aquí</button></div>}
          {Object.entries(controls).map(([key, bounds]) => <label className="tq-studio-field" key={key}><span>{bounds.label}{animated ? " · clave" : ""}<output>{Number(values[key as keyof CardTransform].toFixed(3))}</output></span><input type="range" aria-label={`${bounds.label}${animated ? " de clave" : " de capa"}`} min={bounds.min} max={bounds.max} step={bounds.step} value={values[key as keyof CardTransform]} onChange={e => {
            const value = Number(e.target.value)
            if (animated) putKey({ [key]: value })
            else { controller.reset(); edit(s => { s.layers[layer].transform[key as keyof CardTransform] = value }) }
          }}/></label>)}
          {animated ? <section>
            {selected && <label className="tq-studio-field">Curva de llegada<select aria-label="Curva de la clave" value={selected.ease} onChange={e => edit(s => { s.layers[layer].keys.find(k => k.time === selected.time)!.ease = e.target.value as MotionEase })}>{Object.entries(MOTION_EASES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
            <button disabled={!selected || selected.time === 0 || selected.time === scene.duration} onClick={() => edit(s => { s.layers[layer].keys = s.layers[layer].keys.filter(k => k.time !== selected?.time) })}><Trash2 size={14}/>Eliminar clave</button>
            <label className="tq-studio-field"><span>Duración<output>{scene.duration} s</output></span><input aria-label="Duración de tarjeta" type="range" min={3} max={Math.max(120, scene.duration)} step={1} value={scene.duration} onChange={e => { controller.reset(); change(resizeCardDuration(scene, Number(e.target.value))) }}/></label>
          </section> : <section>
            <label className="tq-studio-field"><span>Profundidad<output>{scene.layers[layer].depth.toFixed(2)}</output></span><input aria-label="Profundidad de capa" type="range" min={0} max={1} step={.01} value={scene.layers[layer].depth} onChange={e => edit(s => { s.layers[layer].depth = Number(e.target.value) })}/></label>
            <button onClick={() => { controller.reset(); edit(s => { s.layers[layer].transform = { ...CARD_REST, scale: layer === "back" ? 1.08 : 1 } }) }}>Restablecer encuadre</button>
          </section>}
          <section><h3>Acabado de superficie</h3><label className="tq-studio-field">Material óptico<select aria-label="Acabado de tarjeta" value={scene.finish.type} onChange={e => edit(s => { s.finish.type = e.target.value as CardScene["finish"]["type"] })}><option value="none">Arte original</option><option value="foil">Foil satinado</option><option value="prismatic">Prisma iridiscente</option></select></label><label className="tq-studio-field"><span>Intensidad del acabado<output>{scene.finish.strength.toFixed(2)}</output></span><input aria-label="Intensidad del acabado" type="range" min={0} max={.6} step={.01} value={scene.finish.strength} onChange={e => edit(s => { s.finish.strength = Number(e.target.value) })}/></label><p>Responde al ángulo, respeta los píxeles transparentes y no cambia la rareza ni los derechos del marco.</p></section>
          <details><summary>Preparar arte para el portal</summary><p>Usa un lienzo 5:7 (por ejemplo, 900 × 1260). Exporta fondo, personaje y primer plano con las mismas dimensiones. Personaje y primer plano necesitan transparencia PNG o WebP.</p><p>Deja margen extra en el fondo para que el paralaje no revele bordes. No se puede recuperar el escenario oculto detrás de una figura de una imagen plana.</p><a href="https://www.photopea.com/" target="_blank" rel="noopener noreferrer">Abrir Photopea · editor de capas externo ↗</a><p>Se abre solo al tocar el enlace; Tloque no envía tu arte ni ejecuta su API.</p></details>
          <p>Usa esta dirección y después guarda la tarjeta. El JSON contiene la receta y las referencias a los modelos guardados.</p></>}
        </aside>
      </main>
    </div>
  </VisualDialog>
}
