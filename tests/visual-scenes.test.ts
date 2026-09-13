import test from "node:test"
import assert from "node:assert/strict"
import { Mesh, Scene, ShaderMaterial, Texture, TextureLoader, Vector4, type WebGLRenderer, type WebGLRenderTarget } from "three"
import { createVisualScene, sceneKey } from "../client/src/visual/scenes"
import { applyCardMotion, createCardScene } from "../shared/card-scene"

class RendererRecorder {
  viewport = new Vector4(20, 30, 200, 300)
  scissor = new Vector4(20, 30, 200, 300)
  scissored = true
  target: WebGLRenderTarget | null = null
  renders: Array<{ scene: Scene; target: WebGLRenderTarget | null }> = []
  getViewport(out: Vector4) { return out.copy(this.viewport) }
  getScissor(out: Vector4) { return out.copy(this.scissor) }
  getScissorTest() { return this.scissored }
  setScissorTest(value: boolean) { this.scissored = value }
  setRenderTarget(value: WebGLRenderTarget | null) { this.target = value }
  setViewport(value: Vector4) { this.viewport.copy(value) }
  setScissor(value: Vector4) { this.scissor.copy(value) }
  setClearColor() {}
  clear() {}
  render(scene: Scene) { this.renders.push({ scene, target: this.target }) }
  asRenderer() { return this as unknown as WebGLRenderer }
}

test("el mundo del portal se dibuja en un target y sólo su abertura lo muestra", () => {
  const resource = createVisualScene({ kind: "portal" }, 1024)
  const recorder = new RendererRecorder()
  try {
    assert.equal(resource.ready(), true)
    resource.update(1, 1 / 30, 5 / 7, { x: 1, y: .5 }, { kind: "portal" })
    resource.render(recorder.asRenderer())
    assert.equal(recorder.renders.length, 2)
    const [world, outer] = recorder.renders
    assert.ok(world.target)
    assert.equal(outer.target, null)
    assert.ok(world.target.height <= 1024)
    let windows = 0, frames = 0
    outer.scene.traverse(object => {
      if (!(object instanceof Mesh)) return
      if (object.geometry.type === "ShapeGeometry") {
        windows++
        const uv = object.geometry.attributes.uv
        for (let i = 0; i < uv.count; i++) { assert.ok(uv.getX(i) >= -1e-6 && uv.getX(i) <= 1.000001); assert.ok(uv.getY(i) >= -1e-6 && uv.getY(i) <= 1.000001) }
      }
      if (object.geometry.type === "ExtrudeGeometry") { frames++; assert.equal(object.geometry.parameters.shapes.holes.length, 1) }
    })
    assert.equal(windows, 2, "abertura y cristal comparten el recorte geométrico")
    assert.equal(frames, 1)
    assert.deepEqual(recorder.viewport.toArray(), [20, 30, 200, 300])
    assert.equal(recorder.scissored, true)
  } finally { resource.dispose() }
})

test("el marco de perfil conserva una abertura circular real", () => {
  const resource = createVisualScene({ kind: "frame", shape: "profile" }, 1024)
  const recorder = new RendererRecorder()
  try {
    resource.render(recorder.asRenderer())
    let circles = 0
    recorder.renders[1].scene.traverse(object => { if (object instanceof Mesh && object.geometry.type === "CircleGeometry") circles++ })
    assert.equal(circles, 2)
  } finally { resource.dispose() }
})

test("rosa y singularidad generan geometría finita y liberan recursos una vez", () => {
  for (const theme of ["fluorescent-rose", "singularity"] as const) {
    const options = { kind: "orb" as const, theme }
    const resource = createVisualScene(options, 1024), recorder = new RendererRecorder()
    resource.update(20, .05, 1, { x: .6, y: -.8 }, { ...options, active: true })
    resource.render(recorder.asRenderer())
    const geometries = new Set<any>()
    recorder.renders[0].scene.traverse(object => {
      const geometry = (object as Mesh).geometry
      if (!geometry) return
      geometries.add(geometry)
      assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite))
    })
    assert.equal(geometries.size, theme === "fluorescent-rose" ? 20 : 1)
    let disposed = 0
    geometries.forEach(geometry => geometry.addEventListener("dispose", () => disposed++))
    resource.dispose(); resource.dispose()
    assert.equal(disposed, geometries.size)
    assert.equal(resource.ready(), false)
  }
})

test("sin portada el libro retiene su título DOM en vez de una cubierta vacía", () => {
  const resource = createVisualScene({ kind: "book" }, 1024)
  assert.equal(resource.ready(), false)
  resource.dispose()
})

test("imágenes inseguras no alcanzan el cargador", () => {
  const resource = createVisualScene({ kind: "portal", images: ["javascript:alert(1)"] }, 1024)
  assert.equal(resource.ready(), false)
  resource.dispose()
})

test("la imagen no oculta el fallback antes de cargar y se libera al cerrar", () => {
  const original = TextureLoader.prototype.load
  let resolve: (texture: Texture) => void = () => {}
  TextureLoader.prototype.load = function (_url, onLoad) { resolve = onLoad as typeof resolve; return new Texture() } as typeof original
  const resource = createVisualScene({ kind: "portal", images: ["https://example.test/image.png"] }, 1024)
  try {
    assert.equal(resource.ready(), false)
    const texture = new Texture({ width: 700, height: 1000 } as HTMLImageElement)
    let freed = false; texture.addEventListener("dispose", () => { freed = true })
    resolve(texture)
    assert.equal(resource.ready(), true)
    resource.dispose()
    assert.equal(freed, true)
  } finally { resource.dispose(); TextureLoader.prototype.load = original }
})

test("una imagen que llega después del cierre no resucita la escena", () => {
  const original = TextureLoader.prototype.load
  let resolve: (texture: Texture) => void = () => {}
  TextureLoader.prototype.load = function (_url, onLoad) { resolve = onLoad as typeof resolve; return new Texture() } as typeof original
  const resource = createVisualScene({ kind: "book", images: ["https://example.test/cover.jpg"] }, 1024)
  try {
    resource.dispose()
    const texture = new Texture()
    let freed = false; texture.addEventListener("dispose", () => { freed = true })
    resolve(texture)
    assert.equal(freed, true)
    assert.equal(resource.ready(), false)
  } finally { resource.dispose(); TextureLoader.prototype.load = original }
})

test("gestos no reconstruyen la escena; cambiar tema sí", () => {
  assert.equal(sceneKey({ kind: "orb", active: false }), sceneKey({ kind: "orb", active: true, pulse: true }))
  assert.notEqual(sceneKey({ kind: "orb" }), sceneKey({ kind: "orb", theme: "fluorescent-rose" }))
})

test("planos de tarjeta respetan identidad, claves, alfa, tiempo absoluto y disposición", () => {
  const original = TextureLoader.prototype.load
  const loaded: Texture[] = []
  TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new Texture({ width: 700, height: 980 } as HTMLImageElement); loaded.push(texture)
    queueMicrotask(() => onLoad?.(texture))
    return texture
  } as typeof original
  const cardScene = applyCardMotion(createCardScene(), "reveal")
  cardScene.finish = { type: "prismatic", strength: .4 }
  const options = { kind: "portal" as const, images: ["https://x.test/back.webp", "", "https://x.test/front.webp"], cardScene, transport: { current: { time: 0, mode: "inspection" as const } } }
  const resource = createVisualScene(options, 1024), recorder = new RendererRecorder()
  return new Promise<void>(resolve => queueMicrotask(resolve)).then(() => {
    assert.equal(resource.ready(), true)
    resource.update(99, 1 / 30, 1, { x: 0, y: 0 }, options); resource.render(recorder.asRenderer())
    const planes: Mesh<any, ShaderMaterial>[] = []
    recorder.renders[0].scene.traverse(object => {
      if (object instanceof Mesh && object.material instanceof ShaderMaterial && object.material.uniforms.uMap) planes.push(object as Mesh<any, ShaderMaterial>)
    })
    assert.deepEqual(planes.map(plane => plane.renderOrder), [1, 3])
    assert.equal(recorder.renders[0].scene.children.some(object => object instanceof Mesh && object.geometry.type === "TorusGeometry"), false, "authored card without a gallery frame has no forced arches")
    const front = planes[1]
    assert.equal(front.material.uniforms.uOpacity.value, 0)
    assert.equal(front.material.depthTest, false, "procedural background never hides the authored image")
    options.transport.current.time = 4
    resource.update(200, 1 / 30, 1, { x: 0, y: 0 }, options)
    const pose = front.position.clone()
    assert.equal(front.material.uniforms.uOpacity.value, 1)
    assert.equal(front.material.uniforms.uFinish.value, 2)
    resource.update(900, 1 / 30, 1, { x: 0, y: 0 }, options)
    assert.deepEqual(front.position, pose, "paused transport does not advance with wall time")
    let disposedTextures = 0, disposedMaterials = 0
    loaded.forEach(texture => texture.addEventListener("dispose", () => disposedTextures++))
    planes.forEach(plane => plane.material.addEventListener("dispose", () => disposedMaterials++))
    resource.dispose(); resource.dispose()
    assert.equal(disposedTextures, 2); assert.equal(disposedMaterials, 2)
  }).finally(() => { resource.dispose(); TextureLoader.prototype.load = original })
})
