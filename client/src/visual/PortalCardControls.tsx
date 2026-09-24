import { useState } from "react"
import { FRAME_MATERIALS, PORTAL_WEATHER, WEATHER_ZONES, withPortalWeather, type PortalCard, type WeatherZone } from "@shared/portal-card"
import "./portal-card.css"

export type PortalPanel = "frame" | "mica" | "weather" | "back" | "world"
export const PORTAL_PANELS = { frame: "Marco", mica: "Mica", weather: "Clima", back: "Reverso", world: "Portal" } as const
export function PortalSlider({ label, value, min=0, max=1, step=.01, onChange }: {label:string;value:number;min?:number;max?:number;step?:number;onChange:(value:number)=>void}) {
  return <label className="tq-studio-field"><span>{label}<output>{Number(value.toFixed(2))}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>
}
function ColorInput({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <label className="tq-color-field"><input aria-label={label} type="color" value={value} onChange={e=>onChange(e.target.value)}/><span>{label}<small>{value.toUpperCase()}</small></span></label>
}
export default function PortalCardControls({value,onChange,panel,equipped=false}:{value:PortalCard;onChange:(value:PortalCard)=>void;panel:PortalPanel;equipped?:boolean}) {
  const [zone,setZone]=useState(0)
  const edit=(fn:(next:PortalCard)=>void)=>{const next=structuredClone(value);fn(next);onChange(next)}
  const field=<K extends "frame"|"back"|"mica"|"world">(key:K,patch:Partial<PortalCard[K]>)=>edit(next=>{Object.assign(next[key],patch)})
  const weather=value.weather[zone]
  if(panel==="frame")return <section className="tq-portal-controls"><h3>Un marco, a tu medida</h3><p>Ancho es el borde visto de frente; grosor es el canto visto de lado.</p>
    {equipped?<p role="status">Hay un marco de galería equipado. Su material y geometría se conservan; selecciona «Sin marco equipado» en la tarjeta para diseñar uno propio.</p>:<>
      <div className="tq-material-swatches">{Object.entries(FRAME_MATERIALS).map(([id,material])=><button type="button" key={id} onClick={()=>{const {label,...properties}=material;field("frame",properties)}}><i style={{background:material.color}}/>{material.label}</button>)}</div>
      <PortalSlider label="Ancho del marco" value={value.frame.width} min={.035} max={.28} step={.005} onChange={width=>field("frame",{width})}/>
      <PortalSlider label="Grosor de la tarjeta" value={value.frame.thickness} min={.035} max={.3} step={.005} onChange={thickness=>field("frame",{thickness})}/>
      <PortalSlider label="Redondez de las esquinas" value={value.frame.radius} min={.04} max={.32} onChange={radius=>field("frame",{radius})}/>
      <PortalSlider label="Bisel del borde" value={value.frame.bevel} min={.003} max={.035} step={.001} onChange={bevel=>field("frame",{bevel})}/>
      <ColorInput label="Color del marco" value={value.frame.color} onChange={color=>field("frame",{color})}/>
      <PortalSlider label="Metalizado del marco" value={value.frame.metalness} onChange={metalness=>field("frame",{metalness})}/>
      <PortalSlider label="Rugosidad del marco" value={value.frame.roughness} min={.08} onChange={roughness=>field("frame",{roughness})}/>
      <ColorInput label="Color de iluminación" value={value.frame.lightColor} onChange={lightColor=>field("frame",{lightColor})}/>
      <PortalSlider label="Iluminación del borde" value={value.frame.glow} onChange={glow=>field("frame",{glow})}/>
      <PortalSlider label="Respiración de la luz" value={value.frame.pulse} onChange={pulse=>field("frame",{pulse})}/>
      <p>La respiración se ve al reproducir. Sin destellos ni luces fuera de la tarjeta.</p>
    </>}
  </section>
  if(panel==="mica")return <section className="tq-portal-controls"><h3>Una lámina sobre tu mundo</h3><p>Vidrio o mica sobre toda la ilustración, no un adorno de cristal.</p>
    <label className="tq-studio-check"><input type="checkbox" checked={value.mica.enabled} onChange={e=>field("mica",{enabled:e.target.checked})}/>Mica protectora</label>
    <fieldset disabled={!value.mica.enabled}><label className="tq-studio-field">Acabado de mica<select aria-label="Acabado de mica" value={value.mica.finish} onChange={e=>field("mica",{finish:e.target.value as PortalCard["mica"]["finish"]})}><option value="clear">Transparente</option><option value="satin">Satinada</option><option value="foil">Foil</option><option value="holographic">Holográfica</option></select></label>
      <PortalSlider label="Reflejos de la mica" value={value.mica.reflection} onChange={reflection=>field("mica",{reflection})}/>
      <PortalSlider label="Intensidad del material" value={value.mica.strength} onChange={strength=>field("mica",{strength})}/>
      <ColorInput label="Tinte de reflejos" value={value.mica.tint} onChange={tint=>field("mica",{tint})}/>
      <label className="tq-studio-field">Superficie<select aria-label="Superficie de mica" value={value.mica.surface} onChange={e=>field("mica",{surface:e.target.value as PortalCard["mica"]["surface"]})}><option value="dry">Limpia</option><option value="drops">Gotas sobre la mica</option><option value="fog">Empañamiento</option><option value="frost">Escarcha</option></select></label>
      <PortalSlider label="Cantidad sobre la mica" value={value.mica.amount} onChange={amount=>field("mica",{amount})}/>
    </fieldset><p>Las gotas y el empañamiento quedan adheridos a la tarjeta al girarla.</p>
  </section>
  if(panel==="weather")return <section className="tq-portal-controls"><h3>Atmósfera entre las capas</h3><label className="tq-studio-field">Punto de partida<select aria-label="Clima en las tres zonas" value="" onChange={e=>{if(e.target.value)onChange(withPortalWeather(value,e.target.value as WeatherZone["type"]))}}><option value="">Aplicar a las tres zonas…</option>{Object.entries(PORTAL_WEATHER).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <div className="tq-weather-depth" aria-label="Profundidad del clima"><span>Fondo</span>{WEATHER_ZONES.map((label,i)=><button type="button" key={label} aria-label={label} aria-pressed={zone===i} onClick={()=>setZone(i)}><b>0{i+1}</b><span>{label}</span><small>{PORTAL_WEATHER[value.weather[i].type]}</small></button>)}<span>Mica · cámara</span></div>
    <label className="tq-studio-field">Efecto de la zona<select aria-label="Efecto de la zona" value={weather.type} onChange={e=>edit(s=>{s.weather[zone].type=e.target.value as WeatherZone["type"]})}>{Object.entries(PORTAL_WEATHER).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <ColorInput label="Color del efecto" value={weather.color} onChange={color=>edit(s=>{s.weather[zone].color=color})}/>
    {([{key:"intensity",label:"Cantidad de partículas",min:0,max:1},{key:"size",label:"Tamaño de partículas",min:.25,max:2.5},{key:"speed",label:"Velocidad del clima",min:.1,max:2},{key:"wind",label:"Viento lateral",min:-1,max:1},{key:"depth",label:"Profundidad dentro de la zona",min:0,max:1}] as const).map(item=><PortalSlider key={item.key} label={item.label} value={weather[item.key]} min={item.min} max={item.max} onChange={v=>edit(s=>{s.weather[zone][item.key]=v})}/>)}
    <p>Pulsa reproducir para ver el clima. Las capas opacas ocultan los efectos que tienen detrás; usa PNG o WebP recortados para dejar pasar la vista.</p>
  </section>
  if(panel==="back")return <section className="tq-portal-controls"><h3>El otro lado de la historia</h3><p>Un reverso sólido. Pulsa «Reverso» bajo la vista previa para inspeccionarlo.</p>
    <ColorInput label="Color del reverso" value={value.back.color} onChange={color=>field("back",{color})}/><ColorInput label="Color de las letras" value={value.back.ink} onChange={ink=>field("back",{ink})}/>
    <label className="tq-studio-field">Título del reverso<input aria-label="Título del reverso" maxLength={64} value={value.back.title} onChange={e=>field("back",{title:e.target.value})}/></label>
    <label className="tq-studio-field">Inscripción<textarea aria-label="Inscripción del reverso" maxLength={140} rows={3} value={value.back.inscription} onChange={e=>field("back",{inscription:e.target.value})}/></label>
    <label className="tq-studio-field">Pie del reverso<input aria-label="Pie del reverso" maxLength={72} value={value.back.signature} onChange={e=>field("back",{signature:e.target.value})}/></label>
    <label className="tq-studio-field">Tratamiento de letras<select aria-label="Tratamiento de letras" value={value.back.treatment} onChange={e=>field("back",{treatment:e.target.value as PortalCard["back"]["treatment"]})}><option value="engraved">Grabado óptico</option><option value="raised">Relieve óptico</option><option value="printed">Impresión lisa</option></select></label>
    <p>El relieve se simula con iluminación, no modifica la silueta. El texto es decorativo: no certifica autoría, edición ni propiedad.</p>
  </section>
  return <section className="tq-portal-controls"><h3>Profundidad del portal</h3>
    <PortalSlider label="Intensidad del paralaje" value={value.world.depth} onChange={depth=>field("world",{depth})}/>
    <PortalSlider label="Curvatura visual del fondo" value={value.world.curvature} max={.5} onChange={curvature=>field("world",{curvature})}/>
    <ColorInput label="Color detrás del arte" value={value.world.background} onChange={background=>field("world",{background})}/>
    <p>El fondo cubre siempre la ventana: el motor aumenta el recorte cuando hace falta. No inventa partes ocultas de tu ilustración. Las capas media y frontal conservan su transparencia.</p>
  </section>
}
