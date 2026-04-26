const { BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, app } = require('electron') as typeof import('electron')
const path = require('path') as typeof import('path')
const fs = require('fs') as typeof import('fs')
const { logProgramEvent } = require('./logger') as {
  logProgramEvent: (payload: {
    source?: string
    event?: string
    message?: string
    data?: unknown
    error?: unknown
  }) => void
}

type PlaybackState = {
  hasQueue: boolean
  isPlaying: boolean
  title: string
}

type ShellPreferences = {
  minimizeToTrayOnClose?: boolean
}

type AuthWindowPayload = {
  page?: string
}

let mainWindow: Electron.BrowserWindow | null = null
let authWindow: Electron.BrowserWindow | null = null
let tray: Electron.Tray | null = null
let isQuitting = false
let minimizeToTrayOnClose = true
let shellPreferencesLoaded = false
let playbackState: PlaybackState = {
  hasQueue: false,
  isPlaying: false,
  title: ''
}
let stateListenerRegistered = false

function getShellPreferencesPath(): string {
  return path.join(app.getPath('userData'), 'shell-preferences.json')
}

function loadShellPreferences(): void {
  if (shellPreferencesLoaded) return
  shellPreferencesLoaded = true

  const storePath = getShellPreferencesPath()
  try {
    if (!fs.existsSync(storePath)) return
    const content = fs.readFileSync(storePath, 'utf8')
    const parsed = JSON.parse(content) as ShellPreferences
    if (typeof parsed?.minimizeToTrayOnClose === 'boolean') {
      minimizeToTrayOnClose = parsed.minimizeToTrayOnClose
    }
  } catch (err) {
    logProgramEvent({
      source: 'playerShell',
      event: 'load-shell-preferences-failed',
      message: 'Failed to load shell preferences',
      error: err
    })
  }
}

function saveShellPreferences(): void {
  const storePath = getShellPreferencesPath()
  const payload = {
    minimizeToTrayOnClose
  }

  void fs.promises
    .mkdir(path.dirname(storePath), { recursive: true })
    .then(() => fs.promises.writeFile(storePath, JSON.stringify(payload, null, 2), 'utf8'))
    .catch((err: unknown) => {
      logProgramEvent({
        source: 'playerShell',
        event: 'save-shell-preferences-failed',
        message: 'Failed to save shell preferences',
        error: err
      })
    })
}

function getActiveWindow(): Electron.BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  return focused || mainWindow
}

function sendPlayerControl(action: string): void {
  const target = getActiveWindow()
  if (!target || target.isDestroyed()) return
  target.webContents.send('player:control', action)
}

function normalizePlaybackState(nextState: unknown): PlaybackState {
  const typed = nextState as PlaybackState | null | undefined
  return {
    hasQueue: !!typed?.hasQueue,
    isPlaying: !!typed?.isPlaying,
    title: typeof typed?.title === 'string' ? typed.title : ''
  }
}

function getAssetImage(assetFileName: string, size: { width: number; height: number } | null = null): Electron.NativeImage | null {
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

function getTrayIcon(): Electron.NativeImage {
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

function getThumbarIcon(action: string, active = false): Electron.NativeImage | null {
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

function getThumbarIconOrEmpty(action: string, active = false): Electron.NativeImage {
  return getThumbarIcon(action, active) || nativeImage.createEmpty()
}

function refreshThumbarButtons(): void {
  if (process.platform !== 'win32') return
  if (!mainWindow || mainWindow.isDestroyed()) return

  const isPlaying = playbackState.hasQueue && playbackState.isPlaying

  mainWindow.setThumbarButtons([
    {
      tooltip: '上一首',
      icon: getThumbarIconOrEmpty('previous-track'),
      click: () => sendPlayerControl('previous-track'),
      flags: []
    },
    {
      tooltip: isPlaying ? '暂停' : '播放',
      icon: getThumbarIconOrEmpty(isPlaying ? 'pause' : 'play', true),
      click: () => sendPlayerControl('toggle-play'),
      flags: []
    },
    {
      tooltip: '下一首',
      icon: getThumbarIconOrEmpty('next-track'),
      click: () => sendPlayerControl('next-track'),
      flags: []
    }
  ])
}

function buildTrayMenu(): Electron.Menu {
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
      click: (menuItem: Electron.MenuItem) => {
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

function refreshTrayMenu(): void {
  if (!tray) return
  const nowPlaying = playbackState.title || 'Music Player'
  tray.setToolTip(playbackState.hasQueue ? `Music Player - ${nowPlaying}` : 'Music Player')
  tray.setContextMenu(buildTrayMenu())
  refreshThumbarButtons()
}

function createTray(): void {
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

function registerMediaShortcuts(): void {
  const bindings: Array<[string, string]> = [
    ['MediaPlayPause', 'toggle-play'],
    ['MediaNextTrack', 'next-track'],
    ['MediaPreviousTrack', 'previous-track']
  ]

  for (const [accelerator, action] of bindings) {
    try {
      const ok = globalShortcut.register(accelerator, () => sendPlayerControl(action))
      if (!ok) {
        logProgramEvent({
          source: 'playerShell',
          event: 'register-media-shortcut-failed',
          message: `Failed to register media shortcut: ${accelerator}`,
          data: { accelerator }
        })
      }
    } catch (err) {
      logProgramEvent({
        source: 'playerShell',
        event: 'register-media-shortcut-exception',
        message: `Failed to register media shortcut: ${accelerator}`,
        data: { accelerator },
        error: err
      })
    }
  }
}

function createMainWindow(): Electron.BrowserWindow {
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

  win.removeMenu()

  void win.loadFile(path.join(__dirname, '../../renderer/index.html'))

  win.on('close', (event: Electron.Event) => {
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

function getAuthWindowStartPage(payload: AuthWindowPayload): 'email' | 'phone' | 'qr' | 'token' {
  const page = String(payload?.page || '').trim().toLowerCase()
  const supportedPages = new Set(['email', 'phone', 'qr', 'token'])
  return supportedPages.has(page) ? (page as 'email' | 'phone' | 'qr' | 'token') : 'email'
}

function openNeteaseAuthWindow(payload: AuthWindowPayload = {}): { ok: boolean; error?: string } {
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
  void win.loadFile(path.join(__dirname, '../../renderer/auth-window.html'), {
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

function initializeShell(): void {
  createTray()
  registerMediaShortcuts()

  if (!stateListenerRegistered) {
    stateListenerRegistered = true
    ipcMain.on('player:state-changed', (_event: Electron.IpcMainEvent, state: unknown) => {
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

    ipcMain.handle('netease:auth:open-window', (_event: Electron.IpcMainInvokeEvent, payload: AuthWindowPayload) => {
      try {
        return openNeteaseAuthWindow(payload)
      } catch (err) {
        logProgramEvent({
          source: 'playerShell',
          event: 'open-auth-window-failed',
          message: 'Failed to open NetEase auth window',
          error: err
        })
        return { ok: false, error: 'OPEN_AUTH_WINDOW_FAILED' }
      }
    })

    ipcMain.on('netease:auth-window:close', () => {
      if (!authWindow || authWindow.isDestroyed()) return
      authWindow.close()
    })
  }
}

function handleActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function shouldKeepAliveOnWindowAllClosed(): boolean {
  return minimizeToTrayOnClose
}

function handleWillQuit(): void {
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

export {}
