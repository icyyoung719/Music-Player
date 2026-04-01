type HomeView = 'recommend' | 'download' | 'recently-played' | 'playlist-detail'

type SavedPlaylistManagerLike = {
  setActiveView?: (view: HomeView) => void
  openPlaylist?: (playlistId: string) => void
}

type ViewDom = {
  songPageEl?: HTMLElement | null
  homePageEl?: HTMLElement | null
  homeRecommendViewEl?: HTMLElement | null
  homeDownloadViewEl?: HTMLElement | null
  homeRecentlyPlayedViewEl?: HTMLElement | null
  homePlaylistDetailViewEl?: HTMLElement | null
  homeMenuRecommendEl?: HTMLElement | null
  homeMenuDownloadEl?: HTMLElement | null
  homeMenuRecentlyPlayedEl?: HTMLElement | null
  homeNowCoverImgEl?: HTMLImageElement | null
  homeNowCoverPlaceholderEl?: HTMLElement | null
  homeFeaturedCoverEl?: HTMLElement | null
}

type ViewManagerOptions = {
  dom: ViewDom
  savedPlaylistManager?: SavedPlaylistManagerLike | null
  onSongPageShown?: (() => void) | null
}

function normalizeHomeView(view: string): HomeView {
  return ['recommend', 'download', 'recently-played', 'playlist-detail'].includes(view)
    ? (view as HomeView)
    : 'recommend'
}

export function createViewManager(options: ViewManagerOptions) {
  const { dom, savedPlaylistManager = null, onSongPageShown = null } = options || {}

  let currentHomeView: HomeView = 'recommend'
  let currentSavedPlaylistManager = savedPlaylistManager

  function getCurrentHomeView(): HomeView {
    return currentHomeView
  }

  function showHomeView(view: string): void {
    currentHomeView = normalizeHomeView(view)

    if (dom.homeRecommendViewEl) {
      dom.homeRecommendViewEl.classList.toggle('page-hidden', currentHomeView !== 'recommend')
    }

    if (dom.homeDownloadViewEl) {
      dom.homeDownloadViewEl.classList.toggle('page-hidden', currentHomeView !== 'download')
    }

    if (dom.homeRecentlyPlayedViewEl) {
      dom.homeRecentlyPlayedViewEl.classList.toggle('page-hidden', currentHomeView !== 'recently-played')
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

    if (dom.homeMenuRecentlyPlayedEl) {
      dom.homeMenuRecentlyPlayedEl.classList.toggle('active', currentHomeView === 'recently-played')
    }

    if (currentSavedPlaylistManager?.setActiveView) {
      currentSavedPlaylistManager.setActiveView(currentHomeView)
    }
  }

  function showHomeShell(): void {
    if (dom.songPageEl) dom.songPageEl.classList.add('page-hidden')
    if (dom.homePageEl) dom.homePageEl.classList.remove('page-hidden')
  }

  function showHomePage(): void {
    showHomeShell()
    showHomeView(currentHomeView)
  }

  function showSongPage(): void {
    if (dom.homePageEl) dom.homePageEl.classList.add('page-hidden')
    if (dom.songPageEl) dom.songPageEl.classList.remove('page-hidden')

    if (typeof onSongPageShown === 'function') {
      requestAnimationFrame(() => {
        onSongPageShown()
      })
    }
  }

  function openSavedPlaylistDetail(playlistId: string): void {
    showHomeShell()

    if (currentSavedPlaylistManager?.openPlaylist) {
      currentSavedPlaylistManager.openPlaylist(playlistId)
    }

    showHomeView('playlist-detail')
  }

  function setHomeNowCover(dataUrl: string | null | undefined): void {
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

  function bindSavedPlaylistManager(nextSavedPlaylistManager: SavedPlaylistManagerLike | null | undefined): void {
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
