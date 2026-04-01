type NeteaseApi = {
  neteaseResolveId?: (payload: { type: string; id: string | number }) => Promise<unknown>
  neteaseSearch?: (payload: unknown) => Promise<unknown>
  neteaseSearchSuggest?: (payload: unknown) => Promise<unknown>
  neteasePlaylistDetail?: (payload: { playlistId: string | number }) => Promise<unknown>
  neteaseGetDailyRecommendation?: () => Promise<unknown>
  neteaseUserPlaylists?: () => Promise<unknown>
  neteaseCloudPlaylistList?: () => Promise<unknown>
  neteaseCloudPlaylistSaveRef?: (payload: unknown) => Promise<unknown>
  neteaseCloudPlaylistRemoveRef?: (payload: unknown) => Promise<unknown>
}

type NeteaseDatabaseServiceOptions = {
  electronAPI?: NeteaseApi
}

type ServiceErrorResult = {
  ok: false
  error: 'API_UNAVAILABLE'
}

function createApiUnavailable(): ServiceErrorResult {
  return { ok: false, error: 'API_UNAVAILABLE' }
}

export function createNeteaseDatabaseService(options: NeteaseDatabaseServiceOptions = {}) {
  const { electronAPI } = options

  async function resolveById(type: string, id: string | number): Promise<unknown> {
    if (!electronAPI?.neteaseResolveId) return createApiUnavailable()
    return electronAPI.neteaseResolveId({ type, id })
  }

  async function search(payload: unknown): Promise<unknown> {
    if (!electronAPI?.neteaseSearch) return createApiUnavailable()
    return electronAPI.neteaseSearch(payload)
  }

  async function suggest(payload: unknown): Promise<unknown> {
    if (!electronAPI?.neteaseSearchSuggest) return createApiUnavailable()
    return electronAPI.neteaseSearchSuggest(payload)
  }

  async function getPlaylistDetail(playlistId: string | number): Promise<unknown> {
    if (!electronAPI?.neteasePlaylistDetail) return createApiUnavailable()
    return electronAPI.neteasePlaylistDetail({ playlistId })
  }

  async function getDailyRecommendation(): Promise<unknown> {
    if (!electronAPI?.neteaseGetDailyRecommendation) return createApiUnavailable()
    return electronAPI.neteaseGetDailyRecommendation()
  }

  async function getUserPlaylists(): Promise<unknown> {
    if (!electronAPI?.neteaseUserPlaylists) return createApiUnavailable()
    return electronAPI.neteaseUserPlaylists()
  }

  async function listCloudPlaylists(): Promise<unknown> {
    if (!electronAPI?.neteaseCloudPlaylistList) return createApiUnavailable()
    return electronAPI.neteaseCloudPlaylistList()
  }

  async function saveCloudPlaylistRef(payload: unknown): Promise<unknown> {
    if (!electronAPI?.neteaseCloudPlaylistSaveRef) return createApiUnavailable()
    return electronAPI.neteaseCloudPlaylistSaveRef(payload)
  }

  async function removeCloudPlaylistRef(payload: unknown): Promise<unknown> {
    if (!electronAPI?.neteaseCloudPlaylistRemoveRef) return createApiUnavailable()
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
