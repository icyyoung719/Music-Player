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
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  reportPlayerState: (state) => ipcRenderer.send('player:state-changed', state),
  onPlayerControl: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, action) => listener(action)
    ipcRenderer.on('player:control', wrapped)
    return () => ipcRenderer.removeListener('player:control', wrapped)
  }
})
