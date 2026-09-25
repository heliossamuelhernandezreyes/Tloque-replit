import assert from "node:assert/strict"
import { HybridMusicEngine } from "../../client/src/audio/HybridMusicEngine"
Object.assign(globalThis, {
  window: { clearTimeout, setTimeout, clearInterval, setInterval },
  Audio: class { setAttribute() {} addEventListener() {} },
})
const engine = new HybridMusicEngine(() => {})
let plays = 0
;(engine as any).stream.play = async () => { plays++ }
;(engine as any).stream.setNarrativeDirection = () => {}
const cue = { id: 1, title: "Fallback", sourceType: "procedural" as const, url: "/audio/fixture.mp3", loop: false, volume: .3, crossfadeSeconds: 1 }
const timeout = setTimeout(() => { throw new Error("Playback queue deadlocked") }, 2000)
await engine.play(cue)
await engine.play({ ...cue, id: 2, sourceType: "stream" })
assert.equal(plays, 2)
clearTimeout(timeout)
