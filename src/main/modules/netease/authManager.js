const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { BrowserWindow, app } = require('electron')
const { requestJson, requestJsonWithMeta, requestBuffer } = require('./httpClient')
const { logProgramEvent } = require('../logger')

const AUTH_STORE_NAME = 'netease-auth.json'
const NETEASE_PC_COOKIE = 'appver=2.7.1.198277; os=pc'
const NETEASE_IOS_COOKIE = 'appver=8.10.90; os=ios'

const DEFAULT_AUTH_STATE = {
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

let authLoaded = false
// Exported as a live object reference — always mutate properties, never reassign.
const authState = { ...DEFAULT_AUTH_STATE }

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

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

function encodeFormData(data) {
  const entries = Object.entries(data || {})
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&')
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function buildAuthHeaders(extraHeaders = {}, options = {}) {
  const cookieProfile = String(options?.cookieProfile || '').toLowerCase()
  const profileCookie = cookieProfile === 'ios' ? NETEASE_IOS_COOKIE : NETEASE_PC_COOKIE
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
    ? `${profileCookie}; ${runtimeCookie}`
    : profileCookie

  if (authState.accessToken) {
    headers.Authorization = `Bearer ${authState.accessToken}`
  }

  return headers
}

// ---------------------------------------------------------------------------
// Authenticated API request
// ---------------------------------------------------------------------------

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

// Post form data with automatic fallback across multiple endpoint paths.
// Each request call includes authState.cookie in headers, which is live-updated from
// previous Set-Cookie responses. This enables proper cookie-based session flow:
// e.g., /captcha/sent → Set-Cookie → /login/cellphone (with persisted cookie) → success.
// NOTE: Do NOT use this for stateless requests. Callers must manually update authState.cookie
// if Set-Cookie headers from response need to be persisted to authState.
async function postFormWithFallback(paths, data, timeout = 12000, options = {}) {
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
        }, options),
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

// ---------------------------------------------------------------------------
// Auth state persistence
// ---------------------------------------------------------------------------

function getAuthStorePath() {
  return path.join(app.getPath('userData'), AUTH_STORE_NAME)
}

async function ensureAuthStateLoaded() {
  if (authLoaded) return
  authLoaded = true

  try {
    const content = await fs.promises.readFile(getAuthStorePath(), 'utf8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      Object.assign(authState, parsed)
      authState.avatarUrl = normalizeAvatarUrl(authState.avatarUrl)
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logProgramEvent({
        source: 'netease.authManager',
        event: 'read-auth-state-failed',
        message: 'Failed to read netease auth state',
        error: err
      })
    }
  }
}

async function persistAuthState() {
  authState.updatedAt = Date.now()
  await fs.promises.mkdir(path.dirname(getAuthStorePath()), { recursive: true })
  await fs.promises.writeFile(getAuthStorePath(), JSON.stringify(authState, null, 2), 'utf8')
}

function clearAuthState() {
  Object.assign(authState, {
    ...DEFAULT_AUTH_STATE,
    updatedAt: Date.now()
  })
}

// ---------------------------------------------------------------------------
// Auth state views
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Profile management
// ---------------------------------------------------------------------------

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

async function refreshProfileFromAuth() {
  try {
    let profile = null

    const profileResult = await postFormWithFallback(
      ['/api/w/nuser/account/get', '/weapi/w/nuser/account/get', '/login/status'],
      {},
      12000,
      { cookieProfile: 'ios' }
    )

    if (profileResult.ok && profileResult.result?.data) {
      const data = profileResult.result.data
      profile = data?.profile || data?.data?.profile || null
    }

    if (!profile) {
      const data = await requestNeteaseApi('/api/w/nuser/account/get', {}, { method: 'POST' })
      profile = data?.profile || null
    }

    if (!profile) return null

    applyProfileToAuthState(profile)
    await enrichAuthStateProfileByUserId(authState.userId)
    await persistAuthState()

    return getPublicAccountSummary()
  } catch {
    return null
  }
}

async function buildQrCodeDataUrl(content) {
  const api = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(content)}`
  const pngBuffer = await requestBuffer(api, { timeout: 12000 })
  return `data:image/png;base64,${pngBuffer.toString('base64')}`
}

module.exports = {
  authState,
  ensureAuthStateLoaded,
  persistAuthState,
  clearAuthState,
  getPublicAuthState,
  getPublicAccountSummary,
  emitAuthStateUpdate,
  buildAuthHeaders,
  requestNeteaseApi,
  postFormWithFallback,
  encodeFormData,
  applyProfileToAuthState,
  enrichAuthStateProfileByUserId,
  refreshProfileFromAuth,
  buildQrCodeDataUrl,
  md5,
  sanitizeEmail,
  sanitizePhone,
  sanitizeCountryCode,
  sanitizeCaptcha,
  sanitizeQrKey,
  normalizeAvatarUrl,
  normalizeCookieHeader,
  extractApiErrorMessage,
  isRiskControlMessage,
  getCandidateApiPaths
}
