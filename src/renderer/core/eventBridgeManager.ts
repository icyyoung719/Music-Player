import type { EventBus } from './eventBus.js'
import type { ElectronAPI } from './electronApi.js'

type PlaybackControllerLike = {
  togglePlayback?: (options?: { silent?: boolean }) => void
  seekBy?: (seconds: number) => void
  playPreviousTrack?: () => void
  playNextTrack?: () => void
  toggleLoopState?: () => void
  hasQueue?: () => boolean
  clearPlaylist?: () => void
  appendToPlaylist?: (tracks: unknown[]) => void
  replaceCurrentQueueWithTracks?: (tracks: unknown[], startIndex: number, options: unknown) => void
  collectCurrentQueueAsTrackInputs?: () => unknown[]
  handleExternalPlayerControl?: (action: string) => void
}

type SavedPlaylistManagerLike = {
  refreshSavedPlaylists?: (playlistId?: string | null) => void
}

type RecentlyPlayedManagerLike = {
  render?: () => void
}

type ToastManagerLike = {
  pushToast?: (payload: unknown) => void
}

type ViewManagerLike = {
  showHomePage?: () => void
  showSongPage?: () => void
  openSavedPlaylistDetail?: (playlistId: string) => void
  setHomeNowCover?: (cover: string) => void
}

type SettingsManagerLike = {
  openPanel?: (panel: string) => void
}

type PlaylistCacheServiceLike = {
  ensureSavedPlaylistByName: (name: string, playlistKey: string) => Promise<unknown>
  appendDownloadedTrackToSavedPlaylist: (playlistId: string, track: unknown) => Promise<void>
}

type EventBridgeOptions = {
  eventBus: EventBus
  electronAPI?: Pick<ElectronAPI, 'minimizeWindow' | 'onPlayerControl'>
  playbackController?: PlaybackControllerLike | null
  savedPlaylistManager?: SavedPlaylistManagerLike | null
  recentlyPlayedManager?: RecentlyPlayedManagerLike | null
  toastManager?: ToastManagerLike | null
  viewManager?: ViewManagerLike | null
  settingsManager?: SettingsManagerLike | null
  playlistCacheService: PlaylistCacheServiceLike
  seekSeconds?: number
  doc?: Document
}

type QueueAppendPayload = {
  tracks?: unknown[]
}

type QueueReplacePayload = {
  tracks?: unknown[]
  startIndex?: number
  options?: unknown
}

type PlaylistChangedPayload = {
  playlistId?: string
}

type ViewPlaylistOpenPayload = {
  playlistId?: string
}

type ShortcutActionPayload = {
  action?: string
}

type EnsurePlaylistPayload = {
  name?: string
  playlistKey?: string
}

type AddTrackPayload = {
  playlistId?: string
  track?: unknown
}

export function createEventBridgeManager(options: EventBridgeOptions) {
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

  function handleShortcutAction(action: string): void {
    switch (action) {
      case 'togglePlay':
        playbackController?.togglePlayback?.({ silent: true })
        break
      case 'seekBackward':
        playbackController?.seekBy?.(-seekSeconds)
        break
      case 'seekForward':
        playbackController?.seekBy?.(seekSeconds)
        break
      case 'previousTrack':
        playbackController?.playPreviousTrack?.()
        break
      case 'nextTrack':
        playbackController?.playNextTrack?.()
        break
      case 'toggleLoop':
        playbackController?.toggleLoopState?.()
        break
      case 'showHomePage':
        viewManager?.showHomePage?.()
        break
      case 'showSongPage':
        viewManager?.showSongPage?.()
        break
      case 'toggleTheme': {
        const themeToggle = doc.querySelector('[data-theme-toggle]') as HTMLElement | null
        if (themeToggle) themeToggle.click()
        break
      }
      case 'openShortcuts':
        settingsManager?.openPanel?.('shortcuts')
        break
      case 'minimizeWindow':
        electronAPI?.minimizeWindow?.()
        break
      case 'clearPlaylist':
        if (playbackController?.hasQueue?.()) {
          playbackController.clearPlaylist?.()
        }
        break
      default:
        break
    }
  }

  function setupEventBusBridge(): void {
    eventBus.on<QueueAppendPayload>('playback:queue.append', (payload) => {
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
      if (!tracks.length || !playbackController) return
      playbackController.appendToPlaylist?.(tracks)
    })

    eventBus.on<QueueReplacePayload>('playback:queue.replace', (payload) => {
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
      if (!tracks.length || !playbackController) return
      const startIndex =
        typeof payload?.startIndex === 'number' && Number.isFinite(payload.startIndex)
          ? payload.startIndex
          : 0
      playbackController.replaceCurrentQueueWithTracks?.(
        tracks,
        startIndex,
        payload?.options || {}
      )
    })

    eventBus.on<PlaylistChangedPayload>('playlist:saved.changed', (payload) => {
      if (savedPlaylistManager?.refreshSavedPlaylists) {
        savedPlaylistManager.refreshSavedPlaylists(payload?.playlistId || null)
      }
    })

    eventBus.on('playback:home-cover.changed', (payload) => {
      viewManager?.setHomeNowCover?.(String(payload || ''))
    })

    eventBus.on('view:home.open', () => {
      viewManager?.showHomePage?.()
    })

    eventBus.on('view:song.open', () => {
      viewManager?.showSongPage?.()
    })

    eventBus.on<ViewPlaylistOpenPayload>('view:playlist.open', (payload) => {
      viewManager?.openSavedPlaylistDetail?.(payload?.playlistId || '')
    })

    eventBus.on('toast:push', (payload) => {
      toastManager?.pushToast?.(payload)
    })

    eventBus.on<ShortcutActionPayload>('shortcut:action', (payload) => {
      handleShortcutAction(payload?.action || '')
    })

    eventBus.on('recently-played:updated', () => {
      recentlyPlayedManager?.render?.()
    })

    eventBus.handle<EnsurePlaylistPayload>('playlist:ensure-by-name', async (payload) => {
      return playlistCacheService.ensureSavedPlaylistByName(payload?.name || '', payload?.playlistKey || '')
    })

    eventBus.handle<AddTrackPayload>('playlist:add-track', async (payload) => {
      await playlistCacheService.appendDownloadedTrackToSavedPlaylist(payload?.playlistId || '', payload?.track || null)
      return true
    })

    eventBus.handle('playback:queue.collect-current-track-inputs', () => {
      if (!playbackController) return []
      return playbackController.collectCurrentQueueAsTrackInputs?.() || []
    })
  }

  function setupPlayerControlListener(): void {
    if (!electronAPI?.onPlayerControl) return
    electronAPI.onPlayerControl((action) => {
      playbackController?.handleExternalPlayerControl?.(action)
    })
  }

  function init(): void {
    setupEventBusBridge()
    setupPlayerControlListener()
  }

  return {
    init,
    handleShortcutAction
  }
}
