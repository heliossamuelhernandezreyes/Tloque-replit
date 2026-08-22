import {
  AUDIO_CONTRACT_VERSION, uiSoundRecipeFor,
  type UiSoundEventKey, type UiSoundManifest, type UiSoundManifestBinding, type UiSoundRecipe,
} from "@shared/audio"

export interface PreviewableSoundAsset {
  id: number
  title: string
  sourceType: string
  url: string
  recipe: unknown
}

export class SoundFXEngine {
  private context: AudioContext | null = null
  private output: GainNode | null = null
  private bindings = new Map<UiSoundEventKey, UiSoundManifestBinding>()
  private streams = new Map<number, HTMLAudioElement>()
  private lastPlayed = new Map<UiSoundEventKey, number>()
  private loading: Promise<void> | null = null

  loadManifest(force = false): Promise<void> {
    if (this.loading && !force) return this.loading
    this.loading = fetch("/api/audio/ui-manifest", { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error(`manifest ${response.status}`)
        const manifest = await response.json() as UiSoundManifest
        if (manifest.version !== AUDIO_CONTRACT_VERSION || !Array.isArray(manifest.bindings)) return
        this.bindings = new Map(manifest.bindings.map(binding => [binding.eventKey, binding]))
        for (const binding of manifest.bindings) {
          if (binding.asset.sourceType !== "stream" || !binding.asset.url || this.streams.has(binding.asset.id)) continue
          const audio = new Audio(binding.asset.url)
          audio.preload = "auto"
          audio.crossOrigin = "anonymous"
          audio.setAttribute("playsinline", "")
          this.streams.set(binding.asset.id, audio)
        }
      })
      .catch(() => undefined)
      .finally(() => { this.loading = null })
    return this.loading
  }

  play(eventKey: UiSoundEventKey, settingsVolume: number): boolean {
    const binding = this.bindings.get(eventKey)
    if (!binding) return false
    const now = performance.now()
    if (now - (this.lastPlayed.get(eventKey) ?? -Infinity) < binding.cooldownMs) return true
    this.lastPlayed.set(eventKey, now)
    const volume = Math.max(0, Math.min(1, settingsVolume * binding.volume))
    if (binding.asset.sourceType === "stream") {
      this.playStream(binding.asset.id, binding.asset.url, volume)
      return true
    }
    if (!binding.asset.recipe) return false
    return this.playRecipe(binding.asset.recipe, volume)
  }

  preview(asset: PreviewableSoundAsset, volume = 0.65): boolean {
    if (asset.sourceType === "stream" && asset.url) {
      this.playStream(asset.id, asset.url, volume)
      return true
    }
    if (asset.sourceType !== "sfx") return false
    try { return this.playRecipe(uiSoundRecipeFor(asset.recipe), volume) } catch { return false }
  }

  private playStream(assetId: number, url: string, volume: number) {
    const source = this.streams.get(assetId) ?? new Audio(url)
    source.preload = "auto"
    source.crossOrigin = "anonymous"
    source.setAttribute("playsinline", "")
    this.streams.set(assetId, source)
    const voice = source.cloneNode(true) as HTMLAudioElement
    voice.volume = volume
    void voice.play().catch(() => undefined)
  }

  private playRecipe(recipe: UiSoundRecipe, volume: number): boolean {
    const context = this.audioContext()
    if (!context) return false
    const now = context.currentTime + 0.004
    const filter = context.createBiquadFilter()
    filter.type = recipe.filter.type
    filter.frequency.setValueAtTime(recipe.filter.frequency, now)
    filter.Q.setValueAtTime(recipe.filter.q, now)
    filter.connect(this.output!)
    let latest = now

    recipe.voices.forEach((voice, voiceIndex) => {
      const start = now + voice.offset
      const end = start + voice.duration
      latest = Math.max(latest, end)
      const gain = context.createGain()
      const peak = Math.max(0.0001, voice.gain * volume)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.linearRampToValueAtTime(peak, start + Math.min(voice.attack, voice.duration * 0.5))
      gain.gain.setValueAtTime(peak, Math.max(start + voice.attack, end - voice.release))
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      gain.connect(filter)

      if (voice.wave === "noise") {
        const samples = Math.max(1, Math.ceil(context.sampleRate * voice.duration))
        const buffer = context.createBuffer(1, samples, context.sampleRate)
        const data = buffer.getChannelData(0)
        let state = (recipe.seed + voiceIndex * 7_919) >>> 0
        for (let index = 0; index < data.length; index += 1) {
          state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
          data[index] = (state / 0xffff_ffff) * 2 - 1
        }
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        source.start(start)
        source.stop(end)
        return
      }

      const oscillator = context.createOscillator()
      oscillator.type = voice.wave
      oscillator.frequency.setValueAtTime(voice.startHz, start)
      if (voice.endHz !== null) oscillator.frequency.exponentialRampToValueAtTime(voice.endHz, end)
      oscillator.connect(gain)
      oscillator.start(start)
      oscillator.stop(end + 0.01)
    })
    window.setTimeout(() => filter.disconnect(), Math.max(50, (latest - context.currentTime + 0.1) * 1_000))
    return true
  }

  private audioContext(): AudioContext | null {
    try {
      const activation = navigator.userActivation
      if (!this.context) {
        if (activation && !activation.isActive) return null
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        this.context = new AudioContextClass({ latencyHint: "interactive" })
        this.output = this.context.createGain()
        this.output.gain.value = 1
        this.output.connect(this.context.destination)
      }
      if (this.context.state === "suspended") {
        if (activation && !activation.isActive) return null
        void this.context.resume()
      }
      return this.context
    } catch {
      return null
    }
  }
}

export const soundFXEngine = new SoundFXEngine()
