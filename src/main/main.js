// main.js
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { parseFile } = require('music-metadata')

let mainWindow = null
let tray = null
let isQuitting = false
let minimizeToTrayOnClose = true
let playbackState = {
  hasQueue: false,
  isPlaying: false,
  title: ''
}

let playlistState = {
  playlists: [],
  trackLibrary: {}
}

function getPlaylistStorePath() {
  return path.join(app.getPath('userData'), 'playlists.json')
}

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizePlaylistName(name) {
  const value = typeof name === 'string' ? name.trim() : ''
  return value || '未命名歌单'
}

function makeUniquePlaylistName(baseName, existingPlaylists, excludeId = null) {
  const base = normalizePlaylistName(baseName)
  const existing = new Set(
    existingPlaylists
      .filter(item => item.id !== excludeId)
      .map(item => (item.name || '').toLowerCase())
  )

  if (!existing.has(base.toLowerCase())) {
    return base
  }

  let i = 2
  while (existing.has(`${base} (${i})`.toLowerCase())) {
    i++
  }
  return `${base} (${i})`
}

function ensureStateShape(rawState) {
  const safeState = {
    playlists: Array.isArray(rawState?.playlists) ? rawState.playlists : [],
    trackLibrary:
      rawState?.trackLibrary && typeof rawState.trackLibrary === 'object'
        ? rawState.trackLibrary
        : {}
  }

  safeState.playlists = safeState.playlists.map(item => ({
    id: item?.id || createId(),
    name: normalizePlaylistName(item?.name),
    trackIds: Array.isArray(item?.trackIds)
      ? item.trackIds.filter(trackId => typeof trackId === 'string' && trackId)
      : []
  }))

  const normalizedLibrary = {}
  for (const [trackId, track] of Object.entries(safeState.trackLibrary)) {
    if (!trackId || typeof track !== 'object' || !track.path) continue
    normalizedLibrary[trackId] = {
      path: track.path,
      metadataCache:
        track.metadataCache && typeof track.metadataCache === 'object'
          ? track.metadataCache
          : {}
    }
  }

  safeState.trackLibrary = normalizedLibrary
  return safeState
}

async function savePlaylistState() {
  const storePath = getPlaylistStorePath()
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true })
  await fs.promises.writeFile(storePath, JSON.stringify(playlistState, null, 2), 'utf8')
}

async function loadPlaylistState() {
  const storePath = getPlaylistStorePath()
  try {
    const content = await fs.promises.readFile(storePath, 'utf8')
    const parsed = JSON.parse(content)
    playlistState = ensureStateShape(parsed)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to load playlists.json, reset to default:', err)
    }
    playlistState = ensureStateShape({ playlists: [], trackLibrary: {} })
    await savePlaylistState()
  }
}

function createTrackId(filePath, mtimeMs) {
  return crypto
    .createHash('sha1')
    .update(`${filePath}|${mtimeMs}`)
    .digest('hex')
}

async function upsertTrack(trackInput) {
  if (!trackInput || typeof trackInput.path !== 'string' || !trackInput.path.trim()) {
    return null
  }

  const resolvedPath = path.resolve(trackInput.path)
  let stat
  try {
    stat = await fs.promises.stat(resolvedPath)
  } catch {
    return null
  }

  const trackId = createTrackId(resolvedPath, stat.mtimeMs)
  const metadataCacheInput =
    trackInput.metadataCache && typeof trackInput.metadataCache === 'object'
      ? trackInput.metadataCache
      : {}

  playlistState.trackLibrary[trackId] = {
    path: resolvedPath,
    metadataCache: {
      title: metadataCacheInput.title || trackInput.title || path.basename(resolvedPath),
      artist: metadataCacheInput.artist || trackInput.artist || null,
      album: metadataCacheInput.album || trackInput.album || null,
      duration: metadataCacheInput.duration || trackInput.duration || null
    }
  }

  return trackId
}

function removeUnreferencedTracks() {
  const used = new Set()
  for (const playlist of playlistState.playlists) {
    for (const trackId of playlist.trackIds) {
      used.add(trackId)
    }
  }

  for (const trackId of Object.keys(playlistState.trackLibrary)) {
    if (!used.has(trackId)) {
      delete playlistState.trackLibrary[trackId]
    }
  }
}

function getPlaylistListPayload() {
  return {
    playlists: playlistState.playlists,
    trackLibrary: playlistState.trackLibrary
  }
}

async function addTracksToPlaylistInternal(playlistId, tracks) {
  const playlist = playlistState.playlists.find(item => item.id === playlistId)
  if (!playlist) {
    return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
  }

  const currentSet = new Set(playlist.trackIds)
  let addedCount = 0
  for (const track of tracks) {
    const trackId = await upsertTrack(track)
    if (!trackId || currentSet.has(trackId)) continue
    playlist.trackIds.push(trackId)
    currentSet.add(trackId)
    addedCount++
  }

  if (addedCount > 0) {
    await savePlaylistState()
  }

  return { ok: true, addedCount, playlist }
}

async function importPlaylistsFromObject(imported) {
  const incoming = ensureStateShape(imported)
  if (incoming.playlists.length === 0) {
    return { importedPlaylistCount: 0, importedTrackCount: 0 }
  }

  let importedTrackCount = 0
  let importedPlaylistCount = 0

  for (const incomingPlaylist of incoming.playlists) {
    const uniqueName = makeUniquePlaylistName(incomingPlaylist.name, playlistState.playlists)
    const newPlaylist = {
      id: createId(),
      name: uniqueName,
      trackIds: []
    }

    for (const trackId of incomingPlaylist.trackIds) {
      const sourceTrack = incoming.trackLibrary[trackId]
      if (!sourceTrack || !sourceTrack.path) continue

      const resultTrackId = await upsertTrack({
        path: sourceTrack.path,
        metadataCache: sourceTrack.metadataCache || {}
      })

      if (!resultTrackId || newPlaylist.trackIds.includes(resultTrackId)) continue
      newPlaylist.trackIds.push(resultTrackId)
      importedTrackCount++
    }

    playlistState.playlists.push(newPlaylist)
    importedPlaylistCount++
  }

  await savePlaylistState()
  return { importedPlaylistCount, importedTrackCount }
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

function getTrayIcon() {
  const iconPath = path.join(__dirname, '../../assets/tray.png')
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath)
  }

  // 16x16 simple white note-like icon fallback.
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAh1BMVEUAAAAAAAD///////////////////////////////////////////////////////////////////////8AAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9+fI3BAAAALHRSTlMAAQIDBAUGBwgJCwwNDhASExQVFhcYGRobHB0fICEiIyQlJicoKSorxvKzMgAAAFhJREFUGNNjYIACRkYGBhY2Dg4uJgYWNh4+ISExKSUtPSMzKzsnNy8/KLi4uPjE5OTk5BQUFJSMjI6OjA0MDAwMTEwMDAxMDAwAAAwAX0wR9jB6LwAAAAASUVORK5CYII='
  )
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

  // 开发时打开 DevTools
  // win.webContents.openDevTools()
}

app.whenReady().then(async () => {
  try {
    await loadPlaylistState()
  } catch (err) {
    console.error('Failed to initialize playlist state:', err)
  }

  createWindow()
  createTray()
  registerMediaShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (minimizeToTrayOnClose) return
    app.quit()
  }
})

app.on('will-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
})

// 主进程监听播放器控制指令
ipcMain.handle('play-audio', (event, filePath) => {
  console.log('Playing:', filePath)
})

ipcMain.on('player:state-changed', (event, state) => {
  playbackState = normalizePlaybackState(state)
  refreshTrayMenu()
})

// 打开文件夹，返回其中所有音频文件路径
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return []

  const folderPath = result.filePaths[0]
  const audioExtensions = ['.mp3', '.flac', '.aac', '.ogg', '.wav', '.m4a', '.opus', '.wma']
  try {
    const files = await fs.promises.readdir(folderPath)
    return files
      .filter(file => audioExtensions.includes(path.extname(file).toLowerCase()))
      .sort()
      .map(file => path.join(folderPath, file))
  } catch (err) {
    console.error('Failed to read folder:', err)
    return []
  }
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

ipcMain.handle('playlist:list', async () => {
  return getPlaylistListPayload()
})

ipcMain.handle('playlist:create', async (event, name) => {
  const uniqueName = makeUniquePlaylistName(name, playlistState.playlists)
  const newPlaylist = {
    id: createId(),
    name: uniqueName,
    trackIds: []
  }

  playlistState.playlists.push(newPlaylist)
  await savePlaylistState()
  return { ok: true, playlist: newPlaylist }
})

ipcMain.handle('playlist:rename', async (event, payloadOrId, maybeName) => {
  const payload =
    payloadOrId && typeof payloadOrId === 'object'
      ? payloadOrId
      : { playlistId: payloadOrId, name: maybeName }

  const playlist = playlistState.playlists.find(item => item.id === payload.playlistId)
  if (!playlist) {
    return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
  }

  playlist.name = makeUniquePlaylistName(payload.name, playlistState.playlists, playlist.id)
  await savePlaylistState()
  return { ok: true, playlist }
})

ipcMain.handle('playlist:delete', async (event, playlistId) => {
  const index = playlistState.playlists.findIndex(item => item.id === playlistId)
  if (index === -1) {
    return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
  }

  playlistState.playlists.splice(index, 1)
  removeUnreferencedTracks()
  await savePlaylistState()
  return { ok: true }
})

ipcMain.handle('playlist:addTracks', async (event, payload) => {
  const playlistId = payload?.playlistId
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
  return addTracksToPlaylistInternal(playlistId, tracks)
})

ipcMain.handle('playlist:removeTrack', async (event, payload) => {
  const playlist = playlistState.playlists.find(item => item.id === payload?.playlistId)
  if (!playlist) {
    return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
  }

  const prevLength = playlist.trackIds.length
  playlist.trackIds = playlist.trackIds.filter(trackId => trackId !== payload?.trackId)
  const removed = prevLength !== playlist.trackIds.length

  if (removed) {
    removeUnreferencedTracks()
    await savePlaylistState()
  }

  return { ok: true, removed, playlist }
})

ipcMain.handle('playlist:export', async (event, playlistId) => {
  const playlist = playlistState.playlists.find(item => item.id === playlistId)
  if (!playlist) {
    return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
  }

  const defaultFileName = `${playlist.name.replace(/[\\/:*?"<>|]/g, '_') || 'playlist'}.json`
  const saveResult = await dialog.showSaveDialog({
    title: '导出歌单',
    defaultPath: defaultFileName,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, canceled: true }
  }

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists: [playlist],
    trackLibrary: {}
  }

  for (const trackId of playlist.trackIds) {
    if (playlistState.trackLibrary[trackId]) {
      exportData.trackLibrary[trackId] = playlistState.trackLibrary[trackId]
    }
  }

  await fs.promises.writeFile(saveResult.filePath, JSON.stringify(exportData, null, 2), 'utf8')
  return { ok: true, filePath: saveResult.filePath }
})

ipcMain.handle('playlist:import', async () => {
  const openResult = await dialog.showOpenDialog({
    title: '导入歌单',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { ok: false, canceled: true }
  }

  try {
    const importPath = openResult.filePaths[0]
    const content = await fs.promises.readFile(importPath, 'utf8')
    const parsed = JSON.parse(content)
    const importResult = await importPlaylistsFromObject(parsed)
    return { ok: true, ...importResult }
  } catch (err) {
    console.error('Failed to import playlist JSON:', err)
    return { ok: false, error: 'IMPORT_FAILED' }
  }
})
