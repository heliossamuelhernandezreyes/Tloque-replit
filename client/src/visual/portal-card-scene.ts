import { AmbientLight, BufferGeometry, CanvasTexture, Color, DirectionalLight, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, OrthographicCamera, Path, PerspectiveCamera, PlaneGeometry, Points, Scene, ShaderMaterial, Shape, ShapeGeometry, SRGBColorSpace, Texture, TextureLoader, Vector2, Vector4, WebGLRenderTarget } from "three"
import { CARD_LAYERS, evaluateCardLayer } from "@shared/card-scene-runtime"
import { evaluateFrameScene, readFrameScene } from "@shared/frame-scene"
import { coveredBackgroundScale, createPortalCard, portalLayerZ, portalView, portalWeatherZ, type PortalCard } from "@shared/portal-card"
import { isSafeImageSource } from "@shared/media"
import { resolvePortalCard } from "@shared/portal-card-recipe"
import type { VisualOptions } from "./VisualEngine"
import type { VisualScene } from "./scenes"
import { portalArtFragment, portalMicaFragment, portalVertex, weatherFragment, weatherVertex } from "./portal-card-shaders"

export function portalRecipe(options: VisualOptions): PortalCard {
  const native = readFrameScene(options.frame)
  const recipe = options.cardScene?.portalCard ?? native?.portalCard ?? createPortalCard()
  return options.cardScene?.portalCard ? resolvePortalCard(recipe,options.frame) : recipe
}

function rounded<T extends Shape | Path>(path: T, w: number, h: number, radius: number): T {
  const x=-w/2,y=-h/2,r=Math.min(radius,w/2,h/2)
  path.moveTo(x+r,y); path.lineTo(x+w-r,y); path.quadraticCurveTo(x+w,y,x+w,y+r)
  path.lineTo(x+w,y+h-r); path.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  path.lineTo(x+r,y+h); path.quadraticCurveTo(x,y+h,x,y+h-r)
  path.lineTo(x,y+r); path.quadraticCurveTo(x,y,x+r,y); path.closePath(); return path
}
function face(w: number,h: number,r: number,profile: boolean) {
  const shape=profile?new Shape().absarc(0,0,w/2,0,Math.PI*2,false) as Shape:rounded(new Shape(),w,h,r)
  const geometry=new ShapeGeometry(shape,32),uv=geometry.attributes.uv,p=geometry.attributes.position
  for(let i=0;i<uv.count;i++) uv.setXY(i,p.getX(i)/w+.5,p.getY(i)/h+.5)
  return geometry
}

/** One solid card + one bounded render target. No per-layer canvases or postprocessing chain. */
export function createPortalCardScene(options: VisualOptions,maxTextureEdge: number,environment?: Texture): VisualScene {
  const profile=options.shape==="profile",w=2.4,h=profile?2.4:3.36
  const scene=new Scene(),world=new Scene(),root=new Group(),shell=new Group()
  scene.environment=environment??null; scene.environmentIntensity=.75; scene.add(root); root.add(shell)
  scene.add(new AmbientLight(0xffffff,1.4))
  const key=new DirectionalLight(0xfff2df,3),rim=new DirectionalLight(0xb6d7ff,2)
  key.position.set(-3,5,6);rim.position.set(4,-1,-3);scene.add(key,rim)
  const camera=new PerspectiveCamera(34,1,.1,40);camera.position.z=7
  const worldCamera=new OrthographicCamera(-w/2,w/2,h/2,-h/2,.1,20);worldCamera.position.z=6
  const targetHeight=Math.min(1024,maxTextureEdge),target=new WebGLRenderTarget(Math.round(targetHeight*w/h),targetHeight,{depthBuffer:false})
  const metal=new MeshPhysicalMaterial({clearcoat:1,clearcoatRoughness:.2}),edge=new MeshBasicMaterial({toneMapped:false})
  const rear=new MeshPhysicalMaterial({roughness:.4,metalness:.35,clearcoat:.35})
  const mica=new ShaderMaterial({vertexShader:portalVertex,fragmentShader:portalMicaFragment,uniforms:{uWorld:{value:target.texture},uView:{value:new Vector2()},uPixel:{value:new Vector2(1/target.width,1/target.height)},uTint:{value:new Color()},uEnabled:{value:1},uFinish:{value:0},uReflection:{value:.3},uStrength:{value:.3},uSurface:{value:0},uAmount:{value:0}}})
  const textures=new Set<Texture>(),timers=new Set<ReturnType<typeof setTimeout>>()
  const art=new Map<number,Mesh<PlaneGeometry,ShaderMaterial>>()
  let disposed=false,pending=0,lastGeometry="",lastBack="",backgroundMap:Texture|undefined,backMap:Texture|undefined,bumpMap:Texture|undefined
  let apertureWidth=w,apertureHeight=h
  let worldDirty=true,lastWorldState:unknown[]=[]

  function buildShell(recipe:PortalCard) {
    const f=recipe.frame,topology=JSON.stringify([f.width,f.thickness,f.radius,f.bevel])
    if(lastGeometry===topology)return
    lastGeometry=topology
    shell.children.forEach(child=>{if(child instanceof Mesh)child.geometry.dispose()});shell.clear()
    const aw=w-f.width*2,ah=h-f.width*2,ar=Math.max(.015,f.radius-f.width)
    apertureWidth=aw;apertureHeight=ah
    worldCamera.left=-aw/2;worldCamera.right=aw/2;worldCamera.top=ah/2;worldCamera.bottom=-ah/2;worldCamera.updateProjectionMatrix()
    const outer=profile?new Shape().absarc(0,0,w/2,0,Math.PI*2,false) as Shape:rounded(new Shape(),w,h,f.radius)
    outer.holes.push(profile?new Path().absarc(0,0,aw/2,0,Math.PI*2,true):rounded(new Path(),aw,ah,ar))
    const bevel=Math.min(f.bevel,f.width*.25)
    const bezel=new Mesh(new ExtrudeGeometry(outer,{depth:f.thickness,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:3,curveSegments:20,steps:1}),metal)
    bezel.position.z=-f.thickness/2;shell.add(bezel)
    const plate=new Mesh(face(w,h,f.radius,profile),rear);plate.rotation.y=Math.PI;plate.position.z=-f.thickness/2-.002;shell.add(plate)
    // Opaque front-facing backplate closes the cavity from every grazing angle.
    const inside=new Mesh(face(w,h,f.radius,profile),metal);inside.position.z=-f.thickness/2;shell.add(inside)
    const window=new Mesh(face(aw,ah,ar,profile),mica);window.position.z=f.thickness/2+.002;shell.add(window)
    const trimOuter=profile?new Shape().absarc(0,0,aw/2+.008,0,Math.PI*2,false) as Shape:rounded(new Shape(),aw+.016,ah+.016,ar+.008)
    trimOuter.holes.push(profile?new Path().absarc(0,0,aw/2,0,Math.PI*2,true):rounded(new Path(),aw,ah,ar))
    const trim=new Mesh(new ShapeGeometry(trimOuter,32),edge);trim.position.z=f.thickness/2+.005;shell.add(trim)
  }
  function drawBack(recipe:PortalCard) {
    const json=JSON.stringify(recipe.back);if(lastBack===json)return;lastBack=json
    const canvas=document.createElement("canvas"),bump=document.createElement("canvas")
    canvas.width=bump.width=512;canvas.height=bump.height=profile?512:716
    const c=canvas.getContext("2d"),b=bump.getContext("2d");if(!c||!b)return
    const back=recipe.back,height=canvas.height
    c.fillStyle=back.color;c.fillRect(0,0,512,height);b.fillStyle="#808080";b.fillRect(0,0,512,height)
    c.strokeStyle=back.ink;c.globalAlpha=.3;c.lineWidth=1
    if(profile){c.beginPath();c.arc(256,height/2,216,0,Math.PI*2);c.stroke()}else c.strokeRect(36,36,440,height-72)
    c.globalAlpha=1
    const text=(value:string,y:number,size:number,italic=false,maxLines=5,maxWidth=380)=>{
      let lines:string[]=[]
      // Fit the whole inscription, including unbroken text, instead of truncating it.
      for(;size>=8;size--){
        c.font=b.font=`${italic?"italic ":""}${size}px Georgia, serif`;lines=[];let line=""
        for(const word of value.trim().split(/\s+/)){
          if(c.measureText(`${line} ${word}`).width>maxWidth&&line){lines.push(line);line=""}
          for(const letter of `${line?" ":""}${word}`){if(c.measureText(line+letter).width>maxWidth){lines.push(line);line=""}line+=letter}
        }
        if(line)lines.push(line)
        if(lines.length<=maxLines)break
      }
      c.textAlign=b.textAlign="center";c.fillStyle=back.ink;b.fillStyle=back.treatment==="engraved"?"#242424":"#eeeeee"
      lines.forEach((line,i)=>{c.fillText(line,256,y+i*(size+12));b.fillText(line,256,y+i*(size+12))})
    }
    text(back.title,height*.26,27,false,3);text(back.inscription,height*.46,19,true);text(back.signature,height*(profile?.77:.81),15,false,3,profile?300:380)
    backMap?.dispose();bumpMap?.dispose()
    backMap=new CanvasTexture(canvas);backMap.colorSpace=SRGBColorSpace;bumpMap=new CanvasTexture(bump)
    rear.map=backMap;rear.bumpMap=back.treatment==="printed"?null:bumpMap;rear.bumpScale=.025;rear.needsUpdate=true
  }
  function load(url:string,index:number) {
    if(!url)return
    if(!isSafeImageSource(url)||url.length>8_000_000){options.onAssetIssue?.("No se pudo cargar una imagen: origen no permitido.");return}
    pending++;let settled=false
    const finish=(failed=false)=>{if(settled)return;settled=true;pending--;clearTimeout(timer);timers.delete(timer);if(failed&&!disposed)options.onAssetIssue?.("No se pudo cargar una imagen. El diseño sigue disponible; puedes reintentar.")}
    const timer=setTimeout(()=>finish(true),12_000);timers.add(timer)
    new TextureLoader().load(url,(texture:Texture)=>{
      if(disposed||settled){texture.dispose();return}
      try{
        const source=texture.image as HTMLImageElement
        if(!source.width||!source.height||source.width*source.height>24_000_000){texture.dispose();finish(true);return}
        const factor=Math.min(1,maxTextureEdge/Math.max(source.width,source.height))
        if(factor<1){const canvas=document.createElement("canvas");canvas.width=Math.round(source.width*factor);canvas.height=Math.round(source.height*factor);const context=canvas.getContext("2d");if(!context)throw Error();context.drawImage(source,0,0,canvas.width,canvas.height);texture.image=canvas}
        texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;textures.add(texture)
        const imageAspect=source.width/source.height,targetAspect=w/h
        if(imageAspect>targetAspect){texture.repeat.x=targetAspect/imageAspect;texture.offset.x=(1-texture.repeat.x)/2}else{texture.repeat.y=imageAspect/targetAspect;texture.offset.y=(1-texture.repeat.y)/2}texture.updateMatrix()
        const material=new ShaderMaterial({vertexShader:portalVertex,fragmentShader:portalArtFragment,uniforms:{uMap:{value:texture},uMapTransform:{value:texture.matrix},uOffset:{value:new Vector2()},uScale:{value:1},uRotation:{value:0},uAspect:{value:w/h},uOpacity:{value:1},uBackground:{value:index===0?1:0},uCurvature:{value:0}},transparent:true,depthWrite:false,depthTest:false,toneMapped:false})
        const plane=new Mesh(new PlaneGeometry(1,1),material);plane.renderOrder=index*2;world.add(plane);art.set(index,plane)
        worldDirty=true
        if(index===0)backgroundMap=texture
        finish()
      }catch{texture.dispose();finish(true)}
    },undefined,()=>finish(true))
  }
  options.images?.slice(0,3).forEach(load)
  const weather=Array.from({length:3},(_,zone)=>{
    const seeds:number[]=[];for(let i=0;i<120;i++)seeds.push(((i*47+zone*11)%127)/127,((i*83+zone*7)%131)/131,(i+.5)/120,((i*37)%101)/101)
    const geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(new Float32Array(120*3),3));geometry.setAttribute("aSeed",new Float32BufferAttribute(seeds,4))
    const material=new ShaderMaterial({vertexShader:weatherVertex,fragmentShader:weatherFragment,uniforms:{uTime:{value:0},uType:{value:0},uSize:{value:1},uSpeed:{value:1},uWind:{value:0},uIntensity:{value:0},uHeight:{value:targetHeight},uDepth:{value:0},uView:{value:new Vector2()},uDimensions:{value:new Vector2(w,h)},uColor:{value:new Color()}},transparent:true,depthTest:false,depthWrite:false,toneMapped:false})
    const points=new Points(geometry,material);points.renderOrder=zone*2+1;points.frustumCulled=false;world.add(points);return points
  })
  const empty=new Mesh(new PlaneGeometry(w,h),new MeshBasicMaterial({color:0x101c29}));empty.position.z=-4;empty.renderOrder=-1;world.add(empty)
  const viewport=new Vector4(),scissor=new Vector4(),clearColor=new Color()
  return {
    ready:()=>!disposed&&pending===0,
    update(_time,_dt,aspect,pointer,current){
      const recipe=portalRecipe(current),native=readFrameScene(current.frame),f=recipe.frame
      buildShell(recipe);drawBack(recipe)
      const inspection=current.transport?.current.mode==="inspection",seconds=inspection?current.transport!.current.time:0
      const frameTime=current.cardScene?seconds/current.cardScene.duration*(native?.animation.duration??8):seconds
      const pose=native?evaluateFrameScene(native,frameTime):null
      const orientation=current.orientation?.current??{yaw:pointer.x*16,pitch:pointer.y*12,zoom:1}
      const yaw=orientation.yaw+(pose?.orbit??0),pitch=orientation.pitch+(pose?.tilt??0),view=portalView({yaw,pitch,zoom:1})
      const worldState=[current.cardScene,current.frame,seconds,view.x,view.y]
      if(worldState.some((value,i)=>value!==lastWorldState[i]))worldDirty=true
      lastWorldState=worldState
      root.rotation.set(pitch*Math.PI/180,yaw*Math.PI/180,0)
      root.scale.setScalar(orientation.zoom*(pose?.zoom??1))
      camera.aspect=aspect;camera.position.z=Math.max(6.8,4.7/Math.max(.2,aspect));camera.updateProjectionMatrix()
      metal.color.set(f.color);metal.metalness=f.metalness;metal.roughness=f.roughness
      const pulse=1-f.pulse*.25+Math.sin(seconds*1.4)*f.pulse*.25
      metal.emissive.set(f.lightColor);metal.emissiveIntensity=f.glow*.2*pulse
      edge.color.set(f.glow>0?f.lightColor:f.color);edge.color.multiplyScalar(1+f.glow*2*pulse)
      key.color.set(native?.lighting.key??"#fff2df");key.intensity=native?.lighting.intensity??3
      rim.color.set(native?.lighting.rim??"#b6d7ff")
      const u=mica.uniforms;u.uView.value.set(view.x,view.y);u.uTint.value.set(recipe.mica.tint);u.uEnabled.value=Number(recipe.mica.enabled)
      u.uFinish.value=["clear","satin","foil","holographic"].indexOf(recipe.mica.finish);u.uReflection.value=recipe.mica.reflection;u.uStrength.value=recipe.mica.strength;u.uSurface.value=["dry","drops","fog","frost"].indexOf(recipe.mica.surface);u.uAmount.value=recipe.mica.amount
      if(!world.background)world.background=new Color()
      ;(world.background as Color).set(recipe.world.background);empty.material.color.set(recipe.world.background);empty.visible=!backgroundMap
      const aw=apertureWidth,ah=apertureHeight
      art.forEach((plane,index)=>{
        const layer=CARD_LAYERS[index],track=current.cardScene?.layers[layer],p=current.cardScene?evaluateCardLayer(current.cardScene,layer,seconds,!!inspection):{x:0,y:0,scale:1,rotation:0,opacity:1}
        const parallax=recipe.world.depth*(.022+index*.043+(track?.depth??0)*.025)
        const x=p.x-view.x*parallax,y=-p.y-view.y*parallax
        plane.position.set(index?x*aw:0,index?y*ah:0,portalLayerZ(index,track?.depth??0));plane.scale.set(aw*(index?p.scale:1),ah*(index?p.scale:1),1);plane.rotation.z=index?-p.rotation*Math.PI/180:0
        const uniforms=plane.material.uniforms;uniforms.uOpacity.value=p.opacity;uniforms.uAspect.value=aw/ah;uniforms.uCurvature.value=recipe.world.curvature
        if(!index){uniforms.uOffset.value.set(x,y);uniforms.uRotation.value=p.rotation*Math.PI/180;uniforms.uScale.value=coveredBackgroundScale(x,y,p.rotation,p.scale,aw/ah)}
      })
      recipe.weather.forEach((zone,i)=>{const points=weather[i],u=points.material.uniforms;points.visible=zone.type!=="none"&&zone.intensity>0;points.position.z=portalWeatherZ(i,zone.depth);u.uTime.value=seconds;u.uType.value=["none","rain","snow","mist","embers","fire","dust","magic"].indexOf(zone.type);u.uSize.value=zone.size*(.7+i*.28+zone.depth*.18);u.uSpeed.value=zone.speed;u.uWind.value=zone.wind;u.uIntensity.value=zone.intensity;u.uDepth.value=i+zone.depth;u.uView.value.set(-view.x*recipe.world.depth,-view.y*recipe.world.depth);u.uDimensions.value.set(aw,ah);u.uColor.value.set(zone.color)})
    },
    render(renderer){
      if(!worldDirty){renderer.render(scene,camera);return}
      const previousTarget=renderer.getRenderTarget(),wasScissored=renderer.getScissorTest(),alpha=renderer.getClearAlpha()
      renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(clearColor)
      try{renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor(world.background as Color,1);renderer.clear();renderer.render(world,worldCamera);worldDirty=false}
      finally{renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(wasScissored);renderer.setClearColor(clearColor,alpha)}
      renderer.render(scene,camera)
    },
    dispose(){
      if(disposed)return;disposed=true;timers.forEach(clearTimeout);timers.clear()
      for(const parent of [scene,world])parent.traverse(object=>{if(object instanceof Mesh||object instanceof Points)object.geometry.dispose()})
      art.forEach(plane=>plane.material.dispose());weather.forEach(points=>points.material.dispose());[metal,rear,edge,mica,empty.material].forEach(material=>material.dispose())
      textures.forEach(texture=>texture.dispose());backMap?.dispose();bumpMap?.dispose();target.dispose()
    },
  }
}
