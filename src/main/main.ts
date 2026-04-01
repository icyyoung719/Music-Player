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
const { initializeLogger, logProgramEvent } = require('./modules/logger')

initializeLogger()

registerPlaylistHandlers()
registerNeteaseHandlers()

app.whenReady().then(async () => {
  logProgramEvent({
    source: 'main',
    event: 'app-ready',
    message: 'Electron app is ready'
  })

  try {
    await initializePlaylistState()
  } catch (err) {
    logProgramEvent({
      source: 'main',
      event: 'playlist-init-failed',
      message: 'Failed to initialize playlist state',
      error: err
    })
  }

  createMainWindow()
  initializeShell()

  app.on('activate', handleActivate)
})

app.on('window-all-closed', () => {
  logProgramEvent({
    source: 'main',
    event: 'window-all-closed',
    message: 'All windows are closed'
  })

  if (process.platform !== 'darwin') {
    if (shouldKeepAliveOnWindowAllClosed()) return
    app.quit()
  }
})

app.on('will-quit', handleWillQuit)
