import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { BrowserWindow, app } from 'electron'
import { requestBuffer, requestJson, requestJsonWithMeta } from './httpClient'
const { logProgramEvent } = require('../logger') as {
  logProgramEvent: (payload: {
    source?: string
    event?: string
    message?: string
    data?: unknown
    error?: unknown
  }) => void
}

const AUTH_STORE_NAME = 'netease-auth.json'
const NETEASE_PC_COOKIE = 'appver=2.7.1.198277; os=pc'
const NETEASE_IOS_COOKIE = 'appver=8.10.90; os=ios'

type AuthState = {
  apiBaseUrl: string
  cookie: string
  accessToken: string
  refreshToken: string
  userName: string
  userId: string
  avatarUrl: string
  signature: string
  vipType: number
  follows: number
  followeds: number
  updatedAt: number
}

type PublicAuthState = {
  apiBaseUrl: string
  userName: string
  userId: string
  avatarUrl: string
  signature: string
  vipType: number
  follows: number
  followeds: number
  isLoggedIn: boolean
  hasCookie: boolean
  hasAccessToken: boolean
  hasRefreshToken: boolean
  updatedAt: number
}

type PublicAccountSummary = {
  isLoggedIn: boolean
  userName: string
  userId: string
  avatarUrl: string
  signature: string
  follows: number
  followeds: number
  vipType: number
  vipLabel: string
}

type ProfileLike = {
  userId?: string | number
  nickname?: string
  avatarUrl?: string
  signature?: string
  vipType?: number
  follows?: number
  followeds?: number
}

type AuthHeadersOptions = {
  cookieProfile?: string
}

type RequestApiOptions = {
  method?: string
  timeout?: number
}

type FallbackAttempt = {
  path: string
  error: string
}

type FallbackResult<T> =
  | {
      ok: true
      path: string
      result: { statusCode: number; headers: Record<string, unknown>; data: T | null; rawText: string }
      attempted: FallbackAttempt[]
    }
  | {
      ok: false
      attempted: FallbackAttempt[]
      error: string
    }

const DEFAULT_AUTH_STATE: AuthState = {
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

export function md5(text: string): string {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex')
}

export function sanitizeEmail(email: string): string | null {
  const text = String(email || '').trim()
  if (!text || !/^\S+@\S+\.\S+$/.test(text)) return null
  return text
}

export function sanitizePhone(phone: string): string | null {
  const text = String(phone || '').trim()
  if (!/^\d{5,20}$/.test(text)) return null
  return text
}

export function sanitizeCountryCode(countryCode: string): string {
  const text = String(countryCode || '').trim()
  if (!/^\d{1,4}$/.test(text)) return '86'
  return text
}

export function sanitizeCaptcha(captcha: string): string | null {
  const text = String(captcha || '').trim()
  if (!/^\d{4,8}$/.test(text)) return null
  return text
}

export function sanitizeQrKey(qrKey: string): string | null {
  const text = String(qrKey || '').trim()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(text)) return null
  return text
}

export function normalizeAvatarUrl(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^http:\/\//i, 'https://')
}

export function normalizeCookieHeader(setCookieHeader: unknown): string {
  if (!Array.isArray(setCookieHeader)) return ''
  return setCookieHeader
    .map((line) => String(line || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

export function extractApiErrorMessage(data: { msg?: string; message?: string } | null | undefined): string {
  return String(data?.msg || data?.message || '').trim()
}

export function isRiskControlMessage(text: string): boolean {
  const value = String(text || '')
  return /安全风险|risk|high risk|SEC_RISK/i.test(value)
}

export function getCandidateApiPaths(basePath: string): string[] {
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

export function encodeFormData(data: Record<string, unknown>): string {
  const entries = Object.entries(data || {})
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&')
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

export function buildAuthHeaders(
  extraHeaders: Record<string, string> = {},
  options: AuthHeadersOptions = {}
): Record<string, string> {
  const cookieProfile = String(options?.cookieProfile || '').toLowerCase()
  const profileCookie = cookieProfile === 'ios' ? NETEASE_IOS_COOKIE : NETEASE_PC_COOKIE
  const headers: Record<string, string> = {
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

export async function requestNeteaseApi<T = unknown>(
  pathname: string,
  data: Record<string, unknown> = {},
  options: RequestApiOptions = {}
): Promise<T> {
  const base = String(authState.apiBaseUrl || 'https://music.163.com').replace(/\/+$/, '')
  const pathValue = pathname.startsWith('/') ? pathname : `/${pathname}`
  const url = `${base}${pathValue}`
  const body = encodeFormData(data)

  return requestJson<T>(url, {
    method: options.method || 'POST',
    headers: buildAuthHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body))
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
export async function postFormWithFallback<T = unknown>(
  paths: string[],
  data: Record<string, unknown>,
  timeout = 12000,
  options: AuthHeadersOptions = {}
): Promise<FallbackResult<T>> {
  const attempted: FallbackAttempt[] = []
  let lastError: Error | null = null

  for (const pathValue of paths) {
    try {
      const base = String(authState.apiBaseUrl || 'https://music.163.com').replace(/\/+$/, '')
      const url = `${base}${pathValue}`
      const body = encodeFormData(data)

      const result = await requestJsonWithMeta<T>(url, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(body))
        }, options),
        body,
        timeout
      })

      // Some endpoints (e.g. weapi without encrypted payload) may reply 200 with empty body.
      // In that case we should continue trying fallback paths instead of returning early.
      const hasJsonBody = Boolean(result && result.data && typeof result.data === 'object')
      if (!hasJsonBody) {
        attempted.push({ path: pathValue, error: 'EMPTY_OR_INVALID_JSON_RESPONSE' })
        continue
      }

      return { ok: true, path: pathValue, result, attempted }
    } catch (err) {
      const typedErr = err instanceof Error ? err : new Error('REQUEST_FAILED')
      lastError = typedErr
      attempted.push({ path: pathValue, error: typedErr.message || 'REQUEST_FAILED' })
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

export function getAuthStorePath(): string {
  return path.join(app.getPath('userData'), AUTH_STORE_NAME)
}

export async function ensureAuthStateLoaded(): Promise<void> {
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
    const typedErr = err as NodeJS.ErrnoException
    if (typedErr.code !== 'ENOENT') {
      logProgramEvent({
        source: 'netease.authManager',
        event: 'read-auth-state-failed',
        message: 'Failed to read netease auth state',
        error: err
      })
    }
  }
}

export async function persistAuthState(): Promise<void> {
  authState.updatedAt = Date.now()
  await fs.promises.mkdir(path.dirname(getAuthStorePath()), { recursive: true })
  await fs.promises.writeFile(getAuthStorePath(), JSON.stringify(authState, null, 2), 'utf8')
}

export function clearAuthState(): void {
  Object.assign(authState, {
    ...DEFAULT_AUTH_STATE,
    updatedAt: Date.now()
  })
}

// ---------------------------------------------------------------------------
// Auth state views
// ---------------------------------------------------------------------------

export function getPublicAuthState(): PublicAuthState {
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

export function getPublicAccountSummary(): PublicAccountSummary {
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

export function emitAuthStateUpdate(reason = 'changed'): void {
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

export function applyProfileToAuthState(profile: ProfileLike | null | undefined): void {
  if (!profile || typeof profile !== 'object') return

  authState.userId = String(profile.userId || authState.userId || '')
  authState.userName = String(profile.nickname || authState.userName || '')
  authState.avatarUrl = normalizeAvatarUrl(profile.avatarUrl || authState.avatarUrl || '')
  authState.signature = String(profile.signature || authState.signature || '')
  authState.vipType = Number(profile.vipType ?? authState.vipType ?? 0) || 0
  authState.follows = Number(profile.follows ?? authState.follows ?? 0) || 0
  authState.followeds = Number(profile.followeds ?? authState.followeds ?? 0) || 0
}

async function fetchUserDetailProfile(userId: string): Promise<ProfileLike | null> {
  const uid = String(userId || '').trim()
  if (!uid) return null

  try {
    const url = `https://music.163.com/api/v1/user/detail/${encodeURIComponent(uid)}`
    const data = await requestJson<{ profile?: ProfileLike }>(url, {
      method: 'GET',
      headers: buildAuthHeaders(),
      timeout: 12000
    })
    return data?.profile || null
  } catch {
    return null
  }
}

export async function enrichAuthStateProfileByUserId(userId: string): Promise<void> {
  const detailProfile = await fetchUserDetailProfile(userId)
  if (!detailProfile) return
  applyProfileToAuthState(detailProfile)
}

export async function refreshProfileFromAuth(): Promise<PublicAccountSummary | null> {
  try {
    let profile: ProfileLike | null = null

    const profileResult = await postFormWithFallback(
      ['/api/w/nuser/account/get', '/weapi/w/nuser/account/get', '/login/status'],
      {},
      12000,
      { cookieProfile: 'ios' }
    )

    if (profileResult.ok && profileResult.result?.data) {
      const data = profileResult.result.data as
        | { profile?: ProfileLike; data?: { profile?: ProfileLike } }
        | null
      profile = data?.profile || data?.data?.profile || null
    }

    if (!profile) {
      const data = await requestNeteaseApi<{ profile?: ProfileLike }>('/api/w/nuser/account/get', {}, { method: 'POST' })
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

export async function buildQrCodeDataUrl(content: string): Promise<string> {
  const api = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(content)}`
  const pngBuffer = await requestBuffer(api, { timeout: 12000 })
  return `data:image/png;base64,${pngBuffer.toString('base64')}`
}

export { authState }
