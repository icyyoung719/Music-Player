export type Unsubscribe = () => void

export type ApiFailure = {
  ok: false
  error: string
  message?: string
  code?: number
  [key: string]: unknown
}

export type ApiResult<TPayload extends Record<string, unknown>> =
  | ({ ok: true } & TPayload)
  | ApiFailure

export type MetadataPayload = {
  title?: string
  artist?: string
  album?: string
  duration?: number
  coverDataUrl?: string
  lyrics?: string
  [key: string]: unknown
}

export type PlaylistTrackInput = Record<string, unknown>

export type PlaylistTrackLibraryEntry = {
  path: string
  metadataCache?: {
    title?: string
    artist?: string
    album?: string
    duration?: number
    coverDataUrl?: string
    [key: string]: unknown
  }
}

export type PlaylistItem = {
  id: string
  name: string
  trackIds: string[]
  source?: string
  platform?: string
  platformPlaylistId?: string
  creator?: {
    userId?: string
    nickname?: string
  }
  coverUrl?: string
  description?: string
  updateTime?: string
  tags?: string[]
}

export type PlaylistStatePayload = {
  schemaVersion: number
  playlists: PlaylistItem[]
  trackLibrary: Record<string, PlaylistTrackLibraryEntry>
}

export type DownloadTaskPayload = {
  mode?: string
  songId?: string | number
  playlistId?: string | number
  id?: string
  url?: string
  fileName?: string
  level?: string
  duplicateStrategy?: string
  targetDirType?: string
  playlistName?: string
  savePlaylistName?: string
  addToQueue?: boolean
  [key: string]: unknown
}

export type DownloadTask = {
  id: string
  status?: string
  filePath?: string
  title?: string
  songId?: string
  error?: string
  [key: string]: unknown
}

export type DownloadTaskResult = ApiResult<{
  task?: DownloadTask
  tasks?: DownloadTask[]
  createdCount?: number
  failedCount?: number
  [key: string]: unknown
}>

export type NeteaseSearchPayload = {
  keywords: string
  type?: string
  limit?: number
  offset?: number
}

export type NeteaseResolveIdPayload = {
  id: string | number
  type?: 'song' | 'playlist'
}

export type NeteasePlaylistPayload = {
  playlistId: string | number
}

export type NeteaseSongIdPayload = {
  songId: string | number
  level?: string
  [key: string]: unknown
}

export type NeteaseOpenExternalPayload = {
  url: string
}

export type NeteaseOpenPagePayload = {
  id: string | number
  type?: 'song' | 'playlist'
}

export type NeteaseAuthSummaryPayload = {
  refresh: boolean
}

export type NeteaseAuthWindowPayload = {
  page?: 'email' | 'captcha' | 'qr'
}

export type NeteaseAuthRequestPayload = {
  path: string
  data?: Record<string, unknown>
  method?: 'GET' | 'POST'
  timeout?: number
}

export type NeteaseAuthStateResult = ApiResult<{
  state?: AuthStatePayload
  account?: AuthStatePayload
}>

export type NeteaseSearchResult = ApiResult<{
  data?: {
    keywords?: string
    type?: string
    limit?: number
    offset?: number
    total?: number
    hasMore?: boolean
    items?: NeteaseSearchItem[]
    [key: string]: unknown
  }
}>

export type NeteaseSearchSongItem = {
  id: string
  name: string
  artist: string
  album: string
  durationMs: number
  coverUrl: string
}

export type NeteaseSearchArtistItem = {
  id: string
  name: string
  alias: string[]
  albumSize: number
  mvSize: number
  picUrl: string
}

export type NeteaseSearchPlaylistItem = {
  id: string
  name: string
  creator: string
  trackCount: number
  playCount: number
  coverUrl: string
}

export type NeteaseSearchItem =
  | NeteaseSearchSongItem
  | NeteaseSearchArtistItem
  | NeteaseSearchPlaylistItem

export type NeteaseSearchSuggestData = {
  keywords: string[]
  songs: Array<{ id: string; name: string; artist: string }>
  artists: Array<{ id: string; name: string }>
  playlists: Array<{ id: string; name: string; trackCount: number }>
}

export type NeteaseSearchSuggestResult = ApiResult<{
  data?: NeteaseSearchSuggestData
}>

export type NeteasePlaylistTrack = {
  songId: string
  title: string
  artist: string
  album: string
  durationMs: number
  coverUrl: string
}

export type NeteasePlaylistDetailData = {
  id: string
  name: string
  creator: string
  trackCount: number
  playCount: number
  coverUrl: string
  description: string
  tags: string[]
  tracks: NeteasePlaylistTrack[]
}

export type NeteasePlaylistDetailResult = ApiResult<{
  data?: NeteasePlaylistDetailData
}>

export type NeteaseCloudPlaylistResult = ApiResult<{
  data?: unknown[]
  state?: unknown
}>

export type NeteaseRecommendedPlaylistResult = ApiResult<{
  data?: unknown[]
  meta?: unknown
}>

export type NeteaseToastPayload = {
  level?: 'info' | 'success' | 'warning' | 'error'
  message?: string
  scope?: string
  [key: string]: unknown
}

export type PlayerStatePayload = {
  hasQueue?: boolean
  isPlaying?: boolean
  title?: string
}

export type AuthStatePayload = {
  apiBaseUrl?: string
  userName?: string
  userId?: string | number
  hasCookie?: boolean
  hasAccessToken?: boolean
  [key: string]: unknown
}

export type AuthStateUpdatePayload = {
  account?: AuthStatePayload
  state?: AuthStatePayload
}

export interface ElectronAPI {
  playAudio?: (filePath: string) => Promise<ApiResult<Record<string, unknown>>>
  getMetadata?: (filePath: string) => Promise<MetadataPayload>
  getPathForFile?: (file: File) => string
  selectFolder?: () => Promise<ApiResult<Record<string, unknown>>>

  playlistList?: () => Promise<PlaylistStatePayload>
  playlistCreate?: (name: string) => Promise<ApiResult<{ playlist: PlaylistItem }>>
  playlistRename?: (playlistId: string, name: string) => Promise<ApiResult<{ playlist: PlaylistItem }>>
  playlistDelete?: (playlistId: string) => Promise<ApiResult<Record<string, unknown>>>
  playlistAddTracks?: (playlistId: string, tracks: PlaylistTrackInput[]) => Promise<ApiResult<{ addedCount: number; playlist: PlaylistItem }>>
  playlistRemoveTrack?: (playlistId: string, trackId: string) => Promise<ApiResult<{ removed?: boolean; playlist?: PlaylistItem }>>
  playlistImport?: () => Promise<ApiResult<{ importedPlaylistCount?: number; importedTrackCount?: number; canceled?: boolean }>>
  playlistExport?: (playlistId: string) => Promise<ApiResult<{ filePath?: string; canceled?: boolean }>>

  neteaseResolveId?: (payload: NeteaseResolveIdPayload) => Promise<ApiResult<{ type?: string; item?: Record<string, unknown> }>>
  neteaseOpenPage?: (payload: NeteaseOpenPagePayload) => Promise<ApiResult<{ pageUrl?: string }>>
  neteaseOpenExternalUrl?: (payload: NeteaseOpenExternalPayload) => Promise<ApiResult<Record<string, unknown>>>
  neteaseGetDownloadDir?: () => Promise<ApiResult<{ dir?: string }>>
  neteaseGetDownloadDirs?: () => Promise<ApiResult<{ dirs?: Record<string, string> }>>
  neteaseOpenDownloadDir?: (payload: { dirType?: string; playlistName?: string }) => Promise<ApiResult<{ dirPath?: string; dirType?: string }>>
  neteaseClearTempDownloads?: () => Promise<ApiResult<{ removedFiles?: number; dirPath?: string }>>
  neteaseDownloadDirect?: (payload: DownloadTaskPayload) => Promise<DownloadTaskResult>
  neteaseDownloadSongTask?: (payload: DownloadTaskPayload) => Promise<DownloadTaskResult>
  neteaseDownloadPlaylistById?: (payload: DownloadTaskPayload) => Promise<DownloadTaskResult>
  neteaseDownloadBySongId?: (payload: DownloadTaskPayload) => Promise<DownloadTaskResult>
  neteaseDownloadTaskList?: () => Promise<ApiResult<{ tasks: DownloadTask[] }>>
  neteaseDownloadTaskCancel?: (payload: { id: string }) => Promise<DownloadTaskResult>

  neteaseAuthGetState?: () => Promise<NeteaseAuthStateResult>
  neteaseAuthGetAccountSummary?: (payload: NeteaseAuthSummaryPayload) => Promise<NeteaseAuthStateResult>
  neteaseAuthUpdate?: (payload: Record<string, unknown>) => Promise<NeteaseAuthStateResult>
  neteaseAuthLoginEmail?: (payload: Record<string, unknown>) => Promise<NeteaseAuthStateResult>
  neteaseAuthSendCaptcha?: (payload: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>>
  neteaseAuthLoginCaptcha?: (payload: Record<string, unknown>) => Promise<NeteaseAuthStateResult>
  neteaseAuthQrCreate?: (payload: Record<string, unknown>) => Promise<ApiResult<{ qrKey?: string; qrLoginUrl?: string; qrDataUrl?: string }>>
  neteaseAuthQrCheck?: (payload: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>>
  neteaseAuthClear?: () => Promise<ApiResult<Record<string, unknown>>>
  neteaseAuthVerify?: () => Promise<ApiResult<Record<string, unknown>>>
  neteaseAuthRequest?: (payload: NeteaseAuthRequestPayload) => Promise<ApiResult<{ data?: unknown }>>
  neteaseAuthOpenWindow?: (payload: NeteaseAuthWindowPayload) => Promise<ApiResult<Record<string, unknown>>>
  neteaseAuthCloseWindow?: () => void

  neteaseSearch?: (payload: NeteaseSearchPayload) => Promise<NeteaseSearchResult>
  neteaseSearchSuggest?: (payload: { keywords: string }) => Promise<NeteaseSearchSuggestResult>
  neteaseSearchDefault?: () => Promise<ApiResult<Record<string, unknown>>>
  neteaseSearchHot?: () => Promise<ApiResult<Record<string, unknown>>>
  neteaseSearchHotDetail?: () => Promise<ApiResult<Record<string, unknown>>>
  neteaseSearchMultimatch?: (payload: NeteaseSearchPayload) => Promise<ApiResult<Record<string, unknown>>>
  neteasePlaylistDetail?: (payload: NeteasePlaylistPayload) => Promise<NeteasePlaylistDetailResult>
  neteaseUserPlaylists?: () => Promise<NeteaseCloudPlaylistResult>
  neteaseCloudPlaylistList?: () => Promise<NeteaseCloudPlaylistResult>
  neteaseCloudPlaylistSaveRef?: (payload: Record<string, unknown>) => Promise<ApiResult<{ data?: unknown }>>
  neteaseCloudPlaylistRemoveRef?: (payload: { platformPlaylistId?: string; playlistId?: string; id?: string }) => Promise<ApiResult<{ removed?: boolean }>>
  neteaseSendText?: (payload: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>>
  neteaseSendSong?: (payload: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>>
  neteaseSendAlbum?: (payload: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>>
  neteaseSendPlaylist?: (payload: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>>
  neteaseGetDailyRecommendation?: () => Promise<ApiResult<{ data?: unknown }>>
  neteaseGetRecommendedPlaylists?: () => Promise<NeteaseRecommendedPlaylistResult>
  neteaseResolveSongDownloadUrl?: (payload: NeteaseSongIdPayload) => Promise<ApiResult<{ resolved?: Record<string, unknown>; pickedLevel?: string; attempts?: unknown[] }>>

  onNeteaseAuthWindowSetPage?: (listener: (page: string) => void) => Unsubscribe
  onNeteaseAuthStateUpdate?: (listener: (payload: AuthStateUpdatePayload) => void) => Unsubscribe
  onNeteaseDownloadTaskUpdate?: (listener: (task: DownloadTask) => void) => Unsubscribe
  onAppToast?: (listener: (payload: NeteaseToastPayload) => void) => Unsubscribe

  minimizeWindow?: () => Promise<ApiResult<Record<string, unknown>>>
  reportPlayerState?: (state: PlayerStatePayload) => void
  onPlayerControl?: (listener: (action: string) => void) => Unsubscribe
}

export function getElectronAPI(win: Window & typeof globalThis = window): ElectronAPI | undefined {
  return (win as Window & { electronAPI?: ElectronAPI }).electronAPI
}
