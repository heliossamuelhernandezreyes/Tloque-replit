import { useEffect, useRef, useState } from "react"
import { accountFetch } from "@/lib/account-context"
import { createSceneContent, createShape, EFFECTS, MODEL_MAX_BYTES, SHAPES, sceneContentSchema, type SceneContent, type SceneObject } from "@shared/scene-content"
import "./scene-content.css"

const uid = () => crypto.randomUUID()
function Slider({ label, value, min, max, step = .01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="tq-studio-field"><span>{label}<output>{Number(value.toFixed(2))}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/></label>
}

/** The same objects and effects can be authored in either workshop. */
export default function SceneContentEditor({ value, onChange, placement = "scene", onBusyChange }: { value?: SceneContent; onChange: (value: SceneContent) => void; placement?: "scene" | "frame"; onBusyChange?: (busy: boolean) => void }) {
  const content = value ?? createSceneContent()
  const [selected, setSelected] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null), upload = useRef<AbortController | null>(null)
  const latest = useRef({ content, onChange, onBusyChange }); latest.current = { content, onChange, onBusyChange }
  useEffect(() => () => { upload.current?.abort(); latest.current.onBusyChange?.(false) }, [])
  const change = (next: SceneContent) => {
    const result = sceneContentSchema.safeParse(next)
    if (!result.success) { setNotice("Usa hasta 16 piezas, incluidos dos modelos importados."); return }
    latest.current.onChange(result.data)
  }
  const edit = (fn: (next: SceneContent) => void) => { const next = structuredClone(latest.current.content); fn(next); change(next) }
  const object = content.objects.find(o => o.id === selected) ?? content.objects[0]
  const updateObject = (fn: (o: SceneObject) => void) => edit(c => { const o = c.objects.find(o => o.id === object?.id); if (o) fn(o) })
  const add = (shape: keyof typeof SHAPES) => {
    const next = createShape(shape, uid(), placement)
    if (placement === "frame") { next.position.y = 1.05; next.scale = { x: .3, y: .3, z: .3 } }
    edit(c => c.objects.push(next)); setSelected(next.id)
  }
  const template = (kind: "crystal" | "crown" | "gate") => {
    const parts: SceneObject[] = []
    const part = (shape: keyof typeof SHAPES, x: number, y: number, sx: number, sy: number) => {
      const o = createShape(shape, uid(), placement); o.position.x = x; o.position.y = y; o.scale = { x: sx, y: sy, z: Math.min(sx, sy) }; parts.push(o); return o
    }
    if (kind === "crystal") { const o = part("crystal", 0, placement === "frame" ? 1.05 : 0, .5, .8); o.motion = "float"; part("ring", 0, placement === "frame" ? 1.05 : 0, .75, .75).rotation.x = 65 }
    if (kind === "crown") {
      const y = placement === "frame" ? 1 : 0
      part("ring", 0, y, .8, .3).rotation.x = 70
      for (let i = -1; i <= 1; i++) { const o = part("cone", i * .4, y + .25, .18, i === 0 ? .5 : .35); o.color = "#e7bd63" }
    }
    if (kind === "gate") { part("cylinder", -.65, 0, .15, 1); part("cylinder", .65, 0, .15, 1); part("box", 0, .65, .8, .12) }
    edit(c => c.objects.push(...parts)); setSelected(parts[0].id)
  }
  const importFile = async (chosen?: File) => {
    if (!chosen) return
    setNotice("")
    if (/\.json$/i.test(chosen.name) || chosen.type === "application/json") {
      if (chosen.size > 64_000) { setNotice("La receta debe pesar menos de 64 KB."); return }
      try { const input = JSON.parse(await chosen.text()); const parsed = sceneContentSchema.parse(input.content ?? input); change(parsed); setSelected(""); setNotice("Objetos y efectos importados.") }
      catch { setNotice("Selecciona una receta de objetos 3D exportada desde Tloque.") }
      return
    }
    if (!/\.glb$/i.test(chosen.name) || chosen.size > MODEL_MAX_BYTES) { setNotice("Selecciona un GLB de hasta 20 MB con sus texturas integradas."); return }
    if (latest.current.content.objects.length >= 16 || latest.current.content.objects.filter(o => o.kind === "model").length >= 2) { setNotice("Elimina una pieza antes de importar otro modelo. Máximo dos GLB por escena."); return }
    const abort = new AbortController(); upload.current?.abort(); upload.current = abort; setBusy(true); latest.current.onBusyChange?.(true)
    const timeout = setTimeout(() => abort.abort(), 90_000)
    try {
      const response = await accountFetch("/api/visual/models", { method: "POST", credentials: "include", headers: { "Content-Type": "model/gltf-binary" }, body: chosen, signal: abort.signal })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || "No se pudo importar el modelo.")
      if (abort.signal.aborted) return
      const id = uid(), base = createShape("sphere", id, placement)
      const { kind: _kind, shape: _shape, color: _color, metalness: _metal, roughness: _rough, ...transform } = base as Extract<SceneObject, { kind: "shape" }>
      const model: SceneObject = { ...transform, kind: "model", name: chosen.name.replace(/\.glb$/i, "").slice(0, 80) || "Modelo", source: data.source, clips: data.clips, clip: data.clips?.length ? 0 : -1, loop: true }
      if (placement === "frame") { model.position.y = 1.05; model.scale = { x: .4, y: .4, z: .4 } }
      edit(c => c.objects.push(model)); setSelected(id)
      setNotice(`Modelo importado · ${data.clips.length} animaciones. Pulsa reproducir para verlas.`)
    } catch (error) { if (upload.current === abort) setNotice(abort.signal.aborted ? "Importación cancelada. Puedes intentarlo otra vez." : error instanceof Error ? error.message : "No se pudo importar.") }
    finally { clearTimeout(timeout); if (upload.current === abort) { upload.current = null; setBusy(false); latest.current.onBusyChange?.(false) } }
  }
  const exportContent = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: "tloque-scene-content", content }, null, 2)], { type: "application/json" }))
    const a = document.createElement("a"); a.href = url; a.download = "tloque-objetos-3d.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="tq-content-editor" aria-label="Objetos y efectos 3D">
    <h3>Modelos y animaciones</h3>
    <p>Importa un modelo o una escena GLB con sus animaciones. También puedes construir con formas y reutilizar tus objetos en tarjetas y marcos.</p>
    <div className="tq-content-actions"><button type="button" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Importando…" : "Importar modelo o animación"}</button><button type="button" onClick={exportContent}>Exportar objetos</button></div>
    <input ref={file} hidden type="file" accept=".glb,.json,model/gltf-binary,application/json" aria-label="Importar archivo 3D" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = "" }}/>
    {busy && <button type="button" onClick={() => upload.current?.abort()}>Cancelar importación</button>}
    {notice && <p className="tq-asset-status" role="status">{notice}</p>}
    <details><summary>Formatos y tamaños</summary><p>GLB 2.0 de hasta 20 MB, 80 000 triángulos y animaciones de hasta 120 s. Texturas PNG/JPEG integradas, hasta 2048 px. En Blender: exporta glTF Binary con animaciones, sin compresión Draco. La receta JSON permite reutilizar los objetos guardados en esta instalación de Tloque.</p></details>
    <h3>Crear en un toque</h3>
    <div className="tq-content-presets"><button type="button" onClick={() => template("crystal")}>Cristal flotante</button><button type="button" onClick={() => template("crown")}>Corona</button><button type="button" onClick={() => template("gate")}>Portal</button></div>
    <details><summary>Añadir una forma</summary><div className="tq-content-presets">{Object.entries(SHAPES).map(([id, name]) => <button type="button" key={id} disabled={content.objects.length >= 16} onClick={() => add(id as keyof typeof SHAPES)}>{name}</button>)}</div></details>
    {object && <>
      <label className="tq-studio-field">Pieza activa<select aria-label="Pieza activa" value={object.id} onChange={e => setSelected(e.target.value)}>{content.objects.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
      <label className="tq-studio-field">Nombre de la pieza<input aria-label="Nombre de la pieza" value={object.name} maxLength={80} onChange={e => updateObject(o => { o.name = e.target.value || "Pieza" })}/></label>
      <label className="tq-studio-field">Colocación<select aria-label="Colocación 3D" value={object.placement} onChange={e => updateObject(o => { o.placement = e.target.value as "scene" | "frame" })}><option value="scene">Dentro de la tarjeta</option><option value="frame">Sobre el marco</option></select></label>
      <Slider label="Tamaño de la pieza" value={object.scale.x} min={.03} max={3} onChange={v => updateObject(o => { const ratio = v / o.scale.x; o.scale = { x: v, y: Math.max(.03, Math.min(3, o.scale.y * ratio)), z: Math.max(.03, Math.min(3, o.scale.z * ratio)) } })}/>
      {(["x", "y", "z"] as const).map((axis, i) => <Slider key={axis} label={["Posición horizontal", "Posición vertical", "Profundidad de pieza"][i]} value={object.position[axis]} min={-1.5} max={1.5} onChange={v => updateObject(o => { o.position[axis] = v })}/>)}
      <details><summary>Forma y orientación</summary>{(["x", "y", "z"] as const).map(axis => <div key={axis}><Slider label={`Rotación ${axis.toUpperCase()} de pieza`} value={object.rotation[axis]} min={-180} max={180} step={1} onChange={v => updateObject(o => { o.rotation[axis] = v })}/><Slider label={`Escala ${axis.toUpperCase()} de pieza`} value={object.scale[axis]} min={.03} max={3} onChange={v => updateObject(o => { o.scale[axis] = v })}/></div>)}</details>
      {object.kind === "shape" && <><label className="tq-color-field"><input aria-label="Color de la pieza" type="color" value={object.color} onChange={e => updateObject(o => { if (o.kind === "shape") o.color = e.target.value })}/>Color de la pieza</label><Slider label="Metal de la pieza" value={object.metalness} min={0} max={1} onChange={v => updateObject(o => { if (o.kind === "shape") o.metalness = v })}/><Slider label="Rugosidad de la pieza" value={object.roughness} min={.04} max={1} onChange={v => updateObject(o => { if (o.kind === "shape") o.roughness = v })}/></>}
      {object.kind === "model" && <><label className="tq-studio-field">Animación importada<select aria-label="Animación importada" value={object.clip} onChange={e => updateObject(o => { if (o.kind === "model") o.clip = Number(e.target.value) })}><option value={-1}>Sin reproducir</option><option value={-2}>Todas juntas</option>{object.clips.map((clip, i) => <option key={i} value={i}>{clip.name} · {clip.duration.toFixed(1)} s</option>)}</select></label><label className="tq-check"><input type="checkbox" checked={object.loop} onChange={e => updateObject(o => { if (o.kind === "model") o.loop = e.target.checked })}/>Repetir animación</label></>}
      <label className="tq-studio-field">Movimiento sencillo<select aria-label="Movimiento de pieza" value={object.motion} onChange={e => updateObject(o => { o.motion = e.target.value as SceneObject["motion"] })}><option value="still">Quieto</option><option value="spin">Girar</option><option value="float">Flotar</option></select></label>
      <Slider label="Velocidad de pieza" value={object.speed} min={.1} max={2} onChange={v => updateObject(o => { o.speed = v })}/>
      <div className="tq-content-actions"><button type="button" disabled={content.objects.length >= 16 || object.kind === "model" && content.objects.filter(o => o.kind === "model").length >= 2} onClick={() => { const copy = structuredClone(object); copy.id = uid(); copy.name = `${copy.name.slice(0, 70)} copia`; copy.position.x = Math.min(1.5, copy.position.x + .15); edit(c => c.objects.push(copy)); setSelected(copy.id) }}>Duplicar pieza</button><button type="button" onClick={() => edit(c => { c.objects = c.objects.filter(o => o.id !== object.id) })}>Eliminar pieza</button></div>
    </>}
    <h3>Vidrio y ambiente</h3>
    <label className="tq-check"><input type="checkbox" checked={content.glass.enabled} onChange={e => edit(c => { c.glass.enabled = e.target.checked })}/>Poner vidrio</label>
    {content.glass.enabled && <><label className="tq-color-field"><input aria-label="Tinte del vidrio" type="color" value={content.glass.tint} onChange={e => edit(c => { c.glass.tint = e.target.value })}/>Tinte del vidrio</label><Slider label="Presencia del vidrio" value={content.glass.opacity} min={0} max={.6} onChange={v => edit(c => { c.glass.opacity = v })}/><Slider label="Vidrio esmerilado" value={content.glass.roughness} min={.04} max={1} onChange={v => edit(c => { c.glass.roughness = v })}/></>}
    <label className="tq-studio-field">Efecto 3D<select aria-label="Efecto 3D" value={content.effect.type} onChange={e => edit(c => { c.effect.type = e.target.value as SceneContent["effect"]["type"]; c.effect.color = ["fire", "embers"].includes(e.target.value) ? "#ff793b" : e.target.value === "smoke" ? "#818b9c" : "#badbff" })}>{Object.entries(EFFECTS).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
    {content.effect.type !== "none" && <><Slider label="Intensidad del efecto 3D" value={content.effect.intensity} min={0} max={1} onChange={v => edit(c => { c.effect.intensity = v })}/><Slider label="Velocidad del efecto 3D" value={content.effect.speed} min={.1} max={2} onChange={v => edit(c => { c.effect.speed = v })}/><label className="tq-color-field"><input aria-label="Color del efecto" type="color" value={content.effect.color} onChange={e => edit(c => { c.effect.color = e.target.value })}/>Color del efecto</label></>}
    <label className="tq-color-field"><input aria-label="Fondo del espacio 3D" type="color" value={content.background} onChange={e => edit(c => { c.background = e.target.value })}/>Fondo del espacio 3D</label>
  </section>
}
