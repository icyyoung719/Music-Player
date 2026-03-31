export function createNavigationBridge(options = {}) {
  const {
    doc = document,
    dom,
    electronAPI,
    onShowSongPage,
    onShowHomePage,
    onShowHomeView,
    onOpenSavedPlaylistDetail
  } = options

  function init() {
    doc.querySelectorAll('[data-open-song]').forEach((el) => {
      el.addEventListener('click', () => {
        if (typeof onShowSongPage === 'function') {
          onShowSongPage()
        }
      })
    })

    if (dom.windowMinimizeBtn) {
      dom.windowMinimizeBtn.addEventListener('click', () => {
        if (electronAPI?.minimizeWindow) {
          electronAPI.minimizeWindow()
        }
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
      dom.homeCreatedPlaylistListEl.addEventListener('click', (event) => {
        const playlistItem = event.target.closest('[data-playlist-id]')
        if (!playlistItem) return
        onOpenSavedPlaylistDetail?.(playlistItem.dataset.playlistId || '')
      })
    }

    if (dom.globalPlayerBarEl) {
      dom.globalPlayerBarEl.addEventListener('click', (event) => {
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
