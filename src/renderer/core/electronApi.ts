export type Unsubscribe = () => void

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
  playAudio?: (filePath: string) => Promise<unknown>
  getMetadata?: (filePath: string) => Promise<unknown>
  getPathForFile?: (file: File) => string
  selectFolder?: () => Promise<unknown>

  playlistList?: () => Promise<unknown>
  playlistCreate?: (name: string) => Promise<unknown>
  playlistRename?: (playlistId: string, name: string) => Promise<unknown>
  playlistDelete?: (playlistId: string) => Promise<unknown>
  playlistAddTracks?: (playlistId: string, tracks: unknown[]) => Promise<unknown>
  playlistRemoveTrack?: (playlistId: string, trackId: string) => Promise<unknown>
  playlistImport?: () => Promise<unknown>
  playlistExport?: (playlistId: string) => Promise<unknown>

  neteaseResolveId?: (payload: unknown) => Promise<unknown>
  neteaseOpenPage?: (payload: unknown) => Promise<unknown>
  neteaseOpenExternalUrl?: (payload: unknown) => Promise<unknown>
  neteaseGetDownloadDir?: () => Promise<unknown>
  neteaseGetDownloadDirs?: () => Promise<unknown>
  neteaseOpenDownloadDir?: (payload: unknown) => Promise<unknown>
  neteaseClearTempDownloads?: () => Promise<unknown>
  neteaseDownloadDirect?: (payload: unknown) => Promise<unknown>
  neteaseDownloadSongTask?: (payload: unknown) => Promise<unknown>
  neteaseDownloadPlaylistById?: (payload: unknown) => Promise<unknown>
  neteaseDownloadBySongId?: (payload: unknown) => Promise<unknown>
  neteaseDownloadTaskList?: () => Promise<unknown>
  neteaseDownloadTaskCancel?: (payload: unknown) => Promise<unknown>

  neteaseAuthGetState?: () => Promise<unknown>
  neteaseAuthGetAccountSummary?: (payload: { refresh: boolean }) => Promise<unknown>
  neteaseAuthUpdate?: (payload: unknown) => Promise<unknown>
  neteaseAuthLoginEmail?: (payload: unknown) => Promise<unknown>
  neteaseAuthSendCaptcha?: (payload: unknown) => Promise<unknown>
  neteaseAuthLoginCaptcha?: (payload: unknown) => Promise<unknown>
  neteaseAuthQrCreate?: (payload: unknown) => Promise<unknown>
  neteaseAuthQrCheck?: (payload: unknown) => Promise<unknown>
  neteaseAuthClear?: () => Promise<unknown>
  neteaseAuthVerify?: () => Promise<unknown>
  neteaseAuthRequest?: (payload: unknown) => Promise<unknown>
  neteaseAuthOpenWindow?: (payload: unknown) => Promise<unknown>
  neteaseAuthCloseWindow?: () => void

  neteaseSearch?: (payload: unknown) => Promise<unknown>
  neteaseSearchSuggest?: (payload: unknown) => Promise<unknown>
  neteaseSearchDefault?: () => Promise<unknown>
  neteaseSearchHot?: () => Promise<unknown>
  neteaseSearchHotDetail?: () => Promise<unknown>
  neteaseSearchMultimatch?: (payload: unknown) => Promise<unknown>
  neteasePlaylistDetail?: (payload: unknown) => Promise<unknown>
  neteaseUserPlaylists?: () => Promise<unknown>
  neteaseCloudPlaylistList?: () => Promise<unknown>
  neteaseCloudPlaylistSaveRef?: (payload: unknown) => Promise<unknown>
  neteaseCloudPlaylistRemoveRef?: (payload: unknown) => Promise<unknown>
  neteaseSendText?: (payload: unknown) => Promise<unknown>
  neteaseSendSong?: (payload: unknown) => Promise<unknown>
  neteaseSendAlbum?: (payload: unknown) => Promise<unknown>
  neteaseSendPlaylist?: (payload: unknown) => Promise<unknown>
  neteaseGetDailyRecommendation?: () => Promise<unknown>
  neteaseResolveSongDownloadUrl?: (payload: unknown) => Promise<unknown>

  onNeteaseAuthWindowSetPage?: (listener: (page: string) => void) => Unsubscribe
  onNeteaseAuthStateUpdate?: (listener: (payload: AuthStateUpdatePayload) => void) => Unsubscribe
  onNeteaseDownloadTaskUpdate?: (listener: (task: unknown) => void) => Unsubscribe
  onAppToast?: (listener: (payload: unknown) => void) => Unsubscribe

  minimizeWindow?: () => Promise<unknown>
  reportPlayerState?: (state: unknown) => void
  onPlayerControl?: (listener: (action: string) => void) => Unsubscribe
}

export function getElectronAPI(win: Window & typeof globalThis = window): ElectronAPI | undefined {
  return (win as Window & { electronAPI?: ElectronAPI }).electronAPI
}
