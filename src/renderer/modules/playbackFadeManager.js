const DEFAULT_FADE_SETTINGS = {
  fadeInMs: 250,
  fadeOutMs: 350
}

function clampFadeDuration(value, fallbackValue) {
  if (!Number.isFinite(value)) return fallbackValue
  return Math.max(0, Math.min(5000, Math.round(value)))
}

function sanitizeFadeSettings(input = {}) {
  return {
    fadeInMs: clampFadeDuration(Number(input.fadeInMs), DEFAULT_FADE_SETTINGS.fadeInMs),
    fadeOutMs: clampFadeDuration(Number(input.fadeOutMs), DEFAULT_FADE_SETTINGS.fadeOutMs)
  }
}

export function createPlaybackFadeManager(options = {}) {
  const {
    audio,
    storageKey = 'musicPlayer.playbackFade.v1'
  } = options

  let fadeTimer = null
  let fadeToken = 0

  function loadSettings() {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { ...DEFAULT_FADE_SETTINGS }
      const parsed = JSON.parse(raw)
      return sanitizeFadeSettings(parsed || {})
    } catch (err) {
      console.warn('Failed to load fade settings:', err)
      return { ...DEFAULT_FADE_SETTINGS }
    }
  }

  let settings = loadSettings()

  function persistSettings() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings))
    } catch (err) {
      console.warn('Failed to save fade settings:', err)
    }
  }

  function stopFade(options = {}) {
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

  function runFadeTo(targetVolume, durationMs) {
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
          clearInterval(fadeTimer)
          fadeTimer = null
          resolve(true)
        }
      }, 20)
    })
  }

  function updateSettings(nextSettings = {}) {
    settings = sanitizeFadeSettings({ ...settings, ...nextSettings })
    persistSettings()
    return { ...settings }
  }

  function getSettings() {
    return { ...settings }
  }

  return {
    stopFade,
    runFadeTo,
    updateSettings,
    getSettings
  }
}