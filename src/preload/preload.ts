const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron')

type Unsubscribe = () => void
type AnyRecord = Record<string, unknown>

type BridgeErrorCode = 'INVALID_PAYLOAD' | 'INVALID_ID' | 'INVALID_URL' | 'INVALID_PLAYLIST_ID' | 'INVALID_TASK_ID'

type BridgeErrorResult = {
  ok: false
  error: BridgeErrorCode
  message: string
}

type NeteaseResolveIdPayload = {
  id: string | number
  type?: 'song' | 'playlist'
}

type NeteaseOpenPagePayload = {
  id: string | number
  type?: 'song' | 'playlist'
}

type NeteaseOpenExternalPayload = {
  url: string
}

type NeteasePlaylistDetailPayload = {
  playlistId: string | number
}

type NeteaseOpenDownloadDirPayload = {
  dirType?: 'songs' | 'temp' | 'lists' | string
  playlistName?: string
}

type NeteaseDownloadTaskPayload = {
  songId?: string | number
  playlistId?: string | number
  level?: string
  mode?: string
  targetDirType?: 'songs' | 'temp' | 'lists' | string
  duplicateStrategy?: string
  downloadMode?: string
  addToQueue?: boolean
  fileName?: string
  title?: string
  savePlaylistName?: string
  savePlaylistBatchKey?: string
  [key: string]: unknown
}

type NeteaseAuthSummaryPayload = {
  refresh?: boolean
}

type NeteaseAuthUpdatePayload = {
  apiBaseUrl?: string
  cookie?: string
  accessToken?: string
  refreshToken?: string
  userName?: string
  userId?: string | number
}

type NeteaseAuthLoginEmailPayload = {
  apiBaseUrl?: string
  email?: string
  password?: string
  md5Password?: string
  phone?: string
  countryCode?: string
}

type NeteaseAuthSendCaptchaPayload = {
  apiBaseUrl?: string
  phone?: string
  countryCode?: string
}

type NeteaseAuthLoginCaptchaPayload = {
  apiBaseUrl?: string
  phone?: string
  captcha?: string
  countryCode?: string
}

type NeteaseAuthQrPayload = {
  apiBaseUrl?: string
  qrKey?: string
}

type NeteaseAuthOpenWindowPayload = {
  page?: 'email' | 'captcha' | 'qr'
}

type NeteaseAuthRequestPayload = {
  path?: string
  data?: Record<string, unknown>
  method?: 'GET' | 'POST' | string
  timeout?: number
}

type NeteaseDownloadTaskCancelPayload = {
  id: string
}

type DownloadTask = {
  id: string
  status?: string
  filePath?: string
  title?: string
  songId?: string
  error?: string
  [key: string]: unknown
}

type AuthStateUpdatePayload = {
  account?: {
    apiBaseUrl?: string
    userName?: string
    userId?: string | number
    hasCookie?: boolean
    hasAccessToken?: boolean
    [key: string]: unknown
  }
  state?: {
    apiBaseUrl?: string
    userName?: string
    userId?: string | number
    hasCookie?: boolean
    hasAccessToken?: boolean
    [key: string]: unknown
  }
}

type AppToastPayload = {
  level?: 'info' | 'success' | 'warning' | 'error'
  message?: string
  scope?: string
  [key: string]: unknown
}

type PlayerStatePayload = {
  hasQueue?: boolean
  isPlaying?: boolean
  title?: string
}

type GenericListener<T = unknown> = (payload: T) => void

function fail(error: BridgeErrorCode, message: string): BridgeErrorResult {
  return { ok: false, error, message }
}

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object') return null
  return value as AnyRecord
}

function sanitizeId(value: unknown): string {
  const text = String(value ?? '').trim()
  return /^\d{1,20}$/.test(text) ? text : ''
}

function sanitizeHttpUrl(value: unknown): string {
  const text = String(value ?? '').trim()
  return /^https?:\/\//i.test(text) ? text : ''
}

function sanitizeDirType(value: unknown): 'songs' | 'temp' | 'lists' {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'temp') return 'temp'
  if (text === 'lists') return 'lists'
  return 'songs'
}

contextBridge.exposeInMainWorld('electronAPI', {
  playAudio: (filePath: string) => ipcRenderer.invoke('play-audio', filePath),
  getMetadata: (filePath: string) => ipcRenderer.invoke('get-metadata', filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  playlistList: () => ipcRenderer.invoke('playlist:list'),
  playlistCreate: (name: string) => ipcRenderer.invoke('playlist:create', name),
  playlistRename: (playlistId: string, name: string) => ipcRenderer.invoke('playlist:rename', { playlistId, name }),
  playlistDelete: (playlistId: string) => ipcRenderer.invoke('playlist:delete', playlistId),
  playlistAddTracks: (playlistId: string, tracks: unknown[]) => ipcRenderer.invoke('playlist:addTracks', { playlistId, tracks }),
  playlistRemoveTrack: (playlistId: string, trackId: string) => ipcRenderer.invoke('playlist:removeTrack', { playlistId, trackId }),
  playlistImport: () => ipcRenderer.invoke('playlist:import'),
  playlistExport: (playlistId: string) => ipcRenderer.invoke('playlist:export', playlistId),
  neteaseResolveId: (payload: NeteaseResolveIdPayload | unknown) => {
    const safePayload = asRecord(payload)
    const id = sanitizeId(safePayload?.id)
    if (!id) return Promise.resolve(fail('INVALID_ID', 'Invalid NetEase id payload'))
    return ipcRenderer.invoke('netease:resolve-id', {
      ...safePayload,
      id,
      type: safePayload?.type === 'playlist' ? 'playlist' : 'song'
    })
  },
  neteaseOpenPage: (payload: NeteaseOpenPagePayload | unknown) => {
    const safePayload = asRecord(payload)
    const id = sanitizeId(safePayload?.id)
    if (!id) return Promise.resolve(fail('INVALID_ID', 'Invalid NetEase page payload'))
    return ipcRenderer.invoke('netease:open-page', {
      ...safePayload,
      id,
      type: safePayload?.type === 'playlist' ? 'playlist' : 'song'
    })
  },
  neteaseOpenExternalUrl: (payload: NeteaseOpenExternalPayload | unknown) => {
    const safePayload = asRecord(payload)
    const url = sanitizeHttpUrl(safePayload?.url)
    if (!url) return Promise.resolve(fail('INVALID_URL', 'Invalid external URL payload'))
    return ipcRenderer.invoke('netease:open-external-url', {
      ...safePayload,
      url
    })
  },
  neteaseGetDownloadDir: () => ipcRenderer.invoke('netease:get-download-dir'),
  neteaseGetDownloadDirs: () => ipcRenderer.invoke('netease:get-download-dirs'),
  neteaseOpenDownloadDir: (payload: NeteaseOpenDownloadDirPayload | unknown) => {
    const safePayload = asRecord(payload)
    return ipcRenderer.invoke('netease:open-download-dir', {
      dirType: sanitizeDirType(safePayload?.dirType),
      playlistName: String(safePayload?.playlistName || '').trim()
    })
  },
  neteaseClearTempDownloads: () => ipcRenderer.invoke('netease:clear-temp-downloads'),
  neteaseDownloadDirect: (payload: NeteaseDownloadTaskPayload | unknown) =>
    ipcRenderer.invoke('netease:download-direct', asRecord(payload) || {}),
  neteaseDownloadSongTask: (payload: NeteaseDownloadTaskPayload | unknown) =>
    ipcRenderer.invoke('netease:download-song-task', asRecord(payload) || {}),
  neteaseDownloadPlaylistById: (payload: NeteaseDownloadTaskPayload | unknown) =>
    ipcRenderer.invoke('netease:download-playlist-by-id', asRecord(payload) || {}),
  neteaseAuthGetState: () => ipcRenderer.invoke('netease:auth:get-state'),
  neteaseAuthGetAccountSummary: (payload: NeteaseAuthSummaryPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:get-account-summary', asRecord(payload) || {}),
  neteaseAuthUpdate: (payload: NeteaseAuthUpdatePayload | unknown) =>
    ipcRenderer.invoke('netease:auth:update', asRecord(payload) || {}),
  neteaseAuthLoginEmail: (payload: NeteaseAuthLoginEmailPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:login-email', asRecord(payload) || {}),
  neteaseAuthSendCaptcha: (payload: NeteaseAuthSendCaptchaPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:send-captcha', asRecord(payload) || {}),
  neteaseAuthLoginCaptcha: (payload: NeteaseAuthLoginCaptchaPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:login-captcha', asRecord(payload) || {}),
  neteaseAuthQrCreate: (payload: NeteaseAuthQrPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:qr:create', asRecord(payload) || {}),
  neteaseAuthQrCheck: (payload: NeteaseAuthQrPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:qr:check', asRecord(payload) || {}),
  neteaseAuthClear: () => ipcRenderer.invoke('netease:auth:clear'),
  neteaseAuthVerify: () => ipcRenderer.invoke('netease:auth:verify'),
  neteaseAuthOpenWindow: (payload: NeteaseAuthOpenWindowPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:open-window', asRecord(payload) || {}),
  neteaseAuthCloseWindow: () => ipcRenderer.send('netease:auth-window:close'),
  onNeteaseAuthWindowSetPage: (listener: GenericListener<string>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, page: string) => listener(page)
    ipcRenderer.on('netease:auth-window:set-page', wrapped)
    return () => ipcRenderer.removeListener('netease:auth-window:set-page', wrapped)
  },
  onNeteaseAuthStateUpdate: (listener: GenericListener<AuthStateUpdatePayload>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AuthStateUpdatePayload) => listener(payload)
    ipcRenderer.on('netease:auth:state-updated', wrapped)
    return () => ipcRenderer.removeListener('netease:auth:state-updated', wrapped)
  },
  neteaseAuthRequest: (payload: NeteaseAuthRequestPayload | unknown) =>
    ipcRenderer.invoke('netease:auth:request', asRecord(payload) || {}),
  neteaseSearch: (payload: unknown) => ipcRenderer.invoke('netease:search', payload),
  neteaseSearchSuggest: (payload: unknown) => ipcRenderer.invoke('netease:search-suggest', payload),
  neteaseSearchDefault: () => ipcRenderer.invoke('netease:search-default'),
  neteaseSearchHot: () => ipcRenderer.invoke('netease:search-hot'),
  neteaseSearchHotDetail: () => ipcRenderer.invoke('netease:search-hot-detail'),
  neteaseSearchMultimatch: (payload: unknown) => ipcRenderer.invoke('netease:search-multimatch', payload),
  neteasePlaylistDetail: (payload: NeteasePlaylistDetailPayload | unknown) => {
    const safePayload = asRecord(payload)
    const playlistId = sanitizeId(safePayload?.playlistId)
    if (!playlistId) return Promise.resolve(fail('INVALID_PLAYLIST_ID', 'Invalid playlist detail payload'))
    return ipcRenderer.invoke('netease:playlist-detail', {
      ...safePayload,
      playlistId
    })
  },
  neteaseUserPlaylists: () => ipcRenderer.invoke('netease:user-playlists'),
  neteaseCloudPlaylistList: () => ipcRenderer.invoke('netease:cloud-playlist:list'),
  neteaseCloudPlaylistSaveRef: (payload: unknown) => ipcRenderer.invoke('netease:cloud-playlist:save-ref', payload),
  neteaseCloudPlaylistRemoveRef: (payload: unknown) => ipcRenderer.invoke('netease:cloud-playlist:remove-ref', payload),
  neteaseSendText: (payload: unknown) => ipcRenderer.invoke('netease:send-text', payload),
  neteaseSendSong: (payload: unknown) => ipcRenderer.invoke('netease:send-song', payload),
  neteaseSendAlbum: (payload: unknown) => ipcRenderer.invoke('netease:send-album', payload),
  neteaseSendPlaylist: (payload: unknown) => ipcRenderer.invoke('netease:send-playlist', payload),
  neteaseGetDailyRecommendation: () => ipcRenderer.invoke('netease:get-daily-recommendation'),
  neteaseGetRecommendedPlaylists: () => ipcRenderer.invoke('netease:get-recommended-playlists'),
  neteaseResolveSongDownloadUrl: (payload: NeteaseDownloadTaskPayload | unknown) =>
    ipcRenderer.invoke('netease:resolve-song-download-url', asRecord(payload) || {}),
  neteaseDownloadBySongId: (payload: NeteaseDownloadTaskPayload | unknown) =>
    ipcRenderer.invoke('netease:download-by-song-id', asRecord(payload) || {}),
  neteaseDownloadTaskList: () => ipcRenderer.invoke('netease:download-task:list'),
  neteaseDownloadTaskCancel: (payload: NeteaseDownloadTaskCancelPayload | unknown) => {
    const safePayload = asRecord(payload)
    const id = String(safePayload?.id || '').trim()
    if (!id) return Promise.resolve(fail('INVALID_TASK_ID', 'Invalid download task cancel payload'))
    return ipcRenderer.invoke('netease:download-task:cancel', { id })
  },
  onNeteaseDownloadTaskUpdate: (listener: GenericListener<DownloadTask>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, task: DownloadTask) => listener(task)
    ipcRenderer.on('netease:download-task-updated', wrapped)
    return () => ipcRenderer.removeListener('netease:download-task-updated', wrapped)
  },
  onAppToast: (listener: GenericListener<AppToastPayload>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppToastPayload) => listener(payload)
    ipcRenderer.on('app:toast', wrapped)
    return () => ipcRenderer.removeListener('app:toast', wrapped)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  reportPlayerState: (state: PlayerStatePayload) => ipcRenderer.send('player:state-changed', state),
  onPlayerControl: (listener: GenericListener<string>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, action: string) => listener(action)
    ipcRenderer.on('player:control', wrapped)
    return () => ipcRenderer.removeListener('player:control', wrapped)
  }
})

export {}
