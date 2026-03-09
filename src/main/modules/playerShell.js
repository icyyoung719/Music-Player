const { BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow = null
let authWindow = null
let tray = null
let isQuitting = false
let minimizeToTrayOnClose = true
let shellPreferencesLoaded = false
let playbackState = {
  hasQueue: false,
  isPlaying: false,
  title: ''
}
let stateListenerRegistered = false

function getShellPreferencesPath() {
  return path.join(app.getPath('userData'), 'shell-preferences.json')
}

function loadShellPreferences() {
  if (shellPreferencesLoaded) return
  shellPreferencesLoaded = true

  const storePath = getShellPreferencesPath()
  try {
    if (!fs.existsSync(storePath)) return
    const content = fs.readFileSync(storePath, 'utf8')
    const parsed = JSON.parse(content)
    if (typeof parsed?.minimizeToTrayOnClose === 'boolean') {
      minimizeToTrayOnClose = parsed.minimizeToTrayOnClose
    }
  } catch (err) {
    console.error('Failed to load shell preferences:', err)
  }
}

function saveShellPreferences() {
  const storePath = getShellPreferencesPath()
  const payload = {
    minimizeToTrayOnClose
  }

  fs.promises
    .mkdir(path.dirname(storePath), { recursive: true })
    .then(() => fs.promises.writeFile(storePath, JSON.stringify(payload, null, 2), 'utf8'))
    .catch((err) => {
      console.error('Failed to save shell preferences:', err)
    })
}

function getActiveWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  return focused || mainWindow
}

function sendPlayerControl(action) {
  const target = getActiveWindow()
  if (!target || target.isDestroyed()) return
  target.webContents.send('player:control', action)
}

function normalizePlaybackState(nextState) {
  return {
    hasQueue: !!nextState?.hasQueue,
    isPlaying: !!nextState?.isPlaying,
    title: typeof nextState?.title === 'string' ? nextState.title : ''
  }
}

function getAssetImage(assetFileName, size = null) {
  const assetPath = path.join(__dirname, '../../../assets/icons', assetFileName)
  if (!fs.existsSync(assetPath)) {
    return null
  }

  const img = nativeImage.createFromPath(assetPath)
  if (img.isEmpty()) {
    return null
  }

  if (size && typeof size.width === 'number' && typeof size.height === 'number') {
    return img.resize({ width: size.width, height: size.height })
  }

  return img
}

function getTrayIcon() {
  const trayIco = getAssetImage('tray.ico')
  if (trayIco) {
    return trayIco
  }

  const trayPng = getAssetImage('tray.png')
  if (trayPng) {
    return trayPng
  }

  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAh1BMVEUAAAAAAAD///////////////////////////////////////////////////////////////////////8AAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9+fI3BAAAALHRSTlMAAQIDBAUGBwgJCwwNDhASExQVFhcYGRobHB0fICEiIyQlJicoKSorxvKzMgAAAFhJREFUGNNjYIACRkYGBhY2Dg4uJgYWNh4+ISExKSUtPSMzKzsnNy8/KLi4uPjE5OTk5BQUFJSMjI6OjA0MDAwMTEwMDAxMDAwAAAwAX0wR9jB6LwAAAAASUVORK5CYII='
  )
}

function getThumbarIcon(action, active = false) {
  const size = { width: 16, height: 16 }

  if (action === 'previous-track') {
    return getAssetImage('thumbar-prev.png', size)
  }

  if (action === 'next-track') {
    return getAssetImage('thumbar-next.png', size)
  }

  if (action === 'pause') {
    return getAssetImage('thumbar-pause.png', size)
  }

  const playIcon = active
    ? getAssetImage('thumbar-play-active.png', size) || getAssetImage('thumbar-play.png', size)
    : getAssetImage('thumbar-play.png', size)

  return playIcon
}

function refreshThumbarButtons() {
  if (process.platform !== 'win32') return
  if (!mainWindow || mainWindow.isDestroyed()) return

  const isPlaying = playbackState.hasQueue && playbackState.isPlaying

  mainWindow.setThumbarButtons([
    {
      tooltip: '上一首',
      icon: getThumbarIcon('previous-track'),
      click: () => sendPlayerControl('previous-track'),
      flags: []
    },
    {
      tooltip: isPlaying ? '暂停' : '播放',
      icon: getThumbarIcon(isPlaying ? 'pause' : 'play', true),
      click: () => sendPlayerControl('toggle-play'),
      flags: []
    },
    {
      tooltip: '下一首',
      icon: getThumbarIcon('next-track'),
      click: () => sendPlayerControl('next-track'),
      flags: []
    }
  ])
}

function buildTrayMenu() {
  const playPauseLabel = playbackState.isPlaying ? '暂停' : '播放'
  const playPauseEnabled = playbackState.hasQueue

  return Menu.buildFromTemplate([
    {
      label: playPauseLabel,
      enabled: playPauseEnabled,
      click: () => sendPlayerControl('toggle-play')
    },
    {
      label: '上一首',
      enabled: playbackState.hasQueue,
      click: () => sendPlayerControl('previous-track')
    },
    {
      label: '下一首',
      enabled: playbackState.hasQueue,
      click: () => sendPlayerControl('next-track')
    },
    { type: 'separator' },
    {
      label: '点击关闭时最小化到托盘',
      type: 'checkbox',
      checked: minimizeToTrayOnClose,
      click: (menuItem) => {
        minimizeToTrayOnClose = menuItem.checked
        saveShellPreferences()
      }
    },
    {
      label: '显示主窗口',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

function refreshTrayMenu() {
  if (!tray) return
  const nowPlaying = playbackState.title || 'Music Player'
  tray.setToolTip(playbackState.hasQueue ? `Music Player - ${nowPlaying}` : 'Music Player')
  tray.setContextMenu(buildTrayMenu())
  refreshThumbarButtons()
}

function createTray() {
  if (tray) return

  tray = new Tray(getTrayIcon())
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  refreshTrayMenu()
}

function registerMediaShortcuts() {
  const bindings = [
    ['MediaPlayPause', 'toggle-play'],
    ['MediaNextTrack', 'next-track'],
    ['MediaPreviousTrack', 'previous-track']
  ]

  for (const [accelerator, action] of bindings) {
    try {
      const ok = globalShortcut.register(accelerator, () => sendPlayerControl(action))
      if (!ok) {
        console.warn(`Failed to register media shortcut: ${accelerator}`)
      }
    } catch (err) {
      console.warn(`Failed to register media shortcut: ${accelerator}`, err)
    }
  }
}

function createMainWindow() {
  loadShellPreferences()

  const appIconPath = path.join(__dirname, '../../../assets/icons/app-icon.png')

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: '🎵 Music Player',
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Remove default Electron menu bar (File/Edit/View...) for a cleaner player UI.
  win.removeMenu()

  win.loadFile(path.join(__dirname, '../../renderer/index.html'))

  win.on('close', (event) => {
    if (isQuitting || !minimizeToTrayOnClose) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  mainWindow = win
  refreshThumbarButtons()
  return win
}

function getAuthWindowStartPage(payload) {
  const page = String(payload?.page || '').trim().toLowerCase()
  const supportedPages = new Set(['email', 'phone', 'qr', 'token'])
  return supportedPages.has(page) ? page : 'email'
}

function openNeteaseAuthWindow(payload = {}) {
  const startPage = getAuthWindowStartPage(payload)

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.webContents.send('netease:auth-window:set-page', startPage)
    authWindow.show()
    authWindow.focus()
    return { ok: true }
  }

  const win = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 620,
    minHeight: 540,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    autoHideMenuBar: true,
    title: '网易云登录',
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.removeMenu()
  win.loadFile(path.join(__dirname, '../../renderer/auth-window.html'), {
    query: { page: startPage }
  })

  win.on('closed', () => {
    if (authWindow === win) {
      authWindow = null
    }
  })

  authWindow = win
  return { ok: true }
}

function initializeShell() {
  createTray()
  registerMediaShortcuts()

  if (!stateListenerRegistered) {
    stateListenerRegistered = true
    ipcMain.on('player:state-changed', (event, state) => {
      playbackState = normalizePlaybackState(state)
      refreshTrayMenu()
    })

    ipcMain.handle('window:minimize', () => {
      const target = getActiveWindow()
      if (!target || target.isDestroyed()) {
        return { ok: false }
      }

      target.minimize()
      return { ok: true }
    })

    ipcMain.handle('netease:auth:open-window', (_event, payload) => {
      try {
        return openNeteaseAuthWindow(payload)
      } catch (err) {
        console.error('Failed to open NetEase auth window:', err)
        return { ok: false, error: 'OPEN_AUTH_WINDOW_FAILED' }
      }
    })

    ipcMain.on('netease:auth-window:close', () => {
      if (!authWindow || authWindow.isDestroyed()) return
      authWindow.close()
    })
  }
}

function handleActivate() {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function shouldKeepAliveOnWindowAllClosed() {
  return minimizeToTrayOnClose
}

function handleWillQuit() {
  isQuitting = true
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.destroy()
    authWindow = null
  }
  globalShortcut.unregisterAll()
}

module.exports = {
  createMainWindow,
  initializeShell,
  handleActivate,
  shouldKeepAliveOnWindowAllClosed,
  handleWillQuit
}
