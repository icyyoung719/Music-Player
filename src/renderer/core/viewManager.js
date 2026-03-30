function normalizeHomeView(view) {
  return ['recommend', 'download', 'playlist-detail'].includes(view) ? view : 'recommend'
}

export function createViewManager(options) {
  const {
    dom,
    savedPlaylistManager = null,
    onSongPageShown = null
  } = options || {}

  let currentHomeView = 'recommend'
  let currentSavedPlaylistManager = savedPlaylistManager

  function getCurrentHomeView() {
    return currentHomeView
  }

  function showHomeView(view) {
    currentHomeView = normalizeHomeView(view)

    if (dom.homeRecommendViewEl) {
      dom.homeRecommendViewEl.classList.toggle('page-hidden', currentHomeView !== 'recommend')
    }

    if (dom.homeDownloadViewEl) {
      dom.homeDownloadViewEl.classList.toggle('page-hidden', currentHomeView !== 'download')
    }

    if (dom.homePlaylistDetailViewEl) {
      dom.homePlaylistDetailViewEl.classList.toggle('page-hidden', currentHomeView !== 'playlist-detail')
    }

    if (dom.homeMenuRecommendEl) {
      dom.homeMenuRecommendEl.classList.toggle('active', currentHomeView === 'recommend')
    }

    if (dom.homeMenuDownloadEl) {
      dom.homeMenuDownloadEl.classList.toggle('active', currentHomeView === 'download')
    }

    if (currentSavedPlaylistManager && currentSavedPlaylistManager.setActiveView) {
      currentSavedPlaylistManager.setActiveView(currentHomeView)
    }
  }

  function showHomeShell() {
    if (dom.songPageEl) dom.songPageEl.classList.add('page-hidden')
    if (dom.homePageEl) dom.homePageEl.classList.remove('page-hidden')
  }

  function showHomePage() {
    showHomeShell()
    showHomeView(currentHomeView)
  }

  function showSongPage() {
    if (dom.homePageEl) dom.homePageEl.classList.add('page-hidden')
    if (dom.songPageEl) dom.songPageEl.classList.remove('page-hidden')

    if (typeof onSongPageShown === 'function') {
      // Wait for display block to take effect.
      requestAnimationFrame(() => {
        onSongPageShown()
      })
    }
  }

  function openSavedPlaylistDetail(playlistId) {
    showHomeShell()

    if (currentSavedPlaylistManager && currentSavedPlaylistManager.openPlaylist) {
      currentSavedPlaylistManager.openPlaylist(playlistId)
    }

    showHomeView('playlist-detail')
  }

  function setHomeNowCover(dataUrl) {
    if (dom.homeNowCoverImgEl && dom.homeNowCoverPlaceholderEl) {
      if (dataUrl) {
        dom.homeNowCoverImgEl.src = dataUrl
        dom.homeNowCoverImgEl.style.display = 'block'
        dom.homeNowCoverPlaceholderEl.style.display = 'none'
      } else {
        dom.homeNowCoverImgEl.src = ''
        dom.homeNowCoverImgEl.style.display = 'none'
        dom.homeNowCoverPlaceholderEl.style.display = 'inline'
      }
    }

    if (dom.homeFeaturedCoverEl) {
      if (dataUrl) {
        dom.homeFeaturedCoverEl.style.backgroundImage = `url(${dataUrl})`
        dom.homeFeaturedCoverEl.style.backgroundSize = 'cover'
        dom.homeFeaturedCoverEl.style.backgroundPosition = 'center'
      } else {
        dom.homeFeaturedCoverEl.style.backgroundImage = ''
      }
    }
  }

  function bindSavedPlaylistManager(nextSavedPlaylistManager) {
    if (!nextSavedPlaylistManager) return
    currentSavedPlaylistManager = nextSavedPlaylistManager
    if (nextSavedPlaylistManager.setActiveView) {
      nextSavedPlaylistManager.setActiveView(currentHomeView)
    }
  }

  return {
    getCurrentHomeView,
    showHomeView,
    showHomePage,
    showSongPage,
    openSavedPlaylistDetail,
    setHomeNowCover,
    bindSavedPlaylistManager
  }
}