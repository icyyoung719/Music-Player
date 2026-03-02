// main.js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: '🎵 Music Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // 安全最佳实践
      nodeIntegration: false
    }
  })

  win.loadFile('index.html')
  
  // 开发时打开 DevTools
  // win.webContents.openDevTools()
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 示例：主进程监听播放器控制指令
ipcMain.handle('play-audio', (event, filePath) => {
  // 后续实现播放逻辑
  console.log('Playing:', filePath)
})