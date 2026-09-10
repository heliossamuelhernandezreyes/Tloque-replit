import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide,
  ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, Path, PerspectiveCamera, PlaneGeometry,
  Points, PointsMaterial, Scene, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry,
  SRGBColorSpace, Texture, TextureLoader, TorusGeometry, Vector4, WebGLRenderTarget, type WebGLRenderer,
} from "three"
import { visualColor, visualFrame } from "@shared/visual-experience"
import { isSafeImageSource } from "@shared/media"
import type { VisualOptions } from "./VisualEngine"

export interface VisualScene {
  update: (time: number, dt: number, aspect: number, pointer: { x: number; y: number }, options: VisualOptions) => void
  render: (renderer: WebGLRenderer) => void
  ready: () => boolean
  dispose: () => void
}
export const sceneKey = (options: VisualOptions) => JSON.stringify([options.kind, options.theme, visualColor(options.color), options.images?.slice(0, 3), visualFrame(options.frame, options.color), options.shape])

function roundedPath<T extends Shape | Path>(path: T, width: number, height: number, radius: number): T {
  const x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2)
  path.moveTo(x + r, y)
  path.lineTo(x + width - r, y); path.quadraticCurveTo(x + width, y, x + width, y + r)
  path.lineTo(x + width, y + height - r); path.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  path.lineTo(x + r, y + height); path.quadraticCurveTo(x, y + height, x, y + height - r)
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y)
  path.closePath(); return path
}

const orbitalVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
const orbitalFragment = `
  varying vec2 vUv;
  uniform float uTime; uniform float uEnergy; uniform vec3 uColor;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){
    vec2 p=(vUv-.5)*2.; float r=length(p); float angle=atan(p.y,p.x);
    float hole=.285+uEnergy*.055;
    float photon=exp(-pow((r-hole-.03)*56.,2.));
    vec2 disk=vec2(p.x,p.y*2.65+.08*sin(p.x*5.));
    float dr=length(disk); float da=atan(disk.y,disk.x);
    float turbulence=.6+.4*sin(da*9.-uTime*1.3+sin(dr*29.+uTime)*1.5);
    float spiral=exp(-pow((dr-.58)*10.,2.))*turbulence;
    float farArc=exp(-pow((r-.43)*28.,2.))*(.55+.45*sin(angle*4.-uTime));
    float halo=exp(-r*4.8)*.24;
    float cut=smoothstep(hole-.015,hole+.025,r);
    float light=(spiral*(p.y<0.?1.:cut)+photon+farArc*cut*.32+halo)*(.72+uEnergy*.5);
    vec3 c=mix(uColor,vec3(1.,.94,.83),clamp(photon+spiral*.4,0.,1.));
    float edge=1.-smoothstep(.82,1.,r);
    float alpha=clamp(light*edge,0.,1.);
    if(r<hole+.01){alpha=1.;c=vec3(.002,.002,.005);light=1.;}
    gl_FragColor=vec4(c*light,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

/** One bounded scene per visible slot. No scripts, remote shaders or user geometry. */
export function createVisualScene(options: VisualOptions, maxTextureEdge: number, environment?: Texture): VisualScene {
  const scene = new Scene()
  scene.environment = environment ?? null
  const camera = new PerspectiveCamera(36, 1, 0.1, 40)
  camera.position.z = 5.2
  const group = new Group(); scene.add(group)
  scene.add(new HemisphereLight(0xdbe7ff, 0x211324, 2.2), new AmbientLight(0xffffff, 0.5))
  const key = new DirectionalLight(0xfff0d6, 4); key.position.set(-3, 5, 6); scene.add(key)
  const rim = new DirectionalLight(0x7dc8ff, 3); rim.position.set(4, -1, 3); scene.add(rim)
  const ownedTextures = new Set<Texture>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false, pending = 0, failed = false
  let renderTarget: WebGLRenderTarget | null = null
  let world: Scene | null = null
  let worldCamera: PerspectiveCamera | null = null
  const petals: Group[] = []
  const rings: Mesh[] = []
  let orbitMaterial: ShaderMaterial | undefined
  let particles: Points | undefined
  let openness = 0, pointerX = 0, pointerY = 0
  let portalWidth = 2.12, portalHeight = options.shape === "profile" ? 2.12 : 3
  const color = new Color(visualColor(options.color))

  function loadTexture(url: string, targetAspect: number, attach: (texture: Texture) => void) {
    if (!isSafeImageSource(url) || url.length > 8_000_000) { failed = true; return }
    pending++
    let settled = false
    const finish = (error: boolean) => {
      if (settled) return
      settled = true; pending--; failed ||= error; clearTimeout(timer); timers.delete(timer)
    }
    const timer = setTimeout(() => finish(true), 12_000); timers.add(timer)
    new TextureLoader().load(url, (texture: Texture) => {
      if (disposed || settled) { texture.dispose(); return }
      ownedTextures.add(texture)
      try {
        const source = texture.image as HTMLImageElement
        if (!source.width || !source.height || source.width * source.height > 24_000_000) { finish(true); return }
        const scale = Math.min(1, maxTextureEdge / Math.max(source.width, source.height))
        if (scale < 1) {
          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale))
          const context = canvas.getContext("2d")
          if (!context) { finish(true); return }
          context.drawImage(source, 0, 0, canvas.width, canvas.height); texture.image = canvas
        }
        texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true
        const imageAspect = source.width / source.height
        if (imageAspect > targetAspect) { texture.repeat.x = targetAspect / imageAspect; texture.offset.x = (1 - texture.repeat.x) / 2 }
        else { texture.repeat.y = imageAspect / targetAspect; texture.offset.y = (1 - texture.repeat.y) / 2 }
        attach(texture); finish(false)
      } catch { finish(true) }
    }, undefined, () => { if (!disposed) finish(true) })
  }

  function sparkField(count: number, parent: Group | Scene, radius: number) {
    const vertices: number[] = []
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996323, r = radius * (0.4 + ((i * 37) % 101) / 101 * 0.6)
      vertices.push(Math.cos(a) * r, Math.sin(a) * r, Math.sin(i * 1.7) * .55)
    }
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3))
    const points = new Points(geometry, new PointsMaterial({ color, size: .022, transparent: true, opacity: .7, blending: AdditiveBlending, depthWrite: false }))
    parent.add(points); return points
  }

  if (options.kind === "orb" && options.theme !== "fluorescent-rose") {
    orbitMaterial = new ShaderMaterial({ vertexShader: orbitalVertex, fragmentShader: orbitalFragment, uniforms: {
      uTime: { value: 0 }, uEnergy: { value: .5 }, uColor: { value: color },
    }, transparent: true, depthWrite: false })
    group.add(new Mesh(new PlaneGeometry(3.05, 3.05), orbitMaterial))
  } else if (options.kind === "orb") {
    // Curved petals are geometry, animated around their root. No external model needed.
    const petalMaterial = new MeshPhysicalMaterial({ color: 0xff4dab, metalness: .18, roughness: .28, clearcoat: 1, emissive: 0xea1686, emissiveIntensity: .48, side: DoubleSide })
    for (let i = 0; i < 18; i++) {
      const outer = i < 10, geometry = new PlaneGeometry(1, 1, 10, 14)
      const position = geometry.attributes.position
      for (let j = 0; j < position.count; j++) {
        const u = position.getX(j) * 2, v = position.getY(j) + .5
        const width = Math.sin(Math.PI * v) * .42 * (outer ? 1 : .8)
        position.setXYZ(j, u * width, v * (outer ? 1.3 : 1), .26 * Math.sin(v * Math.PI) + .18 * u * u * Math.sin(v * Math.PI))
      }
      geometry.computeVertexNormals()
      const axis = new Group(); axis.rotation.z = (i % 10) / (outer ? 10 : 8) * Math.PI * 2 + (outer ? 0 : .3)
      const hinge = new Group(); hinge.position.y = .04; hinge.add(new Mesh(geometry, petalMaterial))
      axis.add(hinge); group.add(axis); petals.push(hinge)
    }
    group.add(new Mesh(new SphereGeometry(.19, 24, 16), new MeshPhysicalMaterial({ color: 0xffe0f3, emissive: 0xff3298, emissiveIntensity: 1, roughness: .2, metalness: .25 })))
    particles = sparkField(48, group, 1.4)
  } else if (options.kind === "reveal") {
    for (let i = 0; i < 4; i++) {
      const ring = new Mesh(new TorusGeometry(.8 + i * .12, .012, 8, 80), new MeshBasicMaterial({ color, transparent: true, opacity: .8, blending: AdditiveBlending }))
      ring.rotation.x = i * .5; ring.rotation.y = i * .7; group.add(ring); rings.push(ring)
    }
    particles = sparkField(96, group, 1.4)
  } else if (options.kind === "book") {
    const caseMaterial = new MeshPhysicalMaterial({ color: 0x272335, roughness: .4, clearcoat: .5 })
    const pages = new Mesh(new BoxGeometry(2.05, 3.06, .22), new MeshStandardMaterial({ color: 0xe7ddc4, roughness: .9 }))
    group.add(pages)
    for (const z of [-.15, .15]) {
      const cover = new Mesh(new BoxGeometry(2.2, 3.2, .045), caseMaterial); cover.position.z = z; group.add(cover)
    }
    const spine = new Mesh(new BoxGeometry(.075, 3.2, .32), caseMaterial); spine.position.x = -1.075; group.add(spine)
    // The existing authorized cover is the texture; no invented/generated edition art.
    if (options.images?.[0]) loadTexture(options.images[0], 2.2 / 3.2, texture => {
      const cover = new Mesh(new PlaneGeometry(2.18, 3.18), new MeshPhysicalMaterial({ map: texture, roughness: .48, metalness: 0, clearcoat: .35, clearcoatRoughness: .4 }))
      cover.position.z = .177; group.add(cover)
    })
    else failed = true // Keep the DOM title when this edition has no cover.
  } else {
    const frame = visualFrame(options.frame, options.color)
    const profile = options.shape === "profile"
    const rimWidth = .08 + frame.thickness
    const outer = profile ? new Shape().absarc(0, 0, 1.18, 0, Math.PI * 2, false) as Shape : roundedPath(new Shape(), 2.38, 3.3, frame.radius + .12)
    const hole = profile ? new Path().absarc(0, 0, 1.05, 0, Math.PI * 2, true) : roundedPath(new Path(), portalWidth, portalHeight, .12)
    outer.holes.push(hole)
    const bezel = new Mesh(new ExtrudeGeometry(outer, { depth: rimWidth, bevelEnabled: true, bevelThickness: .025, bevelSize: .028, bevelSegments: 3, steps: 1, curveSegments: 12 }),
      new MeshPhysicalMaterial({ color: frame.color, metalness: frame.metalness, roughness: frame.roughness, clearcoat: .85, clearcoatRoughness: .2 }))
    group.add(bezel)
    // A separate 3D world becomes a texture ONLY on the aperture geometry.
    // It cannot paint outside the rounded/circular portal, even after rotation.
    const targetHeight = Math.min(maxTextureEdge, 1024)
    renderTarget = new WebGLRenderTarget(Math.round(targetHeight * portalWidth / portalHeight), targetHeight, { depthBuffer: true })
    world = new Scene(); world.background = new Color(0x090c19); world.environment = environment ?? null
    worldCamera = new PerspectiveCamera(40, portalWidth / portalHeight, .1, 45); worldCamera.position.z = 6
    world.add(new HemisphereLight(0xeaf0ff, 0x17122a, 3))
    const worldLight = new DirectionalLight(0xb78cff, 5); worldLight.position.set(3, 4, 4); world.add(worldLight)
    // Receding geometric arches and a reflective floor give an actual spatial backdrop.
    for (let i = 0; i < 5; i++) {
      const arch = new Mesh(new TorusGeometry(2.4, .055, 8, 64), new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .3, metalness: .4, roughness: .35 }))
      arch.position.z = -i * 2; world.add(arch)
    }
    const floor = new Mesh(new PlaneGeometry(30, 30), new MeshStandardMaterial({ color: 0x151126, metalness: .4, roughness: .32 }))
    floor.rotation.x = -Math.PI / 2; floor.position.y = -2.5; floor.position.z = -6; world.add(floor)
    particles = sparkField(48, world, 3)
    particles.position.z = -1
    const urls = (options.images ?? []).slice(0, 3).filter(url => !!url)
    for (const [index, url] of urls.entries()) {
      loadTexture(url, portalWidth / portalHeight, texture => {
        const z = index * .7
        const height = 2 * Math.tan(20 * Math.PI / 180) * (6 - z) * 1.15
        const plane = new Mesh(new PlaneGeometry(height * portalWidth / portalHeight, height), new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .01, depthWrite: false, side: DoubleSide }))
        plane.position.z = z; plane.renderOrder = index + 1; world!.add(plane)
      })
    }
    const windowGeometry = profile ? new CircleGeometry(1.05, 64) : new ShapeGeometry(roundedPath(new Shape(), portalWidth, portalHeight, .12), 16)
    // ShapeGeometry UVs are world-space: map the aperture to the complete target.
    const uv = windowGeometry.attributes.uv, p = windowGeometry.attributes.position
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / portalWidth + .5, p.getY(i) / portalHeight + .5)
    const portal = new Mesh(windowGeometry, new MeshBasicMaterial({ map: renderTarget.texture, side: DoubleSide, toneMapped: false }))
    portal.position.z = -.015; group.add(portal)
    const glass = new Mesh(windowGeometry, new MeshPhysicalMaterial({ color: 0xc8deff, metalness: .15, roughness: .18, transparent: true, opacity: frame.glass * .3, clearcoat: 1, depthWrite: false }))
    glass.position.z = .09; group.add(glass)
  }

  const disposeScene = (target: Scene) => {
    const geometries = new Set<BufferGeometry>(), materials = new Set<any>()
    target.traverse(object => {
      const mesh = object as Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material))
    })
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose())
  }
  return {
    ready: () => !disposed && !failed && pending === 0,
    update(time, dt, aspect, pointer, current) {
      const lerp = 1 - Math.exp(-dt * 7)
      openness += ((current.active ? 1 : current.pressed ? .9 : .15) - openness) * lerp
      pointerX += (pointer.x - pointerX) * lerp; pointerY += (pointer.y - pointerY) * lerp
      camera.aspect = aspect
      camera.position.z = options.kind === "portal" || options.kind === "frame" || options.kind === "book" ? Math.max(5.8, 3.8 / aspect) : Math.max(4.8, 4.8 / aspect)
      camera.updateProjectionMatrix()
      if (orbitMaterial) { orbitMaterial.uniforms.uTime.value = time; orbitMaterial.uniforms.uEnergy.value = openness + (current.pulse ? .5 : 0) }
      petals.forEach((petal, index) => { petal.rotation.x = (.95 - openness * .84) + Math.sin(time * .8 + index * .2) * .025 })
      if (petals.length) { group.rotation.z = Math.sin(time * .18) * .07; group.rotation.x = .12 + pointerY * .1 }
      if (particles) { particles.rotation.z = time * .035; particles.rotation.y = Math.sin(time * .2) * .08 }
      if (options.kind === "book") { group.rotation.y = -.18 + pointerX * .22; group.rotation.x = .045 - pointerY * .13; group.position.y = Math.sin(time * .65) * .018 }
      rings.forEach((ring, i) => { ring.rotation.x = time * (.18 + i * .07); ring.rotation.y = time * .22 + i; ring.scale.setScalar(1 + .07 * Math.sin(time * 3 + i)) })
      if (worldCamera) {
        group.rotation.y = pointerX * .15; group.rotation.x = -pointerY * .12
        // Off-axis view: the window stays fixed while nearer image layers move farther.
        const w = 800, h = Math.round(w * portalHeight / portalWidth)
        worldCamera.position.x = pointerX * .22; worldCamera.position.y = -pointerY * .18
        worldCamera.setViewOffset(w, h, -pointerX * 22, pointerY * 18, w, h)
      }
    },
    render(renderer) {
      if (renderTarget && world && worldCamera) {
        const viewport = renderer.getViewport(new Vector4())
        const scissor = renderer.getScissor(new Vector4())
        const wasScissored = renderer.getScissorTest()
        renderer.setRenderTarget(renderTarget); renderer.setScissorTest(false); renderer.setClearColor(0x090c19, 1); renderer.clear(true, true, true)
        renderer.render(world, worldCamera)
        renderer.setRenderTarget(null); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(wasScissored)
        renderer.setClearColor(0x000000, 0)
      }
      renderer.render(scene, camera)
    },
    dispose() { if (disposed) return; disposed = true; timers.forEach(clearTimeout); timers.clear(); disposeScene(scene); if (world) disposeScene(world); ownedTextures.forEach(texture => texture.dispose()); renderTarget?.dispose() },
  }
}
