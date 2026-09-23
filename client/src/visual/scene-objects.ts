import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, OctahedronGeometry, SphereGeometry, TorusGeometry, type Scene } from "three"
import type { SceneContent } from "@shared/scene-content"
import type { loadSceneModel } from "./model-loader"

type Loaded = Awaited<ReturnType<typeof loadSceneModel>>
type Entry = { key: string; root: Group; mesh?: Mesh<any, MeshPhysicalMaterial>; model?: Loaded; abort: AbortController; error?: string; pending: boolean; timer?: ReturnType<typeof setTimeout> }
export function createSceneObjects(world: Scene, frame: Group, width: number, height: number) {
  const entries = new Map<string, Entry>(); let disposed = false
  const remove = (entry: Entry) => {
    entry.abort.abort(); clearTimeout(entry.timer); entry.root.removeFromParent()
    entry.model?.dispose(); entry.mesh?.geometry.dispose(); entry.mesh?.material.dispose()
  }
  return {
    update(content: SceneContent | undefined, seconds: number) {
      const objects = content?.objects ?? [], ids = new Set(objects.map(o => o.id))
      for (const [id, entry] of entries) if (!ids.has(id)) { remove(entry); entries.delete(id) }
      for (const object of objects) {
        const key = `${object.kind}:${object.kind === "shape" ? object.shape : object.source}:${object.placement}`
        let entry = entries.get(object.id)
        if (entry && entry.key !== key) { remove(entry); entries.delete(object.id); entry = undefined }
        if (!entry) {
          entry = { key, root: new Group(), abort: new AbortController(), pending: object.kind === "model" }
          entries.set(object.id, entry); (object.placement === "frame" ? frame : world).add(entry.root)
          entry.root.name = `tloque-object:${object.id}`
          if (object.kind === "shape") {
            const geometry = object.shape === "sphere" ? new SphereGeometry(1, 24, 16) : object.shape === "box" ? new BoxGeometry(1.6, 1.6, 1.6) : object.shape === "crystal" ? new OctahedronGeometry(1) : object.shape === "ring" ? new TorusGeometry(.8, .17, 12, 48) : object.shape === "cone" ? new ConeGeometry(.85, 2, 24) : new CylinderGeometry(.65, .65, 2, 24)
            entry.mesh = new Mesh(geometry, new MeshPhysicalMaterial({ clearcoat: .6 }))
            entry.root.add(entry.mesh)
          } else {
            const target = entry
            target.timer = setTimeout(() => { target.error = `No se pudo cargar «${object.name}». Reintenta la vista.`; target.pending = false; target.abort.abort() }, 25_000)
            void import("./model-loader").then(m => m.loadSceneModel(object.source, target.abort.signal)).then(model => {
              if (disposed || target.abort.signal.aborted) { model.dispose(); return }
              target.model = model; target.root.add(model.root); target.pending = false; clearTimeout(target.timer)
            }).catch(() => { if (!target.abort.signal.aborted) { target.pending = false; target.error = `No se pudo cargar «${object.name}». Reintenta la vista.` }; clearTimeout(target.timer) })
          }
        }
        const isFrame = object.placement === "frame", { position: p, rotation: r, scale: s } = object
        const unit = isFrame ? .55 : 1
        entry.root.position.set(p.x * (isFrame ? width / 2 : 1.6), p.y * (isFrame ? height / 2 : 2), p.z * (isFrame ? .5 : 1.5) + (isFrame ? .35 : .6))
        entry.root.rotation.set(r.x * Math.PI / 180, r.y * Math.PI / 180, r.z * Math.PI / 180)
        entry.root.scale.set(s.x * unit, s.y * unit, s.z * unit)
        if (object.motion === "spin") entry.root.rotation.y += seconds * .5 * object.speed
        if (object.motion === "float") entry.root.position.y += Math.sin(seconds * object.speed * 1.5) * .12 * unit
        if (entry.mesh && object.kind === "shape") { entry.mesh.material.color.set(object.color); entry.mesh.material.metalness = object.metalness; entry.mesh.material.roughness = object.roughness }
        if (entry.model && object.kind === "model") entry.model.update(object, seconds)
        // All 3D objects share depth testing and draw after artwork. Transparent
        // PNG layers remain at their authored depth; neither engine redraws the DOM.
        entry.root.traverse(node => { if (node instanceof Mesh) node.renderOrder = 4 })
      }
    },
    issue: () => [...entries.values()].find(e => e.error)?.error,
    pending: () => [...entries.values()].some(e => e.pending),
    dispose() { disposed = true; entries.forEach(remove); entries.clear() },
  }
}
