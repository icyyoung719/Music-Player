const { ipcMain, shell, BrowserWindow, app } = require('electron')
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

let handlersRegistered = false

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'MyPlayerDownloads')
const DOWNLOAD_DIR_SONGS = 'Songs'
const DOWNLOAD_DIR_TEMP = 'Temp'
const DOWNLOAD_DIR_LISTS = 'Lists'
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
  avatarUrl: '',
  signature: '',
  vipType: 0,
  follows: 0,
  followeds: 0,
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

function normalizeAvatarUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^http:\/\//i, 'https://')
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

    applyProfileToAuthState(profile)
    await enrichAuthStateProfileByUserId(authState.userId)
    await persistAuthState()

    return getPublicAccountSummary()
  } catch {
    return null
  }
}

async function fetchUserDetailProfile(userId) {
  const uid = String(userId || '').trim()
  if (!uid) return null

  try {
    const url = `https://music.163.com/api/v1/user/detail/${encodeURIComponent(uid)}`
    const data = await requestJson(url, {
      method: 'GET',
      headers: buildAuthHeaders(),
      timeout: 12000
    })
    return data?.profile || null
  } catch {
    return null
  }
}

async function enrichAuthStateProfileByUserId(userId) {
  const detailProfile = await fetchUserDetailProfile(userId)
  if (!detailProfile) return
  applyProfileToAuthState(detailProfile)
}

function applyProfileToAuthState(profile) {
  if (!profile || typeof profile !== 'object') return

  authState.userId = String(profile.userId || authState.userId || '')
  authState.userName = String(profile.nickname || authState.userName || '')
  authState.avatarUrl = normalizeAvatarUrl(profile.avatarUrl || authState.avatarUrl || '')
  authState.signature = String(profile.signature || authState.signature || '')
  authState.vipType = Number(profile.vipType ?? authState.vipType ?? 0) || 0
  authState.follows = Number(profile.follows ?? authState.follows ?? 0) || 0
  authState.followeds = Number(profile.followeds ?? authState.followeds ?? 0) || 0
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

function resolveCoverMimeByExt(ext) {
  const value = String(ext || '').replace('.', '').toLowerCase()
  if (value === 'png') return 'image/png'
  if (value === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function toSynchsafeInt(value) {
  const safe = Math.max(0, Number(value) || 0)
  return Buffer.from([
    (safe >> 21) & 0x7f,
    (safe >> 14) & 0x7f,
    (safe >> 7) & 0x7f,
    safe & 0x7f
  ])
}

function fromSynchsafeInt(buffer, startIndex) {
  if (!buffer || buffer.length < startIndex + 4) return 0
  return (
    ((buffer[startIndex] & 0x7f) << 21) |
    ((buffer[startIndex + 1] & 0x7f) << 14) |
    ((buffer[startIndex + 2] & 0x7f) << 7) |
    (buffer[startIndex + 3] & 0x7f)
  )
}

function buildId3v23Frame(frameId, payload) {
  const id = String(frameId || '').trim()
  if (!/^[A-Z0-9]{4}$/.test(id)) return Buffer.alloc(0)
  const data = Buffer.isBuffer(payload) ? payload : Buffer.alloc(0)
  if (!data.length) return Buffer.alloc(0)

  const header = Buffer.alloc(10)
  header.write(id, 0, 4, 'ascii')
  header.writeUInt32BE(data.length, 4)
  header.writeUInt16BE(0, 8)
  return Buffer.concat([header, data])
}

function encodeUtf16Text(text) {
  const value = String(text || '')
  const bom = Buffer.from([0xff, 0xfe])
  return Buffer.concat([bom, Buffer.from(value, 'utf16le')])
}

function buildTextFrame(frameId, value) {
  const text = String(value || '').trim()
  if (!text) return Buffer.alloc(0)
  const payload = Buffer.concat([Buffer.from([0x01]), encodeUtf16Text(text)])
  return buildId3v23Frame(frameId, payload)
}

function buildApicFrame(imageBuffer, mimeType) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) return Buffer.alloc(0)
  const mime = String(mimeType || 'image/jpeg').toLowerCase()
  const mimePart = Buffer.from(mime, 'ascii')
  const payload = Buffer.concat([
    Buffer.from([0x00]),
    mimePart,
    Buffer.from([0x00]),
    Buffer.from([0x03]),
    Buffer.from([0x00]),
    imageBuffer
  ])
  return buildId3v23Frame('APIC', payload)
}

function buildUsltFrame(lyrics, language = 'XXX') {
  const text = String(lyrics || '').trim()
  if (!text) return Buffer.alloc(0)
  
  // Empty content descriptor: UTF-16 BOM plus null terminator (2 zero bytes)
  const contentDesc = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0x00, 0x00])])
  
  const payload = Buffer.concat([
    Buffer.from([0x01]), // Target text encoding: UTF-16 with BOM
    Buffer.from(language.padEnd(3, ' ').substring(0, 3), 'ascii'),
    contentDesc,
    encodeUtf16Text(text)
  ])
  return buildId3v23Frame('USLT', payload)
}

function stripLeadingId3Tag(audioBuffer) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 10) return audioBuffer
  if (audioBuffer[0] !== 0x49 || audioBuffer[1] !== 0x44 || audioBuffer[2] !== 0x33) return audioBuffer

  const flags = audioBuffer[5]
  const tagSize = fromSynchsafeInt(audioBuffer, 6)
  const hasFooter = (flags & 0x10) !== 0
  const totalSize = 10 + tagSize + (hasFooter ? 10 : 0)

  if (totalSize <= 0 || totalSize >= audioBuffer.length) return audioBuffer
  return audioBuffer.slice(totalSize)
}

async function writeId3TagsToMp3(filePath, metadata, coverBuffer, coverMime) {
  const ext = String(path.extname(filePath || '')).toLowerCase()
  if (ext !== '.mp3') return false

  const title = String(metadata?.title || '').trim()
  const artist = String(metadata?.artist || '').trim()
  const album = String(metadata?.album || '').trim()
  const year = metadata?.year != null ? String(metadata.year).trim() : ''
  const lyrics = String(metadata?.lyrics || '').trim()

  const frames = [
    buildTextFrame('TIT2', title),
    buildTextFrame('TPE1', artist),
    buildTextFrame('TALB', album),
    buildTextFrame('TYER', year),
    buildUsltFrame(lyrics),
    buildApicFrame(coverBuffer, coverMime)
  ].filter((frame) => frame.length > 0)

  if (!frames.length) return false

  const tagBody = Buffer.concat(frames)
  const tagHeader = Buffer.from([
    0x49, 0x44, 0x33,
    0x03, 0x00,
    0x00,
    ...toSynchsafeInt(tagBody.length)
  ])

  const original = await fs.promises.readFile(filePath)
  const strippedAudio = stripLeadingId3Tag(original)
  const nextBuffer = Buffer.concat([tagHeader, tagBody, strippedAudio])
  await fs.promises.writeFile(filePath, nextBuffer)
  return true
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

async function fetchSongLyricsById(songId) {
  try {
    const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=-1&tv=-1`
    const data = await requestJson(url)
    const lrc = data?.lrc?.lyric || ''
    return lrc.trim()
  } catch (err) {
    console.warn('Failed to fetch song lyrics:', err?.message || err)
    return ''
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

  // Fetch lyrics
  if (entry.songId) {
    const lyrics = await fetchSongLyricsById(entry.songId)
    if (lyrics) {
      entry.lyrics = lyrics
    }
  }

  let coverBuffer = null
  let coverMime = 'image/jpeg'

  if (entry.coverUrl) {
    try {
      coverBuffer = await requestBuffer(entry.coverUrl, {
        headers: buildAuthHeaders(),
        timeout: 12000
      })
      if (coverBuffer.length > 0) {
        await fs.promises.mkdir(getTrackCoverDirPath(), { recursive: true })
        const songIdPart = entry.songId || md5(task.filePath)
        const ext = resolveCoverExtByUrl(entry.coverUrl)
        coverMime = resolveCoverMimeByExt(ext)
        const coverPath = path.join(getTrackCoverDirPath(), `${songIdPart}.${ext}`)
        await fs.promises.writeFile(coverPath, coverBuffer)
        entry.coverPath = coverPath
      }
    } catch (err) {
      console.warn('Failed to cache NetEase cover image:', err?.message || err)
    }
  }

  try {
    await writeId3TagsToMp3(task.filePath, entry, coverBuffer, coverMime)
  } catch (err) {
    console.warn('Failed to write ID3 tag for mp3:', err?.message || err)
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
      authState.avatarUrl = normalizeAvatarUrl(authState.avatarUrl)
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
    avatarUrl: authState.avatarUrl,
    signature: authState.signature,
    vipType: Number(authState.vipType || 0),
    follows: Number(authState.follows || 0),
    followeds: Number(authState.followeds || 0),
    isLoggedIn: Boolean(authState.userId || authState.cookie),
    hasCookie: Boolean(authState.cookie),
    hasAccessToken: Boolean(authState.accessToken),
    hasRefreshToken: Boolean(authState.refreshToken),
    updatedAt: authState.updatedAt || 0
  }
}

function getPublicAccountSummary() {
  const vipType = Number(authState.vipType || 0)
  const isLoggedIn = Boolean(authState.userId || authState.cookie)
  return {
    isLoggedIn,
    userName: authState.userName || '',
    userId: authState.userId || '',
    avatarUrl: authState.avatarUrl || '',
    signature: authState.signature || '',
    follows: Number(authState.follows || 0),
    followeds: Number(authState.followeds || 0),
    vipType,
    vipLabel: vipType > 0 ? `VIP ${vipType}` : '普通用户'
  }
}

function emitAuthStateUpdate(reason = 'changed') {
  const payload = {
    reason,
    state: getPublicAuthState(),
    account: getPublicAccountSummary()
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('netease:auth:state-updated', payload)
    }
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

function emitGlobalToast(payload) {
  const message = String(payload?.message || '').trim()
  if (!message) return

  const toastPayload = {
    id: createTaskId(),
    message,
    level: String(payload?.level || 'info'),
    createdAt: Date.now(),
    ...payload
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:toast', toastPayload)
    }
  }
}

function getDownloadRootDir() {
  return DEFAULT_DOWNLOAD_DIR
}

function safeFolderName(name, fallback = 'default') {
  const value = safeFileName(name || fallback)
  return value || fallback
}

function resolveDownloadDir(dirType, playlistName) {
  const type = String(dirType || 'songs').trim().toLowerCase()
  const rootDir = getDownloadRootDir()

  if (type === 'temp') {
    return { dirType: 'temp', dirPath: path.join(rootDir, DOWNLOAD_DIR_TEMP) }
  }

  if (type === 'lists') {
    const child = safeFolderName(playlistName || '未命名歌单', '未命名歌单')
    return {
      dirType: 'lists',
      dirPath: path.join(rootDir, DOWNLOAD_DIR_LISTS, child),
      playlistFolder: child
    }
  }

  return { dirType: 'songs', dirPath: path.join(rootDir, DOWNLOAD_DIR_SONGS) }
}

async function ensureDownloadBaseDirs() {
  const root = getDownloadRootDir()
  const songsDir = resolveDownloadDir('songs').dirPath
  const tempDir = resolveDownloadDir('temp').dirPath
  const listsDir = path.join(root, DOWNLOAD_DIR_LISTS)

  await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.mkdir(songsDir, { recursive: true })
  await fs.promises.mkdir(tempDir, { recursive: true })
  await fs.promises.mkdir(listsDir, { recursive: true })

  return {
    root,
    songs: songsDir,
    temp: tempDir,
    lists: listsDir
  }
}

async function countFilesRecursive(targetDir) {
  let count = 0
  const stack = [targetDir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        count++
      }
    }
  }
  return count
}

function createSkippedTask(payload) {
  const id = createTaskId()
  const now = Date.now()
  return {
    id,
    source: payload.source || 'song-id',
    songId: payload.songId || '',
    title: payload.title || payload.fileName || `song-${payload.songId || now}`,
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : null,
    url: payload.url,
    filePath: payload.filePath,
    status: 'skipped',
    progress: 1,
    totalBytes: 0,
    receivedBytes: 0,
    error: payload.error || '',
    skipReason: payload.skipReason || 'duplicate',
    downloadMode: payload.downloadMode || 'song-download-only',
    targetDirType: payload.targetDirType || 'songs',
    playlistContext:
      payload.playlistContext && typeof payload.playlistContext === 'object'
        ? payload.playlistContext
        : null,
    addToQueue: Boolean(payload.addToQueue),
    savePlaylistName: String(payload.savePlaylistName || '').trim(),
    savePlaylistBatchKey: String(payload.savePlaylistBatchKey || '').trim(),
    createdAt: now,
    updatedAt: now,
    finishedAt: now
  }
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
    emitGlobalToast({
      level: 'success',
      message: `下载完成: ${task.title || task.songId || path.basename(task.filePath || '')}`,
      taskId: task.id,
      taskStatus: task.status
    })
  } catch (err) {
    const isCanceled = task.status === 'canceled'
    if (!isCanceled) {
      task.status = 'failed'
      task.error = err?.message || 'DOWNLOAD_FAILED'
      task.finishedAt = Date.now()
      task.updatedAt = Date.now()
      emitDownloadTaskUpdate(task)
      emitGlobalToast({
        level: 'error',
        message: `下载失败: ${task.title || task.songId || task.id}`,
        taskId: task.id,
        taskStatus: task.status,
        error: task.error
      })
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
  await ensureDownloadBaseDirs()

  const fileNameInput = safeFileName(payload.fileName || `song-${payload.songId || Date.now()}`)
  const finalFileName = maybeAddFileExt(fileNameInput, payload.url)
  const dirResolved = resolveDownloadDir(payload.targetDirType, payload.playlistName)
  await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
  const filePath = path.join(dirResolved.dirPath, finalFileName)

  const duplicateStrategy = String(payload.duplicateStrategy || 'skip').trim().toLowerCase()
  if (duplicateStrategy === 'skip') {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
      const skippedTask = createSkippedTask({
        ...payload,
        filePath,
        fileName: finalFileName,
        skipReason: 'duplicate-file',
        targetDirType: dirResolved.dirType,
        playlistContext: payload.playlistContext
      })

      downloadTasks.set(skippedTask.id, skippedTask)
      emitDownloadTaskUpdate(skippedTask)
      emitGlobalToast({
        level: 'info',
        message: `已跳过重复下载: ${skippedTask.title || skippedTask.songId || finalFileName}`,
        taskId: skippedTask.id,
        taskStatus: skippedTask.status
      })
      return { ok: true, task: skippedTask }
    } catch {
      // ignore access errors, continue to create normal task
    }
  }

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
    skipReason: '',
    downloadMode: payload.downloadMode || 'song-download-only',
    targetDirType: dirResolved.dirType,
    playlistContext:
      payload.playlistContext && typeof payload.playlistContext === 'object'
        ? payload.playlistContext
        : null,
    addToQueue: Boolean(payload.addToQueue),
    savePlaylistName: String(payload.savePlaylistName || '').trim(),
    savePlaylistBatchKey: String(payload.savePlaylistBatchKey || '').trim(),
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

async function createSongDownloadTaskFromId(payload) {
  await ensureAuthStateLoaded()

  const songId = sanitizeSongId(payload?.songId)
  if (!songId) {
    return { ok: false, error: 'INVALID_SONG_ID' }
  }

  const level = String(payload?.level || 'exhigh').trim() || 'exhigh'

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
    source: payload?.source || 'song-id',
    songId,
    url: resolved.url,
    fileName,
    title: payload?.title || defaultTitle,
    songMetadata,
    targetDirType: payload?.targetDirType || 'songs',
    playlistName: payload?.playlistName || '',
    duplicateStrategy: payload?.duplicateStrategy || 'skip',
    downloadMode: payload?.downloadMode || 'song-download-only',
    playlistContext: payload?.playlistContext || null,
    addToQueue: Boolean(payload?.addToQueue),
    savePlaylistName: payload?.savePlaylistName || '',
    savePlaylistBatchKey: payload?.savePlaylistBatchKey || ''
  })

  return {
    ...created,
    pickedLevel: resolveResult.pickedLevel,
    attempts: resolveResult.attempts
  }
}

async function fetchPlaylistTracksById(playlistId) {
  const url = `https://music.163.com/api/v6/playlist/detail?id=${playlistId}`
  const data = await requestJson(url)
  const playlist = data?.playlist
  if (!playlist) return null

  const name = String(playlist.name || `歌单 ${playlistId}`).trim()
  const creator = String(playlist?.creator?.nickname || '').trim()
  const trackList = Array.isArray(playlist.tracks) ? playlist.tracks : []

  const tracks = trackList
    .map((track) => {
      const id = sanitizeSongId(track?.id)
      if (!id) return null
      const artist = Array.isArray(track?.ar)
        ? track.ar.map((item) => item?.name).filter(Boolean).join(' / ')
        : ''
      return {
        songId: id,
        title: String(track?.name || `歌曲 ${id}`).trim(),
        artist
      }
    })
    .filter(Boolean)

  return {
    id: String(playlistId),
    name,
    creator,
    trackCount: Number(playlist.trackCount || tracks.length),
    tracks
  }
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
      const dirs = await ensureDownloadBaseDirs()
      return { ok: true, dir: dirs.songs }
    } catch (err) {
      console.error('Failed to prepare download dir:', err)
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  ipcMain.handle('netease:get-download-dirs', async () => {
    try {
      const dirs = await ensureDownloadBaseDirs()
      return { ok: true, dirs }
    } catch (err) {
      console.error('Failed to prepare download dirs:', err)
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  ipcMain.handle('netease:open-download-dir', async (_event, payload) => {
    try {
      const dirResolved = resolveDownloadDir(payload?.dirType || 'songs', payload?.playlistName || '')
      await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
      const openError = await shell.openPath(dirResolved.dirPath)
      if (openError) {
        return { ok: false, error: 'OPEN_PATH_FAILED', message: openError }
      }
      return { ok: true, dirPath: dirResolved.dirPath, dirType: dirResolved.dirType }
    } catch (err) {
      return { ok: false, error: 'OPEN_PATH_FAILED', message: err?.message || '' }
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
    } catch (err) {
      return { ok: false, error: 'TEMP_CLEAR_FAILED', message: err?.message || '' }
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

  ipcMain.handle('netease:auth:get-account-summary', async (_event, payload) => {
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
    emitAuthStateUpdate('manual-update')
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
      avatarUrl: '',
      signature: '',
      vipType: 0,
      follows: 0,
      followeds: 0,
      updatedAt: Date.now()
    }
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
    } catch (err) {
      console.error('Failed to create song-id download task:', err)
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-song-task', async (_event, payload) => {
    const mode = String(payload?.mode || 'song-download-only').trim()
    const modeMap = {
      'song-download-only': { targetDirType: 'songs', addToQueue: false },
      'song-temp-queue-only': { targetDirType: 'temp', addToQueue: true },
      'song-download-and-queue': { targetDirType: 'songs', addToQueue: true }
    }

    const resolvedMode = modeMap[mode] || modeMap['song-download-only']

    try {
      return await createSongDownloadTaskFromId({
        ...payload,
        targetDirType: resolvedMode.targetDirType,
        addToQueue: resolvedMode.addToQueue,
        duplicateStrategy: payload?.duplicateStrategy || 'skip',
        downloadMode: mode,
        source: 'song-id'
      })
    } catch (err) {
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-playlist-by-id', async (_event, payload) => {
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

      const optionsByMode = {
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
            fileName: `${track.title || `歌曲 ${track.songId}`}-${level}.mp3`,
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
        } catch (err) {
          failedItems.push({ songId: track.songId, error: err?.message || 'DOWNLOAD_CREATE_FAILED' })
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
    } catch (err) {
      console.error('Failed to create playlist download tasks:', err)
      return { ok: false, error: 'PLAYLIST_DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
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
