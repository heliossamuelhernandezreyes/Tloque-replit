import test from "node:test"
import assert from "node:assert/strict"
import { buildNativeProgressivePreloadPlan, NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS } from "../client/src/audio/NativeProgressivePreload"
import type { NativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"

function plan(): NativeSampleScorePlan {
  const zones = [
    { id: "a", sampleUrl: "/a.wav" },
    { id: "b", sampleUrl: "/b.wav" },
    { id: "a-alt", sampleUrl: "/a.wav" },
  ] as NativeSampleScorePlan["zones"]
  const voice = (zoneId: string, sampleUrl: string, startSeconds: number, durationSeconds = 1) => ({
    trackId: "t",
    articulation: "normal",
    timbre: "natural",
    resolvedTimbre: "non-vibrato",
    note: 60,
    velocity: 80,
    roundRobin: 0,
    vibrato: false,
    vibratoColour: "none",
    mute: "none",
    micPosition: "default",
    startSeconds,
    durationSeconds,
    zoneId,
    sampleUrl,
    playbackRate: 1,
    sampleGain: 1,
    oneShot: false,
    fadeInSeconds: 0,
  }) as NativeSampleScorePlan["voices"][number]
  return {
    tracks: [],
    controls: [],
    voices: [voice("a", "/a.wav", 20, 2), voice("a-alt", "/a.wav", 40, 3), voice("b", "/b.wav", 4)],
    auxiliaryVoices: [],
    zones,
    totalSeconds: 60,
  }
}

test("progressive preload deduplicates physical WAVs and warms before first use", () => {
  const items = buildNativeProgressivePreloadPlan(plan())
  assert.equal(items.length, 2)
  const a = items.find(item => item.zone.sampleUrl === "/a.wav")
  const b = items.find(item => item.zone.sampleUrl === "/b.wav")
  assert.ok(a && b)
  assert.equal(a.firstUseSeconds, 20)
  assert.equal(a.lastUseSeconds, 43)
  assert.equal(a.preloadAtSeconds, 20 - NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS)
  assert.ok(a.preloadAtSeconds <= a.firstUseSeconds)
  assert.equal(b.preloadAtSeconds, 0)
  assert.ok(b.preloadAtSeconds <= b.firstUseSeconds)
})

test("negative lead/grace never schedules unsafe lifecycle times", () => {
  const items = buildNativeProgressivePreloadPlan(plan(), -10, -5)
  for (const item of items) {
    assert.equal(item.preloadAtSeconds, item.firstUseSeconds)
    assert.equal(item.releaseAtSeconds, item.lastUseSeconds)
  }
})

test("realtime no eagerly decodes every selected zone", async () => {
  const { readFile } = await import("node:fs/promises")
  const source = await readFile("client/src/audio/NativeSampleScoreEngine.ts", "utf8")
  assert.match(source, /buildNativeProgressivePreloadPlan\(plan\)/)
  assert.match(source, /player\.preload\(\[preload\.zone\]\)/)
  assert.doesNotMatch(source, /player\.preload\(plan\.zones\)/)
})
