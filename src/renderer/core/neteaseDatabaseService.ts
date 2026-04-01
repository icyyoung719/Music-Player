type NeteaseApi = {
  neteaseResolveId?: (payload: { type: string; id: string | number }) => Promise<any>
  neteaseSearch?: (payload: unknown) => Promise<any>
  neteaseSearchSuggest?: (payload: unknown) => Promise<any>
  neteasePlaylistDetail?: (payload: { playlistId: string | number }) => Promise<any>
  neteaseGetDailyRecommendation?: () => Promise<any>
  neteaseUserPlaylists?: () => Promise<any>
  neteaseCloudPlaylistList?: () => Promise<any>
  neteaseCloudPlaylistSaveRef?: (payload: unknown) => Promise<any>
  neteaseCloudPlaylistRemoveRef?: (payload: unknown) => Promise<any>
}

type NeteaseDatabaseServiceOptions = {
  electronAPI?: NeteaseApi
}

export function createNeteaseDatabaseService(options: NeteaseDatabaseServiceOptions = {}) {
  const { electronAPI } = options

  async function resolveById(type: string, id: string | number): Promise<any> {
    if (!electronAPI?.neteaseResolveId) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseResolveId({ type, id })
  }

  async function search(payload: unknown): Promise<any> {
    if (!electronAPI?.neteaseSearch) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseSearch(payload)
  }

  async function suggest(payload: unknown): Promise<any> {
    if (!electronAPI?.neteaseSearchSuggest) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseSearchSuggest(payload)
  }

  async function getPlaylistDetail(playlistId: string | number): Promise<any> {
    if (!electronAPI?.neteasePlaylistDetail) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteasePlaylistDetail({ playlistId })
  }

  async function getDailyRecommendation(): Promise<any> {
    if (!electronAPI?.neteaseGetDailyRecommendation) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseGetDailyRecommendation()
  }

  async function getUserPlaylists(): Promise<any> {
    if (!electronAPI?.neteaseUserPlaylists) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseUserPlaylists()
  }

  async function listCloudPlaylists(): Promise<any> {
    if (!electronAPI?.neteaseCloudPlaylistList) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseCloudPlaylistList()
  }

  async function saveCloudPlaylistRef(payload: unknown): Promise<any> {
    if (!electronAPI?.neteaseCloudPlaylistSaveRef) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseCloudPlaylistSaveRef(payload)
  }

  async function removeCloudPlaylistRef(payload: unknown): Promise<any> {
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
