// preload.js
const { contextBridge, ipcRenderer } = require('electron')

// 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  playAudio: (filePath) => ipcRenderer.invoke('play-audio', filePath),
  // 后续可扩展：pauseAudio, nextTrack, getMetadata 等
})