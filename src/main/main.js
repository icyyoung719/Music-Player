const { app } = require('electron')
const {
  createMainWindow,
  initializeShell,
  handleActivate,
  shouldKeepAliveOnWindowAllClosed,
  handleWillQuit
} = require('./modules/playerShell')
const {
  initializePlaylistState,
  registerPlaylistHandlers
} = require('./modules/playlistHandlers')
const { registerNeteaseHandlers } = require('./modules/neteaseHandlers')

registerPlaylistHandlers()
registerNeteaseHandlers()

app.whenReady().then(async () => {
  try {
    await initializePlaylistState()
  } catch (err) {
    console.error('Failed to initialize playlist state:', err)
  }

  createMainWindow()
  initializeShell()

  app.on('activate', handleActivate)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (shouldKeepAliveOnWindowAllClosed()) return
    app.quit()
  }
})

app.on('will-quit', handleWillQuit)
