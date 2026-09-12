export const cinematicVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
const noise = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<4;i++){n+=noise(p)*a;p=mat2(1.6,-1.2,1.2,1.6)*p;a*=.5;}return n;}`

/** Stylized lensing, not a relativistic simulation. No full-screen postprocessing. */
export const singularityFragment = `
varying vec2 vUv; uniform float uTime; uniform float uEnergy; uniform vec3 uColor;
${noise}
void main(){
  vec2 p=(vUv-.5)*2.; float t=uTime*.3;
  float roll=.15+sin(t*.4)*.035;
  p=mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*p;
  float r=length(p), a=atan(p.y,p.x), hole=.245+uEnergy*.016;
  float lens=hole*hole/max(r,.08);
  vec2 stars=p*(1.+lens*1.8);
  float star=pow(hash(floor(stars*53.)),85.)*(.6+.4*sin(t+stars.x*8.));
  float bend=sqrt(max(0.,1.-pow(p.x/.52,2.)))*.27;
  vec2 disk=vec2(p.x,(p.y-bend*smoothstep(-.05,.3,p.y))*4.3);
  float dr=length(disk), da=atan(disk.y,disk.x);
  float flow=fbm(vec2(dr*32.-t*1.8,da*4.+t*2.5));
  float strands=.55+.45*sin(dr*95.+flow*8.-t*3.);
  float band=smoothstep(.24,.38,dr)*(1.-smoothstep(.6,.94,dr));
  float diskLight=band*(.3+flow*1.4)*strands*(1.1-p.x*.65);
  float cut=smoothstep(hole-.005,hole+.018,r);
  diskLight*=p.y<-.045?1.:cut;
  float photon=exp(-abs(r-hole-.012)*130.);
  float echo=exp(-abs(r-hole-.043)*60.)*.27;
  float corona=exp(-abs(r-hole)*12.)*.16;
  vec3 hot=mix(uColor,vec3(1.,.91,.76),.72);
  vec3 light=hot*diskLight*1.55+mix(uColor,vec3(.79,.88,1.),.45)*(photon+echo)+uColor*corona;
  light*=.8+uEnergy*.65;
  light+=vec3(.47,.61,1.)*star*.35*cut;
  float alpha=clamp(diskLight*1.8+photon+echo+corona+star*.2,0.,1.);
  if(r<hole){light=vec3(.001,.002,.006);alpha=1.;}
  float edge=1.-smoothstep(.84,.99,r);
  gl_FragColor=vec4(light,alpha*edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export const portalFragment = `
varying vec2 vUv; uniform float uTime; uniform float uEnergy; uniform vec3 uColor;
${noise}
void main(){
 vec2 p=(vUv-.5)*2.; float r=length(p),a=atan(p.y,p.x),t=uTime*.07;
 float clouds=fbm(p*2.+vec2(t,-t));
 float spiral=fbm(vec2(r*6.-t, sin(a*3.+r*5.-t)*2.));
 float stars=pow(hash(floor(p*110.)),110.);
 vec3 c=uColor*(.025+pow(clouds,3.)*.6+pow(spiral,3.)*.45);
 c+=vec3(.1,.23,.65)*exp(-r*2.5)*(.025+uEnergy*.08);
 c+=vec3(.5,.7,1.)*stars*.5;
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`
