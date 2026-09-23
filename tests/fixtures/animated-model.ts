/** Original synthetic GLB: a skinned tetrahedron, morph target and two complete clips. */
export function modelFixture(mutate: (doc: any) => void = () => {}, textured = false) {
  const blocks: Buffer[] = [], bufferViews: any[] = [], accessors: any[] = []
  const accessor = (array: Float32Array | Uint16Array, type: string, count: number, extra: any = {}) => {
    const bytes = Buffer.from(array.buffer), byteOffset = blocks.reduce((n, b) => n + b.length, 0)
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length }); blocks.push(bytes)
    if (bytes.length % 4) blocks.push(Buffer.alloc(4 - bytes.length % 4))
    accessors.push({ bufferView: bufferViews.length - 1, componentType: array instanceof Float32Array ? 5126 : 5123, count, type, ...extra })
    return accessors.length - 1
  }
  const position = accessor(new Float32Array([0, 1, 0, -1, -1, 1, 1, -1, 1, 0, -1, -1]), "VEC3", 4, { min: [-1, -1, -1], max: [1, 1, 1] })
  const indices = accessor(new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]), "SCALAR", 12)
  const joints = accessor(new Uint16Array(16), "VEC4", 4)
  const weights = accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4", 4)
  const morph = accessor(new Float32Array([0, .6, 0, -.2, 0, 0, .2, 0, 0, 0, 0, -.2]), "VEC3", 4, { min: [-.2, 0, -.2], max: [.2, .6, 0] })
  const inverse = accessor(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), "MAT4", 1)
  const time = accessor(new Float32Array([0, 9, 18]), "SCALAR", 3, { min: [0], max: [18] })
  const translation = accessor(new Float32Array([0, 0, 0, 0, .5, 0, 0, 0, 0]), "VEC3", 3)
  const rotation = accessor(new Float32Array([0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, -1]), "VEC4", 3)
  const morphTime = accessor(new Float32Array([0, 3, 6]), "SCALAR", 3, { min: [0], max: [6] })
  const morphValues = accessor(new Float32Array([0, 1, 0]), "SCALAR", 3)
  const uv = textured ? accessor(new Float32Array([.5, 1, 0, 0, 1, 0, .5, .5]), "VEC2", 4) : undefined
  if (textured) {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64")
    bufferViews.push({ buffer: 0, byteOffset: blocks.reduce((n, b) => n + b.length, 0), byteLength: png.length }); blocks.push(png)
    if (png.length % 4) blocks.push(Buffer.alloc(4 - png.length % 4))
  }
  const bin = Buffer.concat(blocks)
  const doc: any = {
    asset: { version: "2.0", generator: "Tloque synthetic QA" }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: "Root", children: [1, 2] }, { name: "Crystal", mesh: 0, skin: 0 }, { name: "Bone" }],
    buffers: [{ byteLength: bin.length }], bufferViews, accessors,
    meshes: [{ weights: [0], primitives: [{ attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights }, indices, material: 0, targets: [{ POSITION: morph }] }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.65, .4, 1, 1], metalnessFactor: .3, roughnessFactor: .4 }, doubleSided: true }],
    skins: [{ inverseBindMatrices: inverse, joints: [2], skeleton: 2 }],
    animations: [
      { name: "Vuelo completo", samplers: [{ input: time, output: translation }, { input: time, output: rotation }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }, { sampler: 1, target: { node: 2, path: "rotation" } }] },
      { name: "Cristal crece", samplers: [{ input: morphTime, output: morphValues }], channels: [{ sampler: 0, target: { node: 1, path: "weights" } }] },
    ],
  }
  if (textured) {
    doc.images = [{ mimeType: "image/png", bufferView: bufferViews.length - 1 }]; doc.textures = [{ source: 0 }]
    doc.meshes[0].primitives[0].attributes.TEXCOORD_0 = uv
    doc.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 }
  }
  mutate(doc)
  const json = Buffer.from(JSON.stringify(doc)), padding = (4 - json.length % 4) % 4, body = Buffer.concat([json, Buffer.alloc(padding, 32)])
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + body.length + bin.length, 8)
  header.writeUInt32LE(body.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, body, binHeader, bin])
}
