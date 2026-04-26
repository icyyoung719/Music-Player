import type {
  ApiFailure,
  NeteaseCloudPlaylistResult,
  NeteasePlaylistDetailResult,
  NeteasePlaylistPayload,
  NeteaseRecommendedPlaylistResult,
  NeteaseResolveIdPayload,
  NeteaseSearchPayload,
  NeteaseSearchResult,
  NeteaseSearchSuggestResult
} from './electronApi.js'

type NeteaseResolveIdResult =
  | ApiFailure
  | {
      ok: true
      type?: string
      item?: Record<string, unknown>
    }

type NeteaseDailyRecommendationResult =
  | ApiFailure
  | {
      ok: true
      data?: unknown
    }

type NeteaseCloudPlaylistMutationResult =
  | ApiFailure
  | {
      ok: true
      data?: unknown
      removed?: boolean
    }

type NeteaseApi = {
  neteaseResolveId?: (payload: NeteaseResolveIdPayload) => Promise<NeteaseResolveIdResult>
  neteaseSearch?: (payload: NeteaseSearchPayload) => Promise<NeteaseSearchResult>
  neteaseSearchSuggest?: (payload: { keywords: string }) => Promise<NeteaseSearchSuggestResult>
  neteasePlaylistDetail?: (payload: NeteasePlaylistPayload) => Promise<NeteasePlaylistDetailResult>
  neteaseGetDailyRecommendation?: () => Promise<NeteaseDailyRecommendationResult>
  neteaseGetRecommendedPlaylists?: () => Promise<NeteaseRecommendedPlaylistResult>
  neteaseUserPlaylists?: () => Promise<NeteaseCloudPlaylistResult>
  neteaseCloudPlaylistList?: () => Promise<NeteaseCloudPlaylistResult>
  neteaseCloudPlaylistSaveRef?: (payload: Record<string, unknown>) => Promise<NeteaseCloudPlaylistMutationResult>
  neteaseCloudPlaylistRemoveRef?: (payload: { platformPlaylistId?: string; playlistId?: string; id?: string }) => Promise<NeteaseCloudPlaylistMutationResult>
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

  async function resolveById(type: 'song' | 'playlist', id: string | number): Promise<NeteaseResolveIdResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseResolveId) return createApiUnavailable()
    return electronAPI.neteaseResolveId({ type, id })
  }

  async function search(payload: NeteaseSearchPayload): Promise<NeteaseSearchResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseSearch) return createApiUnavailable()
    return electronAPI.neteaseSearch(payload)
  }

  async function suggest(payload: { keywords: string }): Promise<NeteaseSearchSuggestResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseSearchSuggest) return createApiUnavailable()
    return electronAPI.neteaseSearchSuggest(payload)
  }

  async function getPlaylistDetail(playlistId: string | number): Promise<NeteasePlaylistDetailResult | ServiceErrorResult> {
    if (!electronAPI?.neteasePlaylistDetail) return createApiUnavailable()
    return electronAPI.neteasePlaylistDetail({ playlistId })
  }

  async function getDailyRecommendation(): Promise<NeteaseDailyRecommendationResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseGetDailyRecommendation) return createApiUnavailable()
    return electronAPI.neteaseGetDailyRecommendation()
  }

  async function getRecommendedPlaylists(): Promise<NeteaseRecommendedPlaylistResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseGetRecommendedPlaylists) return createApiUnavailable()
    return electronAPI.neteaseGetRecommendedPlaylists()
  }

  async function getUserPlaylists(): Promise<NeteaseCloudPlaylistResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseUserPlaylists) return createApiUnavailable()
    return electronAPI.neteaseUserPlaylists()
  }

  async function listCloudPlaylists(): Promise<NeteaseCloudPlaylistResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseCloudPlaylistList) return createApiUnavailable()
    return electronAPI.neteaseCloudPlaylistList()
  }

  async function saveCloudPlaylistRef(payload: Record<string, unknown>): Promise<NeteaseCloudPlaylistMutationResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseCloudPlaylistSaveRef) return createApiUnavailable()
    return electronAPI.neteaseCloudPlaylistSaveRef(payload)
  }

  async function removeCloudPlaylistRef(payload: { platformPlaylistId?: string; playlistId?: string; id?: string }): Promise<NeteaseCloudPlaylistMutationResult | ServiceErrorResult> {
    if (!electronAPI?.neteaseCloudPlaylistRemoveRef) return createApiUnavailable()
    return electronAPI.neteaseCloudPlaylistRemoveRef(payload)
  }

  return {
    resolveById,
    search,
    suggest,
    getPlaylistDetail,
    getDailyRecommendation,
    getRecommendedPlaylists,
    getUserPlaylists,
    listCloudPlaylists,
    saveCloudPlaylistRef,
    removeCloudPlaylistRef
  }
}
