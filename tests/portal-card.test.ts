import test from "node:test"
import assert from "node:assert/strict"
import { Color, FrontSide, Group, Mesh, Points, Scene, ShaderMaterial, Texture, TextureLoader, Vector4, type WebGLRenderer, type WebGLRenderTarget } from "three"
import { createPortalCard, coveredBackgroundScale, portalCardSchema, portalLayerZ, portalView, portalWeatherZ, withPortalWeather, wrapCardAngle } from "../shared/portal-card"
import { resolvePortalCard } from "../shared/portal-card-recipe"
import { createCardScene, createPortalCardScene, cardSceneSchema, applyCardMotion } from "../shared/card-scene"
import { createPortalFrameScene, frameSceneSchema, packageFrameScene } from "../shared/frame-scene"
import { createVisualScene, sceneKey } from "../client/src/visual/scenes"
import { validateCard } from "../server/cards"
import { validateFrame } from "../server/frames"

test("portal: recetas acotadas y guardado de ida y vuelta sin cambiar derechos",()=>{
  const scene=createPortalCardScene();scene.portalCard=withPortalWeather(scene.portalCard!,"snow")
  scene.portalCard.back.inscription="Un mundo detrás del vidrio · 雪 ❄"
  const result=validateCard({name:"Ventana",fx:{layers:{back:"data:image/png;base64,AAAA",mid:"",front:"data:image/webp;base64,AAAA"},frameId:7,scene}})
  assert.ok(result.ok);if(result.ok){assert.deepEqual(result.card.fx.scene,scene);assert.equal(result.card.fx.frameId,7)}
  const frame=createPortalFrameScene(),pkg=packageFrameScene(frame,"Puerta","both")
  assert.ok(frameSceneSchema.safeParse(frame).success);assert.ok(validateFrame({name:"Puerta",priceTinta:0,target:"both",pkg}).ok)
  assert.equal(frame.geometry.ornaments,0);assert.equal(frame.portal.particles,0)
  assert.equal(pkg.runtimePreset.appearance.material.baseColor,frame.portalCard!.frame.color)
  const mutations=[(s:any)=>{s.weather.push(s.weather[0])},(s:any)=>{s.weather[0].type="custom-shader"},(s:any)=>{s.world.depth=Infinity},(s:any)=>{s.frame.width=-1},(s:any)=>{s.mica.html="<script>"},(s:any)=>{s.back.title="x".repeat(65)},(s:any)=>{s.weather[0].size=1000}]
  for(const mutate of mutations){const s=createPortalCard();mutate(s);assert.equal(portalCardSchema.safeParse(s).success,false);assert.equal(cardSceneSchema.safeParse({...scene,portalCard:s}).success,false)}
  assert.ok(cardSceneSchema.safeParse(createCardScene()).success,"recetas anteriores permanecen válidas")
})
test("portal: el fondo cubre cada esquina incluso con desplazamiento, rotación, zoom mínimo y paralaje extremos",()=>{
  for(const aspect of [5/7,1,.6])for(const x of [-1.35,-.6,0,.6,1.35])for(const y of [-1.35,0,1.35])for(const rotation of [-90,-45,0,45,90]){
    const scale=coveredBackgroundScale(x,y,rotation,.25,aspect),r=rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r)
    for(const vx of [-.5,.5])for(const vy of [-.5,.5]){
      const px=(vx-x)*aspect,py=vy-y,rx=(c*px+s*py)/aspect/scale,ry=(-s*px+c*py)/scale
      assert.ok(Math.abs(rx)<.5+1e-9&&Math.abs(ry)<.5+1e-9,JSON.stringify({aspect,x,y,rotation,rx,ry}))
    }
  }
})
test("portal: giros completos y profundidad conservan frente/reverso y orden de oclusión",()=>{
  assert.equal(wrapCardAngle(720+25),25);assert.equal(wrapCardAngle(-540),-180);assert.equal(wrapCardAngle(NaN),0)
  assert.equal(portalView({yaw:180,pitch:0,zoom:1}).front,false)
  assert.equal(portalView({yaw:360,pitch:0,zoom:1}).front,true)
  assert.equal(portalView({yaw:0,pitch:180,zoom:1}).front,false)
  for(let i=0;i<3;i++){assert.ok(portalLayerZ(i,1)<portalWeatherZ(i,0));if(i<2)assert.ok(portalWeatherZ(i,1)<portalLayerZ(i+1,0))}
})
test("portal: acabados heredados o propios sin mutar el marco equipado",()=>{
  const card=createPortalCard(),frame=createPortalFrameScene();frame.portalCard!.mica.surface="drops";frame.portalCard!.frame.color="#aabbcc"
  const pkg=packageFrameScene(frame,"Gotas","card"),snapshot=JSON.stringify(pkg)
  assert.equal(resolvePortalCard(card,pkg).mica.surface,"drops")
  card.inheritFrameFinish=false;card.mica.surface="frost"
  assert.equal(resolvePortalCard(card,pkg).mica.surface,"frost");assert.equal(resolvePortalCard(card,pkg).frame.color,"#aabbcc")
  assert.equal(JSON.stringify(pkg),snapshot)
})
test("portal: materiales, marco, clima, texto y orientación no recargan las imágenes",()=>{
  const scene=createPortalCardScene(),options={kind:"portal" as const,images:["back","","front"],cardScene:scene}
  const key=sceneKey(options),changed=applyCardMotion(scene,"drift")
  changed.portalCard!.frame.width=.2;changed.portalCard!.back.title="Nuevo";changed.portalCard!.mica.surface="fog";changed.portalCard!.weather[2].type="rain"
  assert.equal(sceneKey({...options,cardScene:changed,orientation:{current:{yaw:180,pitch:20,zoom:1}}}),key)
  assert.notEqual(sceneKey({...options,images:["other","","front"]}),key)
  assert.notEqual(sceneKey({...options,cardScene:createCardScene()}),key)
})

class Recorder {
  viewport=new Vector4(20,30,200,300);scissor=this.viewport.clone();scissored=true;target:WebGLRenderTarget|null=null;color=new Color("#abcabc");alpha=.25
  renders:Array<{scene:Scene;target:WebGLRenderTarget|null}>=[]
  getViewport(out:Vector4){return out.copy(this.viewport)}getScissor(out:Vector4){return out.copy(this.scissor)}getScissorTest(){return this.scissored}getRenderTarget(){return this.target}getClearColor(out:Color){return out.copy(this.color)}getClearAlpha(){return this.alpha}
  setScissorTest(value:boolean){this.scissored=value}setRenderTarget(value:WebGLRenderTarget|null){this.target=value}setViewport(value:Vector4){this.viewport.copy(value)}setScissor(value:Vector4){this.scissor.copy(value)}setClearColor(value:any,alpha:number){this.color.set(value);this.alpha=alpha}clear(){}
  render(scene:Scene){this.renders.push({scene,target:this.target})}asRenderer(){return this as unknown as WebGLRenderer}
}
test("portal GPU: tres capas, oclusión, 360°, pausa, cobertura, límite de partículas y liberación",async()=>{
  const oldLoad=TextureLoader.prototype.load,oldDocument=globalThis.document,loaded:Texture[]=[]
  TextureLoader.prototype.load=function(_url,onLoad){const texture=new Texture({width:700,height:980} as HTMLImageElement);loaded.push(texture);queueMicrotask(()=>onLoad?.(texture));return texture} as typeof oldLoad
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},strokeRect(){},fillText(){},measureText(value:string){return {width:value.length*10}}})})} as unknown as Document
  const cardScene=createPortalCardScene();cardScene.portalCard=withPortalWeather(cardScene.portalCard!,"rain")
  const options={kind:"portal" as const,images:["https://x.test/back.png","https://x.test/mid.png","https://x.test/front.png"],cardScene,orientation:{current:{yaw:150,pitch:0,zoom:1}},transport:{current:{time:2,mode:"inspection" as const}}}
  const resource=createVisualScene(options,1024),r=new Recorder()
  try{
    assert.equal(resource.ready(),false);await new Promise<void>(resolve=>queueMicrotask(resolve));assert.equal(resource.ready(),true)
    resource.update(200,.033,5/7,{x:0,y:0},options);resource.render(r.asRenderer())
    const [world,outer]=r.renders;assert.ok(world.target);assert.equal(world.target.height,1024);assert.equal(outer.target,null)
    assert.deepEqual(r.viewport.toArray(),[20,30,200,300]);assert.equal(r.scissored,true);assert.equal(r.alpha,.25);assert.equal(r.color.getHexString(),"abcabc")
    const planes=world.scene.children.filter((n):n is Mesh<any,ShaderMaterial>=>n instanceof Mesh&&n.material instanceof ShaderMaterial&&!!n.material.uniforms.uMap)
    const weather=world.scene.children.filter((n):n is Points<any,ShaderMaterial>=>n instanceof Points)
    assert.deepEqual(planes.map(p=>p.renderOrder),[0,2,4]);assert.deepEqual(weather.map(p=>p.renderOrder),[1,3,5])
    assert.equal(weather.reduce((n,p)=>n+p.geometry.attributes.position.count,0),360)
    assert.ok(planes[0].material.uniforms.uScale.value>=1)
    assert.equal(outer.scene.children.find(n=>n instanceof Group)!.rotation.y,150*Math.PI/180)
    outer.scene.traverse(n=>{if(n instanceof Mesh){assert.equal(n.material.side,FrontSide,"la ventana no atraviesa el reverso");assert.ok(Array.from(n.geometry.attributes.position.array).every(Number.isFinite))}})
    const position=planes[2].position.clone();resource.update(999,.033,5/7,{x:0,y:0},options)
    assert.deepEqual(planes[2].position,position);assert.equal(weather[0].material.uniforms.uTime.value,2,"el reloj de pared no anima un transporte pausado")
    resource.render(r.asRenderer());assert.equal(r.renders.filter(call=>call.target).length,1,"el interior pausado reutiliza su textura sin dibujar otro target")
    const materials=new Set<any>(),geometries=new Set<any>();for(const item of [world,outer])item.scene.traverse(n=>{if(n instanceof Mesh||n instanceof Points){materials.add(n.material);geometries.add(n.geometry)}})
    let materialDisposals=0,geometryDisposals=0,textureDisposals=0
    materials.forEach(m=>m.addEventListener("dispose",()=>materialDisposals++));geometries.forEach(g=>g.addEventListener("dispose",()=>geometryDisposals++));loaded.forEach(t=>t.addEventListener("dispose",()=>textureDisposals++))
    resource.dispose();resource.dispose();assert.equal(materialDisposals,materials.size);assert.equal(geometryDisposals,geometries.size);assert.equal(textureDisposals,3)
  }finally{resource.dispose();TextureLoader.prototype.load=oldLoad;globalThis.document=oldDocument}
})
test("portal: carga tardía, error de imagen y orígenes inseguros no bloquean la tarjeta",()=>{
  const old=TextureLoader.prototype.load;let resolve:(texture:Texture)=>void=()=>{},calls=0
  TextureLoader.prototype.load=function(_url,onLoad){calls++;resolve=onLoad as typeof resolve;return new Texture()} as typeof old
  try{
    const messages:string[]=[];const blocked=createVisualScene({kind:"portal",cardScene:createPortalCardScene(),images:["javascript:alert(1)"],onAssetIssue:m=>messages.push(m)},1024)
    assert.equal(calls,0);assert.equal(blocked.ready(),true);assert.equal(messages.length,1);blocked.dispose()
    const late=createVisualScene({kind:"portal",cardScene:createPortalCardScene(),images:["https://x.test/a.png"]},1024)
    late.dispose();const texture=new Texture();let disposed=0;texture.addEventListener("dispose",()=>disposed++);resolve(texture);assert.equal(disposed,1);assert.equal(late.ready(),false)
  }finally{TextureLoader.prototype.load=old}
})
