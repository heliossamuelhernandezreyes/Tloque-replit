import test from "node:test"
import assert from "node:assert/strict"
import { advancedDirectionProjectSchema } from "../shared/direction.ts"
import {
  compileMusicBrainScore,
  defaultMusicBrainSeed,
  leitmotifForCharacter,
  musicBrainScoreForDirection,
  musicBrainScoreForProceduralRecipe,
  notesForMusicBrainRegion,
} from "../shared/music-brain.ts"

function directionFixture() {
  return advancedDirectionProjectSchema.parse({
    version: 2,
    bookId: 17,
    chapterIndex: 0,
    revision: 3,
    contentHash: "a".repeat(64),
    language: "es",
    voiceProject: {
      version: 1,
      bookId: 17,
      chapterIndex: 0,
      revision: 3,
      contentHash: "a".repeat(64),
      language: "es",
      narratorVoiceProfileId: null,
      paragraphPauseMs: 650,
      characters: [
        { id: "ines", name: "Inés", aliases: [], voiceProfileId: null, confidence: 1, source: "oracle", locked: false },
        { id: "tomas", name: "Tomás", aliases: [], voiceProfileId: null, confidence: 1, source: "oracle", locked: false },
      ],
      spans: [
        { id: "span-1", paragraphIndex: 0, startOffset: 0, endOffset: 12, kind: "dialogue", speakerId: "ines", delivery: "warm", pace: 0.95, pauseBeforeMs: 500, pauseAfterMs: 900, confidence: 1, source: "oracle", locked: false, note: "" },
        { id: "span-2", paragraphIndex: 1, startOffset: 0, endOffset: 12, kind: "dialogue", speakerId: "tomas", delivery: "tense", pace: 1.05, pauseBeforeMs: 250, pauseAfterMs: 1_100, confidence: 1, source: "oracle", locked: false, note: "" },
        { id: "span-3", paragraphIndex: 2, startOffset: 0, endOffset: 12, kind: "narration", speakerId: "narrator", delivery: "calm", pace: 0.9, pauseBeforeMs: 1_200, pauseAfterMs: 1_500, confidence: 1, source: "oracle", locked: false, note: "" },
      ],
    },
    musicProject: {
      version: 1,
      bookId: 17,
      chapterIndex: 0,
      revision: 3,
      directionStyle: "subtle",
      defaultScoreId: null,
      regions: [
        { id: "encuentro", name: "Encuentro", startParagraph: 0, preferredParagraph: 0, endParagraph: 1, mood: "rising_tension", targetIntensity: 0.72, tension: 0.78, warmth: 0.42, density: 0.62, texture: "suspended", percussion: "subtle", transition: { minimumSeconds: 8, preferredSeconds: 12, maximumSeconds: 20 }, scoreId: null, layerTags: ["cuerdas", "respiración"], confidence: 0.94, source: "oracle", locked: false, note: "" },
        { id: "quietud", name: "Quietud", startParagraph: 2, preferredParagraph: 2, endParagraph: 2, mood: "silence", targetIntensity: 0.2, tension: 0.15, warmth: 0.55, density: 0.1, texture: "minimal", percussion: "none", transition: { minimumSeconds: 8, preferredSeconds: 14, maximumSeconds: 22 }, scoreId: null, layerTags: [], confidence: 0.98, source: "oracle", locked: false, note: "" },
      ],
    },
    voiceNotes: [
      { spanId: "span-1", emotion: "tenderness", projection: "soft", vocalState: "none", intensity: 0.42, elevenLabsTags: ["tender"], source: "agent", locked: false, note: "" },
      { spanId: "span-2", emotion: "tension", projection: "natural", vocalState: "trembling", intensity: 0.7, elevenLabsTags: ["tense"], source: "agent", locked: false, note: "" },
      { spanId: "span-3", emotion: "calm", projection: "soft", vocalState: "none", intensity: 0.2, elevenLabsTags: ["calm"], source: "agent", locked: false, note: "" },
    ],
    musicNodes: [
      { regionId: "encuentro", scoreId: null, layerIds: [], entry: "fade_in", exit: "crossfade", crossfadeSeconds: 12, source: "agent", locked: false, note: "" },
      { regionId: "quietud", scoreId: null, layerIds: [], entry: "crossfade", exit: "fade_out", crossfadeSeconds: 14, source: "agent", locked: false, note: "" },
    ],
    agentAudit: { promptVersion: "test-v1", provider: "test", model: "fixture", generatedAt: "2026-08-22T00:00:00.000Z" },
  })
}

test("la misma dirección, semilla y versiones producen la misma partitura", () => {
  const project = directionFixture()
  const seed = defaultMusicBrainSeed(project.bookId, project.chapterIndex, project.revision)
  const first = compileMusicBrainScore(musicBrainScoreForDirection(project, seed))
  const second = compileMusicBrainScore(musicBrainScoreForDirection(project, seed))
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test("los personajes conservan leitmotivs estables y distinguibles", () => {
  const seed = 918_271
  const ines = leitmotifForCharacter("ines", seed)
  const inesAgain = leitmotifForCharacter("ines", seed)
  const tomas = leitmotifForCharacter("tomas", seed)
  assert.deepEqual(ines, inesAgain)
  assert.notEqual(ines.signature, tomas.signature)
  assert.notDeepEqual(ines.intervals, tomas.intervals)

  const compilation = compileMusicBrainScore(musicBrainScoreForDirection(directionFixture(), seed))
  const characterNotes = notesForMusicBrainRegion(compilation.timeline, "encuentro")
    .filter(event => event.voice === "leitmotif")
  assert.deepEqual([...new Set(characterNotes.map(event => event.characterId))].sort(), ["ines", "tomas"])
})

test("el silencio es una región real y no emite ataques de nota", () => {
  const compilation = compileMusicBrainScore(musicBrainScoreForDirection(directionFixture(), 44))
  assert.equal(notesForMusicBrainRegion(compilation.timeline, "quietud").length, 0)
  assert.ok(compilation.timeline.events.some(event =>
    event.kind === "marker" && event.regionId === "quietud" && event.marker === "silence_start",
  ))
  assert.ok(compilation.timeline.events.some(event =>
    event.kind === "marker" && event.regionId === "quietud" && event.marker === "silence_end",
  ))
})

test("la compilación respeta los límites de lectura y orden temporal", () => {
  const compilation = compileMusicBrainScore(musicBrainScoreForDirection(directionFixture(), 99))
  assert.ok(compilation.plan.regions.every(region => region.intensity <= 0.48))
  assert.ok(compilation.plan.regions.every(region => region.density <= 0.62))
  assert.ok(compilation.plan.regions.every(region => region.maxPolyphony <= 6))
  for (const event of compilation.timeline.events) {
    assert.ok(Number.isFinite(event.beat) && event.beat >= 0)
    if (event.kind === "note") {
      assert.ok(event.midi >= 24 && event.midi <= 96)
      assert.ok(event.velocity >= 0.04 && event.velocity <= 0.42)
      assert.ok(event.durationBeats > 0)
    }
  }
  const beats = compilation.timeline.events.map(event => event.beat)
  assert.deepEqual(beats, [...beats].sort((left, right) => left - right))
})

test("las recetas procedurales existentes pasan por el nuevo compilador", () => {
  const score = musicBrainScoreForProceduralRecipe({
    version: 1,
    preset: "warm_memory",
    rootMidi: 48,
    scale: "dorian",
    bpm: 58,
    bars: 4,
    density: 0.35,
    brightness: 0.45,
    movement: 0.3,
    seed: 123,
  })
  const compilation = compileMusicBrainScore(score)
  assert.equal(compilation.plan.rootMidi, 48)
  assert.equal(compilation.plan.regions[0].mode, "dorian")
  assert.equal(compilation.plan.regions[0].bpm, 58)
  assert.ok(notesForMusicBrainRegion(compilation.timeline, "legacy-cue").length > 0)
})
