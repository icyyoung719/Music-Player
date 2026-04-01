const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron')

type Unsubscribe = () => void

type GenericListener<T = unknown> = (payload: T) => void

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
  neteaseResolveId: (payload: unknown) => ipcRenderer.invoke('netease:resolve-id', payload),
  neteaseOpenPage: (payload: unknown) => ipcRenderer.invoke('netease:open-page', payload),
  neteaseOpenExternalUrl: (payload: unknown) => ipcRenderer.invoke('netease:open-external-url', payload),
  neteaseGetDownloadDir: () => ipcRenderer.invoke('netease:get-download-dir'),
  neteaseGetDownloadDirs: () => ipcRenderer.invoke('netease:get-download-dirs'),
  neteaseOpenDownloadDir: (payload: unknown) => ipcRenderer.invoke('netease:open-download-dir', payload),
  neteaseClearTempDownloads: () => ipcRenderer.invoke('netease:clear-temp-downloads'),
  neteaseDownloadDirect: (payload: unknown) => ipcRenderer.invoke('netease:download-direct', payload),
  neteaseDownloadSongTask: (payload: unknown) => ipcRenderer.invoke('netease:download-song-task', payload),
  neteaseDownloadPlaylistById: (payload: unknown) => ipcRenderer.invoke('netease:download-playlist-by-id', payload),
  neteaseAuthGetState: () => ipcRenderer.invoke('netease:auth:get-state'),
  neteaseAuthGetAccountSummary: (payload: unknown) => ipcRenderer.invoke('netease:auth:get-account-summary', payload),
  neteaseAuthUpdate: (payload: unknown) => ipcRenderer.invoke('netease:auth:update', payload),
  neteaseAuthLoginEmail: (payload: unknown) => ipcRenderer.invoke('netease:auth:login-email', payload),
  neteaseAuthSendCaptcha: (payload: unknown) => ipcRenderer.invoke('netease:auth:send-captcha', payload),
  neteaseAuthLoginCaptcha: (payload: unknown) => ipcRenderer.invoke('netease:auth:login-captcha', payload),
  neteaseAuthQrCreate: (payload: unknown) => ipcRenderer.invoke('netease:auth:qr:create', payload),
  neteaseAuthQrCheck: (payload: unknown) => ipcRenderer.invoke('netease:auth:qr:check', payload),
  neteaseAuthClear: () => ipcRenderer.invoke('netease:auth:clear'),
  neteaseAuthVerify: () => ipcRenderer.invoke('netease:auth:verify'),
  neteaseAuthOpenWindow: (payload: unknown) => ipcRenderer.invoke('netease:auth:open-window', payload),
  neteaseAuthCloseWindow: () => ipcRenderer.send('netease:auth-window:close'),
  onNeteaseAuthWindowSetPage: (listener: GenericListener<string>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, page: string) => listener(page)
    ipcRenderer.on('netease:auth-window:set-page', wrapped)
    return () => ipcRenderer.removeListener('netease:auth-window:set-page', wrapped)
  },
  onNeteaseAuthStateUpdate: (listener: GenericListener<unknown>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on('netease:auth:state-updated', wrapped)
    return () => ipcRenderer.removeListener('netease:auth:state-updated', wrapped)
  },
  neteaseAuthRequest: (payload: unknown) => ipcRenderer.invoke('netease:auth:request', payload),
  neteaseSearch: (payload: unknown) => ipcRenderer.invoke('netease:search', payload),
  neteaseSearchSuggest: (payload: unknown) => ipcRenderer.invoke('netease:search-suggest', payload),
  neteaseSearchDefault: () => ipcRenderer.invoke('netease:search-default'),
  neteaseSearchHot: () => ipcRenderer.invoke('netease:search-hot'),
  neteaseSearchHotDetail: () => ipcRenderer.invoke('netease:search-hot-detail'),
  neteaseSearchMultimatch: (payload: unknown) => ipcRenderer.invoke('netease:search-multimatch', payload),
  neteasePlaylistDetail: (payload: unknown) => ipcRenderer.invoke('netease:playlist-detail', payload),
  neteaseUserPlaylists: () => ipcRenderer.invoke('netease:user-playlists'),
  neteaseCloudPlaylistList: () => ipcRenderer.invoke('netease:cloud-playlist:list'),
  neteaseCloudPlaylistSaveRef: (payload: unknown) => ipcRenderer.invoke('netease:cloud-playlist:save-ref', payload),
  neteaseCloudPlaylistRemoveRef: (payload: unknown) => ipcRenderer.invoke('netease:cloud-playlist:remove-ref', payload),
  neteaseSendText: (payload: unknown) => ipcRenderer.invoke('netease:send-text', payload),
  neteaseSendSong: (payload: unknown) => ipcRenderer.invoke('netease:send-song', payload),
  neteaseSendAlbum: (payload: unknown) => ipcRenderer.invoke('netease:send-album', payload),
  neteaseSendPlaylist: (payload: unknown) => ipcRenderer.invoke('netease:send-playlist', payload),
  neteaseGetDailyRecommendation: () => ipcRenderer.invoke('netease:get-daily-recommendation'),
  neteaseResolveSongDownloadUrl: (payload: unknown) => ipcRenderer.invoke('netease:resolve-song-download-url', payload),
  neteaseDownloadBySongId: (payload: unknown) => ipcRenderer.invoke('netease:download-by-song-id', payload),
  neteaseDownloadTaskList: () => ipcRenderer.invoke('netease:download-task:list'),
  neteaseDownloadTaskCancel: (payload: unknown) => ipcRenderer.invoke('netease:download-task:cancel', payload),
  onNeteaseDownloadTaskUpdate: (listener: GenericListener<unknown>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, task: unknown) => listener(task)
    ipcRenderer.on('netease:download-task-updated', wrapped)
    return () => ipcRenderer.removeListener('netease:download-task-updated', wrapped)
  },
  onAppToast: (listener: GenericListener<unknown>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on('app:toast', wrapped)
    return () => ipcRenderer.removeListener('app:toast', wrapped)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  reportPlayerState: (state: unknown) => ipcRenderer.send('player:state-changed', state),
  onPlayerControl: (listener: GenericListener<string>): Unsubscribe => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, action: string) => listener(action)
    ipcRenderer.on('player:control', wrapped)
    return () => ipcRenderer.removeListener('player:control', wrapped)
  }
})

export {}
