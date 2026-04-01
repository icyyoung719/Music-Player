const DEFAULT_FADE_SETTINGS = {
  fadeInMs: 250,
  fadeOutMs: 350
}

type FadeSettings = {
  fadeInMs: number
  fadeOutMs: number
}

type FadeOptions = {
  audio?: HTMLAudioElement | null
  storageKey?: string
}

function clampFadeDuration(value: number, fallbackValue: number): number {
  if (!Number.isFinite(value)) return fallbackValue
  return Math.max(0, Math.min(5000, Math.round(value)))
}

function sanitizeFadeSettings(input: Partial<FadeSettings> = {}): FadeSettings {
  return {
    fadeInMs: clampFadeDuration(Number(input.fadeInMs), DEFAULT_FADE_SETTINGS.fadeInMs),
    fadeOutMs: clampFadeDuration(Number(input.fadeOutMs), DEFAULT_FADE_SETTINGS.fadeOutMs)
  }
}

export function createPlaybackFadeManager(options: FadeOptions = {}) {
  const { audio, storageKey = 'musicPlayer.playbackFade.v1' } = options

  let fadeTimer: ReturnType<typeof setInterval> | null = null
  let fadeToken = 0

  function loadSettings(): FadeSettings {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { ...DEFAULT_FADE_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<FadeSettings>
      return sanitizeFadeSettings(parsed || {})
    } catch (err) {
      console.warn('Failed to load fade settings:', err)
      return { ...DEFAULT_FADE_SETTINGS }
    }
  }

  let settings = loadSettings()

  function persistSettings(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings))
    } catch (err) {
      console.warn('Failed to save fade settings:', err)
    }
  }

  function stopFade(options: { resetVolume?: boolean } = {}): void {
    const { resetVolume = false } = options
    if (fadeTimer) {
      clearInterval(fadeTimer)
      fadeTimer = null
    }
    fadeToken += 1
    if (resetVolume && audio) {
      audio.volume = 1
    }
  }

  function runFadeTo(targetVolume: number, durationMs: number): Promise<boolean> {
    if (!audio) return Promise.resolve(false)

    const safeTarget = Math.max(0, Math.min(1, Number(targetVolume) || 0))
    const safeDuration = Math.max(0, Number(durationMs) || 0)

    stopFade()

    if (safeDuration <= 0 || Math.abs(audio.volume - safeTarget) < 0.001) {
      audio.volume = safeTarget
      return Promise.resolve(true)
    }

    const localToken = fadeToken
    const startVolume = audio.volume
    const delta = safeTarget - startVolume
    const startAt = Date.now()

    return new Promise((resolve) => {
      fadeTimer = setInterval(() => {
        if (localToken !== fadeToken) {
          resolve(false)
          return
        }

        const elapsed = Date.now() - startAt
        const progress = Math.max(0, Math.min(1, elapsed / safeDuration))
        audio.volume = Math.max(0, Math.min(1, startVolume + delta * progress))

        if (progress >= 1) {
          clearInterval(fadeTimer!)
          fadeTimer = null
          resolve(true)
        }
      }, 20)
    })
  }

  function updateSettings(nextSettings: Partial<FadeSettings> = {}): FadeSettings {
    settings = sanitizeFadeSettings({ ...settings, ...nextSettings })
    persistSettings()
    return { ...settings }
  }

  function getSettings(): FadeSettings {
    return { ...settings }
  }

  return {
    stopFade,
    runFadeTo,
    updateSettings,
    getSettings
  }
}
