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

  return {
    resolveById,
    search,
    suggest,
    getPlaylistDetail,
    getDailyRecommendation
  }
}