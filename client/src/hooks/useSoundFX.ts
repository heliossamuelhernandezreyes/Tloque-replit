// Web Audio API — genera sonidos sintéticos sin archivos externos
// Funciona en todos los navegadores modernos, sin dependencias
import { useEffect } from "react"
import type { UiSoundEventKey } from "@shared/audio"
import { soundFXEngine, type PreviewableSoundAsset } from "@/audio/SoundFXEngine"

export type SoundType =
  | "orb_tap"        // tap suave en orbe central
  | "orb_hold"       // activación de buscador
  | "genre_cycle"    // ciclar género
  | "genre_reset"    // volver a general
  | "save_book"      // guardar libro
  | "page_turn"      // cambiar capítulo
  | "navigate"       // navegar entre páginas
  | "book_complete"  // terminar un libro
  | "streak_milestone" // hito de racha

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null
const lastPlayedAt = new Map<SoundType, number>()
const COOLDOWN_MS: Partial<Record<SoundType, number>> = {
  orb_tap: 55,
  genre_cycle: 90,
  navigate: 100,
  page_turn: 140,
  save_book: 350,
  book_complete: 1_500,
  streak_milestone: 1_500,
}

function eventKeyFor(type: SoundType, genre?: string): UiSoundEventKey {
  if (type === "genre_cycle") {
    const variant = ["todos", "melancolico", "terror", "fantasia", "misterio", "romance"].includes(genre || "")
      ? genre!
      : "todos"
    return `ui.genre.cycle.${variant}` as UiSoundEventKey
  }
  switch (type) {
    case "orb_tap": return "ui.orb.tap"
    case "orb_hold": return "ui.orb.hold"
    case "genre_reset": return "ui.genre.reset"
    case "save_book": return "ui.book.save"
    case "page_turn": return "ui.page.turn"
    case "navigate": return "ui.navigation"
    case "book_complete": return "ui.book.complete"
    case "streak_milestone": return "ui.streak.milestone"
  }
}

function connectToOutput(ctx: AudioContext, node: AudioNode) {
  if (!masterGain || masterGain.context !== ctx) {
    masterGain = ctx.createGain()
    masterGain.connect(ctx.destination)
  }
  masterGain.gain.setTargetAtTime(getAudioSettings().volume, ctx.currentTime, 0.01)
  node.connect(masterGain)
}

function getCtx(): AudioContext | null {
  try {
    const activation = navigator.userActivation
    if (!audioCtx) {
      // Crear el contexto sólo durante un gesto real evita estados bloqueados
      // en Chrome/Android y Safari. Si el navegador no expone la API, Web
      // Audio conserva su comportamiento tradicional.
      if (activation && !activation.isActive) return null
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    if (audioCtx.state === "suspended") {
      if (activation && !activation.isActive) return null
      void audioCtx.resume()
    }
    return audioCtx
  } catch {
    return null
  }
}

function playTone(opts: {
  freq:      number
  freq2?:    number   // segundo tono para armonía
  type?:     OscillatorType
  attack?:   number   // segundos
  decay?:    number
  sustain?:  number   // nivel de volumen
  release?:  number
  volume?:   number
  detune?:   number
}) {
  const ctx = getCtx()
  if (!ctx) return

  const {
    freq, freq2,
    type    = "sine",
    attack  = 0.005,
    decay   = 0.1,
    sustain = 0.3,
    release = 0.15,
    volume  = 0.18,
    detune  = 0,
  } = opts

  const now = ctx.currentTime

  // Nodo de ganancia principal
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(volume, now + attack)
  gain.gain.linearRampToValueAtTime(volume * sustain, now + attack + decay)
  gain.gain.linearRampToValueAtTime(0, now + attack + decay + release)

  // Reverb mínimo con convolver simple
  const osc = ctx.createOscillator()
  osc.type      = type
  osc.frequency.setValueAtTime(freq, now)
  osc.detune.setValueAtTime(detune, now)
  osc.connect(gain)
  connectToOutput(ctx, gain)
  osc.start(now)
  osc.stop(now + attack + decay + release + 0.05)

  // Segundo oscilador para armonía (opcional)
  if (freq2) {
    const gain2 = ctx.createGain()
    gain2.gain.setValueAtTime(0, now)
    gain2.gain.linearRampToValueAtTime(volume * 0.5, now + attack)
    gain2.gain.linearRampToValueAtTime(volume * 0.15, now + attack + decay)
    gain2.gain.linearRampToValueAtTime(0, now + attack + decay + release)

    const osc2 = ctx.createOscillator()
    osc2.type      = type
    osc2.frequency.setValueAtTime(freq2, now)
    osc2.connect(gain2)
    connectToOutput(ctx, gain2)
    osc2.start(now)
    osc2.stop(now + attack + decay + release + 0.05)
  }
}

// ── SONIDOS ESPECÍFICOS ──────────────────────────────────

function sound_orb_tap() {
  // Chime cristalino suave — como tocar un cuenco tibetano pequeño
  playTone({ freq: 680, freq2: 1020, type: "sine", attack: 0.003, decay: 0.07, sustain: 0.08, release: 0.25, volume: 0.08 })
}

function sound_orb_hold() {
  // Tono ascendente — señal de "activación"
  const ctx = getCtx()
  if (!ctx) return
  const now  = ctx.currentTime
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(0.11, now + 0.05)
  gain.gain.linearRampToValueAtTime(0, now + 0.35)
  connectToOutput(ctx, gain)

  const osc = ctx.createOscillator()
  osc.type = "sine"
  osc.frequency.setValueAtTime(400, now)
  osc.frequency.linearRampToValueAtTime(720, now + 0.3)
  osc.connect(gain)
  osc.start(now)
  osc.stop(now + 0.4)
}

function sound_genre_cycle(genre: string) {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime

  // Cada género tiene su propio paisaje sonoro único
  switch (genre) {

    case "todos": {
      // Campana cristalina — neutral y limpia
      playTone({ freq: 440, freq2: 660, type: "sine",
        attack: 0.003, decay: 0.08, sustain: 0.2, release: 0.25, volume: 0.12 })
      break
    }

    case "melancolico": {
      // Nota grave que decae lentamente — como un suspiro
      playTone({ freq: 220, type: "sine",
        attack: 0.015, decay: 0.20, sustain: 0.3, release: 0.55, volume: 0.13 })
      // Segunda nota más alta, más suave — disonancia melancólica
      setTimeout(() => playTone({ freq: 277, type: "sine",
        attack: 0.020, decay: 0.18, sustain: 0.2, release: 0.5, volume: 0.07 }), 80)
      break
    }

    case "terror": {
      // Nota baja con detuning — perturbador y áspero
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(0.11, now + 0.002)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
      connectToOutput(ctx, g)
      const o1 = ctx.createOscillator()
      o1.type = "sawtooth"
      o1.frequency.setValueAtTime(110, now)
      o1.frequency.linearRampToValueAtTime(95, now + 0.35)  // pitch drop
      o1.detune.setValueAtTime(0, now)
      o1.connect(g)
      o1.start(now); o1.stop(now + 0.45)
      // Subarmónico
      const g2 = ctx.createGain()
      g2.gain.setValueAtTime(0.06, now)
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
      connectToOutput(ctx, g2)
      const o2 = ctx.createOscillator()
      o2.type = "square"
      o2.frequency.setValueAtTime(55, now)
      o2.connect(g2)
      o2.start(now); o2.stop(now + 0.35)
      break
    }

    case "fantasia": {
      // Arpegio ascendente — mágico y etéreo, sin disonancias
      const notes = [392, 494, 587, 740]  // Sol, Si, Re, Fa# — acorde mayor
      notes.forEach((freq, i) => {
        setTimeout(() => playTone({
          freq, type: "sine",
          attack: 0.006, decay: 0.10, sustain: 0.15, release: 0.30, volume: 0.09
        }), i * 55)
      })
      break
    }

    case "misterio": {
      // Intervalo de tritono — el "diabolus in musica", tenso y ambiguo
      playTone({ freq: 370, type: "sine",
        attack: 0.008, decay: 0.15, sustain: 0.25, release: 0.40, volume: 0.11 })
      setTimeout(() => playTone({ freq: 523, type: "sine",  // tritono de 370
        attack: 0.012, decay: 0.14, sustain: 0.2, release: 0.38, volume: 0.08 }), 60)
      break
    }

    case "romance": {
      // Tercera mayor suave y cálida — emotiva y dulce
      playTone({ freq: 392, type: "sine",
        attack: 0.012, decay: 0.16, sustain: 0.35, release: 0.45, volume: 0.11 })
      setTimeout(() => playTone({ freq: 494, type: "sine",
        attack: 0.016, decay: 0.16, sustain: 0.30, release: 0.42, volume: 0.08 }), 70)
      break
    }

    default:
      playTone({ freq: 440, freq2: 660, type: "sine",
        attack: 0.003, decay: 0.08, sustain: 0.2, release: 0.25, volume: 0.12 })
  }
}

function sound_genre_reset() {
  // Acorde de resolución — dos tonos que se asientan
  playTone({ freq: 440, freq2: 550, type: "sine", attack: 0.004, decay: 0.1, sustain: 0.3, release: 0.2, volume: 0.12 })
}

function sound_save_book() {
  // Dos tonos ascendentes rápidos — satisfacción
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime

  ;[0, 0.1].forEach((delay, i) => {
    const freq = i === 0 ? 660 : 880
    const g    = ctx.createGain()
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.15, now + delay + 0.005)
    g.gain.linearRampToValueAtTime(0, now + delay + 0.18)
    connectToOutput(ctx, g)
    const o = ctx.createOscillator()
    o.type = "sine"
    o.frequency.setValueAtTime(freq, now + delay)
    o.connect(g)
    o.start(now + delay)
    o.stop(now + delay + 0.2)
  })
}

function sound_page_turn() {
  // Susurro suave — ruido filtrado breve
  const ctx = getCtx()
  if (!ctx) return
  const now    = ctx.currentTime
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate)
  const data   = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const source = ctx.createBufferSource()
  source.buffer = buffer

  const filter = ctx.createBiquadFilter()
  filter.type            = "bandpass"
  filter.frequency.value = 900    // más bajo = más suave, menos agudo
  filter.Q.value         = 0.5    // más ancho = más suave

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(0.035, now + 0.015)  // más suave
  gain.gain.linearRampToValueAtTime(0, now + 0.12)       // más largo = más natural

  source.connect(filter)
  filter.connect(gain)
  connectToOutput(ctx, gain)
  source.start(now)
}

function sound_navigate() {
  // Transición suave — dos notas en quinta justa, muy ligera
  playTone({ freq: 480, type: "sine", attack: 0.002, decay: 0.05, sustain: 0.04, release: 0.12, volume: 0.08 })
  setTimeout(() => playTone({ freq: 720, type: "sine",
    attack: 0.002, decay: 0.04, sustain: 0.03, release: 0.10, volume: 0.05 }), 50)
}

function sound_book_complete() {
  const ctx = getCtx()
  if (!ctx) return
  const now   = ctx.currentTime
  const notes = [
    { f: 523.25, d: 0.00 }, { f: 659.25, d: 0.10 },
    { f: 783.99, d: 0.20 }, { f: 1046.5, d: 0.32 },
  ]
  notes.forEach(({ f, d }) => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, now + d)
    g.gain.linearRampToValueAtTime(0.12, now + d + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + d + 1.6)
    connectToOutput(ctx, g)
    const o = ctx.createOscillator()
    o.type = "sine"; o.frequency.setValueAtTime(f, now + d)
    o.connect(g); o.start(now + d); o.stop(now + d + 1.7)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0, now + d)
    g2.gain.linearRampToValueAtTime(0.04, now + d + 0.02)
    g2.gain.exponentialRampToValueAtTime(0.0001, now + d + 1.2)
    connectToOutput(ctx, g2)
    const o2 = ctx.createOscillator()
    o2.type = "triangle"; o2.frequency.setValueAtTime(f * 2, now + d)
    o2.connect(g2); o2.start(now + d); o2.stop(now + d + 1.3)
  })
}

function sound_streak_milestone() {
  const ctx = getCtx()
  if (!ctx) return
  const now   = ctx.currentTime
  const notes = [783.99, 987.77, 1174.7, 1568.0]
  notes.forEach((f, i) => {
    const d = i * 0.07
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, now + d)
    g.gain.linearRampToValueAtTime(0.11, now + d + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.5)
    connectToOutput(ctx, g)
    const o = ctx.createOscillator()
    o.type = "triangle"; o.frequency.setValueAtTime(f, now + d)
    o.connect(g); o.start(now + d); o.stop(now + d + 0.55)
  })
  setTimeout(() => playTone({
    freq: 1568.0, freq2: 2093.0, type: "sine",
    attack: 0.004, decay: 0.1, sustain: 0.25, release: 0.6, volume: 0.07,
  }), 300)
}

// ── HOOK PÚBLICO ─────────────────────────────────────────
// Leer settings directamente de localStorage para evitar ciclos de dependencia
function getAudioSettings(): { enabled: boolean; volume: number } {
  try {
    const raw = localStorage.getItem("tloque_settings_v2") || localStorage.getItem("novareads_settings")
    if (!raw) return { enabled: true, volume: 0.8 }
    const s = JSON.parse(raw)
    return {
      enabled: s.orbSounds !== false,
      volume:  typeof s.soundVolume === "number" && Number.isFinite(s.soundVolume)
        ? Math.max(0, Math.min(1, s.soundVolume))
        : 0.8,
    }
  } catch {
    return { enabled: true, volume: 0.8 }
  }
}

export function useSoundFX() {
  useEffect(() => { void soundFXEngine.loadManifest() }, [])

  function play(type: SoundType, genre?: string) {
    // Movimiento reducido y audio son preferencias independientes.
    const { enabled, volume } = getAudioSettings()
    if (!enabled) return
    // La Fonoteca publicada tiene prioridad. El sintetizador histórico queda
    // como fallback offline o durante una migración aún no aplicada.
    if (soundFXEngine.play(eventKeyFor(type, genre), volume)) return
    const now = performance.now()
    const cooldown = COOLDOWN_MS[type] ?? 70
    if (now - (lastPlayedAt.get(type) ?? -Infinity) < cooldown) return
    lastPlayedAt.set(type, now)

    try {
      switch (type) {
        case "orb_tap":      sound_orb_tap();               break
        case "orb_hold":     sound_orb_hold();              break
        case "genre_cycle":  sound_genre_cycle(genre || "todos"); break
        case "genre_reset":  sound_genre_reset();           break
        case "save_book":    sound_save_book();             break
        case "page_turn":    sound_page_turn();             break
        case "navigate":     sound_navigate();              break
        case "book_complete":    sound_book_complete();     break
        case "streak_milestone": sound_streak_milestone();  break
      }
    } catch {
      // Silencioso si el navegador bloquea audio
    }
  }

  function preview(asset: PreviewableSoundAsset) {
    const { enabled, volume } = getAudioSettings()
    return enabled && soundFXEngine.preview(asset, volume)
  }

  return {
    play,
    preview,
    reloadManifest: () => soundFXEngine.loadManifest(true),
  }
}
