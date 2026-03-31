export function createNeteaseDatabaseService(options = {}) {
  const { electronAPI } = options

  async function resolveById(type, id) {
    if (!electronAPI?.neteaseResolveId) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseResolveId({ type, id })
  }

  async function search(payload) {
    if (!electronAPI?.neteaseSearch) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseSearch(payload)
  }

  async function suggest(payload) {
    if (!electronAPI?.neteaseSearchSuggest) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseSearchSuggest(payload)
  }

  async function getPlaylistDetail(playlistId) {
    if (!electronAPI?.neteasePlaylistDetail) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteasePlaylistDetail({ playlistId })
  }

  async function getDailyRecommendation() {
    if (!electronAPI?.neteaseGetDailyRecommendation) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseGetDailyRecommendation()
  }

  async function getUserPlaylists() {
    if (!electronAPI?.neteaseUserPlaylists) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseUserPlaylists()
  }

  async function listCloudPlaylists() {
    if (!electronAPI?.neteaseCloudPlaylistList) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseCloudPlaylistList()
  }

  async function saveCloudPlaylistRef(payload) {
    if (!electronAPI?.neteaseCloudPlaylistSaveRef) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseCloudPlaylistSaveRef(payload)
  }

  async function removeCloudPlaylistRef(payload) {
    if (!electronAPI?.neteaseCloudPlaylistRemoveRef) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseCloudPlaylistRemoveRef(payload)
  }

  return {
    resolveById,
    search,
    suggest,
    getPlaylistDetail,
    getDailyRecommendation,
    getUserPlaylists,
    listCloudPlaylists,
    saveCloudPlaylistRef,
    removeCloudPlaylistRef
  }
}