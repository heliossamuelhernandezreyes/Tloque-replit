import { AnimationMixer, Box3, Group, LoadingManager, LoopOnce, LoopRepeat, Material, Mesh, Object3D, Texture, Vector3 } from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { inspectGlb } from "@shared/validate-glb"
import { MODEL_MAX_BYTES, MODEL_SOURCE, type SceneObject } from "@shared/scene-content"

/** Each view owns its textures, skin and mixer. Disposing it never damages another card. */
export function disposeModel(root: Object3D | Object3D[]) {
  const geometries = new Set<any>(), materials = new Set<Material>(), textures = new Set<Texture>(), skeletons = new Set<any>()
  for (const scene of Array.isArray(root) ? root : [root]) scene.traverse(node => {
    const mesh = node as Mesh & { skeleton?: any }
    if (mesh.geometry) geometries.add(mesh.geometry)
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
    if (mesh.skeleton) skeletons.add(mesh.skeleton)
  })
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); skeletons.forEach(s => s.dispose())
  const images = new Set<any>()
  textures.forEach(t => { images.add(t.source?.data); t.dispose() })
  images.forEach(i => i?.close?.())
}

export async function loadSceneModel(source: string, signal: AbortSignal) {
  if (!MODEL_SOURCE.test(source)) throw new Error("La dirección del modelo no es válida.")
  const response = await fetch(source, { signal, credentials: "same-origin" })
  if (!response.ok || Number(response.headers.get("Content-Length")) > MODEL_MAX_BYTES) throw new Error("No se pudo descargar el modelo.")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No se pudo leer el modelo.")
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      size += value.length
      if (size > MODEL_MAX_BYTES) { await reader.cancel(); throw new Error("El modelo supera 20 MB.") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length })
  inspectGlb(bytes)
  // Embedded PNG/JPEG images become blob URLs inside GLTFLoader. No external fetches.
  const manager = new LoadingManager()
  manager.setURLModifier(url => { if (!url.startsWith("blob:")) throw new Error("El GLB contiene un recurso externo."); return url })
  const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, "")
  let freed = false
  const dispose = () => { if (!freed) { freed = true; disposeModel(gltf.scenes) } }
  if (signal.aborted) { dispose(); throw new DOMException("Cancelado", "AbortError") }
  gltf.scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(gltf.scene), extent = box.getSize(new Vector3()), center = box.getCenter(new Vector3())
  const edge = Math.max(extent.x, extent.y, extent.z)
  if (!Number.isFinite(edge) || edge <= 0) { dispose(); throw new Error("El modelo no tiene geometría visible.") }
  const root = new Group(), centering = new Group()
  root.scale.setScalar(2 / edge); centering.position.copy(center).negate(); centering.add(gltf.scene); root.add(centering)
  const mixer = new AnimationMixer(gltf.scene)
  const actions = gltf.animations.map(clip => mixer.clipAction(clip))
  let selection = ""
  return {
    root,
    update(object: Extract<SceneObject, { kind: "model" }>, seconds: number) {
      const key = `${object.clip}:${object.loop}`
      if (selection !== key) {
        selection = key; mixer.stopAllAction()
        actions.forEach((action, i) => {
          if (object.clip === -2 || object.clip === i) { action.reset(); action.setLoop(object.loop ? LoopRepeat : LoopOnce, object.loop ? Infinity : 1); action.clampWhenFinished = true; action.play() }
        })
      }
      // Explicit absolute time makes reverse scrubbing and replay deterministic,
      // including actions that had already reached their last frame.
      actions.forEach((action, i) => { if (object.clip === -2 || object.clip === i) { action.enabled = true; action.paused = false } })
      mixer.setTime(seconds * object.speed)
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); root.removeFromParent(); dispose() },
  }
}
