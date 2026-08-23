export const AUDIO_SOURCE_REGISTRY_VERSION = "tloque-audio-sources-2026-08-v3" as const

export type AudioSourceStatus = "integrated" | "approved" | "conversion" | "review" | "excluded"
export type AudioSourceKind = "runtime" | "theory" | "offline-tool" | "sample-library" | "plugin-standard"

export interface AudioModuleSource {
  id: string
  name: string
  kind: AudioSourceKind
  status: AudioSourceStatus
  license: string
  repositoryUrl: string
  documentationUrl?: string
  role: string
  decision: string
  formats: readonly string[]
  install?: CuratedAudioModuleInstall
  samplePackInstall?: CuratedSamplePackInstall
}

export interface CuratedAudioModuleInstall {
  moduleId: string
  version: string
  fileName: string
  sourceUrl: string
  pinnedCommit: string
  estimatedMegabytes: number
  presetCount: number
  drumKitCount: number
  acknowledgement: string
  tags: readonly string[]
}

export interface CuratedSamplePackInstall {
  moduleId: string
  manifestId: string
  version: string
  pinnedCommit: string
  sfzPath: string
  estimatedMegabytes: number
  acknowledgement: string
  tags: readonly string[]
}

// Catálogo de procedencia, no CDN de reproducción. Los renderers nunca buscan
// GitHub durante la lectura: todo banco debe importarse y quedar fijado por SHA-256.
export const AUDIO_MODULE_SOURCES: readonly AudioModuleSource[] = [
  {
    id: "tonejs",
    name: "Tone.js",
    kind: "runtime",
    status: "integrated",
    license: "MIT",
    repositoryUrl: "https://github.com/Tonejs/Tone.js",
    documentationUrl: "https://tonejs.github.io/docs/",
    role: "Síntesis Web Audio, reloj musical, efectos y automatización.",
    decision: "Integrado y fijado en package-lock; es el renderer incorporado de Tloque.",
    formats: ["Web Audio"],
  },
  {
    id: "spessasynth",
    name: "SpessaSynth",
    kind: "runtime",
    status: "integrated",
    license: "Apache-2.0",
    repositoryUrl: "https://github.com/spessasus/spessasynth_lib",
    documentationUrl: "https://spessasus.github.io/spessasynth_lib/",
    role: "Reproducción y render de bancos instrumentales muestreados.",
    decision: "Integrado; los derechos de cada banco se verifican por separado.",
    formats: ["SF2", "SF3", "DLS", "MIDI"],
  },
  {
    id: "tonal",
    name: "Tonal",
    kind: "theory",
    status: "approved",
    license: "MIT",
    repositoryUrl: "https://github.com/tonaljs/tonal",
    documentationUrl: "https://tonaljs.github.io/tonal/docs/",
    role: "Notas, intervalos, acordes, escalas, modos y tonalidades.",
    decision: "Aprobado como referencia/runtime modular; se incorpora sólo donde sustituya reglas propias verificadas.",
    formats: ["TypeScript"],
  },
  {
    id: "webaudiomodules",
    name: "Web Audio Modules 2",
    kind: "plugin-standard",
    status: "approved",
    license: "MIT",
    repositoryUrl: "https://github.com/webaudiomodules/api",
    documentationUrl: "https://www.webaudiomodules.com/docs/",
    role: "Contrato de plugins de audio web interoperables.",
    decision: "Aprobado para un host futuro; no se cargan plugins remotos sin allowlist y firma.",
    formats: ["WAM 2", "AudioWorklet"],
  },
  {
    id: "music21",
    name: "music21",
    kind: "offline-tool",
    status: "approved",
    license: "BSD-3-Clause",
    repositoryUrl: "https://github.com/cuthbertLab/music21",
    documentationUrl: "https://www.music21.org/music21docs/",
    role: "Análisis musical, contrapunto y validación offline.",
    decision: "Aprobado para laboratorio/CI sin corpus; no se envía su runtime Python al móvil.",
    formats: ["MusicXML", "MIDI", "Python"],
  },
  {
    id: "partitura",
    name: "Partitura",
    kind: "offline-tool",
    status: "approved",
    license: "Apache-2.0",
    repositoryUrl: "https://github.com/CPJKU/partitura",
    documentationUrl: "https://partitura.readthedocs.io/",
    role: "Normalización y comprobación de música simbólica.",
    decision: "Aprobado para herramientas offline y pruebas de MusicXML/MIDI.",
    formats: ["MusicXML", "MIDI", "MEI", "Python"],
  },
  {
    id: "muspy",
    name: "MusPy",
    kind: "offline-tool",
    status: "approved",
    license: "MIT",
    repositoryUrl: "https://github.com/salu133445/muspy",
    documentationUrl: "https://salu133445.github.io/muspy/",
    role: "Representación, métricas y evaluación de música simbólica.",
    decision: "Aprobado para evaluación reproducible; los datasets conservan licencias independientes.",
    formats: ["MIDI", "MusicXML", "ABC", "Python"],
  },
  {
    id: "tinysoundfont",
    name: "TinySoundFont",
    kind: "offline-tool",
    status: "approved",
    license: "MIT",
    repositoryUrl: "https://github.com/schellingb/TinySoundFont",
    role: "Renderer nativo pequeño para una futura versión móvil nativa.",
    decision: "Aprobado como referencia futura; SpessaSynth sigue siendo el renderer web principal.",
    formats: ["SF2", "C/C++"],
  },
  {
    id: "vsco2-ce",
    name: "VSCO 2 Community Edition",
    kind: "sample-library",
    status: "approved",
    license: "CC0-1.0",
    repositoryUrl: "https://github.com/sgossner/VSCO-2-CE",
    documentationUrl: "https://sfzinstruments.github.io/orchestra/vcso_ce/",
    role: "Cuerdas, metales, maderas, percusión y cámara orquestal.",
    decision: "Aprobado para empaquetado nativo seguro; el primer paquete es Solo Violin y conserva capas dinámicas y round-robin del SFZ original.",
    formats: ["SFZ", "WAV", "TloqueSamplePack"],
    samplePackInstall: {
      moduleId: "vsco2-ce-solo-violin",
      manifestId: "vsco2-ce-solo-violin",
      version: "SFZ-6dd651d",
      pinnedCommit: "6dd651d55dde97fd4028699be9d4481f26917891",
      sfzPath: "SViolin-KS.sfz",
      estimatedMegabytes: 118,
      acknowledgement: "VSCO 2 Community Edition se distribuye bajo CC0-1.0. Instalaré únicamente el Solo Violin fijado al commit 6dd651d55dde97fd4028699be9d4481f26917891 y Tloque verificará cada WAV antes de publicarlo.",
      tags: ["module:vsco2-ce-solo-violin", "manifest:vsco2-ce-solo-violin", "native-samples", "violin", "strings", "cc0", "velocity-layers", "round-robin"],
    },
  },
  {
    id: "vcsl",
    name: "Versilian Community Sample Library",
    kind: "sample-library",
    status: "conversion",
    license: "CC0-1.0",
    repositoryUrl: "https://github.com/sgossner/VCSL",
    role: "Instrumentos acústicos, percusión, objetos y texturas de propósito general.",
    decision: "Fuente oficial aprobada; requiere selección, normalización y conversión con manifiesto por muestra.",
    formats: ["SFZ", "WAV"],
  },
  {
    id: "salamander-piano",
    name: "Salamander Grand Piano V3",
    kind: "sample-library",
    status: "conversion",
    license: "CC-BY-3.0",
    repositoryUrl: "https://github.com/sfzinstruments/SalamanderGrandPiano",
    documentationUrl: "https://sfzinstruments.github.io/pianos/salamander/",
    role: "Piano Yamaha C5, 48 kHz/24-bit y 16 capas de velocidad.",
    decision: "Aprobado con atribución; necesita un módulo SF3 optimizado y su aviso de licencia.",
    formats: ["SFZ", "WAV 24-bit/48 kHz"],
  },
  {
    id: "generaluser-gs",
    name: "GeneralUser GS",
    kind: "sample-library",
    status: "review",
    license: "Permisiva propia; procedencia parcial incierta",
    repositoryUrl: "https://github.com/mrbumpy409/GeneralUser-GS",
    documentationUrl: "https://www.schristiancollins.com/generaluser.php",
    role: "Banco General MIDI compacto de amplia cobertura.",
    decision: "Instalación comunitaria opt-in: la licencia permite integrarlo en software, pero el administrador debe aceptar el aviso de procedencia antes de copiarlo al almacenamiento interno.",
    formats: ["SF2"],
    install: {
      moduleId: "generaluser-gs-203",
      version: "2.0.3",
      fileName: "GeneralUser-GS.sf2",
      sourceUrl: "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/97049183643d5fc5a9322a69c5b09efb667c6c3a/GeneralUser-GS.sf2",
      pinnedCommit: "97049183643d5fc5a9322a69c5b09efb667c6c3a",
      estimatedMegabytes: 30.8,
      presetCount: 261,
      drumKitCount: 13,
      acknowledgement: "Entiendo que GeneralUser GS usa una licencia permisiva propia y que su autor declara incertidumbre sobre la procedencia original de algunas muestras.",
      tags: ["gm", "orchestra", "piano", "strings", "woodwinds", "brass", "percussion", "mobile"],
    },
  },
  {
    id: "tonejs-instruments",
    name: "Tone.js Instruments",
    kind: "sample-library",
    status: "conversion",
    license: "MIT (código) · CC-BY-3.0 (muestras)",
    repositoryUrl: "https://github.com/nbrosowsky/tonejs-instruments",
    role: "Veinte instrumentos muestreados para Web Audio: piano, violín, cello, contrabajo, maderas, metales, arpa, órgano y guitarras.",
    decision: "Fuente útil para módulos ligeros por instrumento; requiere empaquetado interno, atribución y caché antes de entrar al renderer de producción.",
    formats: ["MP3", "Web Audio", "JavaScript"],
  },
  {
    id: "discord-sfz-gm-bank",
    name: "Discord SFZ General MIDI Bank",
    kind: "sample-library",
    status: "review",
    license: "CC0/CC-BY por instrumento; manifiesto aún incompleto",
    repositoryUrl: "https://github.com/sfzinstruments/Discord-SFZ-GM-Bank",
    role: "Banco General MIDI abierto construido con muestras libres de varias procedencias.",
    decision: "No se instala todavía: está en desarrollo, usa SFZ y mantiene incidencias abiertas de licencia en instrumentos concretos.",
    formats: ["SFZ", "WAV", "FLAC"],
  },
  {
    id: "sfz-web-player",
    name: "SFZ Web Player",
    kind: "runtime",
    status: "review",
    license: "CC0-1.0",
    repositoryUrl: "https://github.com/sfzlab/sfz-web-player",
    role: "Reproductor SFZ directo sobre Web Audio para explorar módulos sin convertirlos a SoundFont.",
    decision: "Se conserva como prototipo de laboratorio; Tloque usa SpessaSynth/SF2-SF3 hasta validar compatibilidad SFZ, streaming, rendimiento móvil y seguridad.",
    formats: ["SFZ", "Web Audio", "TypeScript"],
  },
  {
    id: "faustwasm",
    name: "FaustWasm",
    kind: "runtime",
    status: "review",
    license: "LGPL-2.1-or-later",
    repositoryUrl: "https://github.com/grame-cncm/faustwasm",
    documentationUrl: "https://faustdoc.grame.fr/",
    role: "DSP WebAssembly, sintetizadores y efectos compilados.",
    decision: "Potente, pero queda aislado hasta decidir distribución LGPL, tamaño y sandbox de código DSP.",
    formats: ["Faust DSP", "WebAssembly", "AudioWorklet"],
  },
  {
    id: "muse-sounds-unlicensed",
    name: "Repositorios no oficiales de Muse Sounds",
    kind: "sample-library",
    status: "excluded",
    license: "Sin licencia redistribuible verificada",
    repositoryUrl: "https://github.com/CarlGao4/Muse-Sounds",
    role: "Conversión no oficial de instrumentos comerciales.",
    decision: "Excluido: el repositorio declara que no contiene licencia; Tloque no lo descarga ni redistribuye.",
    formats: ["SF2", "SF3"],
  },
] as const

export function audioSourcesByStatus(status: AudioSourceStatus) {
  return AUDIO_MODULE_SOURCES.filter(source => source.status === status)
}
