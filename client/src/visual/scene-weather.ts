import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, NormalBlending, Points, ShaderMaterial, type Scene } from "three"
import type { SceneContent } from "@shared/scene-content"

// Deterministic GPU particles: the same time always yields the same weather.
// A single bounded draw call replaces the old per-card Canvas2D loops.
export function createSceneWeather(world: Scene) {
  const count = 160, geometry = new BufferGeometry(), vertices = [], seeds = []
  for (let i = 0; i < count; i++) { vertices.push(((i * 73) % 157) / 157 * 4 - 2, ((i * 47) % 163) / 163 * 5 - 2.5, ((i * 23) % 167) / 167 * 2 + .8); seeds.push((i * 31 % 173) / 173) }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3)); geometry.setAttribute("seed", new Float32BufferAttribute(seeds, 1))
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true, uniforms: { uTime: { value: 0 }, uKind: { value: 0 }, uIntensity: { value: .5 }, uColor: { value: new Color("#badbff") } }, vertexShader: `
    attribute float seed; uniform float uTime; uniform float uKind; uniform float uIntensity; varying float vFade;
    void main(){ vec3 p=position; float t=uTime; float life=fract(seed+t*.22);
      if(uKind<1.5){p.y=2.5-mod(position.y+2.5+t*(2.8+seed),5.);p.x+=sin(seed*30.+t)*.08;}
      else if(uKind<2.5){p.x=position.x*.65+sin(t*2.+seed*18.)*.12;p.y=-2.4+life*3.2;p.z=1.6+seed;}
      else if(uKind<3.5){p.y=2.5-mod(position.y+2.5+t*.5,5.);p.x+=sin(t+seed*12.)*.25;}
      else if(uKind<5.5){p.y=-2.4+life*5.;p.x+=sin(t*.6+seed*18.)*.35;}
      else {p.x+=sin(t*.4+seed*21.)*.12;}
      vFade=(uKind>1.5&&uKind<2.5 || uKind>3.5&&uKind<5.5)?sin(life*3.14159):.55+.45*sin(seed*40.+t);
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
      float s=uKind>4.5&&uKind<5.5?44.:uKind>1.5&&uKind<2.5?24.:uKind<1.5?15.:5.;
      gl_PointSize=clamp(s*(3.8/-mv.z),1.,56.);vFade*=uIntensity;
    }`, fragmentShader: `
    uniform vec3 uColor; uniform float uKind; varying float vFade;
    void main(){vec2 p=gl_PointCoord-.5;if(uKind<1.5)p.x*=8.;
      float a=1.-smoothstep(.05,.5,length(p));vec3 c=uColor;
      if(uKind>1.5&&uKind<2.5)c=mix(vec3(1.,.82,.3),uColor,gl_PointCoord.y);
      gl_FragColor=vec4(c,a*vFade*.65);}
  ` })
  const points = new Points(geometry, material); points.frustumCulled = false; points.renderOrder = 5; points.visible = false; world.add(points)
  const kinds = ["none", "rain", "fire", "snow", "embers", "smoke", "sparkle"]
  return {
    update(effect: SceneContent["effect"] | undefined, time: number) {
      points.visible = !!effect && effect.type !== "none" && effect.intensity > 0
      if (!effect) return
      material.uniforms.uTime.value = time * effect.speed; material.uniforms.uKind.value = kinds.indexOf(effect.type)
      material.uniforms.uIntensity.value = effect.intensity; material.uniforms.uColor.value.set(effect.color)
      const blending = ["fire", "embers", "sparkle"].includes(effect.type) ? AdditiveBlending : NormalBlending
      if (material.blending !== blending) { material.blending = blending; material.needsUpdate = true }
      geometry.setDrawRange(0, Math.round(24 + effect.intensity * (count - 24)))
    },
    dispose() { points.removeFromParent(); geometry.dispose(); material.dispose() },
  }
}
