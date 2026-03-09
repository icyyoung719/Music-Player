const { ipcMain, shell, BrowserWindow, app } = require('electron')
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

let handlersRegistered = false

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'MyPlayerDownloads')
const AUTH_STORE_NAME = 'netease-auth.json'
const TRACK_METADATA_STORE_NAME = 'netease-track-metadata.json'
const TRACK_COVER_DIR_NAME = 'netease-track-covers'
const MAX_DOWNLOAD_CONCURRENCY = 2
const NETEASE_BASE_COOKIE = 'appver=2.7.1.198277; os=pc'

let authLoaded = false
let authState = {
  apiBaseUrl: 'https://music.163.com',
  cookie: '',
  accessToken: '',
  refreshToken: '',
  userName: '',
  userId: '',
  updatedAt: 0
}

let trackMetadataLoaded = false
let trackMetadataStore = {}

const downloadTasks = new Map()
const pendingTaskIds = []
const activeDownloadHandles = new Map()
let activeDownloadCount = 0

function requestJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers || {}
  const body = options.body || null
  const timeout = Number(options.timeout || 12000)
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
          ...headers
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP_${res.statusCode || 'UNKNOWN'}`))
          res.resume()
          return
        }

        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve(data)
          } catch (err) {
            reject(err)
          }
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function requestJsonWithMeta(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers || {}
  const body = options.body || null
  const timeout = Number(options.timeout || 12000)
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data = null
          try {
            data = JSON.parse(text)
          } catch {
            data = null
          }

          resolve({
            statusCode: Number(res.statusCode || 0),
            headers: res.headers || {},
            data,
            rawText: text
          })
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function requestBuffer(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers || {}
  const timeout = Number(options.timeout || 12000)
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
          ...headers
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP_${res.statusCode || 'UNKNOWN'}`))
          res.resume()
          return
        }

        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve(Buffer.concat(chunks))
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })
    req.end()
  })
}

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex')
}

function sanitizeEmail(email) {
  const text = String(email || '').trim()
  if (!text || !/^\S+@\S+\.\S+$/.test(text)) return null
  return text
}

function sanitizePhone(phone) {
  const text = String(phone || '').trim()
  if (!/^\d{5,20}$/.test(text)) return null
  return text
}

function sanitizeCountryCode(countryCode) {
  const text = String(countryCode || '').trim()
  if (!/^\d{1,4}$/.test(text)) return '86'
  return text
}

function sanitizeCaptcha(captcha) {
  const text = String(captcha || '').trim()
  if (!/^\d{4,8}$/.test(text)) return null
  return text
}

function sanitizeQrKey(qrKey) {
  const text = String(qrKey || '').trim()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(text)) return null
  return text
}

function normalizeCookieHeader(setCookieHeader) {
  if (!Array.isArray(setCookieHeader)) return ''
  return setCookieHeader
    .map((line) => String(line || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

function extractApiErrorMessage(data) {
  return String(data?.msg || data?.message || '').trim()
}

function isRiskControlMessage(text) {
  const value = String(text || '')
  return /安全风险|risk|high risk|SEC_RISK/i.test(value)
}

function getCandidateApiPaths(basePath) {
  const p = String(basePath || '').trim()
  if (!p) return []

  if (p.startsWith('/api/')) {
    return [p, p.replace('/api/', '/')]
  }

  if (p.startsWith('/')) {
    return [p, `/api${p}`]
  }

  return [`/${p}`, `/api/${p}`]
}

async function postFormWithFallback(paths, data, timeout = 12000) {
  const attempted = []
  let lastError = null

  for (const pathValue of paths) {
    try {
      const base = String(authState.apiBaseUrl || 'https://music.163.com').replace(/\/+$/, '')
      const url = `${base}${pathValue}`
      const body = encodeFormData(data)

      const result = await requestJsonWithMeta(url, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }),
        body,
        timeout
      })

      return { ok: true, path: pathValue, result, attempted }
    } catch (err) {
      lastError = err
      attempted.push({ path: pathValue, error: err?.message || 'REQUEST_FAILED' })
    }
  }

  return {
    ok: false,
    attempted,
    error: lastError ? String(lastError.message || 'REQUEST_FAILED') : 'REQUEST_FAILED'
  }
}

async function refreshProfileFromAuth() {
  try {
    const data = await requestNeteaseApi('/api/w/nuser/account/get', {}, { method: 'POST' })
    const profile = data?.profile || null
    if (!profile) return null

    authState.userId = String(profile.userId || authState.userId || '')
    authState.userName = String(profile.nickname || authState.userName || '')
    await persistAuthState()

    return {
      userId: authState.userId,
      userName: authState.userName
    }
  } catch {
    return null
  }
}

async function buildQrCodeDataUrl(content) {
  const api = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(content)}`
  const pngBuffer = await requestBuffer(api, {
    timeout: 12000
  })
  return `data:image/png;base64,${pngBuffer.toString('base64')}`
}

function getAuthStorePath() {
  return path.join(app.getPath('userData'), AUTH_STORE_NAME)
}

function getTrackMetadataStorePath() {
  return path.join(app.getPath('userData'), TRACK_METADATA_STORE_NAME)
}

function getTrackCoverDirPath() {
  return path.join(app.getPath('userData'), TRACK_COVER_DIR_NAME)
}

function normalizeTrackPathKey(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function ensureTrackMetadataLoaded() {
  if (trackMetadataLoaded) return
  trackMetadataLoaded = true

  try {
    const content = await fs.promises.readFile(getTrackMetadataStorePath(), 'utf8')
    const parsed = JSON.parse(content)
    trackMetadataStore = parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    trackMetadataStore = {}
    if (err.code !== 'ENOENT') {
      console.error('Failed to read netease track metadata store:', err)
    }
  }
}

async function persistTrackMetadataStore() {
  await fs.promises.mkdir(path.dirname(getTrackMetadataStorePath()), { recursive: true })
  await fs.promises.writeFile(getTrackMetadataStorePath(), JSON.stringify(trackMetadataStore, null, 2), 'utf8')
}

function normalizeAudioExt(value) {
  const text = String(value || '').replace(/^\./, '').trim().toLowerCase()
  const allowed = new Set(['mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus'])
  if (allowed.has(text)) return text
  return ''
}

function resolveAudioExtByUrl(rawUrl) {
  try {
    const ext = path.extname(new URL(rawUrl).pathname || '')
    return normalizeAudioExt(ext)
  } catch {
    return ''
  }
}

function resolveAudioExtByResolvedUrl(resolved) {
  const fromType = normalizeAudioExt(resolved?.type)
  if (fromType) return fromType
  const fromUrl = resolveAudioExtByUrl(resolved?.url)
  if (fromUrl) return fromUrl
  return 'mp3'
}

function resolveCoverExtByUrl(rawUrl) {
  try {
    const ext = path.extname(new URL(rawUrl).pathname || '').replace('.', '').toLowerCase()
    const allowed = new Set(['jpg', 'jpeg', 'png', 'webp'])
    if (allowed.has(ext)) return ext === 'jpeg' ? 'jpg' : ext
  } catch {
    // fall through
  }
  return 'jpg'
}

function extractSongMetadata(song, fallbackSongId) {
  if (!song || typeof song !== 'object') return null

  const artist = Array.isArray(song.ar)
    ? song.ar.map((item) => item?.name).filter(Boolean).join(' / ')
    : Array.isArray(song.artists)
      ? song.artists.map((item) => item?.name).filter(Boolean).join(' / ')
      : ''

  const album = song.al || song.album || null
  const publishTime = Number(album?.publishTime || 0)
  const year = publishTime > 0 ? new Date(publishTime).getFullYear() : null

  return {
    songId: String(song.id || fallbackSongId || ''),
    title: String(song.name || '').trim(),
    artist: String(artist || '').trim(),
    album: String(album?.name || '').trim(),
    year: Number.isFinite(year) ? year : null,
    coverUrl: String(album?.picUrl || '').trim()
  }
}

async function fetchSongMetadataById(songId) {
  try {
    const url = `https://music.163.com/api/song/detail/?ids=[${songId}]`
    const data = await requestJson(url)
    const song = Array.isArray(data?.songs) ? data.songs[0] : null
    return extractSongMetadata(song, songId)
  } catch (err) {
    console.warn('Failed to fetch song detail metadata:', err?.message || err)
    return null
  }
}

async function persistTrackMetadataForTask(task) {
  if (!task || !task.filePath || task.status !== 'succeeded') return

  const sourceMetadata = task.songMetadata && typeof task.songMetadata === 'object'
    ? task.songMetadata
    : null
  if (!sourceMetadata) return

  const entry = {
    songId: sourceMetadata.songId || task.songId || '',
    title: sourceMetadata.title || task.title || path.basename(task.filePath),
    artist: sourceMetadata.artist || '',
    album: sourceMetadata.album || '',
    year: Number.isFinite(Number(sourceMetadata.year)) ? Number(sourceMetadata.year) : null,
    coverPath: '',
    coverUrl: sourceMetadata.coverUrl || '',
    updatedAt: Date.now()
  }

  if (entry.coverUrl) {
    try {
      const coverBuffer = await requestBuffer(entry.coverUrl, {
        headers: buildAuthHeaders(),
        timeout: 12000
      })
      if (coverBuffer.length > 0) {
        await fs.promises.mkdir(getTrackCoverDirPath(), { recursive: true })
        const songIdPart = entry.songId || md5(task.filePath)
        const ext = resolveCoverExtByUrl(entry.coverUrl)
        const coverPath = path.join(getTrackCoverDirPath(), `${songIdPart}.${ext}`)
        await fs.promises.writeFile(coverPath, coverBuffer)
        entry.coverPath = coverPath
      }
    } catch (err) {
      console.warn('Failed to cache NetEase cover image:', err?.message || err)
    }
  }

  await ensureTrackMetadataLoaded()
  trackMetadataStore[normalizeTrackPathKey(task.filePath)] = entry
  await persistTrackMetadataStore()
}

async function ensureAuthStateLoaded() {
  if (authLoaded) return
  authLoaded = true

  try {
    const content = await fs.promises.readFile(getAuthStorePath(), 'utf8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      authState = {
        ...authState,
        ...parsed
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to read netease auth state:', err)
    }
  }
}

async function persistAuthState() {
  authState.updatedAt = Date.now()
  await fs.promises.mkdir(path.dirname(getAuthStorePath()), { recursive: true })
  await fs.promises.writeFile(getAuthStorePath(), JSON.stringify(authState, null, 2), 'utf8')
}

function getPublicAuthState() {
  return {
    apiBaseUrl: authState.apiBaseUrl,
    userName: authState.userName,
    userId: authState.userId,
    hasCookie: Boolean(authState.cookie),
    hasAccessToken: Boolean(authState.accessToken),
    hasRefreshToken: Boolean(authState.refreshToken),
    updatedAt: authState.updatedAt || 0
  }
}

function buildAuthHeaders(extraHeaders = {}) {
  const headers = {
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Connection: 'keep-alive',
    Referer: 'https://music.163.com/',
    Origin: 'https://music.163.com',
    ...extraHeaders
  }

  const runtimeCookie = String(authState.cookie || '').trim()
  headers.Cookie = runtimeCookie
    ? `${NETEASE_BASE_COOKIE}; ${runtimeCookie}`
    : NETEASE_BASE_COOKIE

  if (authState.accessToken) {
    headers.Authorization = `Bearer ${authState.accessToken}`
  }

  return headers
}

function createTaskId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emitDownloadTaskUpdate(task) {
  const payload = { ...task }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('netease:download-task-updated', payload)
    }
  }
}

function listDownloadTasks() {
  return Array.from(downloadTasks.values()).sort((a, b) => b.createdAt - a.createdAt)
}

function maybeAddFileExt(fileName, url) {
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(fileName)
  if (hasExt) return fileName
  try {
    const pathname = new URL(url).pathname || ''
    const ext = path.extname(pathname)
    if (ext) return `${fileName}${ext}`
  } catch {
    return fileName
  }
  return fileName
}

function sanitizeSongId(songId) {
  const text = String(songId || '').trim()
  if (!/^\d{1,20}$/.test(text)) return null
  return text
}

function encodeFormData(data) {
  const entries = Object.entries(data || {})
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&')
}

async function requestNeteaseApi(pathname, data = {}, options = {}) {
  const base = String(authState.apiBaseUrl || 'https://music.163.com').replace(/\/+$/, '')
  const pathValue = pathname.startsWith('/') ? pathname : `/${pathname}`
  const url = `${base}${pathValue}`
  const body = encodeFormData(data)

  return requestJson(url, {
    method: options.method || 'POST',
    headers: buildAuthHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }),
    body,
    timeout: options.timeout || 12000
  })
}

function resolveSongDownloadUrlResponse(json, songId) {
  const dataList = Array.isArray(json?.data) ? json.data : []
  const exact = dataList.find((item) => String(item?.id || '') === String(songId))
  const first = exact || dataList[0]
  const url = first?.url || ''
  if (!url) return null
  return {
    url,
    songId: String(first?.id || songId),
    level: first?.level || '',
    type: first?.type || '',
    size: Number(first?.size || 0)
  }
}

function buildFallbackLevels(preferred) {
  const base = [preferred, 'exhigh', 'higher', 'standard', 'lossless']
  const seen = new Set()
  const result = []
  for (const level of base) {
    const v = String(level || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    result.push(v)
  }
  return result
}

async function resolveSongUrlWithLevelFallback(songId, preferredLevel) {
  const levels = buildFallbackLevels(preferredLevel)
  const attempts = []
  let lastMessage = ''

  for (const level of levels) {
    try {
      const data = await requestNeteaseApi('/api/song/enhance/player/url/v1', {
        ids: JSON.stringify([Number(songId)]),
        level,
        encodeType: 'flac'
      })

      const resolved = resolveSongDownloadUrlResponse(data, songId)
      attempts.push({ level, ok: Boolean(resolved?.url) })

      if (resolved?.url) {
        return {
          ok: true,
          resolved,
          pickedLevel: level,
          attempts
        }
      }

      lastMessage = extractApiErrorMessage(data) || lastMessage
    } catch (err) {
      attempts.push({ level, ok: false, error: err?.message || 'REQUEST_FAILED' })
      lastMessage = err?.message || lastMessage
    }
  }

  return {
    ok: false,
    error: 'URL_NOT_FOUND',
    message: lastMessage || '未获取到可用音源，可能受版权或账号权限限制',
    attempts
  }
}

function isNeteaseAudioHost(rawUrl) {
  try {
    const u = new URL(rawUrl)
    const protocolAllowed = u.protocol === 'https:' || u.protocol === 'http:'
    if (!protocolAllowed) return false

    const hostAllowed =
      /(^|\.)music\.126\.net$/i.test(u.hostname) ||
      /(^|\.)vod\.126\.net$/i.test(u.hostname) ||
      /(^|\.)nosdn\.127\.net$/i.test(u.hostname)

    return hostAllowed
  } catch {
    return false
  }
}

function startDownloadWithProgress(task) {
  return new Promise((resolve, reject) => {
    let redirected = 0

    const run = (targetUrl) => {
      const client = targetUrl.startsWith('https:') ? https : http
      const req = client.get(
        targetUrl,
        {
          headers: buildAuthHeaders()
        },
        (res) => {
          if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            if (redirected >= 4) {
              reject(new Error('TOO_MANY_REDIRECTS'))
              res.resume()
              return
            }

            redirected++
            const nextUrl = new URL(res.headers.location, targetUrl).toString()
            res.resume()
            run(nextUrl)
            return
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP_${res.statusCode || 'UNKNOWN'}`))
            res.resume()
            return
          }

          const totalBytes = Number(res.headers['content-length'] || 0)
          let receivedBytes = 0
          const stream = fs.createWriteStream(task.filePath)
          activeDownloadHandles.set(task.id, { request: req, stream })

          res.on('data', (chunk) => {
            receivedBytes += chunk.length
            task.receivedBytes = receivedBytes
            task.totalBytes = totalBytes
            task.progress = totalBytes > 0 ? receivedBytes / totalBytes : 0
            task.updatedAt = Date.now()
            emitDownloadTaskUpdate(task)
          })

          res.pipe(stream)

          stream.on('finish', () => {
            stream.close(() => resolve(task.filePath))
          })

          stream.on('error', (err) => {
            stream.close(() => reject(err))
          })
        }
      )

      req.on('error', reject)
      req.setTimeout(60000, () => {
        req.destroy(new Error('DOWNLOAD_TIMEOUT'))
      })
    }

    run(task.url)
  })
}

async function runSingleTask(taskId) {
  const task = downloadTasks.get(taskId)
  if (!task || task.status !== 'pending') return

  task.status = 'downloading'
  task.startedAt = Date.now()
  task.updatedAt = Date.now()
  emitDownloadTaskUpdate(task)

  try {
    await fs.promises.mkdir(path.dirname(task.filePath), { recursive: true })
    await startDownloadWithProgress(task)

    task.status = 'succeeded'
    task.progress = 1
    task.finishedAt = Date.now()
    task.updatedAt = Date.now()
    await persistTrackMetadataForTask(task)
    emitDownloadTaskUpdate(task)
  } catch (err) {
    const isCanceled = task.status === 'canceled'
    if (!isCanceled) {
      task.status = 'failed'
      task.error = err?.message || 'DOWNLOAD_FAILED'
      task.finishedAt = Date.now()
      task.updatedAt = Date.now()
      emitDownloadTaskUpdate(task)
    }
  } finally {
    activeDownloadHandles.delete(taskId)
  }
}

async function consumeDownloadQueue() {
  while (activeDownloadCount < MAX_DOWNLOAD_CONCURRENCY && pendingTaskIds.length > 0) {
    const nextTaskId = pendingTaskIds.shift()
    activeDownloadCount++

    runSingleTask(nextTaskId)
      .catch(() => {})
      .finally(() => {
        activeDownloadCount = Math.max(0, activeDownloadCount - 1)
        consumeDownloadQueue()
      })
  }
}

async function createDownloadTask(payload) {
  await fs.promises.mkdir(DEFAULT_DOWNLOAD_DIR, { recursive: true })

  const fileNameInput = safeFileName(payload.fileName || `song-${payload.songId || Date.now()}`)
  const finalFileName = maybeAddFileExt(fileNameInput, payload.url)
  const filePath = path.join(DEFAULT_DOWNLOAD_DIR, finalFileName)
  const id = createTaskId()
  const now = Date.now()

  const task = {
    id,
    source: payload.source || 'song-id',
    songId: payload.songId || '',
    title: payload.title || finalFileName,
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : null,
    url: payload.url,
    filePath,
    status: 'pending',
    progress: 0,
    totalBytes: 0,
    receivedBytes: 0,
    error: '',
    createdAt: now,
    updatedAt: now
  }

  downloadTasks.set(task.id, task)
  pendingTaskIds.push(task.id)
  emitDownloadTaskUpdate(task)
  consumeDownloadQueue()

  return { ok: true, task }
}

function sanitizeId(id) {
  const text = String(id || '').trim()
  if (!/^\d{1,20}$/.test(text)) return null
  return text
}

function getSongPageUrl(songId) {
  return `https://music.163.com/#/song?id=${songId}`
}

function getPlaylistPageUrl(playlistId) {
  return `https://music.163.com/#/playlist?id=${playlistId}`
}

function safeFileName(name) {
  return String(name || 'download')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'download'
}

function isAllowedDownloadHost(rawUrl) {
  return isNeteaseAudioHost(rawUrl)
}

function registerNeteaseHandlers() {
  if (handlersRegistered) return
  handlersRegistered = true

  ensureAuthStateLoaded().catch((err) => {
    console.error('Failed to initialize NetEase auth state:', err)
  })

  ipcMain.handle('netease:resolve-id', async (_event, payload) => {
    const id = sanitizeId(payload?.id)
    const type = payload?.type === 'playlist' ? 'playlist' : 'song'

    if (!id) {
      return { ok: false, error: 'INVALID_ID' }
    }

    try {
      if (type === 'song') {
        const url = `https://music.163.com/api/song/detail/?ids=[${id}]`
        const data = await requestJson(url)
        const song = Array.isArray(data?.songs) ? data.songs[0] : null
        if (!song) return { ok: false, error: 'NOT_FOUND' }

        return {
          ok: true,
          type,
          item: {
            id,
            name: song.name || `歌曲 ${id}`,
            artist: Array.isArray(song.artists)
              ? song.artists.map((a) => a?.name).filter(Boolean).join(' / ')
              : '',
            album: song.album?.name || '',
            durationMs: Number(song.duration) || 0,
            pageUrl: getSongPageUrl(id)
          }
        }
      }

      const url = `https://music.163.com/api/v6/playlist/detail?id=${id}`
      const data = await requestJson(url)
      const playlist = data?.playlist
      if (!playlist) return { ok: false, error: 'NOT_FOUND' }

      const tracks = Array.isArray(playlist.tracks)
        ? playlist.tracks.slice(0, 20).map((track) => ({
            id: String(track?.id || ''),
            name: track?.name || '未知歌曲',
            artist: Array.isArray(track?.ar)
              ? track.ar.map((a) => a?.name).filter(Boolean).join(' / ')
              : ''
          }))
        : []

      return {
        ok: true,
        type,
        item: {
          id,
          name: playlist.name || `歌单 ${id}`,
          trackCount: Number(playlist.trackCount) || tracks.length,
          creator: playlist.creator?.nickname || '',
          pageUrl: getPlaylistPageUrl(id),
          tracks
        }
      }
    } catch (err) {
      console.error('Failed to resolve NetEase id:', err)
      return { ok: false, error: 'REQUEST_FAILED' }
    }
  })

  ipcMain.handle('netease:open-page', async (_event, payload) => {
    const id = sanitizeId(payload?.id)
    const type = payload?.type === 'playlist' ? 'playlist' : 'song'
    if (!id) return { ok: false, error: 'INVALID_ID' }

    const pageUrl = type === 'playlist' ? getPlaylistPageUrl(id) : getSongPageUrl(id)
    await shell.openExternal(pageUrl)
    return { ok: true, pageUrl }
  })

  ipcMain.handle('netease:open-external-url', async (_event, payload) => {
    const url = String(payload?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'INVALID_URL' }
    }

    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('netease:get-download-dir', async () => {
    try {
      await fs.promises.mkdir(DEFAULT_DOWNLOAD_DIR, { recursive: true })
      return { ok: true, dir: DEFAULT_DOWNLOAD_DIR }
    } catch (err) {
      console.error('Failed to prepare download dir:', err)
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  // Only supports downloading direct, authorized HTTPS links from music.126.net.
  ipcMain.handle('netease:download-direct', async (_event, payload) => {
    const rawUrl = String(payload?.url || '').trim()
    const fileName = safeFileName(payload?.fileName || 'netease-download.mp3')

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
    } catch (err) {
      console.error('Failed to download direct URL:', err)
      return { ok: false, error: 'DOWNLOAD_FAILED' }
    }
  })

  ipcMain.handle('netease:auth:get-state', async () => {
    await ensureAuthStateLoaded()
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:update', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const nextBase = String(payload?.apiBaseUrl || authState.apiBaseUrl).trim()
    authState.apiBaseUrl = nextBase || 'https://music.163.com'
    authState.cookie = String(payload?.cookie ?? authState.cookie ?? '').trim()
    authState.accessToken = String(payload?.accessToken ?? authState.accessToken ?? '').trim()
    authState.refreshToken = String(payload?.refreshToken ?? authState.refreshToken ?? '').trim()
    authState.userName = String(payload?.userName ?? authState.userName ?? '').trim()
    authState.userId = String(payload?.userId ?? authState.userId ?? '').trim()

    await persistAuthState()
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:login-email', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const email = sanitizeEmail(payload?.email)
    const password = String(payload?.password || '')
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!email || !password) {
      return { ok: false, error: 'INVALID_CREDENTIALS' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const base = String(authState.apiBaseUrl).replace(/\/+$/, '')
      const url = `${base}/api/login`
      const body = encodeFormData({
        username: email,
        password: md5(password),
        rememberLogin: true
      })

      const result = await requestJsonWithMeta(url, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }),
        body,
        timeout: 12000
      })

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

      authState.userName = String(result.data?.profile?.nickname || authState.userName || '')
      authState.userId = String(result.data?.account?.id || result.data?.profile?.userId || authState.userId || '')
      await persistAuthState()

      return {
        ok: true,
        state: getPublicAuthState(),
        profile: {
          userName: authState.userName,
          userId: authState.userId
        }
      }
    } catch (err) {
      console.error('Failed to login with email:', err)
      return { ok: false, error: 'LOGIN_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:send-captcha', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const phone = sanitizePhone(payload?.phone)
    const countryCode = sanitizeCountryCode(payload?.countryCode)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!phone) {
      return { ok: false, error: 'INVALID_PHONE' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const sendResult = await postFormWithFallback(
        getCandidateApiPaths('/api/sms/captcha/sent'),
        {
          ctcode: countryCode,
          cellphone: phone
        }
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
            message: message || '当前登录存在安全风险，请稍后再试'
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
    } catch (err) {
      console.error('Failed to send phone captcha:', err)
      return { ok: false, error: 'SEND_CAPTCHA_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:login-captcha', async (_event, payload) => {
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
      const payloadData = {
        phone,
        cellphone: phone,
        captcha,
        countrycode: countryCode,
        ctcode: countryCode,
        rememberLogin: true
      }

      // Validate captcha first; this avoids some gateway variants rejecting direct login-captcha flow.
      const verifyResult = await postFormWithFallback(
        getCandidateApiPaths('/api/sms/captcha/verify'),
        {
          cellphone: phone,
          captcha,
          ctcode: countryCode
        }
      )

      if (verifyResult.ok && verifyResult.result?.data) {
        const verifyCode = Number(verifyResult.result.data?.code || 0)
        if (verifyCode !== 200) {
          const verifyMessage = extractApiErrorMessage(verifyResult.result.data)
          if (isRiskControlMessage(verifyMessage)) {
            return {
              ok: false,
              error: 'LOGIN_RISK_BLOCKED',
              code: verifyCode,
              message: verifyMessage || '当前登录存在安全风险，请稍后再试'
            }
          }
        }
      }

      const loginResult = await postFormWithFallback(
        getCandidateApiPaths('/api/login/cellphone'),
        payloadData
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
            message: message || '当前登录存在安全风险，请稍后再试'
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

      authState.userName = String(result.data?.profile?.nickname || authState.userName || '')
      authState.userId = String(result.data?.account?.id || result.data?.profile?.userId || authState.userId || '')
      await persistAuthState()

      return {
        ok: true,
        state: getPublicAuthState(),
        profile: {
          userName: authState.userName,
          userId: authState.userId
        }
      }
    } catch (err) {
      console.error('Failed to login with phone captcha:', err)
      return { ok: false, error: 'LOGIN_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:qr:create', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()
    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const keyResult = await postFormWithFallback(
        getCandidateApiPaths('/api/login/qrcode/unikey'),
        { type: 1 }
      )

      if (!keyResult.ok || !keyResult.result?.data) {
        return {
          ok: false,
          error: 'QR_KEY_REQUEST_FAILED',
          message: keyResult.error || 'QR_KEY_REQUEST_FAILED'
        }
      }

      const data = keyResult.result.data
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
      } catch (err) {
        console.warn('Failed to build QR image data URL:', err)
      }

      return {
        ok: true,
        qrKey,
        qrLoginUrl,
        qrDataUrl
      }
    } catch (err) {
      console.error('Failed to create QR login:', err)
      return { ok: false, error: 'QR_CREATE_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:qr:check', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const qrKey = sanitizeQrKey(payload?.qrKey)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!qrKey) {
      return { ok: false, error: 'INVALID_QR_KEY' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const checkResult = await postFormWithFallback(
        getCandidateApiPaths('/api/login/qrcode/client/login'),
        {
          key: qrKey,
          type: 1
        }
      )

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
    } catch (err) {
      console.error('Failed to check QR login status:', err)
      return { ok: false, error: 'QR_CHECK_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:clear', async () => {
    await ensureAuthStateLoaded()
    authState = {
      apiBaseUrl: 'https://music.163.com',
      cookie: '',
      accessToken: '',
      refreshToken: '',
      userName: '',
      userId: '',
      updatedAt: Date.now()
    }
    await persistAuthState()
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:verify', async () => {
    await ensureAuthStateLoaded()
    try {
      const data = await requestNeteaseApi('/api/w/nuser/account/get', {}, { method: 'POST' })
      const profile = data?.profile || null
      if (profile) {
        authState.userId = String(profile.userId || authState.userId || '')
        authState.userName = String(profile.nickname || authState.userName || '')
        await persistAuthState()
      }
      return {
        ok: true,
        profile: profile
          ? {
              userId: String(profile.userId || ''),
              nickname: profile.nickname || ''
            }
          : null,
        code: Number(data?.code || 0)
      }
    } catch (err) {
      console.error('Failed to verify NetEase auth:', err)
      return { ok: false, error: 'VERIFY_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:request', async (_event, payload) => {
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
    } catch (err) {
      console.error('Failed to call authenticated NetEase API:', err)
      return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:resolve-song-download-url', async (_event, payload) => {
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
    } catch (err) {
      console.error('Failed to resolve song download URL:', err)
      return { ok: false, error: 'RESOLVE_URL_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-by-song-id', async (_event, payload) => {
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
      const songMetadata = await fetchSongMetadataById(songId)

      if (!isNeteaseAudioHost(resolved.url)) {
        return {
          ok: false,
          error: 'URL_NOT_ALLOWED',
          message: `音源地址不在白名单域名内: ${resolved.url}`
        }
      }

      const defaultExt = resolveAudioExtByResolvedUrl(resolved)
      const defaultTitle = songMetadata?.title || `歌曲 ${songId}`
      const fileName = safeFileName(payload?.fileName || `${defaultTitle}-${level}.${defaultExt}`)
      const created = await createDownloadTask({
        source: 'song-id',
        songId,
        url: resolved.url,
        fileName,
        title: payload?.title || defaultTitle,
        songMetadata
      })

      return {
        ...created,
        pickedLevel: resolveResult.pickedLevel,
        attempts: resolveResult.attempts
      }
    } catch (err) {
      console.error('Failed to create song-id download task:', err)
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-task:list', async () => {
    return { ok: true, tasks: listDownloadTasks() }
  })

  ipcMain.handle('netease:download-task:cancel', async (_event, payload) => {
    const id = String(payload?.id || '').trim()
    if (!id) return { ok: false, error: 'INVALID_TASK_ID' }

    const task = downloadTasks.get(id)
    if (!task) return { ok: false, error: 'TASK_NOT_FOUND' }

    if (task.status === 'pending') {
      const index = pendingTaskIds.indexOf(id)
      if (index >= 0) pendingTaskIds.splice(index, 1)
      task.status = 'canceled'
      task.updatedAt = Date.now()
      emitDownloadTaskUpdate(task)
      return { ok: true, task }
    }

    if (task.status === 'downloading') {
      task.status = 'canceled'
      task.updatedAt = Date.now()
      const handle = activeDownloadHandles.get(id)
      if (handle?.request) {
        handle.request.destroy(new Error('TASK_CANCELED'))
      }
      if (handle?.stream) {
        handle.stream.destroy(new Error('TASK_CANCELED'))
      }
      emitDownloadTaskUpdate(task)
      return { ok: true, task }
    }

    return { ok: false, error: 'TASK_NOT_CANCELABLE' }
  })
}

module.exports = {
  registerNeteaseHandlers
}
