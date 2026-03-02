// preload.js
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  playAudio: (filePath) => ipcRenderer.invoke('play-audio', filePath),
  getMetadata: (filePath) => ipcRenderer.invoke('get-metadata', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file)
})
