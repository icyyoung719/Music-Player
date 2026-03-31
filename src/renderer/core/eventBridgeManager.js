export function createEventBridgeManager(options = {}) {
  const {
    eventBus,
    electronAPI,
    playbackController,
    savedPlaylistManager,
    recentlyPlayedManager,
    toastManager,
    viewManager,
    settingsManager,
    playlistCacheService,
    seekSeconds = 5,
    doc = document
  } = options

  function handleShortcutAction(action) {
    switch (action) {
      case 'togglePlay':
        playbackController?.togglePlayback({ silent: true })
        break
      case 'seekBackward':
        playbackController?.seekBy(-seekSeconds)
        break
      case 'seekForward':
        playbackController?.seekBy(seekSeconds)
        break
      case 'previousTrack':
        playbackController?.playPreviousTrack()
        break
      case 'nextTrack':
        playbackController?.playNextTrack()
        break
      case 'toggleLoop':
        playbackController?.toggleLoopState()
        break
      case 'showHomePage':
        viewManager?.showHomePage()
        break
      case 'showSongPage':
        viewManager?.showSongPage()
        break
      case 'toggleTheme': {
        const themeToggle = doc.querySelector('[data-theme-toggle]')
        if (themeToggle) themeToggle.click()
        break
      }
      case 'openShortcuts':
        settingsManager?.openPanel('shortcuts')
        break
      case 'minimizeWindow':
        if (electronAPI?.minimizeWindow) {
          electronAPI.minimizeWindow()
        }
        break
      case 'clearPlaylist':
        if (playbackController?.hasQueue()) {
          playbackController.clearPlaylist()
        }
        break
      default:
        break
    }
  }

  function setupEventBusBridge() {
    eventBus.on('playback:queue.append', (payload) => {
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
      if (!tracks.length || !playbackController) return
      playbackController.appendToPlaylist(tracks)
    })

    eventBus.on('playback:queue.replace', (payload) => {
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
      if (!tracks.length || !playbackController) return
      playbackController.replaceCurrentQueueWithTracks(
        tracks,
        Number.isFinite(payload?.startIndex) ? payload.startIndex : 0,
        payload?.options || {}
      )
    })

    eventBus.on('playlist:saved.changed', (payload) => {
      if (savedPlaylistManager?.refreshSavedPlaylists) {
        savedPlaylistManager.refreshSavedPlaylists(payload?.playlistId || null)
      }
    })

    eventBus.on('playback:home-cover.changed', (payload) => {
      viewManager?.setHomeNowCover(payload || '')
    })

    eventBus.on('view:home.open', () => {
      viewManager?.showHomePage()
    })

    eventBus.on('view:song.open', () => {
      viewManager?.showSongPage()
    })

    eventBus.on('view:playlist.open', (payload) => {
      viewManager?.openSavedPlaylistDetail(payload?.playlistId || '')
    })

    eventBus.on('toast:push', (payload) => {
      toastManager?.pushToast(payload)
    })

    eventBus.on('shortcut:action', (payload) => {
      handleShortcutAction(payload?.action || '')
    })

    eventBus.on('recently-played:updated', () => {
      recentlyPlayedManager?.render()
    })

    eventBus.handle('playlist:ensure-by-name', async (payload) => {
      return playlistCacheService.ensureSavedPlaylistByName(payload?.name || '', payload?.playlistKey || '')
    })

    eventBus.handle('playlist:add-track', async (payload) => {
      await playlistCacheService.appendDownloadedTrackToSavedPlaylist(payload?.playlistId || '', payload?.track || null)
      return true
    })

    eventBus.handle('playback:queue.collect-current-track-inputs', () => {
      if (!playbackController) return []
      return playbackController.collectCurrentQueueAsTrackInputs()
    })
  }

  function setupPlayerControlListener() {
    if (!electronAPI?.onPlayerControl) return
    electronAPI.onPlayerControl((action) => {
      playbackController?.handleExternalPlayerControl(action)
    })
  }

  function init() {
    setupEventBusBridge()
    setupPlayerControlListener()
  }

  return {
    init,
    handleShortcutAction
  }
}
