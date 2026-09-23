import { MODEL_MAX_BYTES, MODEL_ANIMATION_MAX_SECONDS } from "./scene-content"

const fail = (message: string): never => { throw new Error(message) }
const integer = (n: unknown, max: number) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= max
const supported = new Set(["KHR_materials_unlit", "KHR_materials_clearcoat", "KHR_materials_ior", "KHR_materials_specular", "KHR_materials_sheen", "KHR_materials_emissive_strength", "KHR_materials_iridescence", "KHR_materials_anisotropy", "KHR_materials_transmission", "KHR_materials_volume", "KHR_materials_dispersion", "KHR_texture_transform", "KHR_mesh_quantization"])

/** Validate before GLTFLoader allocates resources. One embedded buffer, no network references. */
export function inspectGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 28 || bytes.byteLength > MODEL_MAX_BYTES) fail("El GLB debe pesar como máximo 20 MB.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) fail("Selecciona un archivo GLB 2.0 válido.")
  const length = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a || length > 2_000_000 || length % 4 || 20 + length + 8 > bytes.length) fail("La cabecera del GLB no es válida.")
  const binHeader = 20 + length, binLength = view.getUint32(binHeader, true), binStart = binHeader + 8
  if (view.getUint32(binHeader + 4, true) !== 0x004e4942 || binLength % 4 || binStart + binLength !== bytes.length) fail("El GLB debe contener su geometría y texturas en un único bloque integrado.")
  let doc: any
  try { doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + length))) } catch { fail("El GLB contiene JSON no válido.") }
  let visited = 0
  const walk = (value: any, depth = 0) => {
    if (++visited > 100_000 || depth > 32) fail("El modelo es demasiado complejo.")
    if (typeof value === "number" && !Number.isFinite(value)) fail("El modelo contiene números no válidos.")
    if (!value || typeof value !== "object") return
    for (const [key, item] of Object.entries(value)) {
      if (["uri", "__proto__", "prototype", "constructor"].includes(key)) fail("Exporta un GLB con las texturas integradas, sin archivos externos.")
      walk(item, depth + 1)
    }
  }
  walk(doc)
  if (doc.asset?.version !== "2.0") fail("Se necesita GLB 2.0.")
  for (const extension of [...(doc.extensionsRequired ?? []), ...(doc.extensionsUsed ?? [])]) if (!supported.has(extension)) fail(`Exporta sin la extensión ${String(extension).slice(0, 80)}. Usa mallas sin compresión y texturas PNG/JPEG.`)
  // Reject undeclared extensions too; the loader otherwise still executes their plugins.
  const extensions = (value: any) => {
    if (!value || typeof value !== "object") return
    if (value.extensions) for (const name of Object.keys(value.extensions)) if (!supported.has(name)) fail(`Extensión no admitida: ${name.slice(0, 80)}.`)
    Object.values(value).forEach(extensions)
  }
  extensions(doc)
  const list = (name: string, max: number): any[] => {
    const value = doc[name] ?? []
    if (!Array.isArray(value) || value.length > max) fail(`Demasiados elementos en ${name}.`)
    return value
  }
  const buffers = list("buffers", 1), views = list("bufferViews", 2048), accessors = list("accessors", 2048)
  if (buffers.length !== 1 || !integer(buffers[0].byteLength, binLength) || binLength - buffers[0].byteLength > 3) fail("El bloque de datos no coincide con el modelo.")
  for (const v of views) if (v.buffer !== 0 || !integer(v.byteOffset ?? 0, binLength) || !integer(v.byteLength, binLength) || (v.byteOffset ?? 0) + v.byteLength > buffers[0].byteLength || v.byteStride != null && (!integer(v.byteStride, 252) || v.byteStride < 4 || v.byteStride % 4)) fail("El modelo contiene una región de datos inválida.")
  const ref = (array: any[], index: any): any => integer(index, array.length - 1) ? array[index] : fail("El modelo contiene una referencia inválida.")
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  const widths: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  let values = 0
  for (const a of accessors) {
    const v = ref(views, a.bufferView), width = widths[a.componentType], count = components[a.type]
    if (!width || !count || a.sparse || !integer(a.count, 240_000) || !integer(a.byteOffset ?? 0, v.byteLength)) fail("Exporta accesores completos, sin datos sparse, de hasta 240 000 vértices.")
    const size = width * count, stride = v.byteStride ?? size, offset = a.byteOffset ?? 0
    if (stride < size || offset % width || ((v.byteOffset ?? 0) + offset) % width || offset + Math.max(0, a.count - 1) * stride + (a.count ? size : 0) > v.byteLength) fail("La geometría excede el bloque de datos.")
    values += a.count * count
    if (values > 4_000_000) fail("Simplifica el modelo o sus animaciones antes de importarlo.")
    if (a.componentType === 5126) for (let i = 0; i < a.count; i++) for (let c = 0; c < count; c++) {
      const n = view.getFloat32(binStart + (v.byteOffset ?? 0) + offset + i * stride + c * width, true)
      if (!Number.isFinite(n) || Math.abs(n) > 1e8) fail("El modelo contiene coordenadas no válidas.")
    }
  }
  const meshes = list("meshes", 64), nodes = list("nodes", 256), materials = list("materials", 64), textures = list("textures", 32), images = list("images", 16), skins = list("skins", 16)
  let triangles = 0, draws = 0
  const costs = meshes.map(mesh => {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) fail("Falta la geometría de una malla.")
    let cost = 0
    for (const p of mesh.primitives) {
      if (p.mode != null && p.mode !== 4) fail("Exporta la malla con caras triangulares.")
      const position = ref(accessors, p.attributes?.POSITION)
      if (position.type !== "VEC3") fail("Las posiciones deben tener tres componentes.")
      for (const index of Object.values(p.attributes ?? {})) ref(accessors, index)
      if (p.material != null) ref(materials, p.material)
      if ((p.targets?.length ?? 0) > 16) fail("Usa hasta 16 objetivos de deformación por malla.")
      for (const target of p.targets ?? []) for (const index of Object.values(target)) ref(accessors, index)
      cost += (p.indices == null ? position.count : ref(accessors, p.indices).count) / 3
    }
    return cost
  })
  const parents = new Set<number>()
  for (const node of nodes) {
    if (node.mesh != null) { const m = ref(meshes, node.mesh); draws += m.primitives.length; triangles += costs[node.mesh] }
    if (node.skin != null) ref(skins, node.skin)
    for (const index of node.children ?? []) { ref(nodes, index); if (parents.has(index)) fail("Un nodo no puede tener varios padres."); parents.add(index) }
  }
  const visit = (index: number, path = new Set<number>()) => {
    if (path.has(index) || path.size > 64) fail("La jerarquía del modelo contiene un ciclo o demasiados niveles.")
    const next = new Set(path); next.add(index)
    for (const child of ref(nodes, index).children ?? []) visit(child, next)
  }
  nodes.forEach((_, i) => visit(i))
  const scenes = list("scenes", 16)
  if (!scenes.length) fail("El GLB debe incluir una escena.")
  const active = ref(scenes, doc.scene ?? 0)
  if (!Array.isArray(active.nodes) || !active.nodes.length) fail("La escena está vacía.")
  for (const scene of scenes) for (const index of scene.nodes ?? []) { ref(nodes, index); if (parents.has(index)) fail("Una raíz de escena no puede tener padre.") }
  if (!triangles || triangles > 80_000 || draws > 64) fail("Usa un modelo de hasta 80 000 triángulos y 64 mallas dibujables.")
  for (const skin of skins) {
    if (!Array.isArray(skin.joints) || skin.joints.length > 128) fail("El esqueleto admite hasta 128 huesos.")
    skin.joints.forEach((i: number) => ref(nodes, i)); if (skin.inverseBindMatrices != null) ref(accessors, skin.inverseBindMatrices)
  }
  // Read image dimensions without decoding their pixels on the server.
  let pixels = 0
  for (const image of images) {
    const v = ref(views, image.bufferView), start = binStart + (v.byteOffset ?? 0), end = start + v.byteLength
    let w = 0, h = 0
    if (image.mimeType === "image/png" && v.byteLength >= 24 && view.getUint32(start) === 0x89504e47 && view.getUint32(start + 12) === 0x49484452) { w = view.getUint32(start + 16); h = view.getUint32(start + 20) }
    else if (image.mimeType === "image/jpeg" && v.byteLength > 4 && view.getUint16(start) === 0xffd8) {
      let p = start + 2
      while (p + 4 <= end) {
        if (bytes[p] !== 0xff) break
        const marker = bytes[p + 1], size = view.getUint16(p + 2)
        if (size < 2 || p + 2 + size > end) break
        if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 7) { h = view.getUint16(p + 5); w = view.getUint16(p + 7); break }
        p += size + 2
      }
    }
    if (!w || !h || w > 2048 || h > 2048) fail("Integra texturas PNG o JPEG de hasta 2048 × 2048 píxeles.")
    pixels += w * h
    if (pixels > 8_388_608) fail("Las texturas juntas deben ocupar como máximo 8 megapíxeles.")
  }
  for (const texture of textures) ref(images, texture.source)
  const clips = list("animations", 24).map((animation, index) => {
    if (!Array.isArray(animation.samplers) || animation.samplers.length > 256 || !Array.isArray(animation.channels) || animation.channels.length > 256) fail("Demasiadas pistas de animación.")
    let duration = 0
    for (const sampler of animation.samplers) {
      const a = ref(accessors, sampler.input); ref(accessors, sampler.output)
      if (a.type !== "SCALAR" || a.componentType !== 5126 || ![undefined, "LINEAR", "STEP", "CUBICSPLINE"].includes(sampler.interpolation)) fail("Los tiempos de animación no son válidos.")
      const v = ref(views, a.bufferView); let previous = -1
      for (let i = 0; i < a.count; i++) {
        const time = view.getFloat32(binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? 4), true)
        if (time < 0 || time <= previous || time > MODEL_ANIMATION_MAX_SECONDS) fail("Cada animación debe durar hasta 120 segundos y tener tiempos ordenados.")
        previous = time; duration = Math.max(duration, time)
      }
    }
    for (const channel of animation.channels) {
      ref(animation.samplers, channel.sampler); ref(nodes, channel.target?.node)
      if (!["translation", "rotation", "scale", "weights"].includes(channel.target?.path)) fail("La animación contiene una pista no admitida.")
    }
    return { name: String(animation.name || `Animación ${index + 1}`).slice(0, 128), duration }
  })
  return { clips, triangles: Math.ceil(triangles), nodes: nodes.length, bytes: bytes.length }
}
