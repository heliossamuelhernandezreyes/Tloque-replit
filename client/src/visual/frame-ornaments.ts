import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, OctahedronGeometry, PlaneGeometry, DoubleSide, TorusGeometry } from "three"
import type { FrameScene } from "@shared/frame-scene"

/** Bounded procedural assets shared by Studio and the equipped frame's inspector. */
export function frameOrnaments(scene: FrameScene, profile: boolean) {
  const metal = new MeshPhysicalMaterial({ color: scene.material.color, metalness: scene.material.metalness, roughness: scene.material.roughness, clearcoat: 1, envMapIntensity: .5 })
  const crystal = new MeshPhysicalMaterial({ color: scene.material.accent, metalness: .35, roughness: .16, emissive: scene.material.accent, emissiveIntensity: .6, clearcoat: 1, envMapIntensity: .4 })
  const light = new MeshBasicMaterial({ color: scene.material.accent, transparent: true, opacity: .8 })
  const parts: Array<{ group: Group; x: number; y: number; angle: number }> = []
  const root = new Group()
  const count = scene.geometry.ornaments
  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2
    const edge = profile ? 1 : Math.max(Math.abs(Math.sin(angle)), Math.abs(Math.cos(angle)))
    const x = Math.sin(angle) / edge * 1.18, y = Math.cos(angle) / edge * (profile ? 1.18 : 1.65)
    const group = new Group(); group.position.set(x, y, .17); group.rotation.z = -angle
    root.add(group); parts.push({ group, x, y, angle })
    if (scene.style === "bloom") {
      for (let j = 0; j < 3; j++) {
        const geometry = new PlaneGeometry(.24, .62, 6, 10)
        const p = geometry.attributes.position
        for (let k = 0; k < p.count; k++) {
          const v = p.getY(k) / .62 + .5
          p.setXYZ(k, p.getX(k) * Math.sin(v * Math.PI), v * .62, Math.sin(v * Math.PI) * .13)
        }
        geometry.computeVertexNormals()
        const petal = new Mesh(geometry, metal); petal.rotation.z = (j - 1) * .65; group.add(petal)
      }
      metal.side = DoubleSide
    } else {
      const plate = new Mesh(new BoxGeometry(.22, .48, .065), metal)
      plate.rotation.z = Math.PI / 4; plate.scale.x = .65; group.add(plate)
      for (const side of [-1, 1]) {
        const tine = new Mesh(new BoxGeometry(.035, .43, .04), metal)
        tine.position.set(side * .12, .15, -.01); tine.rotation.z = -side * .3; group.add(tine)
      }
    }
    const gem = new Mesh(new OctahedronGeometry(scene.style === "reliquary" ? .105 : .08, 0), crystal)
    gem.position.set(0, .1, .09); gem.scale.y = 1.7; group.add(gem)
    const halo = new Mesh(new TorusGeometry(.19, .009, 4, 32), light)
    halo.position.z = -.01; group.add(halo)
  }
  const crown = new Group(); crown.position.set(0, profile ? 1.2 : 1.67, .18); root.add(crown)
  const orbits: Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const ring = new Mesh(new TorusGeometry(.23 + i * .07, i === 1 ? .018 : .009, 6, 64), i === 1 ? metal : light)
    crown.add(ring); orbits.push(ring)
  }
  const jewel = new Mesh(new OctahedronGeometry(.15), crystal); crown.add(jewel)
  return { root, parts, orbits, jewel, metal, crystal, light }
}
