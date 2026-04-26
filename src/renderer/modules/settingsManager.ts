type ShortcutManagerLike = {
  openPanel?: () => void
  closePanel?: () => boolean
}

type PlaybackControllerLike = {
  getFadeSettings: () => { fadeInMs: number; fadeOutMs: number }
  updateFadeSettings: (payload: { fadeInMs: number; fadeOutMs: number }) => { fadeInMs: number; fadeOutMs: number }
}

type SettingsDom = {
  settingsBtn?: HTMLElement | null
  settingsOverlay?: HTMLElement | null
  settingsCloseBtn?: HTMLElement | null
  settingsTabs: NodeListOf<Element>
  settingsPanels: NodeListOf<Element>
  fadeInDurationInput?: HTMLInputElement | null
  fadeOutDurationInput?: HTMLInputElement | null
  fadeSaveBtn?: HTMLElement | null
}

type SettingsManagerOptions = {
  dom: SettingsDom
  doc?: Document
  shortcutManager?: ShortcutManagerLike | null
  getPlaybackController?: () => PlaybackControllerLike | null
}

function sanitizeFadeDurationInput(value: unknown, fallbackValue: number): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallbackValue
  return Math.max(0, Math.min(5000, parsed))
}

export function createSettingsManager(options: SettingsManagerOptions) {
  const { dom, doc = document, shortcutManager, getPlaybackController } = options

  let currentSettingsTab = 'playback'

  function getPlaybackControllerSafe(): PlaybackControllerLike | null {
    return typeof getPlaybackController === 'function' ? getPlaybackController() : null
  }

  function switchTab(tab: string): void {
    currentSettingsTab = tab === 'shortcuts' ? 'shortcuts' : 'playback'

    dom.settingsTabs.forEach((tabEl) => {
      const tabName = tabEl.getAttribute('data-settings-tab')
      const active = tabName === currentSettingsTab
      tabEl.classList.toggle('active', active)
      tabEl.setAttribute('aria-selected', active ? 'true' : 'false')
    })

    dom.settingsPanels.forEach((panelEl) => {
      const panelName = panelEl.getAttribute('data-settings-panel')
      panelEl.classList.toggle('page-hidden', panelName !== currentSettingsTab)
    })
  }

  function syncFadeInputs(): void {
    const playbackController = getPlaybackControllerSafe()
    if (!playbackController) return
    const settings = playbackController.getFadeSettings()
    if (dom.fadeInDurationInput) {
      dom.fadeInDurationInput.value = String(settings.fadeInMs)
    }
    if (dom.fadeOutDurationInput) {
      dom.fadeOutDurationInput.value = String(settings.fadeOutMs)
    }
  }

  function applyFadeSettingsFromInputs(): void {
    const playbackController = getPlaybackControllerSafe()
    if (!playbackController) return
    const current = playbackController.getFadeSettings()
    const fadeInMs = sanitizeFadeDurationInput(dom.fadeInDurationInput?.value, current.fadeInMs)
    const fadeOutMs = sanitizeFadeDurationInput(dom.fadeOutDurationInput?.value, current.fadeOutMs)
    const next = playbackController.updateFadeSettings({ fadeInMs, fadeOutMs })
    if (dom.fadeInDurationInput) dom.fadeInDurationInput.value = String(next.fadeInMs)
    if (dom.fadeOutDurationInput) dom.fadeOutDurationInput.value = String(next.fadeOutMs)
  }

  function openPanel(tab = 'playback'): void {
    if (!dom.settingsOverlay) return
    dom.settingsOverlay.classList.add('visible')
    dom.settingsOverlay.setAttribute('aria-hidden', 'false')
    switchTab(tab)
    if (shortcutManager) {
      shortcutManager.openPanel?.()
    }
    syncFadeInputs()
  }

  function closePanel(): boolean {
    if (!dom.settingsOverlay) return false
    if (shortcutManager && !shortcutManager.closePanel?.()) {
      return false
    }
    dom.settingsOverlay.classList.remove('visible')
    dom.settingsOverlay.setAttribute('aria-hidden', 'true')
    return true
  }

  function bindEvents(): void {
    if (dom.settingsBtn) {
      dom.settingsBtn.addEventListener('click', () => {
        openPanel('playback')
      })
    }

    if (dom.settingsCloseBtn) {
      dom.settingsCloseBtn.addEventListener('click', () => {
        closePanel()
      })
    }

    if (dom.settingsOverlay) {
      dom.settingsOverlay.addEventListener('click', (event: Event) => {
        if (event.target === dom.settingsOverlay) {
          closePanel()
        }
      })
    }

    doc.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!dom.settingsOverlay?.classList.contains('visible')) return
      event.preventDefault()
      closePanel()
    })

    dom.settingsTabs.forEach((tabEl) => {
      tabEl.addEventListener('click', () => {
        switchTab(tabEl.getAttribute('data-settings-tab') || 'playback')
      })
    })

    if (dom.fadeSaveBtn) {
      dom.fadeSaveBtn.addEventListener('click', () => {
        applyFadeSettingsFromInputs()
      })
    }

    if (dom.fadeInDurationInput) {
      dom.fadeInDurationInput.addEventListener('change', applyFadeSettingsFromInputs)
    }

    if (dom.fadeOutDurationInput) {
      dom.fadeOutDurationInput.addEventListener('change', applyFadeSettingsFromInputs)
    }
  }

  function init(): void {
    bindEvents()
  }

  return {
    init,
    openPanel,
    closePanel,
    switchTab,
    syncFadeInputs,
    applyFadeSettingsFromInputs
  }
}
