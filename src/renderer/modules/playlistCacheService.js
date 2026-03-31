export function createPlaylistCacheService(options = {}) {
  const {
    electronAPI,
    getSavedPlaylistManager
  } = options

  const createdPlaylistIdsByName = new Map()
  const pendingPlaylistPromises = new Map()

  function getSavedPlaylistManagerSafe() {
    return typeof getSavedPlaylistManager === 'function' ? getSavedPlaylistManager() : null
  }

  async function ensureSavedPlaylistByName(name, playlistKey = '') {
    const cleanName = String(name || '').trim()
    const cacheKey = String(playlistKey || cleanName).trim()
    if (!cleanName || !electronAPI?.playlistCreate) return ''

    if (cacheKey && createdPlaylistIdsByName.has(cacheKey)) {
      return createdPlaylistIdsByName.get(cacheKey)
    }

    if (cacheKey && pendingPlaylistPromises.has(cacheKey)) {
      return pendingPlaylistPromises.get(cacheKey)
    }

    const createPromise = (async () => {
      const created = await electronAPI.playlistCreate(cleanName)
      if (!created?.ok || !created?.playlist?.id) return ''
      const playlistId = created.playlist.id
      if (cacheKey) {
        createdPlaylistIdsByName.set(cacheKey, playlistId)
      }
      return playlistId
    })()

    if (cacheKey) {
      pendingPlaylistPromises.set(cacheKey, createPromise)
    }

    const playlistId = await createPromise
    if (cacheKey) {
      pendingPlaylistPromises.delete(cacheKey)
    }
    return playlistId
  }

  async function appendDownloadedTrackToSavedPlaylist(playlistId, track) {
    if (!playlistId || !track?.path || !electronAPI?.playlistAddTracks) return false

    await electronAPI.playlistAddTracks(playlistId, [
      {
        path: track.path,
        metadataCache: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration
        }
      }
    ])

    const savedPlaylistManager = getSavedPlaylistManagerSafe()
    if (savedPlaylistManager?.refreshSavedPlaylists) {
      savedPlaylistManager.refreshSavedPlaylists(playlistId)
    }
    return true
  }

  function clearCache() {
    createdPlaylistIdsByName.clear()
    pendingPlaylistPromises.clear()
  }

  return {
    ensureSavedPlaylistByName,
    appendDownloadedTrackToSavedPlaylist,
    clearCache
  }
}
