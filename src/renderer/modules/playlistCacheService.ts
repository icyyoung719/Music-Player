import type { ElectronAPI } from '../core/electronApi.js'

type PlaylistCreateResponse = {
  ok?: boolean
  playlist?: {
    id?: string
  }
}

type SavedPlaylistManagerLike = {
  refreshSavedPlaylists?: (playlistId?: string | null) => void
}

type DownloadedTrackLike = {
  path?: string
  title?: string
  artist?: string
  album?: string
  duration?: number
}

type PlaylistCacheServiceOptions = {
  electronAPI?: Pick<ElectronAPI, 'playlistCreate' | 'playlistAddTracks'>
  getSavedPlaylistManager?: () => SavedPlaylistManagerLike | null
}

export function createPlaylistCacheService(options: PlaylistCacheServiceOptions = {}) {
  const { electronAPI, getSavedPlaylistManager } = options

  const createdPlaylistIdsByName = new Map<string, string>()
  const pendingPlaylistPromises = new Map<string, Promise<string>>()

  function getSavedPlaylistManagerSafe(): SavedPlaylistManagerLike | null {
    return typeof getSavedPlaylistManager === 'function' ? getSavedPlaylistManager() : null
  }

  async function ensureSavedPlaylistByName(name: string, playlistKey = ''): Promise<string> {
    const cleanName = String(name || '').trim()
    const cacheKey = String(playlistKey || cleanName).trim()
    if (!cleanName || !electronAPI?.playlistCreate) return ''

    if (cacheKey && createdPlaylistIdsByName.has(cacheKey)) {
      return createdPlaylistIdsByName.get(cacheKey) || ''
    }

    if (cacheKey && pendingPlaylistPromises.has(cacheKey)) {
      return pendingPlaylistPromises.get(cacheKey) || ''
    }

    const createPromise = (async () => {
      const created = (await electronAPI.playlistCreate!(cleanName)) as PlaylistCreateResponse
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

  async function appendDownloadedTrackToSavedPlaylist(playlistId: string, track: DownloadedTrackLike | null): Promise<boolean> {
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

  function clearCache(): void {
    createdPlaylistIdsByName.clear()
    pendingPlaylistPromises.clear()
  }

  return {
    ensureSavedPlaylistByName,
    appendDownloadedTrackToSavedPlaylist,
    clearCache
  }
}
