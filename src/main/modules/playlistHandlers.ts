const { ipcMain, dialog, app } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { parseFile } = require('music-metadata')
const { logProgramEvent } = require('./logger')

const NETEASE_TRACK_METADATA_STORE_NAME = 'netease-track-metadata.json'
const PLAYLIST_SCHEMA_VERSION = 2

type PlaylistState = {
  schemaVersion: number
  playlists: any[]
  trackLibrary: Record<string, any>
}

let playlistState: PlaylistState = {
  schemaVersion: PLAYLIST_SCHEMA_VERSION,
  playlists: [],
  trackLibrary: {}
}

let handlersRegistered = false

function getPlaylistStorePath(): string {
  return path.join(app.getPath('userData'), 'playlists.json')
}

function getNeteaseTrackMetadataStorePath(): string {
  return path.join(app.getPath('userData'), NETEASE_TRACK_METADATA_STORE_NAME)
}

function normalizeTrackPathKey(filePath: unknown): string {
  const resolved = path.resolve(String(filePath || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function resolveImageMimeByPath(filePath: unknown): string {
  const ext = String(path.extname(filePath || '')).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function readNeteaseTrackMetadataByPath(filePath: unknown): Promise<any | null> {
  try {
    const content = await fs.promises.readFile(getNeteaseTrackMetadataStorePath(), 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed[normalizeTrackPathKey(filePath)]
    return record && typeof record === 'object' ? record : null
  } catch {
    return null
  }
}

async function readCoverDataUrlByPath(coverPath: unknown): Promise<string | null> {
  if (!coverPath) return null
  try {
    const buffer = await fs.promises.readFile(coverPath)
    if (!buffer.length) return null
    const mime = resolveImageMimeByPath(coverPath)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

function normalizeLyricsValue(value: any): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const text = item.trim()
        if (text) return text
        continue
      }

      if (item && typeof item === 'object' && typeof item.text === 'string') {
        const text = item.text.trim()
        if (text) return text
      }
    }
    return null
  }

  if (value && typeof value === 'object' && typeof value.text === 'string') {
    const text = value.text.trim()
    return text || null
  }

  return null
}

function hasLrcTimestamp(lyricsText: unknown): boolean {
  const text = String(lyricsText || '')
  return /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(text)
}

function chooseBestLyrics(primary: any, fallback: any): string | null {
  const first = normalizeLyricsValue(primary)
  const second = normalizeLyricsValue(fallback)

  if (hasLrcTimestamp(first)) return first
  if (hasLrcTimestamp(second)) return second
  return first || second || null
}

function createId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizePlaylistName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : ''
  return value || '未命名歌单'
}

function makeUniquePlaylistName(baseName: unknown, existingPlaylists: any[], excludeId: string | null = null): string {
  const base = normalizePlaylistName(baseName)
  const existing = new Set(
    existingPlaylists
      .filter((item: any) => item.id !== excludeId)
      .map((item: any) => (item.name || '').toLowerCase())
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

function ensureStateShape(rawState: any): PlaylistState {
  const normalizedVersion = Number(rawState?.schemaVersion)
  const schemaVersion = Number.isFinite(normalizedVersion)
    ? Math.max(1, Math.trunc(normalizedVersion))
    : 1

  const normalizeText = (value: any, maxLen: number = 512): string => String(value || '').trim().slice(0, maxLen)

  const normalizeTags = (value: any): string[] => {
    if (!Array.isArray(value)) return []
    const deduped = new Set<string>()
    for (const item of value) {
      const text = normalizeText(item, 40)
      if (!text) continue
      deduped.add(text)
    }
    return Array.from(deduped).slice(0, 20)
  }

  const normalizeCreator = (value: any): any => {
    if (!value || typeof value !== 'object') return null
    const userId = normalizeText(value.userId, 64)
    const nickname = normalizeText(value.nickname, 64)
    if (!userId && !nickname) return null
    return {
      userId,
      nickname
    }
  }

  const normalizeDateText = (value: any): string => {
    const text = normalizeText(value, 64)
    if (!text) return ''
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString()
  }

  const normalizePlaylistMeta = (item: any): any => {
    const source = normalizeText(item?.source, 24).toLowerCase() || 'local'
    const platform = normalizeText(item?.platform, 24).toLowerCase() || 'local'
    return {
      source,
      platform,
      platformPlaylistId: normalizeText(item?.platformPlaylistId, 80),
      creator: normalizeCreator(item?.creator),
      coverUrl: normalizeText(item?.coverUrl, 2048),
      description: normalizeText(item?.description, 1024),
      updateTime: normalizeDateText(item?.updateTime),
      tags: normalizeTags(item?.tags)
    }
  }

  const safeState: PlaylistState = {
    schemaVersion: PLAYLIST_SCHEMA_VERSION,
    playlists: Array.isArray(rawState?.playlists) ? rawState.playlists : [],
    trackLibrary:
      rawState?.trackLibrary && typeof rawState.trackLibrary === 'object'
        ? rawState.trackLibrary
        : {}
  }

  safeState.playlists = safeState.playlists.map((item: any) => ({
    id: item?.id || createId(),
    name: normalizePlaylistName(item?.name),
    trackIds: Array.isArray(item?.trackIds)
      ? item.trackIds.filter((trackId: any) => typeof trackId === 'string' && trackId)
      : [],
    ...normalizePlaylistMeta(item)
  }))

  // Legacy migration path (schemaVersion < 2): fill missing NetEase-aligned optional fields.
  if (schemaVersion < 2) {
    safeState.playlists = safeState.playlists.map((item) => ({
      ...item,
      source: item.source || 'local',
      platform: item.platform || 'local',
      platformPlaylistId: item.platformPlaylistId || '',
      creator: item.creator || null,
      coverUrl: item.coverUrl || '',
      description: item.description || '',
      updateTime: item.updateTime || new Date().toISOString(),
      tags: Array.isArray(item.tags) ? item.tags : []
    }))
  }

  const normalizedLibrary: Record<string, any> = {}
  for (const [trackId, track] of Object.entries(safeState.trackLibrary)) {
    if (!trackId || typeof track !== 'object' || !(track as any).path) continue
    normalizedLibrary[trackId] = {
      path: (track as any).path,
      metadataCache:
        (track as any).metadataCache && typeof (track as any).metadataCache === 'object'
          ? (track as any).metadataCache
          : {}
    }
  }

  safeState.trackLibrary = normalizedLibrary
  return safeState
}

async function savePlaylistState(): Promise<void> {
  const storePath = getPlaylistStorePath()
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true })
  await fs.promises.writeFile(storePath, JSON.stringify(playlistState, null, 2), 'utf8')
}

async function initializePlaylistState(): Promise<void> {
  const storePath = getPlaylistStorePath()
  try {
    const content = await fs.promises.readFile(storePath, 'utf8')
    const parsed = JSON.parse(content)
    playlistState = ensureStateShape(parsed)

    const parsedVersion = Number(parsed?.schemaVersion)
    if (!Number.isFinite(parsedVersion) || Math.trunc(parsedVersion) !== PLAYLIST_SCHEMA_VERSION) {
      await savePlaylistState()
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      logProgramEvent({
        source: 'playlistHandlers',
        event: 'load-playlist-store-failed',
        message: 'Failed to load playlists.json, reset to default',
        error: err
      })
    }
    playlistState = ensureStateShape({ schemaVersion: PLAYLIST_SCHEMA_VERSION, playlists: [], trackLibrary: {} })
    await savePlaylistState()
  }
}

function createTrackId(filePath: string, mtimeMs: number): string {
  return crypto
    .createHash('sha1')
    .update(`${filePath}|${mtimeMs}`)
    .digest('hex')
}

async function upsertTrack(trackInput: any): Promise<string | null> {
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

function removeUnreferencedTracks(): void {
  const used = new Set<string>()
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

function getPlaylistListPayload(): PlaylistState {
  return {
    schemaVersion: playlistState.schemaVersion,
    playlists: playlistState.playlists,
    trackLibrary: playlistState.trackLibrary
  }
}

async function addTracksToPlaylistInternal(playlistId: string, tracks: any[]): Promise<any> {
  const playlist = playlistState.playlists.find((item: any) => item.id === playlistId)
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

async function importPlaylistsFromObject(imported: any): Promise<{ importedPlaylistCount: number; importedTrackCount: number }> {
  const incoming = ensureStateShape(imported)
  if (incoming.playlists.length === 0) {
    return { importedPlaylistCount: 0, importedTrackCount: 0 }
  }

  let importedTrackCount = 0
  let importedPlaylistCount = 0

  for (const incomingPlaylist of incoming.playlists) {
    const uniqueName = makeUniquePlaylistName(incomingPlaylist.name, playlistState.playlists)
    const newPlaylist: any = {
      id: createId(),
      name: uniqueName,
      trackIds: [] as string[],
      source: incomingPlaylist.source || 'local',
      platform: incomingPlaylist.platform || 'local',
      platformPlaylistId: incomingPlaylist.platformPlaylistId || '',
      creator: incomingPlaylist.creator || null,
      coverUrl: incomingPlaylist.coverUrl || '',
      description: incomingPlaylist.description || '',
      updateTime: incomingPlaylist.updateTime || new Date().toISOString(),
      tags: Array.isArray(incomingPlaylist.tags) ? incomingPlaylist.tags : []
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

function registerPlaylistHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('play-audio', (event: any, filePath: string) => {
    logProgramEvent({
      source: 'playlistHandlers',
      event: 'play-audio',
      message: 'Play audio event received',
      data: { filePath: String(filePath || '') }
    })
  })

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
        .filter((file: string) => audioExtensions.includes(path.extname(file).toLowerCase()))
        .sort()
        .map((file: string) => path.join(folderPath, file))
    } catch (err: any) {
      logProgramEvent({
        source: 'playlistHandlers',
        event: 'read-folder-failed',
        message: 'Failed to read selected folder',
        error: err,
        data: { folderPath }
      })
      return []
    }
  })

  ipcMain.handle('get-metadata', async (event: any, filePath: string) => {
    let parsedMeta = null
    try {
      const metadata = await parseFile(filePath)
      const { common, format } = metadata

      let coverDataUrl = null
      if (common.picture && common.picture.length > 0) {
        const pic = common.picture[0]
        const base64 = Buffer.from(pic.data).toString('base64')
        coverDataUrl = `data:${pic.format};base64,${base64}`
      }

      parsedMeta = {
        title: common.title || null,
        artist: common.artist || null,
        album: common.album || null,
        year: common.year || null,
        lyrics: normalizeLyricsValue(common.lyrics),
        duration: format.duration || null,
        coverDataUrl
      }
    } catch (err: any) {
      logProgramEvent({
        source: 'playlistHandlers',
        event: 'parse-metadata-failed',
        message: 'Failed to parse audio metadata',
        error: err,
        data: { filePath: String(filePath || '') }
      })
    }

    const fallback = await readNeteaseTrackMetadataByPath(filePath)
    const fallbackCoverDataUrl = await readCoverDataUrlByPath(fallback?.coverPath)

    const merged = {
      title: parsedMeta?.title || fallback?.title || null,
      artist: parsedMeta?.artist || fallback?.artist || null,
      album: parsedMeta?.album || fallback?.album || null,
      year: parsedMeta?.year || fallback?.year || null,
      lyrics: chooseBestLyrics(parsedMeta?.lyrics, fallback?.lyrics),
      duration: parsedMeta?.duration || null,
      coverDataUrl: parsedMeta?.coverDataUrl || fallbackCoverDataUrl || null
    }

    const hasMeaningfulField =
      Boolean(merged.title) ||
      Boolean(merged.artist) ||
      Boolean(merged.album) ||
      Boolean(merged.year) ||
      Boolean(merged.lyrics) ||
      Boolean(merged.duration) ||
      Boolean(merged.coverDataUrl)

    return hasMeaningfulField ? merged : null
  })

  ipcMain.handle('playlist:list', async () => {
    return getPlaylistListPayload()
  })

  ipcMain.handle('playlist:create', async (event: any, name: string) => {
    const uniqueName = makeUniquePlaylistName(name, playlistState.playlists)
    const newPlaylist = {
      id: createId(),
      name: uniqueName,
      trackIds: [],
      source: 'local',
      platform: 'local',
      platformPlaylistId: '',
      creator: null,
      coverUrl: '',
      description: '',
      updateTime: new Date().toISOString(),
      tags: []
    }

    playlistState.playlists.push(newPlaylist)
    await savePlaylistState()
    return { ok: true, playlist: newPlaylist }
  })

  ipcMain.handle('playlist:rename', async (event: any, payloadOrId: any, maybeName: any) => {
    const payload =
      payloadOrId && typeof payloadOrId === 'object'
        ? payloadOrId
        : { playlistId: payloadOrId, name: maybeName }

    const playlist = playlistState.playlists.find((item: any) => item.id === payload.playlistId)
    if (!playlist) {
      return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
    }

    playlist.name = makeUniquePlaylistName(payload.name, playlistState.playlists, playlist.id)
    playlist.updateTime = new Date().toISOString()
    await savePlaylistState()
    return { ok: true, playlist }
  })

  ipcMain.handle('playlist:delete', async (event: any, playlistId: string) => {
    const index = playlistState.playlists.findIndex((item: any) => item.id === playlistId)
    if (index === -1) {
      return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
    }

    playlistState.playlists.splice(index, 1)
    removeUnreferencedTracks()
    await savePlaylistState()
    return { ok: true }
  })

  ipcMain.handle('playlist:addTracks', async (event: any, payload: any) => {
    const playlistId = payload?.playlistId
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
    return addTracksToPlaylistInternal(playlistId, tracks)
  })

  ipcMain.handle('playlist:removeTrack', async (event: any, payload: any) => {
    const playlist = playlistState.playlists.find((item: any) => item.id === payload?.playlistId)
    if (!playlist) {
      return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
    }

    const prevLength = playlist.trackIds.length
    playlist.trackIds = playlist.trackIds.filter((trackId: string) => trackId !== payload?.trackId)
    const removed = prevLength !== playlist.trackIds.length

    if (removed) {
      removeUnreferencedTracks()
      await savePlaylistState()
    }

    return { ok: true, removed, playlist }
  })

  ipcMain.handle('playlist:export', async (event: any, playlistId: string) => {
    const playlist = playlistState.playlists.find((item: any) => item.id === playlistId)
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

    const exportData: any = {
      schemaVersion: PLAYLIST_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      playlists: [playlist],
      trackLibrary: {} as Record<string, any>
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
    } catch (err: any) {
      logProgramEvent({
        source: 'playlistHandlers',
        event: 'import-playlist-failed',
        message: 'Failed to import playlist JSON',
        error: err
      })
      return { ok: false, error: 'IMPORT_FAILED' }
    }
  })
}

module.exports = {
  initializePlaylistState,
  registerPlaylistHandlers
}

export {}
