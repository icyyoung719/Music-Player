import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app, dialog, ipcMain } from 'electron'
import { parseFile } from 'music-metadata'
import { logProgramEvent } from './logger'

const NETEASE_TRACK_METADATA_STORE_NAME = 'netease-track-metadata.json'
const PLAYLIST_SCHEMA_VERSION = 2

type PlaylistState = {
  schemaVersion: number
  playlists: PlaylistItem[]
  trackLibrary: Record<string, TrackLibraryEntry>
}

type PlaylistCreator = {
  userId: string
  nickname: string
}

type PlaylistItem = {
  id: string
  name: string
  trackIds: string[]
  source: string
  platform: string
  platformPlaylistId: string
  creator?: PlaylistCreator
  coverUrl: string
  description: string
  updateTime: string
  tags: string[]
}

type MetadataCache = {
  title?: string
  artist?: string
  album?: string
  duration?: number
}

type TrackLibraryEntry = {
  path: string
  metadataCache: MetadataCache
}

type NeteaseTrackMetadataRecord = {
  title?: string
  artist?: string
  album?: string
  year?: number
  lyrics?: string
  coverPath?: string
}

type PlaylistRenamePayload = {
  playlistId: string
  name: string
}

type PlaylistAddTracksPayload = {
  playlistId: string
  tracks: unknown[]
}

type PlaylistRemoveTrackPayload = {
  playlistId: string
  trackId: string
}

type AnyRecord = Record<string, unknown>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

function logPlaylistError(event: string, message: string, error: unknown, data?: AnyRecord): void {
  logProgramEvent({
    source: 'playlistHandlers',
    event,
    message,
    error,
    data
  })
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
  const safePath = typeof filePath === 'string' ? filePath : ''
  const ext = String(path.extname(safePath)).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function readNeteaseTrackMetadataByPath(filePath: unknown): Promise<NeteaseTrackMetadataRecord | undefined> {
  try {
    const content = await fs.promises.readFile(getNeteaseTrackMetadataStorePath(), 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return undefined
    const record = (parsed as Record<string, unknown>)[normalizeTrackPathKey(filePath)]
    return record && typeof record === 'object' ? (record as NeteaseTrackMetadataRecord) : undefined
  } catch {
    return undefined
  }
}

async function readCoverDataUrlByPath(coverPath: unknown): Promise<string | undefined> {
  if (typeof coverPath !== 'string' || !coverPath.trim()) return undefined
  try {
    const buffer = await fs.promises.readFile(coverPath)
    if (!buffer.length) return undefined
    const mime = resolveImageMimeByPath(coverPath)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return undefined
  }
}

function normalizeLyricsValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || undefined
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
    return undefined
  }

  if (value && typeof value === 'object') {
    const payload = value as { text?: unknown }
    if (typeof payload.text !== 'string') return undefined
    const text = payload.text.trim()
    return text || undefined
  }

  return undefined
}

function hasLrcTimestamp(lyricsText: unknown): boolean {
  const text = String(lyricsText || '')
  return /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(text)
}

function chooseBestLyrics(primary: unknown, fallback: unknown): string | undefined {
  const first = normalizeLyricsValue(primary)
  const second = normalizeLyricsValue(fallback)

  if (hasLrcTimestamp(first)) return first
  if (hasLrcTimestamp(second)) return second
  return first || second || undefined
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

function makeUniquePlaylistName(baseName: unknown, existingPlaylists: PlaylistItem[], excludeId?: string): string {
  const base = normalizePlaylistName(baseName)
  const existing = new Set(
    existingPlaylists
        .filter((item) => item.id !== excludeId)
        .map((item) => (item.name || '').toLowerCase())
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

function ensureStateShape(rawState: unknown): PlaylistState {
  const state = (rawState ?? {}) as {
    schemaVersion?: unknown
    playlists?: unknown[]
    trackLibrary?: Record<string, unknown>
  }
  const normalizedVersion = Number(state.schemaVersion)
  const schemaVersion = Number.isFinite(normalizedVersion)
    ? Math.max(1, Math.trunc(normalizedVersion))
    : 1

  const normalizeText = (value: unknown, maxLen: number = 512): string => String(value || '').trim().slice(0, maxLen)

  const normalizeTags = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const deduped = new Set<string>()
    for (const item of value) {
      const text = normalizeText(item, 40)
      if (!text) continue
      deduped.add(text)
    }
    return Array.from(deduped).slice(0, 20)
  }

  const normalizeCreator = (value: unknown): PlaylistCreator | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const creator = value as { userId?: unknown; nickname?: unknown }
    const userId = normalizeText(creator.userId, 64)
    const nickname = normalizeText(creator.nickname, 64)
    if (!userId && !nickname) return undefined
    return {
      userId,
      nickname
    }
  }

  const normalizeDateText = (value: unknown): string => {
    const text = normalizeText(value, 64)
    if (!text) return ''
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString()
  }

  const normalizePlaylistMeta = (item: unknown): Omit<PlaylistItem, 'id' | 'name' | 'trackIds'> => {
    const payload = (item ?? {}) as {
      source?: unknown
      platform?: unknown
      platformPlaylistId?: unknown
      creator?: unknown
      coverUrl?: unknown
      description?: unknown
      updateTime?: unknown
      tags?: unknown
    }
    const source = normalizeText(payload.source, 24).toLowerCase() || 'local'
    const platform = normalizeText(payload.platform, 24).toLowerCase() || 'local'
    return {
      source,
      platform,
      platformPlaylistId: normalizeText(payload.platformPlaylistId, 80),
      creator: normalizeCreator(payload.creator),
      coverUrl: normalizeText(payload.coverUrl, 2048),
      description: normalizeText(payload.description, 1024),
      updateTime: normalizeDateText(payload.updateTime),
      tags: normalizeTags(payload.tags)
    }
  }

  const safeState: PlaylistState = {
    schemaVersion: PLAYLIST_SCHEMA_VERSION,
    playlists: [],
    trackLibrary: {}
  }

  const rawPlaylists = Array.isArray(state.playlists) ? state.playlists : []
  const rawTrackLibrary = state.trackLibrary && typeof state.trackLibrary === 'object' ? state.trackLibrary : {}

  safeState.playlists = rawPlaylists.map((item: unknown) => {
    const payload = (item ?? {}) as { id?: unknown; name?: unknown; trackIds?: unknown[] }
    return {
      id: typeof payload.id === 'string' && payload.id ? payload.id : createId(),
      name: normalizePlaylistName(payload.name),
      trackIds: Array.isArray(payload.trackIds)
        ? payload.trackIds.filter((trackId): trackId is string => typeof trackId === 'string' && Boolean(trackId))
        : [],
      ...normalizePlaylistMeta(item)
    }
  })

  // Legacy migration path (schemaVersion < 2): fill missing NetEase-aligned optional fields.
  if (schemaVersion < 2) {
    safeState.playlists = safeState.playlists.map((item) => ({
      ...item,
      source: item.source || 'local',
      platform: item.platform || 'local',
      platformPlaylistId: item.platformPlaylistId || '',
      creator: item.creator,
      coverUrl: item.coverUrl || '',
      description: item.description || '',
      updateTime: item.updateTime || new Date().toISOString(),
      tags: Array.isArray(item.tags) ? item.tags : []
    }))
  }

  const normalizedLibrary: Record<string, TrackLibraryEntry> = {}
  for (const [trackId, track] of Object.entries(rawTrackLibrary)) {
    if (!trackId || typeof track !== 'object' || !track) continue
    const typedTrack = track as { path?: unknown; metadataCache?: unknown }
    if (typeof typedTrack.path !== 'string' || !typedTrack.path.trim()) continue
    normalizedLibrary[trackId] = {
      path: typedTrack.path,
      metadataCache:
        typedTrack.metadataCache && typeof typedTrack.metadataCache === 'object'
          ? (typedTrack.metadataCache as MetadataCache)
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
  } catch (err: unknown) {
    const errorCode = (err as { code?: string } | undefined)?.code
    if (errorCode !== 'ENOENT') {
      logPlaylistError('load-playlist-store-failed', 'Failed to load playlists.json, reset to default', err)
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

async function upsertTrack(trackInput: unknown): Promise<string | undefined> {
  const payload = (trackInput ?? {}) as {
    path?: unknown
    metadataCache?: unknown
    title?: unknown
    artist?: unknown
    album?: unknown
    duration?: unknown
  }
  if (typeof payload.path !== 'string' || !payload.path.trim()) {
    return undefined
  }

  const resolvedPath = path.resolve(payload.path)
  let stat
  try {
    stat = await fs.promises.stat(resolvedPath)
  } catch {
    return undefined
  }

  const trackId = createTrackId(resolvedPath, stat.mtimeMs)
  const metadataCacheInput =
    payload.metadataCache && typeof payload.metadataCache === 'object'
      ? (payload.metadataCache as Record<string, unknown>)
      : {}

  playlistState.trackLibrary[trackId] = {
    path: resolvedPath,
    metadataCache: {
      title: String(metadataCacheInput.title || payload.title || path.basename(resolvedPath)),
      artist: metadataCacheInput.artist ? String(metadataCacheInput.artist) : payload.artist ? String(payload.artist) : undefined,
      album: metadataCacheInput.album ? String(metadataCacheInput.album) : payload.album ? String(payload.album) : undefined,
      duration: Number(metadataCacheInput.duration || payload.duration || 0) || undefined
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

async function addTracksToPlaylistInternal(
  playlistId: string,
  tracks: unknown[]
): Promise<{ ok: true; addedCount: number; playlist: PlaylistItem } | { ok: false; error: 'PLAYLIST_NOT_FOUND' }> {
  const playlist = playlistState.playlists.find((item) => item.id === playlistId)
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

async function importPlaylistsFromObject(imported: unknown): Promise<{ importedPlaylistCount: number; importedTrackCount: number }> {
  const incoming = ensureStateShape(imported)
  if (incoming.playlists.length === 0) {
    return { importedPlaylistCount: 0, importedTrackCount: 0 }
  }

  let importedTrackCount = 0
  let importedPlaylistCount = 0

  for (const incomingPlaylist of incoming.playlists) {
    const uniqueName = makeUniquePlaylistName(incomingPlaylist.name, playlistState.playlists)
    const newPlaylist: PlaylistItem = {
      id: createId(),
      name: uniqueName,
      trackIds: [],
      source: incomingPlaylist.source || 'local',
      platform: incomingPlaylist.platform || 'local',
      platformPlaylistId: incomingPlaylist.platformPlaylistId || '',
      creator: incomingPlaylist.creator,
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

  ipcMain.handle('play-audio', (_event: unknown, filePath: string) => {
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
    } catch (err: unknown) {
      logPlaylistError('read-folder-failed', 'Failed to read selected folder', err, { folderPath })
      return []
    }
  })

  ipcMain.handle('get-metadata', async (_event: unknown, filePath: string) => {
    let parsedMeta: {
      title?: string
      artist?: string
      album?: string
      year?: number
      lyrics?: string
      duration?: number
      coverDataUrl?: string
    } | undefined
    try {
      const metadata = await parseFile(filePath)
      const { common, format } = metadata

      let coverDataUrl: string | undefined
      if (common.picture && common.picture.length > 0) {
        const pic = common.picture[0]
        const base64 = Buffer.from(pic.data).toString('base64')
        coverDataUrl = `data:${pic.format};base64,${base64}`
      }

      parsedMeta = {
        title: common.title || undefined,
        artist: common.artist || undefined,
        album: common.album || undefined,
        year: common.year || undefined,
        lyrics: normalizeLyricsValue(common.lyrics),
        duration: format.duration || undefined,
        coverDataUrl
      }
    } catch (err: unknown) {
      logPlaylistError('parse-metadata-failed', 'Failed to parse audio metadata', err, {
        filePath: String(filePath || '')
      })
    }

    const fallback = await readNeteaseTrackMetadataByPath(filePath)
    const fallbackCoverDataUrl = await readCoverDataUrlByPath(fallback?.coverPath)

    const merged = {
      title: parsedMeta?.title || fallback?.title || undefined,
      artist: parsedMeta?.artist || fallback?.artist || undefined,
      album: parsedMeta?.album || fallback?.album || undefined,
      year: parsedMeta?.year || fallback?.year || undefined,
      lyrics: chooseBestLyrics(parsedMeta?.lyrics, fallback?.lyrics),
      duration: parsedMeta?.duration || undefined,
      coverDataUrl: parsedMeta?.coverDataUrl || fallbackCoverDataUrl || undefined
    }

    const hasMeaningfulField =
      Boolean(merged.title) ||
      Boolean(merged.artist) ||
      Boolean(merged.album) ||
      Boolean(merged.year) ||
      Boolean(merged.lyrics) ||
      Boolean(merged.duration) ||
      Boolean(merged.coverDataUrl)

    return hasMeaningfulField ? merged : undefined
  })

  ipcMain.handle('playlist:list', async () => {
    return getPlaylistListPayload()
  })

  ipcMain.handle('playlist:create', async (_event: unknown, name: string) => {
    const uniqueName = makeUniquePlaylistName(name, playlistState.playlists)
    const newPlaylist = {
      id: createId(),
      name: uniqueName,
      trackIds: [],
      source: 'local',
      platform: 'local',
      platformPlaylistId: '',
      creator: undefined,
      coverUrl: '',
      description: '',
      updateTime: new Date().toISOString(),
      tags: []
    }

    playlistState.playlists.push(newPlaylist)
    await savePlaylistState()
    return { ok: true, playlist: newPlaylist }
  })

  ipcMain.handle('playlist:rename', async (_event: unknown, payloadOrId: unknown, maybeName: unknown) => {
    const payload =
      payloadOrId && typeof payloadOrId === 'object'
        ? (payloadOrId as PlaylistRenamePayload)
        : { playlistId: payloadOrId, name: maybeName }

    const playlist = playlistState.playlists.find((item) => item.id === payload.playlistId)
    if (!playlist) {
      return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
    }

    playlist.name = makeUniquePlaylistName(payload.name, playlistState.playlists, playlist.id)
    playlist.updateTime = new Date().toISOString()
    await savePlaylistState()
    return { ok: true, playlist }
  })

  ipcMain.handle('playlist:delete', async (_event: unknown, playlistId: string) => {
    const index = playlistState.playlists.findIndex((item) => item.id === playlistId)
    if (index === -1) {
      return { ok: false, error: 'PLAYLIST_NOT_FOUND' }
    }

    playlistState.playlists.splice(index, 1)
    removeUnreferencedTracks()
    await savePlaylistState()
    return { ok: true }
  })

  ipcMain.handle('playlist:addTracks', async (_event: unknown, payload: PlaylistAddTracksPayload) => {
    const playlistId = String(payload?.playlistId || '')
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : []
    return addTracksToPlaylistInternal(playlistId, tracks)
  })

  ipcMain.handle('playlist:removeTrack', async (_event: unknown, payload: PlaylistRemoveTrackPayload) => {
    const playlist = playlistState.playlists.find((item) => item.id === payload?.playlistId)
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

  ipcMain.handle('playlist:export', async (_event: unknown, playlistId: string) => {
    const playlist = playlistState.playlists.find((item) => item.id === playlistId)
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

    const exportData: {
      schemaVersion: number
      exportedAt: string
      playlists: PlaylistItem[]
      trackLibrary: Record<string, TrackLibraryEntry>
    } = {
      schemaVersion: PLAYLIST_SCHEMA_VERSION,
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
    } catch (err: unknown) {
      logPlaylistError('import-playlist-failed', 'Failed to import playlist JSON', err)
      return { ok: false, error: 'IMPORT_FAILED' }
    }
  })
}

export {
  initializePlaylistState,
  registerPlaylistHandlers
}
