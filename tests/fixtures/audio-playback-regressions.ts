import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { MusicEngine, type MusicCue } from '../../client/src/audio/MusicEngine'
import { HybridMusicEngine } from '../../client/src/audio/HybridMusicEngine'
import { AdaptiveLayerMusicEngine } from '../../client/src/audio/AdaptiveLayerMusicEngine'
import { SoundFontMusicEngine } from '../../client/src/audio/SoundFontMusicEngine'
import { NativeCrossfadeScoreEngine } from '../../client/src/audio/NativeCrossfadeScoreEngine'
import { LinearScoreEngine } from '../../client/src/audio/LinearScoreEngine'
import { compileTloqueScore, DEFAULT_PROCEDURAL_RECIPE } from '../../shared/audio'
import { musicBrainScoreForProceduralRecipe } from '../../shared/music-brain'

let now=0, sequence=0
const frames=new Map<number,FrameRequestCallback>(), results:any[]=[]
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}})
globalThis.requestAnimationFrame=callback=>{frames.set(++sequence,callback);return sequence}
globalThis.cancelAnimationFrame=id=>{frames.delete(id)}
function step(ms:number){now+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now))}
class FakeAudio extends EventTarget {
  static all:FakeAudio[]=[]
  src='';volume=1;loop=false;paused=true;currentTime=0;preload='';crossOrigin='';readyState=4
  getAttribute(name:string){return name==='src'?this.src||null:null}
  constructor(){super();FakeAudio.all.push(this)}
  setAttribute(){} removeAttribute(name:string){if(name==='src')this.src=''} load(){}
  async play(){this.paused=false} pause(){this.paused=true}
}
;(globalThis as any).Audio=FakeAudio
;(globalThis as any).window={setTimeout,clearTimeout,setInterval,clearInterval,AudioContext:class{}}
const cue=(id:number,extra:Partial<MusicCue>={}):MusicCue=>({id,title:'Audit fixture '+id,sourceType:'stream',url:'/fixture-'+id+'.wav',volume:1,crossfadeSeconds:.25,loop:true,...extra})
async function probe(id:string,run:()=>Promise<any>){
  try{const evidence=await run();results.push({id,passed:true,...evidence});console.log('PASS '+id+' '+JSON.stringify(evidence))}
  catch(error){results.push({id,passed:false,error:String((error as Error).stack)});console.error(id,error)}
  finally{frames.clear();FakeAudio.all=[]}
}
await probe('A01-stream-crossfade-stays-paused',async()=>{
  const states:string[]=[],engine=new MusicEngine(state=>states.push(state))
  try{
    await engine.play(cue(1));step(300)
    await engine.play(cue(2,{crossfadeSeconds:10}));step(1000)
    engine.pause()
    const active=FakeAudio.all.filter(deck=>!deck.paused&&deck.volume>0)
    assert.equal(active.length,0)
    step(11000)
    assert.equal(states.at(-1),'paused')
    await engine.resume();assert.equal(FakeAudio.all.filter(deck=>!deck.paused&&deck.volume>0).length,2)
    step(11000);assert.equal(states.at(-1),'playing')
    return {audibleDecksAfterPause:active.length,lastPublicState:states.at(-1)}
  }finally{engine.dispose()}
})
await probe('A02-stream-master-zero-mutes-both',async()=>{
  const engine=new MusicEngine(()=>{})
  try{
    await engine.play(cue(1));step(300)
    await engine.play(cue(2,{crossfadeSeconds:10}));step(1000)
    engine.setMasterVolume(0);step(1000)
    const volumes=FakeAudio.all.map(deck=>deck.volume)
    assert.ok(volumes.every(value=>value===0))
    return {requestedMaster:0,deckVolumes:volumes}
  }finally{engine.dispose()}
})
await probe('A03-stream-natural-end-updates-state',async()=>{
  const states:string[]=[],engine=new MusicEngine(state=>states.push(state))
  try{
    await engine.play(cue(1,{loop:false}));step(300)
    const deck=FakeAudio.all.find(deck=>!deck.paused)!
    deck.paused=true;deck.dispatchEvent(new Event('ended'))
    assert.equal(states.at(-1),'paused')
    return {mediaEnded:true,lastPublicState:states.at(-1)}
  }finally{engine.dispose()}
})
for(const action of ['stop','pause','dispose'] as const)await probe('A04-procedural-preserves-'+action,async()=>{
  let release!:()=>void
  ;(globalThis as any).toneGate=new Promise<void>(resolve=>release=resolve)
  ;(globalThis as any).toneGateEntered=false
  const states:string[]=[],engine=new HybridMusicEngine(state=>states.push(state))
  try{
    const playing=engine.play(cue(3,{sourceType:'procedural',recipe:DEFAULT_PROCEDURAL_RECIPE}))
    for(let i=0;i<50&&!(globalThis as any).toneGateEntered;i++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal((globalThis as any).toneGateEntered,true)
    engine[action]();const afterAction=states.at(-1)
    release();await playing
    assert.equal(states.at(-1),action==='pause'?'paused':'idle')
    assert.notEqual((globalThis as any).toneTransport.state,'started')
    return {action,stateAfterAction:afterAction,lastPublicState:states.at(-1),transport:(globalThis as any).toneTransport.state}
  }finally{release();(engine as any).procedural.stop();engine.dispose()}
})
await probe('A05-adaptive-layers-update-reselects-engine',async()=>{
  const engine=new HybridMusicEngine(()=>{}),calls:any[]=[]
  const backend=(label:string)=>({play:async(value:any)=>{calls.push({label,sourceType:value.sourceType});(engine as any).state='playing'},stop(){},pause(){},resume(){},dispose(){},setMasterVolume(){},setDucked(){},setNarrativeDirection(){}})
  const native=backend('nativeScore'),adaptive=backend('adaptive')
  ;(engine as any).nativeScore=native;(engine as any).score=backend('score');(engine as any).adaptive=adaptive
  try{
    const score=musicBrainScoreForProceduralRecipe(DEFAULT_PROCEDURAL_RECIPE)
    const region=score.regions.find(region=>!region.silence)!
    region.scoreId=1;region.layerIds=[1]
    // Reader loads the score first, then its layers in the same effect.
    engine.setNarrativeScore(score)
    await engine.play(cue(4,{sourceType:'procedural',recipe:DEFAULT_PROCEDURAL_RECIPE}))
    engine.setAdaptiveLayers([{id:1,scoreId:1,layerKey:'fixture',url:'/stem.wav',defaultGain:1,loop:true} as any])
    for(let i=0;i<10;i++)await Promise.resolve()
    assert.ok(calls.length);assert.equal(calls.some(call=>call.label==='adaptive'),true)
    const beforeRetry=[...calls]
    await engine.play(cue(4,{sourceType:'procedural',recipe:DEFAULT_PROCEDURAL_RECIPE}))
    assert.equal(calls.at(-1).label,'adaptive')
    return {regionId:region.id,playCallsBeforeRetry:beforeRetry,manualRetry:calls.at(-1),layersReselected:true}
  }finally{engine.dispose()}
})
await probe('A06-adaptive-pause-retains-crossfade',async()=>{
  const engine=new AdaptiveLayerMusicEngine(()=>{}),layers=[{id:1,url:'/stem.wav',defaultGain:1,loop:true} as any]
  try{
    await engine.play(cue(10,{adaptiveLayers:layers}));step(300)
    await engine.play(cue(11,{adaptiveLayers:layers,crossfadeSeconds:10}));step(1000)
    engine.pause();step(11000)
    // A wall-clock wait must retain both groups until the fade resumes.
    assert.equal((engine as any).groups.filter(Boolean).length,2)
    await engine.resume();step(11000);assert.equal((engine as any).groups.filter(Boolean).length,1)
    return {groupsAfterPauseAndWait:(engine as any).groups.filter(Boolean).length,retainedFadeResumed:true}
  }finally{engine.dispose()}
})
await probe('A12-soundfont-pause-retains-audio-phase',async()=>{
  const intervals=new Map<number,()=>void>(),timeouts=new Map<number,()=>void>(),notes:any[]=[]
  const saved={...((globalThis as any).window)}
  let sequence=0, suspended=false
  Object.assign((globalThis as any).window,{
    setInterval:(fn:()=>void)=>{intervals.set(++sequence,fn);return sequence},clearInterval:(id:number)=>intervals.delete(id),
    setTimeout:(fn:()=>void)=>{timeouts.set(++sequence,fn);return sequence},clearTimeout:(id:number)=>timeouts.delete(id),
  })
  const engine=new SoundFontMusicEngine(()=>{})
  ;(engine as any).context={currentTime:1,suspend:async()=>{suspended=true},close:async()=>{}}
  ;(engine as any).synth={noteOn:(...args:any[])=>notes.push(['on',...args]),noteOff:(...args:any[])=>notes.push(['off',...args]),stopAll(){},destroy(){}}
  ;(engine as any).cue=cue(20,{sourceType:'soundfont',recipe:DEFAULT_PROCEDURAL_RECIPE})
  try{
    ;(engine as any).schedule();const barBeforePause=(engine as any).bar
    engine.pause();for(const fn of [...timeouts.values()])fn();for(const fn of [...intervals.values()])fn()
    const barWhilePaused=(engine as any).bar
    assert.equal(suspended,true);assert.equal(barWhilePaused,barBeforePause);assert.equal(notes.length,6)
    return {barBeforePause,barWhilePaused,audioClockSeconds:(engine as any).context.currentTime,audioSuspended:suspended,noteMessages:notes.length}
  }finally{engine.dispose();Object.assign((globalThis as any).window,saved)}
})
const compiled=compileTloqueScore(`TLOQUE_SCORE 2
title "Module cancellation"
tempo 120
meter 4/4
loop false
seed 1
humanize 0
quality studio
module builtin
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.3
section test form=custom bars=1 repeat=1 fade=0 tempo=120 rubato=0
use solo
1:1 E5 1 velocity=0.7 articulation=normal
end`)
assert.ok(compiled.ok)
for(const Backend of [SoundFontMusicEngine,LinearScoreEngine])for(const action of ['stop','dispose'] as const)await probe('loading-'+Backend.name+'-'+action,async()=>{
  let release!:()=>void,closed=false,entered=false
  const gate=new Promise<void>(resolve=>release=resolve),states:string[]=[]
  const previous=(globalThis as any).AudioContext
  ;(globalThis as any).AudioContext=class{
    audioWorklet={addModule:async()=>{entered=true;await gate}}
    async close(){closed=true}
  }
  const engine=new Backend(state=>states.push(state))
  try{
    const pending=engine.play(cue(40,{sourceType:Backend===LinearScoreEngine?'score':'soundfont',packUrl:'/fixture.sf2',recipe:Backend===LinearScoreEngine&&compiled.ok?compiled.recipe:DEFAULT_PROCEDURAL_RECIPE}))
    for(let i=0;i<10&&!entered;i++)await Promise.resolve()
    assert.equal(entered,true);engine[action]();assert.equal(closed,true)
    release();await pending;assert.equal(states.at(-1),'idle')
    return {contextClosed:true,lastState:states.at(-1)}
  }finally{release();engine.dispose();(globalThis as any).AudioContext=previous}
})
await probe('native-wrapper-stale-load-cannot-retire-new-deck',async()=>{
  let release!:()=>void,calls=0,retirements=0
  const gate=new Promise<void>(resolve=>release=resolve),engine=new NativeCrossfadeScoreEngine(()=>{})
  const deck={setMasterVolume(){},setDucked(){},setNarrativeDirection(){},stop(){},pause(){},resume:async()=>{},secondsUntilNextBar(){return 0},fadeOutAndStop(){retirements++},play:async()=>{if(++calls===1)await gate;return 0}}
  ;(engine as any).decks=[deck,deck]
  try{
    const older=engine.play(cue(50));engine.stop();await engine.play(cue(51));release();await older
    assert.equal(retirements,0);return {newDeckPreserved:true}
  }finally{release();engine.dispose()}
})
await writeFile(process.env.AUDIO_AUDIT_RESULTS||'.tloque_cache/audio-playback-regressions.json',JSON.stringify({regressionFor:'audio-audit-20261109',fixture:'actual engines with controlled media/clock/Tone primitives; no live providers',results},null,2))
if(results.some(result=>!result.passed))process.exitCode=1
