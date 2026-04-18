import fs from 'fs'
import path from 'path'
import { app, ipcMain, shell } from 'electron'
import { logProgramEvent } from '../logger'
const {
  authState,
  ensureAuthStateLoaded,
  persistAuthState,
  clearAuthState,
  getPublicAuthState,
  getPublicAccountSummary,
  emitAuthStateUpdate,
  postFormWithFallback,
  requestNeteaseApi,
  refreshProfileFromAuth,
  applyProfileToAuthState,
  enrichAuthStateProfileByUserId,
  buildQrCodeDataUrl,
  normalizeCookieHeader,
  extractApiErrorMessage,
  isRiskControlMessage,
  sanitizeEmail,
  sanitizePhone,
  sanitizeCountryCode,
  sanitizeCaptcha,
  sanitizeQrKey,
  md5
} = require('./authManager')
const {
  sanitizeSongId,
  sanitizeId,
  getSongPageUrl,
  getPlaylistPageUrl,
  extractSongMetadata,
  searchNeteaseByKeyword,
  searchNeteaseSuggest,
  fetchNeteaseSearchDefaultKeyword,
  fetchNeteaseSearchHot,
  fetchNeteaseSearchHotDetail,
  searchNeteaseMultimatch,
  sendNeteasePrivateMessage,
  resolveSongUrlWithLevelFallback,
  fetchSongMetadataById,
  fetchPlaylistTracksById,
  isNeteaseAudioHost
} = require('./neteaseApi')
import {
  createTaskId,
  safeFileName,
  isAllowedDownloadHost,
  emitGlobalToast,
  listDownloadTasks,
  resolveDownloadDir,
  ensureDownloadBaseDirs,
  countFilesRecursive,
  createDownloadTask,
  createSongDownloadTaskFromId,
  cancelDownloadTask
} from './downloadManager'

let handlersRegistered = false
const CLOUD_PLAYLIST_STORE_NAME = 'netease-cloud-playlists.json'

type CloudPlaylistItem = {
  id: string
  platform: string
  source: string
  platformPlaylistId: string
  name: string
  creator: {
    userId: string
    nickname: string
  }
  coverUrl: string
  description: string
  trackCount: number
  playCount: number
  tags: string[]
  collected: boolean
  sourceKinds: string[]
  updatedAt: string
}

type CloudPlaylistState = {
  schemaVersion: number
  playlists: CloudPlaylistItem[]
}

type UpsertCloudPlaylistOptions = {
  forceCollected?: boolean
  sourceKinds?: string[]
}

type AnyRecord = Record<string, unknown>

type NeteaseResolveIdPayload = {
  id?: unknown
  type?: unknown
}

type NeteaseOpenPagePayload = {
  id?: unknown
  type?: unknown
}

type NeteaseOpenExternalUrlPayload = {
  url?: unknown
}

type NeteaseOpenDownloadDirPayload = {
  dirType?: unknown
  playlistName?: unknown
}

type NeteaseDownloadDirectPayload = {
  url?: unknown
  fileName?: unknown
}

type NeteaseAuthSummaryPayload = {
  refresh?: unknown
}

type NeteaseAuthUpdatePayload = {
  apiBaseUrl?: unknown
  cookie?: unknown
  accessToken?: unknown
  refreshToken?: unknown
  userName?: unknown
  userId?: unknown
}

type NeteaseAuthLoginEmailPayload = {
  apiBaseUrl?: unknown
  email?: unknown
  password?: unknown
  md5Password?: unknown
  phone?: unknown
  countryCode?: unknown
}

type NeteaseAuthSendCaptchaPayload = {
  apiBaseUrl?: unknown
  phone?: unknown
  countryCode?: unknown
}

type NeteaseAuthLoginCaptchaPayload = {
  apiBaseUrl?: unknown
  phone?: unknown
  captcha?: unknown
  countryCode?: unknown
}

type NeteaseAuthQrPayload = {
  apiBaseUrl?: unknown
  qrKey?: unknown
}

type NeteaseAuthRequestPayload = {
  path?: unknown
  data?: unknown
  method?: unknown
  timeout?: unknown
}

type NeteaseCloudPlaylistRefPayload = {
  platformPlaylistId?: unknown
  playlistId?: unknown
  id?: unknown
  collected?: unknown
  sourceKinds?: unknown
  [key: string]: unknown
}

type NeteaseSearchPayload = {
  keywords?: unknown
  type?: unknown
  limit?: unknown
  offset?: unknown
}

type NeteasePlaylistDetailPayload = {
  playlistId?: unknown
}

type NeteaseSendPayload = {
  id?: unknown
  songId?: unknown
  albumId?: unknown
  playlistId?: unknown
  [key: string]: unknown
}

type NeteaseResolveSongDownloadUrlPayload = {
  songId?: unknown
  level?: unknown
}

type NeteaseDownloadBySongIdPayload = {
  targetDirType?: unknown
  duplicateStrategy?: unknown
  downloadMode?: unknown
  addToQueue?: unknown
  savePlaylistName?: unknown
  [key: string]: unknown
}

type NeteaseDownloadSongTaskPayload = {
  mode?: unknown
  duplicateStrategy?: unknown
  addToQueue?: unknown
  [key: string]: unknown
}

type NeteaseDownloadPlaylistByIdPayload = {
  playlistId?: unknown
  mode?: unknown
  level?: unknown
  duplicateStrategy?: unknown
}

type NeteaseDownloadTaskCancelPayload = {
  id?: unknown
}

type DailyRecommendationTrack = {
  id: string
  name: string
  artist: string
  album: string
  durationMs: number
  year?: number
  coverUrl: string
  reason: string
}

let cloudPlaylistState: CloudPlaylistState = {
  schemaVersion: 1,
  playlists: []
}
let cloudPlaylistLoaded = false

const AUTH_PATHS = {
  emailLogin: ['/api/login', '/weapi/login', '/login'],
  captchaSend: [
    '/api/sms/captcha/sent',
    '/weapi/sms/captcha/sent',
    '/sms/captcha/sent',
    '/captcha/sent'
  ],
  phoneCaptchaLogin: ['/api/login/cellphone', '/weapi/login/cellphone', '/login/cellphone'],
  qrKey: [
    '/api/login/qrcode/unikey',
    '/weapi/login/qrcode/unikey',
    '/login/qr/key',
    '/login/qrcode/unikey'
  ],
  qrCheck: [
    '/api/login/qrcode/client/login',
    '/weapi/login/qrcode/client/login',
    '/login/qr/check',
    '/login/qrcode/client/login'
  ]
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

function logNeteaseIndexError(event: string, message: string, error: unknown, data?: AnyRecord): void {
  logProgramEvent({
    source: 'netease.index',
    event,
    message,
    error,
    data
  })
}

function normalizeDailyRecommendationTracks(data: unknown): DailyRecommendationTrack[] {
  const payload = (data ?? {}) as {
    recommend?: unknown[]
    data?: { dailySongs?: unknown[] }
  }
  const songList = Array.isArray(payload.recommend)
    ? payload.recommend
    : Array.isArray(payload.data?.dailySongs)
      ? payload.data.dailySongs
      : []

  return songList
    .map((song: unknown): DailyRecommendationTrack | undefined => {
      const typedSong = (song ?? {}) as { id?: unknown; reason?: unknown }
      const normalized = extractSongMetadata(song, typedSong.id)
      if (!normalized?.songId) return undefined
      return {
        id: String(normalized.songId),
        name: normalized.title || `歌曲 ${normalized.songId}`,
        artist: normalized.artist || '',
        album: normalized.album || '',
        durationMs: Number(normalized.durationMs || 0),
        year: normalized.year,
        coverUrl: normalized.coverUrl || '',
        reason: String(typedSong.reason || '').trim()
      }
    })
    .filter((item): item is DailyRecommendationTrack => Boolean(item))
}

function normalizeRecommendedPlaylists(data: unknown): CloudPlaylistItem[] {
  const payload = (data ?? {}) as {
    recommend?: unknown[]
    result?: unknown[]
    data?: { recommend?: unknown[]; result?: unknown[] }
  }
  const rawList = Array.isArray(payload.recommend)
    ? payload.recommend
    : Array.isArray(payload.result)
      ? payload.result
    : Array.isArray(payload.data?.recommend)
      ? payload.data.recommend
      : Array.isArray(payload.data?.result)
        ? payload.data.result
      : []

  return rawList
    .map((item: unknown): CloudPlaylistItem | undefined => {
      const typed = (item ?? {}) as {
        id?: unknown
        name?: unknown
        picUrl?: unknown
        coverImgUrl?: unknown
        copywriter?: unknown
        description?: unknown
        trackCount?: unknown
        playCount?: unknown
        playcount?: unknown
        tags?: unknown[]
        creator?: { userId?: unknown; nickname?: unknown }
      }
      const playlistId = sanitizeId(typed.id)
      if (!playlistId) return undefined

      return normalizeCloudPlaylistItem({
        id: playlistId,
        platformPlaylistId: playlistId,
        name: typed.name,
        creator: {
          userId: sanitizeId(typed.creator?.userId) || '',
          nickname: String(typed.creator?.nickname || '').trim() || '网易云音乐'
        },
        coverUrl: typed.picUrl || typed.coverImgUrl,
        description: typed.copywriter || typed.description,
        trackCount: typed.trackCount,
        playCount: typed.playCount ?? typed.playcount,
        tags: typed.tags,
        collected: false,
        sourceKinds: ['recommend'],
        updatedAt: new Date().toISOString()
      })
    })
    .filter((entry: CloudPlaylistItem | undefined): entry is CloudPlaylistItem => Boolean(entry))
}

function getCloudPlaylistStorePath(): string {
  return path.join(app.getPath('userData'), CLOUD_PLAYLIST_STORE_NAME)
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toSafeIsoString(value: string | number | Date | undefined, fallback = Date.now()): string {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? value.toISOString() : new Date(fallback).toISOString()
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) {
      return date.toISOString()
    }
  }

  return new Date(fallback).toISOString()
}

function normalizeCloudPlaylistItem(item: unknown): CloudPlaylistItem | undefined {
  const payload = (item ?? {}) as {
    platformPlaylistId?: unknown
    id?: unknown
    tags?: unknown[]
    name?: unknown
    creator?: { userId?: unknown; nickname?: unknown }
    coverUrl?: unknown
    description?: unknown
    trackCount?: unknown
    playCount?: unknown
    collected?: unknown
    sourceKinds?: unknown[]
    updatedAt?: unknown
  }
  const playlistId = sanitizeId(payload.platformPlaylistId || payload.id)
  if (!playlistId) return undefined

  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean).slice(0, 20)
    : []

  return {
    id: `netease-cloud-${playlistId}`,
    platform: 'netease',
    source: 'cloud',
    platformPlaylistId: playlistId,
    name: String(payload.name || `歌单 ${playlistId}`).trim() || `歌单 ${playlistId}`,
    creator: {
      userId: String(payload.creator?.userId || '').trim(),
      nickname: String(payload.creator?.nickname || '').trim()
    },
    coverUrl: String(payload.coverUrl || '').trim(),
    description: String(payload.description || '').trim(),
    trackCount: Math.max(0, Math.trunc(toSafeNumber(payload.trackCount, 0))),
    playCount: Math.max(0, Math.trunc(toSafeNumber(payload.playCount, 0))),
    tags,
    collected: Boolean(payload.collected !== false),
    sourceKinds: Array.isArray(payload.sourceKinds)
      ? payload.sourceKinds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [],
    updatedAt: toSafeIsoString(
      typeof payload.updatedAt === 'string' || typeof payload.updatedAt === 'number' || payload.updatedAt instanceof Date
        ? payload.updatedAt
        : undefined
    )
  }
}

function ensureCloudPlaylistStateShape(raw: unknown): CloudPlaylistState {
  const payload = (raw ?? {}) as { playlists?: unknown[] }
  const playlists = Array.isArray(payload.playlists) ? payload.playlists : []
  const normalized = playlists
    .map(normalizeCloudPlaylistItem)
    .filter((item): item is CloudPlaylistItem => Boolean(item))
  return {
    schemaVersion: 1,
    playlists: normalized
  }
}

async function loadCloudPlaylistState(): Promise<void> {
  if (cloudPlaylistLoaded) return
  try {
    const content = await fs.promises.readFile(getCloudPlaylistStorePath(), 'utf8')
    cloudPlaylistState = ensureCloudPlaylistStateShape(JSON.parse(content))
  } catch (err: unknown) {
    const code = (err as { code?: string } | undefined)?.code
    if (code !== 'ENOENT') {
      logNeteaseIndexError('load-cloud-playlist-store-failed', 'Failed to load cloud playlist store', err)
    }
    cloudPlaylistState = ensureCloudPlaylistStateShape({ schemaVersion: 1, playlists: [] })
    await saveCloudPlaylistState()
  }
  cloudPlaylistLoaded = true
}

async function saveCloudPlaylistState(): Promise<void> {
  const storePath = getCloudPlaylistStorePath()
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true })
  await fs.promises.writeFile(storePath, JSON.stringify(cloudPlaylistState, null, 2), 'utf8')
}

function upsertCloudPlaylistReference(
  input: unknown,
  options: UpsertCloudPlaylistOptions = {}
): CloudPlaylistItem | undefined {
  const item = normalizeCloudPlaylistItem(input)
  if (!item) return undefined

  const existingIndex = cloudPlaylistState.playlists.findIndex((entry) => entry.platformPlaylistId === item.platformPlaylistId)
  if (existingIndex < 0) {
    cloudPlaylistState.playlists.unshift(item)
    return item
  }

  const existing = cloudPlaylistState.playlists[existingIndex]
  const mergedSourceKinds = new Set([...(existing.sourceKinds || []), ...(item.sourceKinds || []), ...(options.sourceKinds || [])])
  const merged: CloudPlaylistItem = {
    ...existing,
    ...item,
    collected: options.forceCollected == null ? existing.collected : Boolean(options.forceCollected),
    sourceKinds: Array.from(mergedSourceKinds).filter(Boolean),
    updatedAt: new Date().toISOString()
  }

  cloudPlaylistState.playlists.splice(existingIndex, 1)
  cloudPlaylistState.playlists.unshift(merged)
  return merged
}

async function fetchUserCloudPlaylists(): Promise<
  | { ok: true; data: CloudPlaylistItem[] }
  | { ok: false; error: string; message: string; code?: number }
> {
  if (!authState.cookie && !authState.userId) {
    return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
  }

  const uid = sanitizeId(authState.userId)
  if (!uid) {
    return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
  }

  try {
    const data = await requestNeteaseApi('/api/user/playlist', {
      uid,
      limit: 100,
      offset: 0
    })

    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      const message = extractApiErrorMessage(data) || 'REQUEST_FAILED'
      if (isRiskControlMessage(message)) {
        return { ok: false, error: 'LOGIN_RISK_BLOCKED', code, message }
      }
      return { ok: false, error: 'REQUEST_FAILED', code, message }
    }

    const rawList = Array.isArray(data?.playlist) ? data.playlist : []
    const items = rawList
      .map((item: unknown) => {
        const payload = (item ?? {}) as {
          id?: unknown
          creator?: { userId?: unknown; nickname?: unknown }
          name?: unknown
          coverImgUrl?: unknown
          description?: unknown
          trackCount?: unknown
          playCount?: unknown
          tags?: unknown[]
        }
        const playlistId = sanitizeId(payload.id)
        if (!playlistId) return undefined

        const creatorUserId = sanitizeId(payload.creator?.userId)
        const ownerId = sanitizeId(uid)
        const sourceKind = creatorUserId && ownerId && creatorUserId === ownerId ? 'created' : 'subscribed'

        return normalizeCloudPlaylistItem({
          id: playlistId,
          platformPlaylistId: playlistId,
          name: payload.name,
          creator: {
            userId: creatorUserId || '',
            nickname: String(payload.creator?.nickname || '').trim()
          },
          coverUrl: payload.coverImgUrl,
          description: payload.description,
          trackCount: payload.trackCount,
          playCount: payload.playCount,
          tags: payload.tags,
          collected: true,
          sourceKinds: [sourceKind, 'account']
        })
      })
      .filter((item: CloudPlaylistItem | undefined): item is CloudPlaylistItem => Boolean(item))

    return { ok: true, data: items }
  } catch (err: unknown) {
    return { ok: false, error: 'REQUEST_FAILED', message: getErrorMessage(err) }
  }
}

function registerNeteaseHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ensureAuthStateLoaded().catch((err: unknown) => {
    logNeteaseIndexError('init-auth-state-failed', 'Failed to initialize NetEase auth state', err)
  })


  ipcMain.handle('netease:resolve-id', async (_event: unknown, payload: NeteaseResolveIdPayload) => {
    const id = sanitizeId(payload?.id)
    const type = payload?.type === 'playlist' ? 'playlist' : 'song'

    if (!id) {
      return { ok: false, error: 'INVALID_ID' }
    }

    try {
      if (type === 'song') {
        const song = await fetchSongMetadataById(id)
        if (!song) return { ok: false, error: 'NOT_FOUND' }

        return {
          ok: true,
          type,
          item: {
            id,
            name: song.title || `歌曲 ${id}`,
            artist: song.artist || '',
            album: song.album || '',
            durationMs: Number(song.durationMs || 0),
            year: song.year,
            coverUrl: song.coverUrl || '',
            pageUrl: getSongPageUrl(id)
          }
        }
      }

      const playlist = await fetchPlaylistTracksById(id)
      if (!playlist) return { ok: false, error: 'NOT_FOUND' }

      return {
        ok: true,
        type,
        item: {
          id,
          name: playlist.name || `歌单 ${id}`,
          trackCount: Number(playlist.trackCount) || playlist.tracks.length,
          creator: playlist.creator || '',
          description: playlist.description || '',
          coverUrl: playlist.coverUrl || '',
          tags: Array.isArray(playlist.tags) ? playlist.tags : [],
          playCount: Number(playlist.playCount || 0),
          pageUrl: getPlaylistPageUrl(id),
          tracks: Array.isArray(playlist.tracks)
            ? playlist.tracks.map((track: { songId?: unknown; title?: unknown; artist?: unknown; album?: unknown; durationMs?: unknown; coverUrl?: unknown }) => ({
                id: String(track?.songId || ''),
                name: track?.title || '未知歌曲',
                artist: track?.artist || '',
                album: track?.album || '',
                durationMs: Number(track?.durationMs || 0),
                coverUrl: track?.coverUrl || ''
              }))
            : []
        }
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'resolve-id-failed',
        message: 'Failed to resolve NetEase id',
        error: err,
        data: { id, type }
      })
      return { ok: false, error: 'REQUEST_FAILED' }
    }
  })

  ipcMain.handle('netease:open-page', async (_event: unknown, payload: NeteaseOpenPagePayload) => {
    const id = sanitizeId(payload?.id)
    const type = payload?.type === 'playlist' ? 'playlist' : 'song'
    if (!id) return { ok: false, error: 'INVALID_ID' }

    const pageUrl = type === 'playlist' ? getPlaylistPageUrl(id) : getSongPageUrl(id)
    await shell.openExternal(pageUrl)
    return { ok: true, pageUrl }
  })

  ipcMain.handle('netease:open-external-url', async (_event: unknown, payload: NeteaseOpenExternalUrlPayload) => {
    const url = String(payload?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'INVALID_URL' }
    }

    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('netease:get-download-dir', async () => {
    try {
      const dirs = await ensureDownloadBaseDirs()
      return { ok: true, dir: dirs.songs }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'prepare-download-dir-failed',
        message: 'Failed to prepare download dir',
        error: err
      })
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  ipcMain.handle('netease:get-download-dirs', async () => {
    try {
      const dirs = await ensureDownloadBaseDirs()
      return { ok: true, dirs }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'prepare-download-dirs-failed',
        message: 'Failed to prepare download dirs',
        error: err
      })
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  ipcMain.handle('netease:open-download-dir', async (_event: unknown, payload: NeteaseOpenDownloadDirPayload) => {
    try {
      const dirResolved = resolveDownloadDir(payload?.dirType || 'songs', payload?.playlistName || '')
      await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
      const openError = await shell.openPath(dirResolved.dirPath)
      if (openError) {
        return { ok: false, error: 'OPEN_PATH_FAILED', message: openError }
      }
      return { ok: true, dirPath: dirResolved.dirPath, dirType: dirResolved.dirType }
    } catch (err: unknown) {
      return { ok: false, error: 'OPEN_PATH_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:clear-temp-downloads', async () => {
    try {
      const tempDir = resolveDownloadDir('temp').dirPath
      await fs.promises.mkdir(tempDir, { recursive: true })
      const beforeCount = await countFilesRecursive(tempDir)
      await fs.promises.rm(tempDir, { recursive: true, force: true })
      await fs.promises.mkdir(tempDir, { recursive: true })

      emitGlobalToast({
        level: 'info',
        message: `已清理缓存歌曲 ${beforeCount} 首`,
        scope: 'temp-cleanup'
      })

      return { ok: true, removedFiles: beforeCount, dirPath: tempDir }
    } catch (err: unknown) {
      return { ok: false, error: 'TEMP_CLEAR_FAILED', message: getErrorMessage(err) }
    }
  })

  // Only supports downloading direct, authorized HTTPS links from music.126.net.
  ipcMain.handle('netease:download-direct', async (_event: unknown, payload: NeteaseDownloadDirectPayload) => {
    const rawUrl = String(payload?.url || '').trim()
    const fileName = safeFileName(payload?.fileName || 'netease-download')

    if (!isAllowedDownloadHost(rawUrl)) {
      return { ok: false, error: 'URL_NOT_ALLOWED' }
    }

    try {
      return createDownloadTask({
        url: rawUrl,
        fileName,
        source: 'direct-url',
        title: fileName
      })
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'download-direct-failed',
        message: 'Failed to download direct URL',
        error: err,
        data: { url: rawUrl }
      })
      return { ok: false, error: 'DOWNLOAD_FAILED' }
    }
  })

  ipcMain.handle('netease:auth:get-state', async () => {
    await ensureAuthStateLoaded()
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:get-account-summary', async (_event: unknown, payload: NeteaseAuthSummaryPayload) => {
    await ensureAuthStateLoaded()

    if (payload?.refresh && (authState.cookie || authState.userId)) {
      try {
        await refreshProfileFromAuth()
      } catch {
        // Ignore refresh errors and return cached summary for UI fallback.
      }
    }

    return {
      ok: true,
      account: getPublicAccountSummary(),
      state: getPublicAuthState()
    }
  })

  ipcMain.handle('netease:auth:update', async (_event: unknown, payload: NeteaseAuthUpdatePayload) => {
    await ensureAuthStateLoaded()

    const nextBase = String(payload?.apiBaseUrl || authState.apiBaseUrl).trim()
    authState.apiBaseUrl = nextBase || 'https://music.163.com'
    authState.cookie = String(payload?.cookie ?? authState.cookie ?? '').trim()
    authState.accessToken = String(payload?.accessToken ?? authState.accessToken ?? '').trim()
    authState.refreshToken = String(payload?.refreshToken ?? authState.refreshToken ?? '').trim()
    authState.userName = String(payload?.userName ?? authState.userName ?? '').trim()
    authState.userId = String(payload?.userId ?? authState.userId ?? '').trim()

    await persistAuthState()
    emitAuthStateUpdate('manual-update')
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:login-email', async (_event: unknown, payload: NeteaseAuthLoginEmailPayload) => {
    await ensureAuthStateLoaded()

    const email = sanitizeEmail(payload?.email)
    const password = String(payload?.password || '')
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!email || !password) {
      return { ok: false, error: 'INVALID_CREDENTIALS' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      // Per Netease API: /login expects username, password (or md5_password), rememberLogin
      // Password recommendation: encodeURIComponent recommended for special char safety, use MD5 + form encoding
      const bodyData = {
        username: email,
        password: md5(password),
        rememberLogin: 'true'
      }

      const loginResult = await postFormWithFallback(
        AUTH_PATHS.emailLogin,
        bodyData,
        12000,
        { cookieProfile: 'ios' }
      )

      if (!loginResult.ok || !loginResult.result) {
        return {
          ok: false,
          error: 'LOGIN_REQUEST_FAILED',
          message: loginResult.error || 'LOGIN_REQUEST_FAILED'
        }
      }

      const result = loginResult.result

      if (result.statusCode !== 200 || !result.data) {
        return { ok: false, error: 'LOGIN_REQUEST_FAILED', statusCode: result.statusCode }
      }

      const code = Number(result.data.code || 0)
      if (code !== 200) {
        return {
          ok: false,
          error: 'LOGIN_FAILED',
          code,
          message: String(result.data.msg || result.data.message || 'LOGIN_FAILED')
        }
      }

      const cookie = normalizeCookieHeader(result.headers['set-cookie'])
      if (cookie) {
        authState.cookie = cookie
      }

      applyProfileToAuthState(result.data?.profile)
      authState.userId = String(result.data?.account?.id || authState.userId || '')
      await enrichAuthStateProfileByUserId(authState.userId)
      await persistAuthState()
      emitAuthStateUpdate('login-email')

      return {
        ok: true,
        state: getPublicAuthState(),
        profile: getPublicAccountSummary()
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'login-email-failed',
        message: 'Failed to login with email',
        error: err
      })
      return { ok: false, error: 'LOGIN_EXCEPTION', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:auth:send-captcha', async (_event: unknown, payload: NeteaseAuthSendCaptchaPayload) => {
    await ensureAuthStateLoaded()

    const phone = sanitizePhone(payload?.phone)
    const countryCode = sanitizeCountryCode(payload?.countryCode)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!phone) {
      return { ok: false, error: 'INVALID_PHONE' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      // Per Netease API: /captcha/sent expects phone, ctcode (optional, default '86')
      // CRITICAL: Set-Cookie from this response must be preserved and reused in subsequent
      // /login/cellphone call. Failure to preserve cookies causes risk control error (code 10004).
      const sendResult = await postFormWithFallback(
        AUTH_PATHS.captchaSend,
        {
          phone,
          ctcode: countryCode
        },
        12000,
        { cookieProfile: 'ios' }
      )

      if (!sendResult.ok || !sendResult.result?.data) {
        return {
          ok: false,
          error: 'SEND_CAPTCHA_REQUEST_FAILED',
          message: sendResult.error || 'SEND_CAPTCHA_REQUEST_FAILED'
        }
      }

      const data = sendResult.result.data
      const code = Number(data?.code || 0)
      if (code !== 200) {
        const message = extractApiErrorMessage(data)
        if (isRiskControlMessage(message)) {
          return {
            ok: false,
            error: 'LOGIN_RISK_BLOCKED',
            code,
            message: message || '当前登录存在安全风险，请稍后重试'
          }
        }

        return {
          ok: false,
          error: 'SEND_CAPTCHA_FAILED',
          code,
          message: message || 'SEND_CAPTCHA_FAILED'
        }
      }

      return { ok: true, code }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'send-captcha-failed',
        message: 'Failed to send phone captcha',
        error: err,
        data: { phone }
      })
      return { ok: false, error: 'SEND_CAPTCHA_EXCEPTION', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:auth:login-captcha', async (_event: unknown, payload: NeteaseAuthLoginCaptchaPayload) => {
    await ensureAuthStateLoaded()

    const phone = sanitizePhone(payload?.phone)
    const captcha = sanitizeCaptcha(payload?.captcha)
    const countryCode = sanitizeCountryCode(payload?.countryCode)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!phone || !captcha) {
      return { ok: false, error: 'INVALID_PHONE_OR_CAPTCHA' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      // Per Netease API: /login/cellphone expects phone, captcha, countrycode, rememberLogin
      // Note: Set-Cookie from /captcha/sent must be preserved to avoid risk control (code 10004)
      const payloadData = {
        phone,
        captcha,
        countrycode: countryCode,
        rememberLogin: 'true'
      }

      const loginResult = await postFormWithFallback(
        AUTH_PATHS.phoneCaptchaLogin,
        payloadData,
        12000,
        { cookieProfile: 'ios' }
      )

      if (!loginResult.ok || !loginResult.result?.data) {
        return {
          ok: false,
          error: 'LOGIN_REQUEST_FAILED',
          message: loginResult.error || 'LOGIN_REQUEST_FAILED'
        }
      }

      const result = loginResult.result

      if (result.statusCode !== 200 || !result.data) {
        return { ok: false, error: 'LOGIN_REQUEST_FAILED', statusCode: result.statusCode }
      }

      const code = Number(result.data.code || 0)
      if (code !== 200) {
        const message = extractApiErrorMessage(result.data)
        if (isRiskControlMessage(message)) {
          return {
            ok: false,
            error: 'LOGIN_RISK_BLOCKED',
            code,
            message: message || '当前登录存在安全风险，请稍后重试'
          }
        }

        return {
          ok: false,
          error: 'LOGIN_FAILED',
          code,
          message: message || 'LOGIN_FAILED'
        }
      }

      const cookie = normalizeCookieHeader(result.headers['set-cookie'])
      if (cookie) {
        authState.cookie = cookie
      }

      applyProfileToAuthState(result.data?.profile)
      authState.userId = String(result.data?.account?.id || authState.userId || '')
      await enrichAuthStateProfileByUserId(authState.userId)
      await persistAuthState()
      emitAuthStateUpdate('login-phone-captcha')

      return {
        ok: true,
        state: getPublicAuthState(),
        profile: getPublicAccountSummary()
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'login-phone-captcha-failed',
        message: 'Failed to login with phone captcha',
        error: err,
        data: { phone }
      })
      return { ok: false, error: 'LOGIN_EXCEPTION', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:auth:qr:create', async (_event: unknown, payload: NeteaseAuthQrPayload) => {
    await ensureAuthStateLoaded()

    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()
    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const timestamp = Date.now()
      const qrKeyPaths = AUTH_PATHS.qrKey.map((pathValue: string) =>
        pathValue.includes('?') ? `${pathValue}&timestamp=${timestamp}` : `${pathValue}?timestamp=${timestamp}`
      )

      const keyResult = await postFormWithFallback(
        qrKeyPaths,
        {
          type: 1
        },
        12000,
        { cookieProfile: 'pc' }
      )

      if (!keyResult.ok || !keyResult.result?.data) {
        return {
          ok: false,
          error: 'QR_KEY_REQUEST_FAILED',
          message: keyResult.error || 'QR_KEY_REQUEST_FAILED'
        }
      }

      const data = keyResult.result.data
      const keyResponseCookie = normalizeCookieHeader(keyResult.result.headers['set-cookie'])
      if (keyResponseCookie) {
        // Keep QR session cookies for subsequent /login/qr/check polling calls.
        authState.cookie = keyResponseCookie
      }
      const code = Number(data?.code || 0)
      if (code !== 200) {
        return {
          ok: false,
          error: 'QR_KEY_FAILED',
          code,
          message: extractApiErrorMessage(data) || 'QR_KEY_FAILED'
        }
      }

      const qrKey = String(data?.unikey || data?.data?.unikey || '').trim()
      if (!qrKey) {
        return { ok: false, error: 'QR_KEY_EMPTY' }
      }

      const qrLoginUrl = `https://music.163.com/login?codekey=${encodeURIComponent(qrKey)}`
      let qrDataUrl = ''
      try {
        qrDataUrl = await buildQrCodeDataUrl(qrLoginUrl)
      } catch (err: unknown) {
        logProgramEvent({
          source: 'netease.index',
          event: 'build-qr-image-failed',
          message: 'Failed to build QR image data URL',
          error: err
        })
      }

      return {
        ok: true,
        qrKey,
        qrLoginUrl,
        qrDataUrl
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'create-qr-login-failed',
        message: 'Failed to create QR login',
        error: err
      })
      return { ok: false, error: 'QR_CREATE_EXCEPTION', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:auth:qr:check', async (_event: unknown, payload: NeteaseAuthQrPayload) => {
    await ensureAuthStateLoaded()

    const qrKey = sanitizeQrKey(payload?.qrKey)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!qrKey) {
      return { ok: false, error: 'INVALID_QR_KEY' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const timestamp = Date.now()
      const qrCheckPaths = AUTH_PATHS.qrCheck.map((pathValue: string) =>
        pathValue.includes('?') ? `${pathValue}&timestamp=${timestamp}` : `${pathValue}?timestamp=${timestamp}`
      )

      const checkPayload = {
        key: qrKey,
        type: 1
      }

      let checkResult = await postFormWithFallback(
        qrCheckPaths,
        checkPayload,
        12000,
        { cookieProfile: 'pc' }
      )

      // Per NetEase QR login reference: after scan may return 502, retry with noCookie=true.
      if (checkResult.ok && checkResult.result?.data) {
        const retryCode = Number(checkResult.result.data?.code || 0)
        if (retryCode === 502) {
          const noCookiePaths = AUTH_PATHS.qrCheck.map((pathValue: string) =>
            pathValue.includes('?')
              ? `${pathValue}&noCookie=true&timestamp=${Date.now()}`
              : `${pathValue}?noCookie=true&timestamp=${Date.now()}`
          )
          const retryResult = await postFormWithFallback(
            noCookiePaths,
            checkPayload,
            12000,
            { cookieProfile: 'pc' }
          )
          if (retryResult.ok) {
            checkResult = retryResult
          }
        }
      }

      if (!checkResult.ok || !checkResult.result?.data) {
        return {
          ok: false,
          error: 'QR_CHECK_REQUEST_FAILED',
          message: checkResult.error || 'QR_CHECK_REQUEST_FAILED'
        }
      }

      const result = checkResult.result
      const data = result.data
      const code = Number(data?.code || 0)
      const message = extractApiErrorMessage(data)

      const pollCookie = normalizeCookieHeader(result.headers['set-cookie'])
      if (pollCookie) {
        // Some QR flows rotate anti-risk cookies during polling; keep latest in memory.
        authState.cookie = pollCookie
      }

      if (code === 803) {
        const cookie = normalizeCookieHeader(result.headers['set-cookie'])
        const bodyCookie = String(data?.cookie || '').trim()
        if (cookie) {
          authState.cookie = cookie
          await persistAuthState()
        } else if (bodyCookie) {
          authState.cookie = bodyCookie
          await persistAuthState()
        }

        const profile = await refreshProfileFromAuth()
        emitAuthStateUpdate('qr-authorized')
        const verified = Boolean(profile?.userId || authState.userId)
        return {
          ok: true,
          code,
          status: 'AUTHORIZED',
          message: message || '授权成功',
          profile,
          verified,
          state: getPublicAuthState()
        }
      }

      if (code === 801) {
        return { ok: true, code, status: 'WAIT_SCAN', message: message || '等待扫码' }
      }

      if (code === 802) {
        return { ok: true, code, status: 'WAIT_CONFIRM', message: message || '等待确认' }
      }

      if (code === 800) {
        return { ok: true, code, status: 'EXPIRED', message: message || '二维码已过期' }
      }

      return {
        ok: false,
        error: 'QR_CHECK_FAILED',
        code,
        message: message || 'QR_CHECK_FAILED'
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'check-qr-login-failed',
        message: 'Failed to check QR login status',
        error: err
      })
      return { ok: false, error: 'QR_CHECK_EXCEPTION', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:auth:clear', async () => {
    await ensureAuthStateLoaded()
    clearAuthState()
    await persistAuthState()
    emitAuthStateUpdate('clear')
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:verify', async () => {
    await ensureAuthStateLoaded()
    try {
      const data = await requestNeteaseApi('/api/w/nuser/account/get', {}, { method: 'POST' })
      const profile = data?.profile || null
      if (profile) {
        applyProfileToAuthState(profile)
        await enrichAuthStateProfileByUserId(authState.userId)
        await persistAuthState()
        emitAuthStateUpdate('verify')
      }
      return {
        ok: true,
        profile: profile
          ? {
              userId: String(profile.userId || ''),
              nickname: profile.nickname || '',
              avatarUrl: profile.avatarUrl || '',
              signature: profile.signature || '',
              follows: Number(profile.follows || 0),
              followeds: Number(profile.followeds || 0),
              vipType: Number(profile.vipType || 0)
            }
          : null,
        code: Number(data?.code || 0)
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'verify-auth-failed',
        message: 'Failed to verify NetEase auth',
        error: err
      })
      return { ok: false, error: 'VERIFY_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:auth:request', async (_event: unknown, payload: NeteaseAuthRequestPayload) => {
    await ensureAuthStateLoaded()

    const pathValue = String(payload?.path || '').trim()
    if (!pathValue) {
      return { ok: false, error: 'INVALID_PATH' }
    }

    try {
      const data = await requestNeteaseApi(pathValue, payload?.data || {}, {
        method: String(payload?.method || 'POST').toUpperCase(),
        timeout: Number(payload?.timeout || 12000)
      })
      return { ok: true, data }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'auth-request-failed',
        message: 'Failed to call authenticated NetEase API',
        error: err,
        data: { path: pathValue }
      })
      return { ok: false, error: 'REQUEST_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:get-daily-recommendation', async () => {
    await ensureAuthStateLoaded()

    if (!authState.cookie && !authState.userId) {
      return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
    }

    try {
      const dailyResult = await postFormWithFallback(
        [
          '/api/v1/discovery/recommend/songs',
          '/weapi/v1/discovery/recommend/songs',
          '/recommend/songs'
        ],
        {},
        12000,
        { cookieProfile: 'ios' }
      )

      if (!dailyResult.ok || !dailyResult.result?.data) {
        return {
          ok: false,
          error: 'REQUEST_FAILED',
          message: dailyResult.error || 'REQUEST_FAILED'
        }
      }

      const data = dailyResult.result.data
      const code = Number(data?.code || 0)
      if (code && code !== 200) {
        const message = extractApiErrorMessage(data) || 'REQUEST_FAILED'
        if (isRiskControlMessage(message)) {
          return { ok: false, error: 'LOGIN_RISK_BLOCKED', code, message }
        }
        return { ok: false, error: 'REQUEST_FAILED', code, message }
      }

      const tracks = normalizeDailyRecommendationTracks(data)
      if (!tracks.length) {
        return { ok: false, error: 'EMPTY_DAILY_RECOMMENDATION', message: '今日暂无推荐歌曲' }
      }

      const now = new Date()
      const dayKey = now.toISOString().slice(0, 10).replace(/-/g, '')

      return {
        ok: true,
        data: {
          playlist: {
            id: `netease-daily-${dayKey}`,
            name: '每日推荐',
            source: 'netease',
            platform: 'netease',
            platformPlaylistId: 'daily-recommendation',
            creator: {
              userId: String(authState.userId || ''),
              nickname: String(authState.userName || '').trim() || '网易云用户'
            },
            coverUrl: tracks[0]?.coverUrl || '',
            updateTime: now.toISOString(),
            description: '网易云每日推荐歌曲',
            tags: ['daily-recommendation', 'netease'],
            trackCount: tracks.length,
            trackIds: tracks.map((item) => String(item.id))
          },
          tracks
        }
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'get-daily-recommendation-failed',
        message: 'Failed to fetch daily recommendation',
        error: err
      })
      return { ok: false, error: 'REQUEST_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:get-recommended-playlists', async (_event, payload: { limit?: unknown } = {}) => {
    await ensureAuthStateLoaded()

    if (!authState.cookie && !authState.userId) {
      return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
    }

    const requestedLimit = Number(payload?.limit)
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(60, Math.trunc(requestedLimit)))
      : 30

    try {
      const recommendResult = await postFormWithFallback(
        [
          '/weapi/personalized/playlist',
          '/api/personalized/playlist',
          '/personalized'
        ],
        {
          limit,
          total: true,
          n: 1000
        },
        12000,
        { cookieProfile: 'ios' }
      )

      if (!recommendResult.ok || !recommendResult.result?.data) {
        return {
          ok: false,
          error: 'REQUEST_FAILED',
          message: recommendResult.error || 'REQUEST_FAILED'
        }
      }

      const data = recommendResult.result.data
      const code = Number(data?.code || 0)
      if (code && code !== 200) {
        const message = extractApiErrorMessage(data) || 'REQUEST_FAILED'
        if (isRiskControlMessage(message)) {
          return { ok: false, error: 'LOGIN_RISK_BLOCKED', code, message }
        }
        return { ok: false, error: 'REQUEST_FAILED', code, message }
      }

      const playlists = normalizeRecommendedPlaylists(data)
      if (!playlists.length) {
        return { ok: false, error: 'EMPTY_RECOMMENDED_PLAYLISTS', message: '暂无推荐歌单' }
      }

      return {
        ok: true,
        data: playlists,
        meta: {
          fetchedAt: new Date().toISOString(),
          source: 'personalized',
          limit
        }
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'get-recommended-playlists-failed',
        message: 'Failed to fetch recommended playlists',
        error: err
      })
      return { ok: false, error: 'REQUEST_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:user-playlists', async () => {
    await ensureAuthStateLoaded()
    await loadCloudPlaylistState()

    const result = await fetchUserCloudPlaylists()
    if (!result?.ok) {
      return result
    }

    for (const item of result.data) {
      upsertCloudPlaylistReference(item, {
        forceCollected: true,
        sourceKinds: item.sourceKinds
      })
    }
    await saveCloudPlaylistState()

    return {
      ok: true,
      data: result.data,
      state: cloudPlaylistState
    }
  })

  ipcMain.handle('netease:cloud-playlist:list', async () => {
    await ensureAuthStateLoaded()
    await loadCloudPlaylistState()
    return {
      ok: true,
      data: cloudPlaylistState.playlists
    }
  })

  ipcMain.handle('netease:cloud-playlist:save-ref', async (_event: unknown, payload: NeteaseCloudPlaylistRefPayload) => {
    await ensureAuthStateLoaded()
    await loadCloudPlaylistState()

    const saved = upsertCloudPlaylistReference(payload, {
      forceCollected: typeof payload?.collected === 'boolean' ? payload.collected : undefined,
      sourceKinds: Array.isArray(payload?.sourceKinds) ? payload.sourceKinds : []
    })
    if (!saved) {
      return { ok: false, error: 'INVALID_PLAYLIST_ID', message: '歌单 ID 无效' }
    }

    await saveCloudPlaylistState()
    return { ok: true, data: saved }
  })

  ipcMain.handle('netease:cloud-playlist:remove-ref', async (_event: unknown, payload: NeteaseCloudPlaylistRefPayload) => {
    await ensureAuthStateLoaded()
    await loadCloudPlaylistState()

    const playlistId = sanitizeId(payload?.platformPlaylistId || payload?.playlistId || payload?.id)
    if (!playlistId) {
      return { ok: false, error: 'INVALID_PLAYLIST_ID', message: '歌单 ID 无效' }
    }

    const before = cloudPlaylistState.playlists.length
    cloudPlaylistState.playlists = cloudPlaylistState.playlists.filter((item) => item.platformPlaylistId !== playlistId)
    const removed = cloudPlaylistState.playlists.length !== before
    if (removed) {
      await saveCloudPlaylistState()
    }

    return { ok: true, removed }
  })

  ipcMain.handle('netease:search', async (_event: unknown, payload: NeteaseSearchPayload) => {
    await ensureAuthStateLoaded()
    return searchNeteaseByKeyword(payload)
  })

  ipcMain.handle('netease:search-suggest', async (_event: unknown, payload: NeteaseSearchPayload) => {
    await ensureAuthStateLoaded()
    return searchNeteaseSuggest(payload)
  })

  ipcMain.handle('netease:search-default', async () => {
    await ensureAuthStateLoaded()
    return fetchNeteaseSearchDefaultKeyword()
  })

  ipcMain.handle('netease:search-hot', async () => {
    await ensureAuthStateLoaded()
    return fetchNeteaseSearchHot()
  })

  ipcMain.handle('netease:search-hot-detail', async () => {
    await ensureAuthStateLoaded()
    return fetchNeteaseSearchHotDetail()
  })

  ipcMain.handle('netease:search-multimatch', async (_event: unknown, payload: NeteaseSearchPayload) => {
    await ensureAuthStateLoaded()
    return searchNeteaseMultimatch(payload)
  })

  ipcMain.handle('netease:playlist-detail', async (_event: unknown, payload: NeteasePlaylistDetailPayload) => {
    await ensureAuthStateLoaded()

    const playlistId = sanitizeId(payload?.playlistId)
    if (!playlistId) {
      return { ok: false, error: 'INVALID_PLAYLIST_ID', message: '歌单 ID 无效' }
    }

    try {
      const playlist = await fetchPlaylistTracksById(playlistId)
      if (!playlist) {
        return { ok: false, error: 'PLAYLIST_NOT_FOUND', message: '未找到对应歌单' }
      }

      return { ok: true, data: playlist }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'playlist-detail-failed',
        message: 'Failed to fetch NetEase playlist detail',
        error: err,
        data: { playlistId }
      })
      return { ok: false, error: 'REQUEST_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:send-text', async (_event: unknown, payload: NeteaseSendPayload) => {
    await ensureAuthStateLoaded()
    if (!authState.cookie && !authState.userId) {
      return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
    }

    return sendNeteasePrivateMessage({
      ...payload,
      sendType: 'text'
    })
  })

  ipcMain.handle('netease:send-song', async (_event: unknown, payload: NeteaseSendPayload) => {
    await ensureAuthStateLoaded()
    if (!authState.cookie && !authState.userId) {
      return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
    }

    return sendNeteasePrivateMessage({
      ...payload,
      sendType: 'song',
      songId: payload?.songId || payload?.id
    })
  })

  ipcMain.handle('netease:send-album', async (_event: unknown, payload: NeteaseSendPayload) => {
    await ensureAuthStateLoaded()
    if (!authState.cookie && !authState.userId) {
      return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
    }

    return sendNeteasePrivateMessage({
      ...payload,
      sendType: 'album',
      albumId: payload?.albumId || payload?.id
    })
  })

  ipcMain.handle('netease:send-playlist', async (_event: unknown, payload: NeteaseSendPayload) => {
    await ensureAuthStateLoaded()
    if (!authState.cookie && !authState.userId) {
      return { ok: false, error: 'NOT_LOGGED_IN', message: '请先登录网易云账号' }
    }

    return sendNeteasePrivateMessage({
      ...payload,
      sendType: 'playlist',
      playlistId: payload?.playlistId || payload?.id
    })
  })

  ipcMain.handle('netease:resolve-song-download-url', async (_event: unknown, payload: NeteaseResolveSongDownloadUrlPayload) => {
    await ensureAuthStateLoaded()

    const songId = sanitizeSongId(payload?.songId)
    if (!songId) {
      return { ok: false, error: 'INVALID_SONG_ID' }
    }

    const level = String(payload?.level || 'exhigh').trim() || 'exhigh'
    try {
      const resolveResult = await resolveSongUrlWithLevelFallback(songId, level)
      if (!resolveResult.ok || !resolveResult.resolved?.url) {
        return {
          ok: false,
          error: 'URL_NOT_FOUND',
          message: resolveResult.message,
          attempts: resolveResult.attempts || []
        }
      }

      const resolved = resolveResult.resolved

      if (!isNeteaseAudioHost(resolved.url)) {
        return {
          ok: false,
          error: 'URL_NOT_ALLOWED',
          message: `音源地址不在白名单域名内: ${resolved.url}`
        }
      }

      return {
        ok: true,
        resolved,
        pickedLevel: resolveResult.pickedLevel,
        attempts: resolveResult.attempts
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'resolve-song-download-url-failed',
        message: 'Failed to resolve song download URL',
        error: err,
        data: { songId }
      })
      return { ok: false, error: 'RESOLVE_URL_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:download-by-song-id', async (_event: unknown, payload: NeteaseDownloadBySongIdPayload) => {
    try {
      return await createSongDownloadTaskFromId({
        ...payload,
        source: 'song-id',
        targetDirType: payload?.targetDirType || 'songs',
        duplicateStrategy: payload?.duplicateStrategy || 'skip',
        downloadMode: payload?.downloadMode || 'song-download-only',
        addToQueue: Boolean(payload?.addToQueue),
        savePlaylistName: payload?.savePlaylistName || ''
      })
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'create-song-download-task-failed',
        message: 'Failed to create song-id download task',
        error: err
      })
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:download-song-task', async (_event: unknown, payload: NeteaseDownloadSongTaskPayload) => {
    const mode = String(payload?.mode || 'song-download-only').trim()
    const modeMap: Record<string, { targetDirType: string; addToQueue: boolean }> = {
      'song-download-only': { targetDirType: 'songs', addToQueue: false },
      'song-temp-queue-only': { targetDirType: 'temp', addToQueue: true },
      'song-download-and-queue': { targetDirType: 'songs', addToQueue: true }
    }

    const resolvedMode = modeMap[mode] || modeMap['song-download-only']
    const addToQueue =
      typeof payload?.addToQueue === 'boolean'
        ? payload.addToQueue
        : resolvedMode.addToQueue

    try {
      return await createSongDownloadTaskFromId({
        ...payload,
        targetDirType: resolvedMode.targetDirType,
        addToQueue,
        duplicateStrategy: payload?.duplicateStrategy || 'skip',
        downloadMode: mode,
        source: 'song-id'
      })
    } catch (err: unknown) {
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:download-playlist-by-id', async (_event: unknown, payload: NeteaseDownloadPlaylistByIdPayload) => {
    await ensureAuthStateLoaded()

    const playlistId = sanitizeId(payload?.playlistId)
    if (!playlistId) return { ok: false, error: 'INVALID_PLAYLIST_ID' }

    const mode = String(payload?.mode || 'playlist-download-only').trim()
    const level = String(payload?.level || 'exhigh').trim() || 'exhigh'
    const duplicateStrategy = String(payload?.duplicateStrategy || 'skip').trim().toLowerCase() || 'skip'

    try {
      const playlist = await fetchPlaylistTracksById(playlistId)
      if (!playlist || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
        return { ok: false, error: 'PLAYLIST_EMPTY_OR_NOT_FOUND' }
      }

      const optionsByMode: Record<string, { targetDirType: string; addToQueue: boolean; savePlaylistName: string }> = {
        'playlist-download-only': {
          targetDirType: 'lists',
          addToQueue: false,
          savePlaylistName: ''
        },
        'playlist-download-and-queue': {
          targetDirType: 'lists',
          addToQueue: true,
          savePlaylistName: ''
        },
        'playlist-download-and-save': {
          targetDirType: 'lists',
          addToQueue: false,
          savePlaylistName: playlist.name
        }
      }

      const selected = optionsByMode[mode] || optionsByMode['playlist-download-only']
      const savePlaylistBatchKey = selected.savePlaylistName ? createTaskId() : ''

      const createdTasks = []
      const failedItems = []
      for (const track of playlist.tracks) {
        try {
          const created = await createSongDownloadTaskFromId({
            songId: track.songId,
            level,
            title: track.title,
            fileName: `${track.title || `歌曲 ${track.songId}`}-${level}`,
            targetDirType: selected.targetDirType,
            playlistName: playlist.name,
            duplicateStrategy,
            source: 'playlist-id',
            downloadMode: mode,
            playlistContext: {
              playlistId,
              playlistName: playlist.name,
              creator: playlist.creator || ''
            },
            addToQueue: selected.addToQueue,
            savePlaylistName: selected.savePlaylistName,
            savePlaylistBatchKey
          })

          if (created?.ok && created.task) {
            createdTasks.push(created.task)
          } else {
            failedItems.push({ songId: track.songId, error: created?.error || 'DOWNLOAD_CREATE_FAILED' })
          }
        } catch (err: unknown) {
          failedItems.push({ songId: track.songId, error: getErrorMessage(err) || 'DOWNLOAD_CREATE_FAILED' })
        }
      }

      return {
        ok: true,
        playlist: {
          id: playlist.id,
          name: playlist.name,
          creator: playlist.creator,
          trackCount: playlist.trackCount
        },
        createdCount: createdTasks.length,
        failedCount: failedItems.length,
        tasks: createdTasks,
        failedItems
      }
    } catch (err: unknown) {
      logProgramEvent({
        source: 'netease.index',
        event: 'create-playlist-download-tasks-failed',
        message: 'Failed to create playlist download tasks',
        error: err
      })
      return { ok: false, error: 'PLAYLIST_DOWNLOAD_CREATE_FAILED', message: getErrorMessage(err) }
    }
  })

  ipcMain.handle('netease:download-task:list', async () => {
    return { ok: true, tasks: listDownloadTasks() }
  })

  ipcMain.handle('netease:download-task:cancel', async (_event: unknown, payload: NeteaseDownloadTaskCancelPayload) => {
    const id = String(payload?.id || '').trim()
    if (!id) return { ok: false, error: 'INVALID_TASK_ID' }

    return cancelDownloadTask(id)
  })
}

export { registerNeteaseHandlers }

