import { sfzNoteToMidi } from "./sfzSamplePackCompiler"
import type { CuratedRawWavPackSource } from "../shared/curated-raw-wav-packs"

interface IndexEntry { bank?: unknown; type?: unknown; url?: unknown }
interface ParsedRawZone {
  samplePath: string
  rootMidi: number
  velocityLayer: number
  roundRobin: number
  mic: "default" | "close"
  trigger: "attack" | "release"
  articulation: "normal" | "staccato"
}

function parseIndex(text: string, source: CuratedRawWavPackSource): string[] {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error("El índice WAV curado no contiene JSON válido") }
  if (!Array.isArray(value)) throw new Error("El índice WAV curado no contiene una lista")
  const paths = value.flatMap((raw): string[] => {
    if (!raw || typeof raw !== "object") return []
    const entry = raw as IndexEntry
    if (entry.bank !== source.rawWavBank || entry.type !== "audio" || typeof entry.url !== "string") return []
    const path = entry.url.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!path || path.includes("..") || !/\.wav$/i.test(path)) return []
    return [path]
  })
  if (!paths.length) throw new Error(`El índice WAV no contiene el banco ${source.rawWavBank}`)
  return paths
}

function pianoZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap((samplePath): ParsedRawZone[] => {
    const match = /_JHPiano_Sus_Close_([A-Ga-g](?:#|b)?-?\d+)_vl(\d+)_rr(\d+)\.wav$/i.exec(samplePath)
    if (!match) return []
    const physicalLayer = Number(match[2])
    return [{ samplePath, rootMidi: sfzNoteToMidi(match[1]), velocityLayer: physicalLayer <= 2 ? 0 : physicalLayer === 3 ? 1 : 2, roundRobin: Math.max(0, Number(match[3]) - 1), mic: "close", trigger: "attack", articulation: "normal" }]
  })
}
function organManualOpenZones(paths: readonly string[]): ParsedRawZone[] { return paths.flatMap((samplePath): ParsedRawZone[] => { const m=/_Rode_Man3Open_([A-Ga-g](?:#|b)?-?\d+)\.wav$/i.exec(samplePath); return m?[{samplePath,rootMidi:sfzNoteToMidi(m[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"attack",articulation:"normal"}]:[] }) }
function organManualQuietZones(paths: readonly string[]): ParsedRawZone[] { return paths.flatMap((samplePath): ParsedRawZone[] => { const m=/_NT5_Man3Quiet_([A-Ga-g](?:#|b)?-?\d+)_rr(\d+)\.wav$/i.exec(samplePath); return m?[{samplePath,rootMidi:sfzNoteToMidi(m[1]),velocityLayer:0,roundRobin:Math.max(0,Number(m[2])-1),mic:"default",trigger:"attack",articulation:"normal"}]:[] }) }
function organPedalZones(paths: readonly string[]): ParsedRawZone[] { return paths.flatMap((samplePath): ParsedRawZone[] => { const m=/_Rode_Pedal_([A-Ga-g](?:#|b)?-?\d+)\.wav$/i.exec(samplePath); return m?[{samplePath,rootMidi:sfzNoteToMidi(m[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"attack",articulation:"normal"}]:[] }) }
function ocarinaZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap((samplePath): ParsedRawZone[] => {
    const standard=/_StdOcarina_Sus_([A-Ga-g](?:#|b)?-?\d+)\.wav$/i.exec(samplePath); if(standard)return[{samplePath,rootMidi:sfzNoteToMidi(standard[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"attack",articulation:"normal"}]
    const sustain=/_ocarina_([A-Ga-g](?:#|b)?-?\d+)_sustain\d+\.wav$/i.exec(samplePath); if(sustain)return[{samplePath,rootMidi:sfzNoteToMidi(sustain[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"attack",articulation:"normal"}]
    const staccato=/_ocarina_([A-Ga-g](?:#|b)?-?\d+)_staccato\d+\.wav$/i.exec(samplePath); return staccato?[{samplePath,rootMidi:sfzNoteToMidi(staccato[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"attack",articulation:"staccato"}]:[]
  })
}
function altoRecorderZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap((samplePath): ParsedRawZone[] => {
    const sustain=/AltRecorder_Sus_([A-Ga-g](?:#|b)?-?\d+)_rr(\d+)_Main\.wav$/i.exec(samplePath); if(sustain)return[{samplePath,rootMidi:sfzNoteToMidi(sustain[1]),velocityLayer:0,roundRobin:Math.max(0,Number(sustain[2])-1),mic:"default",trigger:"attack",articulation:"normal"}]
    const staccato=/AltRecorder_Stac_([A-Ga-g](?:#|b)?-?\d+)_rr(\d+)_Main\.wav$/i.exec(samplePath); return staccato?[{samplePath,rootMidi:sfzNoteToMidi(staccato[1]),velocityLayer:0,roundRobin:Math.max(0,Number(staccato[2])-1),mic:"default",trigger:"attack",articulation:"staccato"}]:[]
  })
}
function harpsichordZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap((samplePath): ParsedRawZone[] => {
    const release=/Harpsichord_stop1-rel_([A-Ga-g](?:#|b)?-?\d+)_1\.wav$/i.exec(samplePath); if(release)return[{samplePath,rootMidi:sfzNoteToMidi(release[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"release",articulation:"normal"}]
    const sustain=/Harpsichord_stop1_([A-Ga-g](?:#|b)?-?\d+)_1\.wav$/i.exec(samplePath); return sustain?[{samplePath,rootMidi:sfzNoteToMidi(sustain[1]),velocityLayer:0,roundRobin:0,mic:"default",trigger:"attack",articulation:"normal"}]:[]
  })
}
function concertHarpZones(paths: readonly string[]): ParsedRawZone[] {
  return paths.flatMap((samplePath): ParsedRawZone[] => {
    const match=/KSHarp_([A-Ga-g](?:#|b)?-?\d+)_(p|mp|mf|f)(\d+)\.wav$/i.exec(samplePath)
    if(!match)return[]
    // The source is irregular at the extreme registers. p/mp/mf are the softer physical colour;
    // f is the hard-pluck layer. Layer ranges are generated independently so missing roots do not create holes.
    const dynamic=match[2].toLowerCase()
    return [{samplePath,rootMidi:sfzNoteToMidi(match[1]),velocityLayer:dynamic==="f"?1:0,roundRobin:Math.max(0,Number(match[3])-1),mic:"default",trigger:"attack",articulation:"normal"}]
  })
}

function velocityRange(layer:number, profile:CuratedRawWavPackSource["rawWavProfile"]){
  if(profile==="vcsl-grand-piano-sus-close")return layer===0?{lo:0,hi:50}:layer===1?{lo:51,hi:94}:{lo:95,hi:127}
  if(profile==="vcsl-concert-harp")return layer===0?{lo:0,hi:87}:{lo:88,hi:127}
  return{lo:0,hi:127}
}
function rangesForRoots(roots:readonly number[]){const unique=[...new Set(roots)].sort((a,b)=>a-b),map=new Map<number,{lo:number;hi:number}>();for(let i=0;i<unique.length;i++){const root=unique[i],previous=unique[i-1],next=unique[i+1],lo=previous===undefined?0:Math.floor((previous+root)/2)+1,hi=next===undefined?127:Math.floor((root+next)/2);map.set(root,{lo:Math.max(0,lo),hi:Math.min(127,hi)})}return map}
function zonesForProfile(paths:readonly string[],profile:CuratedRawWavPackSource["rawWavProfile"]):ParsedRawZone[]{switch(profile){case"vcsl-grand-piano-sus-close":return pianoZones(paths);case"vcsl-pipe-organ-rode-man3-open":return organManualOpenZones(paths);case"vcsl-pipe-organ-nt5-man3-quiet":return organManualQuietZones(paths);case"vcsl-pipe-organ-rode-pedal":return organPedalZones(paths);case"vcsl-ocarina":return ocarinaZones(paths);case"vcsl-alto-recorder":return altoRecorderZones(paths);case"vcsl-italian-harpsichord-stop1":return harpsichordZones(paths);case"vcsl-concert-harp":return concertHarpZones(paths)}}

export function compileRawWavPathsToSfz(paths:readonly string[],source:CuratedRawWavPackSource){
  const zones=zonesForProfile(paths,source.rawWavProfile);if(!zones.length)throw new Error(`El perfil ${source.rawWavProfile} no encontró WAV compatibles`)
  const selectedPaths=[...new Set(zones.map(zone=>zone.samplePath))],groups=new Map<string,ParsedRawZone[]>()
  for(const zone of zones){const key=`${zone.articulation}:${zone.trigger}:${zone.velocityLayer}:${zone.mic}`,list=groups.get(key)??[];list.push(zone);groups.set(key,list)}
  const chunks:string[]=["<control> default_path="]
  for(const[key,groupZones]of groups){const[articulation,,layerText]=key.split(":"),layer=Number(layerText),velocity=velocityRange(layer,source.rawWavProfile),rootRanges=rangesForRoots(groupZones.map(zone=>zone.rootMidi));chunks.push(`<group> sw_label=${articulation}`);for(const zone of groupZones.sort((a,b)=>a.rootMidi-b.rootMidi)){const range=rootRanges.get(zone.rootMidi)!;chunks.push(`<region> sample=${zone.samplePath} pitch_keycenter=${zone.rootMidi} lokey=${range.lo} hikey=${range.hi} lovel=${velocity.lo} hivel=${velocity.hi} tloque_mic=${zone.mic} trigger=${zone.trigger} seq_length=1 seq_position=${zone.roundRobin+1}`)}}
  return{sfzText:chunks.join("\n"),samplePaths:selectedPaths}
}
export function compileRawWavIndexToSfz(indexText:string,source:CuratedRawWavPackSource){return compileRawWavPathsToSfz(parseIndex(indexText,source),source)}
