export const portalVertex = /* glsl */`
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }
`

export const portalArtFragment = /* glsl */`
uniform sampler2D uMap;
uniform mat3 uMapTransform;
uniform vec2 uOffset;
uniform float uScale, uRotation, uAspect, uOpacity, uBackground, uCurvature;
varying vec2 vUv;
void main(){
  vec2 p=vUv-.5;
  if(uBackground>.5){
    // A bounded cylindrical warp only contracts the source footprint.
    p.x*=1.-uCurvature*.35*(1.-4.*p.y*p.y);
    p-=uOffset; p.x*=uAspect;
    float c=cos(uRotation),s=sin(uRotation);
    // Inverse of the clockwise image rotation used by the cutout planes.
    p=mat2(c,s,-s,c)*p; p.x/=uAspect; p/=uScale;
  }
  vec2 uv=(uMapTransform*vec3(p+.5,1.)).xy;
  vec4 art=texture2D(uMap,uv);
  gl_FragColor=vec4(art.rgb,art.a*(uBackground>.5?1.:uOpacity));
  #include <colorspace_fragment>
}
`

export const portalMicaFragment = /* glsl */`
uniform sampler2D uWorld;
uniform vec2 uView, uPixel;
uniform vec3 uTint;
uniform float uEnabled,uFinish,uReflection,uStrength,uSurface,uAmount;
varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 world(vec2 p){return texture2D(uWorld,clamp(p,vec2(.001),vec2(.999))).rgb;}
void main(){
  vec2 uv=vUv, distortion=vec2(0.); float droplets=0.;
  float edge=pow(clamp(length((uv-.5)*1.45),0.,1.),3.);
  if(uEnabled>.5 && uSurface>.5 && uSurface<1.5){
    vec2 grid=uv*vec2(15.,21.); vec2 cell=floor(grid);
    vec2 local=fract(grid)-vec2(.24+hash(cell)*.52,.22+hash(cell+5.)*.56);
    float r=.09+hash(cell+9.)*.14;
    float d=length(local*vec2(1.,.82))/r;
    float wetCell=step(hash(cell+2.),uAmount*.82);
    float drop=(1.-smoothstep(.75,1.,d))*wetCell;
    distortion=local*drop*.035;
    droplets=(smoothstep(.6,.83,d)-smoothstep(.83,1.,d))*wetCell*.22;
  }
  vec3 art=world(uv+distortion);
  if(uEnabled>.5){
    float fog=uSurface>1.5&&uSurface<2.5?uAmount*(.24+edge*.5):0.;
    float blur=(uFinish>.5&&uFinish<1.5?uStrength*.7:0.)+fog;
    vec2 px=uPixel*(2.+blur*9.);
    vec3 soft=(world(uv+px)+world(uv-px)+world(uv+vec2(px.x,-px.y))+world(uv+vec2(-px.x,px.y)))*.25;
    art=mix(art,soft,clamp(blur,0.,.8));
    art=mix(art,uTint,fog*.27);
    if(uSurface>2.5){
      float crystal=pow(abs(sin(uv.x*180.+sin(uv.y*49.)*4.)*sin(uv.y*205.)),9.);
      float frost=clamp((edge*1.8-.22+crystal*.4)*uAmount,0.,.7);
      art=mix(art,uTint,frost);
    }
    float band=exp(-pow((uv.x*.72+uv.y*.45-.52+uView.x*.28-uView.y*.19)*13.,2.));
    float sheen=(band*.18+edge*.07)*uReflection;
    art=mix(art,uTint,sheen)+droplets*uReflection;
    if(uFinish>1.5){
      float angle=dot(uv,vec2(1.3,.7))+uView.x*.65+uView.y*.4;
      vec3 foil=.5+.5*cos(6.28318*(angle+vec3(0.,.33,.67)));
      float mask=uFinish>2.5?.22:.08;
      art+=foil*uStrength*(mask+band*.19);
    }
  }
  gl_FragColor=vec4(art,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const weatherVertex = /* glsl */`
attribute vec4 aSeed;
uniform float uTime,uType,uSize,uSpeed,uWind,uIntensity,uHeight,uDepth;
uniform vec2 uView,uDimensions;
varying float vFade;
void main(){
  float t=uTime*uSpeed;
  bool rising=uType>3.5;
  float flow=uType<1.5?.3:uType<2.5?.085:uType<3.5?.02:.12;
  float y=fract(aSeed.y+t*flow*(rising?1.:-1.));
  float x=fract(aSeed.x+t*uWind*.045+sin(t*.6+aSeed.z*20.)*.018);
  vec2 p=(vec2(x,y)-.5)*uDimensions*1.28;
  p+=uView*(.05+uDepth*.08);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,0.,1.);
  float size=uType<1.5?13.:uType<2.5?4.:uType<3.5?55.:uType<4.5?4.:uType<5.5?29.:3.;
  gl_PointSize=clamp(size*uSize*(.65+aSeed.w*.7)*uHeight/768.,1.,80.);
  vFade=step(aSeed.z,uIntensity)*smoothstep(0.,.12,y)*(1.-smoothstep(.88,1.,y));
}
`
export const weatherFragment = /* glsl */`
uniform float uType;
uniform vec3 uColor;
varying float vFade;
void main(){
  vec2 p=gl_PointCoord-.5; float a=0.;
  if(uType<1.5) a=(1.-smoothstep(.018,.055,abs(p.x+p.y*.15)))*(1.-smoothstep(.15,.5,abs(p.y)))*.55;
  else if(uType<2.5) a=(1.-smoothstep(.12,.48,length(p)))*.85;
  else if(uType<3.5) a=(1.-smoothstep(.05,.5,length(p)))*.055;
  else if(uType<4.5) a=(1.-smoothstep(.05,.5,length(p)))*.7;
  else if(uType<5.5){ float width=.26*pow(clamp(p.y+.5,0.,1.),.6); a=(1.-smoothstep(width*.25,width,abs(p.x+sin(p.y*9.)*.03)))*smoothstep(-.5,-.1,p.y)*(1.-smoothstep(.28,.5,p.y))*.55; }
  else a=(1.-smoothstep(.03,.48,length(p)))*.65;
  gl_FragColor=vec4(uColor,a*vFade);
  #include <colorspace_fragment>
}
`
