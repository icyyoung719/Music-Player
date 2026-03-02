// main.js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { parseFile } = require('music-metadata')

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: '🎵 Music Player',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true, // 安全最佳实践
      nodeIntegration: false
    }
  })

  win.loadFile(path.join(__dirname, '../renderer/index.html'))

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

// 主进程监听播放器控制指令
ipcMain.handle('play-audio', (event, filePath) => {
  console.log('Playing:', filePath)
})

// 解析音频文件元数据
ipcMain.handle('get-metadata', async (event, filePath) => {
  try {
    const metadata = await parseFile(filePath)
    const { common, format } = metadata

    // 将封面图片转为 base64 data URL
    let coverDataUrl = null
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0]
      const base64 = Buffer.from(pic.data).toString('base64')
      coverDataUrl = `data:${pic.format};base64,${base64}`
    }

    return {
      title: common.title || null,
      artist: common.artist || null,
      album: common.album || null,
      year: common.year || null,
      duration: format.duration || null,
      coverDataUrl
    }
  } catch (err) {
    console.error('Failed to parse metadata:', err)
    return null
  }
})
