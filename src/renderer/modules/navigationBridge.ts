type NavigationDom = {
  windowMinimizeBtn?: HTMLElement | null
  homeMenuRecommendEl?: HTMLElement | null
  homeMenuDownloadEl?: HTMLElement | null
  homeMenuRecentlyPlayedEl?: HTMLElement | null
  homeCreatedPlaylistListEl?: HTMLElement | null
  globalPlayerBarEl?: HTMLElement | null
}

type NavigationApi = {
  minimizeWindow?: () => void
}

type NavigationBridgeOptions = {
  doc?: Document
  dom: NavigationDom
  electronAPI?: NavigationApi
  onShowSongPage?: () => void
  onShowHomePage?: () => void
  onShowHomeView?: (view: string) => void
  onOpenSavedPlaylistDetail?: (playlistId: string) => void
}

export function createNavigationBridge(options: NavigationBridgeOptions) {
  const {
    doc = document,
    dom,
    electronAPI,
    onShowSongPage,
    onShowHomePage,
    onShowHomeView,
    onOpenSavedPlaylistDetail
  } = options

  function init(): void {
    doc.querySelectorAll('[data-open-song]').forEach((el) => {
      el.addEventListener('click', () => {
        if (typeof onShowSongPage === 'function') {
          onShowSongPage()
        }
      })
    })

    if (dom.windowMinimizeBtn) {
      dom.windowMinimizeBtn.addEventListener('click', () => {
        electronAPI?.minimizeWindow?.()
      })
    }

    if (dom.homeMenuRecommendEl) {
      dom.homeMenuRecommendEl.addEventListener('click', () => {
        onShowHomePage?.()
        onShowHomeView?.('recommend')
      })
    }

    if (dom.homeMenuDownloadEl) {
      dom.homeMenuDownloadEl.addEventListener('click', () => {
        onShowHomePage?.()
        onShowHomeView?.('download')
      })
    }

    if (dom.homeMenuRecentlyPlayedEl) {
      dom.homeMenuRecentlyPlayedEl.addEventListener('click', () => {
        onShowHomePage?.()
        onShowHomeView?.('recently-played')
      })
    }

    if (dom.homeCreatedPlaylistListEl) {
      dom.homeCreatedPlaylistListEl.addEventListener('click', (event: Event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const playlistItem = target.closest('[data-playlist-id]') as HTMLElement | null
        if (!playlistItem) return
        onOpenSavedPlaylistDetail?.(playlistItem.dataset.playlistId || '')
      })
    }

    if (dom.globalPlayerBarEl) {
      dom.globalPlayerBarEl.addEventListener('click', (event: Event) => {
        const target = event.target
        if (!(target instanceof Element)) return

        if (target.closest('button, .progress-container, input, label, select, a')) return
        onShowSongPage?.()
      })
    }
  }

  return {
    init
  }
}
