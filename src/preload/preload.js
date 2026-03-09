// preload.js
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  playAudio: (filePath) => ipcRenderer.invoke('play-audio', filePath),
  getMetadata: (filePath) => ipcRenderer.invoke('get-metadata', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  playlistList: () => ipcRenderer.invoke('playlist:list'),
  playlistCreate: (name) => ipcRenderer.invoke('playlist:create', name),
  playlistRename: (playlistId, name) => ipcRenderer.invoke('playlist:rename', { playlistId, name }),
  playlistDelete: (playlistId) => ipcRenderer.invoke('playlist:delete', playlistId),
  playlistAddTracks: (playlistId, tracks) => ipcRenderer.invoke('playlist:addTracks', { playlistId, tracks }),
  playlistRemoveTrack: (playlistId, trackId) => ipcRenderer.invoke('playlist:removeTrack', { playlistId, trackId }),
  playlistImport: () => ipcRenderer.invoke('playlist:import'),
  playlistExport: (playlistId) => ipcRenderer.invoke('playlist:export', playlistId),
  neteaseResolveId: (payload) => ipcRenderer.invoke('netease:resolve-id', payload),
  neteaseOpenPage: (payload) => ipcRenderer.invoke('netease:open-page', payload),
  neteaseOpenExternalUrl: (payload) => ipcRenderer.invoke('netease:open-external-url', payload),
  neteaseGetDownloadDir: () => ipcRenderer.invoke('netease:get-download-dir'),
  neteaseDownloadDirect: (payload) => ipcRenderer.invoke('netease:download-direct', payload),
  neteaseAuthGetState: () => ipcRenderer.invoke('netease:auth:get-state'),
  neteaseAuthUpdate: (payload) => ipcRenderer.invoke('netease:auth:update', payload),
  neteaseAuthLoginEmail: (payload) => ipcRenderer.invoke('netease:auth:login-email', payload),
  neteaseAuthSendCaptcha: (payload) => ipcRenderer.invoke('netease:auth:send-captcha', payload),
  neteaseAuthLoginCaptcha: (payload) => ipcRenderer.invoke('netease:auth:login-captcha', payload),
  neteaseAuthQrCreate: (payload) => ipcRenderer.invoke('netease:auth:qr:create', payload),
  neteaseAuthQrCheck: (payload) => ipcRenderer.invoke('netease:auth:qr:check', payload),
  neteaseAuthClear: () => ipcRenderer.invoke('netease:auth:clear'),
  neteaseAuthVerify: () => ipcRenderer.invoke('netease:auth:verify'),
  neteaseAuthOpenWindow: (payload) => ipcRenderer.invoke('netease:auth:open-window', payload),
  neteaseAuthCloseWindow: () => ipcRenderer.send('netease:auth-window:close'),
  onNeteaseAuthWindowSetPage: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, page) => listener(page)
    ipcRenderer.on('netease:auth-window:set-page', wrapped)
    return () => ipcRenderer.removeListener('netease:auth-window:set-page', wrapped)
  },
  neteaseAuthRequest: (payload) => ipcRenderer.invoke('netease:auth:request', payload),
  neteaseResolveSongDownloadUrl: (payload) => ipcRenderer.invoke('netease:resolve-song-download-url', payload),
  neteaseDownloadBySongId: (payload) => ipcRenderer.invoke('netease:download-by-song-id', payload),
  neteaseDownloadTaskList: () => ipcRenderer.invoke('netease:download-task:list'),
  neteaseDownloadTaskCancel: (payload) => ipcRenderer.invoke('netease:download-task:cancel', payload),
  onNeteaseDownloadTaskUpdate: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, task) => listener(task)
    ipcRenderer.on('netease:download-task-updated', wrapped)
    return () => ipcRenderer.removeListener('netease:download-task-updated', wrapped)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  reportPlayerState: (state) => ipcRenderer.send('player:state-changed', state),
  onPlayerControl: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, action) => listener(action)
    ipcRenderer.on('player:control', wrapped)
    return () => ipcRenderer.removeListener('player:control', wrapped)
  }
})
