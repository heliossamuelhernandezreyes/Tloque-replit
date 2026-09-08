import assert from "node:assert/strict"
import test from "node:test"
import { deflateRawSync } from "node:zlib"
import { importMusicXmlBytes, importMusicXmlText } from "../client/src/lib/musicXmlImporter"
import { parseStrictXml } from "../client/src/lib/strictXml"
import { compileTloqueScore, TLOQUE_SCORE_COMPILER_V2 } from "../shared/audio"

const PARTWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Puente clásico</work-title></work>
  <identification><creator type="composer">Ada Música</creator></identification>
  <part-list>
    <score-part id="P1">
      <part-name>Violin I</part-name>
      <score-instrument id="P1-I1"><instrument-name>Violin section</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>41</midi-program></midi-instrument>
    </score-part>
    <score-part id="P2">
      <part-name>Clarinet in B-flat</part-name>
      <score-instrument id="P2-I1"><instrument-name>Clarinet</instrument-name></score-instrument>
      <midi-instrument id="P2-I1"><midi-channel>2</midi-channel><midi-program>72</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><words>pizz.</words><dynamics><p/></dynamics><wedge type="crescendo" number="1"/></direction-type><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><tie type="start"/><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><staff>1</staff></note>
      <note><rest/><duration>8</duration><voice>1</voice></note>
      <direction><direction-type><wedge type="stop" number="1"/></direction-type></direction>
    </measure>
    <measure number="2">
      <attributes><time><beats>3</beats><beat-type>8</beat-type></time></attributes>
      <direction><direction-type><words>arco</words><dynamics><f/></dynamics><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>6</duration><voice>2</voice><staff>1</staff><notations><articulations><tenuto/></articulations></notations></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><transpose><chromatic>-2</chromatic></transpose></attributes>
      <direction><direction-type><pedal type="start"/></direction-type></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice></note>
      <backup><duration>8</duration></backup>
      <note><rest/><duration>4</duration><voice>2</voice></note>
      <forward><duration>2</duration></forward>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><notations><articulations><staccato/></articulations></notations></note>
      <direction><direction-type><pedal type="stop"/></direction-type></direction>
    </measure>
    <measure number="2">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`

const TIMEWISE = `<?xml version="1.0"?>
<score-timewise version="4.0">
  <movement-title>Forma timewise</movement-title>
  <part-list><score-part id="P1"><part-name>Flute</part-name><midi-instrument id="P1-I1"><midi-program>74</midi-program></midi-instrument></score-part></part-list>
  <measure number="1"><part id="P1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes><sound tempo="90"/><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration></note></part></measure>
</score-timewise>`

function crc32(value: Buffer) {
  let checksum = 0xffffffff
  for (const byte of value) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function mxlArchive(files: readonly { name: string; value: string; deflate?: boolean }[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8")
    const plain = Buffer.from(file.value, "utf8")
    const compressed = file.deflate ? deflateRawSync(plain) : plain
    const method = file.deflate ? 8 : 0
    const checksum = crc32(plain)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(plain.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(plain.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(localOffset, 42)
    const localPart = Buffer.concat([local, name, compressed])
    localParts.push(localPart)
    centralParts.push(central, name)
    localOffset += localPart.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return new Uint8Array(Buffer.concat([...localParts, central, end]))
}

test("MusicXML partwise conserva estructura, transposición y gestos reproducibles", () => {
  const imported = importMusicXmlText(PARTWISE, "puente.musicxml")
  assert.equal(imported.title, "Puente clásico")
  assert.equal(imported.composer, "Ada Música")
  assert.equal(imported.report.sourceParts, 2)
  assert.equal(imported.report.outputTracks, 2)
  assert.equal(imported.report.measures, 2)
  assert.equal(imported.recipe.version, 2)
  assert.match(imported.source, /instrument=strings\.violin-section/)
  assert.match(imported.source, /section mx-0001[^\n]+tempo=60 meter=4\/4/)
  assert.match(imported.source, /section mx-0002[^\n]+tempo=120 meter=3\/8/)
  assert.match(imported.source, /\bC5\b/)
  assert.match(imported.source, /articulation=pizzicato/)
  assert.match(imported.source, /pedal=down/)
  assert.match(imported.source, /pedal=up/)

  const compiled = compileTloqueScore(imported.source)
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
  if (!compiled.ok || compiled.recipe.version !== 2) return
  assert.equal(compiled.recipe.plan.compilerVersion, TLOQUE_SCORE_COMPILER_V2)
  assert.deepEqual(compiled.recipe.plan.sections.map(section => section.meter), [
    { numerator: 4, denominator: 4 },
    { numerator: 3, denominator: 8 },
  ])
  assert.equal(compiled.recipe.plan.totalBeats, 5.5)
  assert.ok(compiled.recipe.plan.controls.length >= 4)
  const tiedC = compiled.recipe.plan.events.find(event => event.notes.length === 1 && event.notes[0] === 60 && event.timeBeats === 0)
  assert.equal(tiedC?.durationSeconds, 4.75)
  assert.ok(imported.report.warnings.some(warning => warning.code === "duration-across-tempo"))
})

test("MusicXML timewise se normaliza a la misma línea temporal", () => {
  const imported = importMusicXmlText(TIMEWISE, "timewise.musicxml")
  assert.equal(imported.report.measures, 1)
  assert.equal(imported.report.notes, 1)
  assert.match(imported.source, /instrument=woodwinds\.flute/)
  assert.match(imported.source, /tempo 90/)
})

test("un compás implícito conserva la anacrusa sin insertar silencio", () => {
  const pickup = `<?xml version="1.0"?><score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list>
    <part id="P1">
      <measure number="0" implicit="yes"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note></measure>
      <measure number="1"><note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration></note></measure>
    </part>
  </score-partwise>`
  const imported = importMusicXmlText(pickup, "anacrusa.musicxml")
  const compiled = compileTloqueScore(imported.source)
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
  if (!compiled.ok || compiled.recipe.version !== 2) return
  assert.deepEqual(compiled.recipe.plan.sections.map(section => section.meter), [
    { numerator: 1, denominator: 4 },
    { numerator: 4, denominator: 4 },
  ])
  assert.deepEqual(compiled.recipe.plan.events.map(event => event.timeBeats), [0, 1])
  assert.equal(compiled.recipe.plan.totalBeats, 5)
  assert.ok(imported.report.warnings.some(warning => warning.code === "implicit-measure"))
})

test("una ligadura de frase mantiene legato en sus notas intermedias", () => {
  const slur = `<?xml version="1.0"?><score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Flute</part-name><midi-instrument id="P1-I1"><midi-program>74</midi-program></midi-instrument></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><notations><slur type="start" number="1"/></notations></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><notations><slur type="stop" number="1"/></notations></note>
    </measure></part>
  </score-partwise>`
  const imported = importMusicXmlText(slur, "ligadura.musicxml")
  assert.equal(imported.source.match(/articulation=legato/g)?.length, 3)
  assert.equal(imported.report.warnings.some(warning => warning.code === "open-slur"), false)
})

test("una parte de percusión conserva el midi-unpitched de cada instrumento", () => {
  const percussion = `<?xml version="1.0"?><score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Percussion</part-name>
      <score-instrument id="P1-I1"><instrument-name>Snare Drum</instrument-name></score-instrument>
      <score-instrument id="P1-I2"><instrument-name>Open Triangle</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument>
      <midi-instrument id="P1-I2"><midi-channel>10</midi-channel><midi-unpitched>82</midi-unpitched></midi-instrument>
    </score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
      <note><unpitched><display-step>C</display-step><display-octave>4</display-octave></unpitched><instrument id="P1-I1"/><duration>1</duration></note>
      <note><unpitched><display-step>A</display-step><display-octave>5</display-octave></unpitched><instrument id="P1-I2"/><duration>1</duration></note>
    </measure></part>
  </score-partwise>`
  const imported = importMusicXmlText(percussion, "percusion.musicxml")
  assert.equal(imported.recipe.version, 2)
  if (imported.recipe.version !== 2) return
  assert.deepEqual(imported.recipe.plan.events.map(event => event.notes), [[38], [81]])
  assert.ok(imported.report.warnings.some(warning => warning.code === "multi-instrument-part"))
})

test("MXL resuelve container.xml, descomprime DEFLATE y verifica CRC", async t => {
  try {
    new DecompressionStream("deflate-raw")
  } catch {
    t.skip("El runtime no ofrece deflate-raw; los navegadores compatibles sí lo validan")
    return
  }
  const container = `<?xml version="1.0"?><container version="1.0"><rootfiles><rootfile full-path="preview.xml" media-type="application/pdf"/><rootfile full-path="scores/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`
  const archive = mxlArchive([
    { name: "META-INF/container.xml", value: container },
    { name: "preview.xml", value: "<not-a-score/>" },
    { name: "scores/main.musicxml", value: TIMEWISE, deflate: true },
  ])
  const imported = await importMusicXmlBytes(archive, "obra.mxl")
  assert.equal(imported.report.format, "mxl")
  assert.equal(imported.report.sourcePath, "scores/main.musicxml")
  assert.equal(imported.report.notes, 1)

  const corruptArchive = mxlArchive([
    { name: "META-INF/container.xml", value: container },
    { name: "preview.xml", value: "<not-a-score/>" },
    { name: "scores/main.musicxml", value: TIMEWISE },
  ])
  const scoreOffset = Buffer.from(corruptArchive.buffer, corruptArchive.byteOffset, corruptArchive.byteLength).indexOf(Buffer.from("<score-timewise"))
  assert.ok(scoreOffset >= 0)
  corruptArchive[scoreOffset + 1] ^= 0x01
  await assert.rejects(importMusicXmlBytes(corruptArchive, "rota.mxl"), /CRC/)
})

test("el lector XML bloquea DTD, entidades declaradas y profundidad abusiva", () => {
  assert.throws(() => parseStrictXml(`<!DOCTYPE score-partwise [<!ENTITY x "boom">]><score-partwise>&x;</score-partwise>`), /DTD o ENTITY/)
  assert.throws(() => parseStrictXml("<a><b><c/></b></a>", { maxDepth: 1 }), /niveles de anidación/)
  assert.throws(() => parseStrictXml("<a>&#0;</a>"), /fuera de Unicode/)
  assert.throws(() => parseStrictXml("<a>&#65oops;</a>"), /fuera de Unicode/)
  assert.throws(() => parseStrictXml("<a>\u0001</a>"), /carácter no permitido/)
  assert.throws(() => importMusicXmlText(PARTWISE.replace("<beat-type>8</beat-type>", "<beat-type>3</beat-type>")), /denominador no admitido/)
})

test("una parte musical no declarada se rechaza en lugar de omitirse", () => {
  const undeclared = TIMEWISE.replace("</measure>", `<part id="P2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></part></measure>`)
  assert.throws(() => importMusicXmlText(undeclared, "parte-no-declarada.musicxml"), /no la declara/)
})

test("los compases compuestos conservan su duración total exacta", () => {
  const composite = `<?xml version="1.0"?><score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>2</beats><beat-type>4</beat-type><beats>3</beats><beat-type>8</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>7</duration></note>
    </measure></part>
  </score-partwise>`
  const imported = importMusicXmlText(composite, "compuesto.musicxml")
  assert.match(imported.source, /meter 7\/8/)
  assert.ok(imported.report.warnings.some(warning => warning.code === "composite-meter"))
})

test("TloqueScore 2.3 mantiene tiempos absolutos con compases variables", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
title "Compases variables"
tempo 60
meter 4/4
loop false
seed 7
humanize 0
quality master
module builtin
track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.3 pan=0 attack=0.01 release=1 expression=0.8 brightness=0.5 vibrato=0
section four form=custom bars=1 repeat=1 fade=0 tempo=60 meter=4/4 rubato=0
use piano
1:1 C4 1 velocity=0.5
end
section three-eight form=custom bars=1 repeat=1 fade=0 tempo=120 meter=3/8 rubato=0
use piano
1:2 D4 0.5 velocity=0.5
end`)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) return
  assert.equal(result.recipe.plan.events[1].timeBeats, 4.5)
  assert.equal(result.recipe.plan.events[1].timeSeconds, 4.25)
  assert.equal(result.recipe.plan.totalBeats, 5.5)
  assert.equal(result.recipe.plan.totalSeconds, 4.75)
})

test("los compases extremos admitidos siguen produciendo un plan válido", () => {
  const tiny = compileTloqueScore(`TLOQUE_SCORE 2
title "Compás mínimo"
tempo 300
meter 1/32
loop false
seed 2
humanize 0
quality core
module builtin
track bell synth=bell instrument=keys.celesta program=8 role=accent gain=0.2 pan=0 attack=0.01 release=1 expression=0.8 brightness=0.5 vibrato=0
section tiny form=custom bars=1 repeat=1 fade=0 tempo=300 meter=1/32 rubato=0
use bell
1:1 C6 0.03125 velocity=0.5
end`)
  assert.equal(tiny.ok, true, tiny.ok ? undefined : JSON.stringify(tiny.diagnostics))
  if (tiny.ok) {
    assert.equal(tiny.recipe.plan.totalBeats, 0.125)
    assert.equal(tiny.recipe.plan.totalSeconds, 0.025)
  }

  const wide = compileTloqueScore(`TLOQUE_SCORE 2
title "Compás ancho"
tempo 120
meter 32/32
loop false
seed 3
humanize 0
quality core
module builtin
track bell synth=bell instrument=keys.celesta program=8 role=accent gain=0.2 pan=0 attack=0.01 release=1 expression=0.8 brightness=0.5 vibrato=0
section wide form=custom bars=1 repeat=1 fade=0 tempo=120 meter=32/32 rubato=0
use bell
1:32.5 C6 0.03125 velocity=0.5
end`)
  assert.equal(wide.ok, true, wide.ok ? undefined : JSON.stringify(wide.diagnostics))
})

test("el compilador acepta 500 compases sin búsquedas cuadráticas por sección", () => {
  const notes = Array.from({ length: 500 }, (_, index) => `${index + 1}:1 C4 0.25 velocity=0.5`).join("\n")
  const result = compileTloqueScore(`TLOQUE_SCORE 2
title "Escala clásica"
tempo 240
meter 2/2
loop false
seed 8
humanize 0
quality master
module builtin
track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.3 pan=0 attack=0.01 release=1 expression=0.8 brightness=0.5 vibrato=0
section movement form=custom bars=500 repeat=1 fade=0 tempo=240 meter=2/2 rubato=0
use piano
${notes}
end`)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) return
  assert.equal(result.recipe.plan.totalBars, 500)
  assert.equal(result.recipe.plan.events.length, 500)
})

test("el endpoint acepta fuente compacta y rechaza TloqueScore inválido", async () => {
  process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:5432/unused"
  const { audioAssetInputSchema } = await import("../server/audio")
  const source = `TLOQUE_SCORE 2
title "Carga compacta"
tempo 72
meter 4/4
loop false
seed 1
humanize 0
quality master
module builtin
track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.3 pan=0 attack=0.01 release=1 expression=0.8 brightness=0.5 vibrato=0
section one form=custom bars=1 repeat=1 fade=0 tempo=72 meter=4/4 rubato=0
use piano
1:1 C4 1 velocity=0.5
end`
  const base = { title: "Carga compacta", kind: "music", sourceType: "score", recipe: null, license: "Autorización pendiente", sourceName: "Prueba MusicXML" }
  assert.equal(audioAssetInputSchema.safeParse({ ...base, scoreSource: source }).success, true)
  assert.equal(audioAssetInputSchema.safeParse({ ...base, scoreSource: "no es una partitura" }).success, false)
})
