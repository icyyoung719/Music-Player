const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const PROFILE_COOKIE_PC = 'appver=2.7.1.198277; os=pc'
const PROFILE_COOKIE_IOS = 'appver=8.10.90; os=ios'

function parseArgs(argv) {
  const args = {
    authFile: '',
    outputDir: '',
    baseUrl: '',
    keyword: '周杰伦',
    songId: '',
    playlistId: '',
    sideEffectMode: 'safe',
    timeoutMs: 12000,
    limit: 30,
    includeAuthFallbacks: true,
    help: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if (token === '--help' || token === '-h') {
      args.help = true
    } else if (token === '--auth-file' && next) {
      args.authFile = next
      i += 1
    } else if (token === '--output-dir' && next) {
      args.outputDir = next
      i += 1
    } else if (token === '--base-url' && next) {
      args.baseUrl = next
      i += 1
    } else if (token === '--keyword' && next) {
      args.keyword = next
      i += 1
    } else if (token === '--song-id' && next) {
      args.songId = next
      i += 1
    } else if (token === '--playlist-id' && next) {
      args.playlistId = next
      i += 1
    } else if (token === '--side-effect-mode' && next) {
      args.sideEffectMode = next
      i += 1
    } else if (token === '--timeout-ms' && next) {
      args.timeoutMs = Number(next) || args.timeoutMs
      i += 1
    } else if (token === '--limit' && next) {
      args.limit = Number(next) || args.limit
      i += 1
    } else if (token === '--no-auth-fallbacks') {
      args.includeAuthFallbacks = false
    }
  }

  args.timeoutMs = Math.max(3000, Math.min(60000, Math.trunc(args.timeoutMs)))
  args.limit = Math.max(1, Math.min(60, Math.trunc(args.limit)))
  if (!['safe', 'live'].includes(args.sideEffectMode)) args.sideEffectMode = 'safe'

  return args
}

function printHelp() {
  const text = [
    'NetEase API Simulator',
    '',
    'Usage:',
    '  node tools/netease-api-sim/index.js [options]',
    '',
    'Options:',
    '  --auth-file <path>       Explicit netease-auth.json path',
    '  --output-dir <path>      Output directory for this run',
    '  --base-url <url>         Override API base url',
    '  --keyword <text>         Search keyword, default: 周杰伦',
    '  --song-id <id>           Prefer this song ID for song APIs',
    '  --playlist-id <id>       Prefer this playlist ID for playlist APIs',
    '  --limit <n>              Recommend list limit (1-60), default: 30',
    '  --timeout-ms <n>         Request timeout, default: 12000',
    '  --side-effect-mode <m>   safe | live, default: safe',
    '  --no-auth-fallbacks      Disable fallback path probing for auth APIs',
    '  -h, --help               Show this message',
    '',
    'Notes:',
    '  safe mode never sends valid private message payloads.',
    '  login APIs are called with demo credentials to observe error shapes only.'
  ]
  console.log(text.join('\n'))
}

function ensureDir(p) {
  return fsp.mkdir(p, { recursive: true })
}

async function fileExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

function nowTag() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`
}

function toSafeUrl(baseUrl, p) {
  const base = String(baseUrl || 'https://music.163.com').replace(/\/+$/, '')
  const pathname = String(p || '').startsWith('/') ? String(p) : `/${String(p || '')}`
  return `${base}${pathname}`
}

function toFormBody(data) {
  return Object.entries(data || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&')
}

function buildHeaders(authState, profile, method, body) {
  const cookieProfile = String(profile || 'pc').toLowerCase() === 'ios' ? PROFILE_COOKIE_IOS : PROFILE_COOKIE_PC
  const runtimeCookie = String(authState.cookie || '').trim()
  const cookie = runtimeCookie ? `${cookieProfile}; ${runtimeCookie}` : cookieProfile

  const headers = {
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Connection: 'keep-alive',
    Referer: 'https://music.163.com/',
    Origin: 'https://music.163.com',
    Cookie: cookie
  }

  if (String(authState.accessToken || '').trim()) {
    headers.Authorization = `Bearer ${String(authState.accessToken).trim()}`
  }

  if (String(method || 'GET').toUpperCase() !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    headers['Content-Length'] = String(Buffer.byteLength(body || ''))
  }

  return headers
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('REQUEST_TIMEOUT')), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

async function requestSingle({ authState, baseUrl, pathName, method = 'POST', data = {}, profile = 'pc', timeoutMs = 12000 }) {
  const requestMethod = String(method || 'POST').toUpperCase()
  const formBody = toFormBody(data)
  let url = toSafeUrl(baseUrl, pathName)

  if (requestMethod === 'GET' && formBody) {
    const joinChar = url.includes('?') ? '&' : '?'
    url = `${url}${joinChar}${formBody}`
  }

  const { signal, clear } = createAbortSignal(timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      method: requestMethod,
      headers: buildHeaders(authState, profile, requestMethod, formBody),
      body: requestMethod === 'GET' ? undefined : formBody,
      signal
    })

    const rawText = await response.text()
    const endedAt = Date.now()
    let json = null

    try {
      json = rawText ? JSON.parse(rawText) : null
    } catch {
      json = null
    }

    return {
      ok: response.ok,
      url,
      method: requestMethod,
      statusCode: response.status,
      statusText: response.statusText,
      elapsedMs: endedAt - startedAt,
      headers: Object.fromEntries(response.headers.entries()),
      body: json,
      rawText,
      parseError: json ? '' : (rawText ? 'INVALID_JSON' : '')
    }
  } catch (error) {
    const endedAt = Date.now()
    return {
      ok: false,
      url,
      method: requestMethod,
      statusCode: 0,
      statusText: 'REQUEST_FAILED',
      elapsedMs: endedAt - startedAt,
      headers: {},
      body: null,
      rawText: '',
      parseError: '',
      transportError: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clear()
  }
}

async function requestWithFallback({ authState, baseUrl, paths, method = 'POST', data = {}, profile = 'pc', timeoutMs = 12000 }) {
  const attempts = []
  let firstJsonResult = null
  let firstJsonPath = ''

  for (const p of paths) {
    const result = await requestSingle({
      authState,
      baseUrl,
      pathName: p,
      method,
      data,
      profile,
      timeoutMs
    })

    attempts.push({
      path: p,
      statusCode: result.statusCode,
      bodyCode: Number((result.body && result.body.code) || 0),
      elapsedMs: result.elapsedMs,
      transportError: result.transportError || '',
      parseError: result.parseError || ''
    })

    const hasJson = result.body && typeof result.body === 'object'
    if (hasJson) {
      const bodyCode = Number((result.body && result.body.code) || 0)
      const success = Boolean(result.ok) && (!bodyCode || bodyCode === 200)
      if (success) {
        return { result, pathUsed: p, attempts }
      }

      if (!firstJsonResult) {
        firstJsonResult = result
        firstJsonPath = p
      }
    }
  }

  if (firstJsonResult) {
    return { result: firstJsonResult, pathUsed: firstJsonPath, attempts }
  }

  return { result: null, pathUsed: '', attempts }
}

function sanitizeText(input) {
  return String(input == null ? '' : input).trim()
}

function normalizeId(value) {
  const text = sanitizeText(value)
  return /^\d{1,20}$/.test(text) ? text : ''
}

function pickFirstSongId(searchJson) {
  const payload = searchJson && typeof searchJson === 'object' ? searchJson : {}
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {}
  const songs = Array.isArray(result.songs) ? result.songs : []
  for (const item of songs) {
    const id = normalizeId(item && item.id)
    if (id) return id
  }
  return ''
}

function pickFirstPlaylistId(userPlaylistJson) {
  const payload = userPlaylistJson && typeof userPlaylistJson === 'object' ? userPlaylistJson : {}
  const list = Array.isArray(payload.playlist) ? payload.playlist : []
  for (const item of list) {
    const id = normalizeId(item && item.id)
    if (id) return id
  }
  return ''
}

function hashSha1(value) {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex')
}

function trimLargeString(text, maxLength = 600) {
  const str = String(text || '')
  if (str.length <= maxLength) return str
  const keep = Math.floor(maxLength / 2)
  return {
    __type: 'trimmed-string',
    length: str.length,
    head: str.slice(0, keep),
    tail: str.slice(-keep)
  }
}

function snapshotValue(value, depth = 0) {
  if (depth > 10) {
    return { __type: 'max-depth-reached' }
  }

  if (value == null) return value

  if (typeof value === 'string') {
    const text = value
    if (/^data:[^;]+;base64,/i.test(text) && text.length > 160) {
      return {
        __type: 'data-url',
        length: text.length,
        sha1: hashSha1(text),
        prefix: text.slice(0, 60),
        suffix: text.slice(-30)
      }
    }
    return trimLargeString(text)
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    const limit = 20
    const sampled = value.slice(0, limit).map((item) => snapshotValue(item, depth + 1))
    if (value.length > limit) {
      sampled.push({
        __type: 'truncated-array',
        originalLength: value.length,
        kept: limit
      })
    }
    return sampled
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    const maxKeys = 120
    const out = {}
    for (let i = 0; i < entries.length && i < maxKeys; i += 1) {
      const [k, v] = entries[i]
      out[k] = snapshotValue(v, depth + 1)
    }
    if (entries.length > maxKeys) {
      out.__truncatedKeys = {
        __type: 'truncated-object-keys',
        originalKeyCount: entries.length,
        kept: maxKeys
      }
    }
    return out
  }

  return String(value)
}

function countMissing(items, getter) {
  let total = 0
  let missing = 0
  for (const item of items) {
    total += 1
    const value = getter(item)
    if (!sanitizeText(value)) missing += 1
  }
  return { total, missing, missingRate: total ? Number((missing / total).toFixed(4)) : 0 }
}

function getSongArtist(song) {
  const ar = Array.isArray(song && song.ar) ? song.ar : []
  if (ar.length > 0) {
    return ar.map((x) => sanitizeText(x && x.name)).filter(Boolean).join(' / ')
  }
  const artists = Array.isArray(song && song.artists) ? song.artists : []
  if (artists.length > 0) {
    return artists.map((x) => sanitizeText(x && x.name)).filter(Boolean).join(' / ')
  }
  return ''
}

function getSongAlbum(song) {
  const al = song && song.al && typeof song.al === 'object' ? song.al : null
  const album = song && song.album && typeof song.album === 'object' ? song.album : null
  return sanitizeText((al && al.name) || (album && album.name) || '')
}

function buildUnknownAudit(executedMap) {
  const checks = []

  const searchJson = executedMap.search && executedMap.search.body
  const searchSongs = searchJson && searchJson.result && Array.isArray(searchJson.result.songs)
    ? searchJson.result.songs
    : []
  if (searchSongs.length > 0) {
    checks.push({
      id: 'search-song-artist',
      title: '搜索结果歌曲缺失歌手',
      fallbackFile: 'src/renderer/modules/neteaseSearchManager.ts',
      fallbackLine: 241,
      fallbackLabel: '未知歌手',
      endpointId: 'search',
      fieldPath: 'result.songs[].ar[].name|result.songs[].artists[].name',
      stats: countMissing(searchSongs, getSongArtist),
      suggestion: '在 main 归一化层确保 artist 字段始终是字符串，避免 renderer 再猜测 ar/artists 结构。'
    })
    checks.push({
      id: 'search-song-album',
      title: '搜索结果歌曲缺失专辑',
      fallbackFile: 'src/renderer/modules/neteaseSearchManager.ts',
      fallbackLine: 242,
      fallbackLabel: '未知专辑',
      endpointId: 'search',
      fieldPath: 'result.songs[].al.name|result.songs[].album.name',
      stats: countMissing(searchSongs, getSongAlbum),
      suggestion: '在 main 归一化层统一输出 album 字段，渲染层直接消费。'
    })
  }

  const searchPlaylists = searchJson && searchJson.result && Array.isArray(searchJson.result.playlists)
    ? searchJson.result.playlists
    : []
  if (searchPlaylists.length > 0) {
    checks.push({
      id: 'search-playlist-creator',
      title: '搜索结果歌单缺失创建者',
      fallbackFile: 'src/renderer/modules/neteaseSearchManager.ts',
      fallbackLine: 217,
      fallbackLabel: '未知',
      endpointId: 'search',
      fieldPath: 'result.playlists[].creator.nickname',
      stats: countMissing(searchPlaylists, (x) => x && x.creator && x.creator.nickname),
      suggestion: '主进程归一化歌单搜索项时提供 creator 字段，默认给出平台昵称占位。'
    })
  }

  const playlistDetailJson = executedMap.playlist_detail && executedMap.playlist_detail.body
  const playlistTracks = playlistDetailJson && playlistDetailJson.playlist && Array.isArray(playlistDetailJson.playlist.tracks)
    ? playlistDetailJson.playlist.tracks
    : []
  if (playlistTracks.length > 0) {
    checks.push({
      id: 'playlist-track-title',
      title: '歌单详情曲目缺失标题',
      fallbackFile: 'src/renderer/modules/neteasePlaylistDetailManager.ts',
      fallbackLine: 220,
      fallbackLabel: '未知歌曲',
      endpointId: 'playlist_detail',
      fieldPath: 'playlist.tracks[].name',
      stats: countMissing(playlistTracks, (x) => x && x.name),
      suggestion: '统一在主进程映射 title/name，避免 renderer 同时兼容多种字段名。'
    })
    checks.push({
      id: 'playlist-track-artist',
      title: '歌单详情曲目缺失歌手',
      fallbackFile: 'src/renderer/modules/neteasePlaylistDetailManager.ts',
      fallbackLine: 221,
      fallbackLabel: '未知歌手',
      endpointId: 'playlist_detail',
      fieldPath: 'playlist.tracks[].ar[].name|playlist.tracks[].artists[].name',
      stats: countMissing(playlistTracks, getSongArtist),
      suggestion: '主进程将多种来源统一拼接为 artist 字符串并持久化。'
    })
    checks.push({
      id: 'playlist-track-album',
      title: '歌单详情曲目缺失专辑',
      fallbackFile: 'src/renderer/modules/neteasePlaylistDetailManager.ts',
      fallbackLine: 222,
      fallbackLabel: '未知专辑',
      endpointId: 'playlist_detail',
      fieldPath: 'playlist.tracks[].al.name|playlist.tracks[].album.name',
      stats: countMissing(playlistTracks, getSongAlbum),
      suggestion: '主进程归一化时补齐 album，避免 renderer 直接读原始 al/album。'
    })
  }

  const accountJson = executedMap.auth_account_get && executedMap.auth_account_get.body
  const profile = accountJson && (accountJson.profile || (accountJson.data && accountJson.data.profile))
  checks.push({
    id: 'auth-profile-nickname',
    title: '账户信息缺失昵称',
    fallbackFile: 'src/renderer/modules/authWindow.ts',
    fallbackLine: 394,
    fallbackLabel: '未知用户',
    endpointId: 'auth_account_get',
    fieldPath: 'profile.nickname',
    stats: {
      total: 1,
      missing: sanitizeText(profile && profile.nickname) ? 0 : 1,
      missingRate: sanitizeText(profile && profile.nickname) ? 0 : 1
    },
    suggestion: '登录后立即刷新 profile 并写回 auth 状态，避免仅靠 cookie 判定已登录。'
  })

  const highPriority = checks.filter((item) => item.stats.missingRate >= 0.1)

  return {
    generatedAt: new Date().toISOString(),
    highPriorityThreshold: 0.1,
    summary: {
      totalChecks: checks.length,
      highPriorityCount: highPriority.length
    },
    checks,
    highPriority
  }
}

function toMarkdownAudit(audit) {
  const lines = []
  lines.push('# Unknown Audit')
  lines.push('')
  lines.push(`Generated at: ${audit.generatedAt}`)
  lines.push('')
  lines.push('| ID | Missing/Total | Missing Rate | Fallback | Endpoint |')
  lines.push('| --- | ---: | ---: | --- | --- |')

  for (const item of audit.checks) {
    lines.push(`| ${item.id} | ${item.stats.missing}/${item.stats.total} | ${item.stats.missingRate} | ${item.fallbackLabel} (${item.fallbackFile}:${item.fallbackLine}) | ${item.endpointId} |`)
  }

  lines.push('')
  lines.push('## Suggestions')
  lines.push('')
  for (const item of audit.highPriority) {
    lines.push(`- [${item.id}] ${item.suggestion}`)
  }

  if (!audit.highPriority.length) {
    lines.push('- No high-priority unknown source found by current snapshots.')
  }

  return lines.join('\n')
}

async function loadAuthState(args) {
  const candidateFiles = []
  if (args.authFile) {
    candidateFiles.push(path.resolve(args.authFile))
  }

  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const names = ['music-player', 'MusicPlayer', 'Music Player', 'music_player']
  for (const name of names) {
    candidateFiles.push(path.join(appData, name, 'netease-auth.json'))
  }

  for (const p of candidateFiles) {
    if (await fileExists(p)) {
      const raw = await fsp.readFile(p, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        authFile: p,
        authState: {
          apiBaseUrl: sanitizeText(parsed.apiBaseUrl) || 'https://music.163.com',
          cookie: sanitizeText(parsed.cookie),
          accessToken: sanitizeText(parsed.accessToken),
          userId: sanitizeText(parsed.userId),
          userName: sanitizeText(parsed.userName)
        }
      }
    }
  }

  throw new Error(`Cannot find netease-auth.json. Tried: ${candidateFiles.join(', ')}`)
}

function buildSpecs(context) {
  const safeUserIds = context.args.sideEffectMode === 'live' && context.authState.userId
    ? `[${context.authState.userId}]`
    : '[]'
  const safeMsg = context.args.sideEffectMode === 'live' ? `API-SIM ${new Date().toISOString()}` : 'SIMULATE_ONLY'

  return [
    {
      id: 'auth_account_get',
      category: 'auth',
      kind: 'fallback',
      paths: context.args.includeAuthFallbacks
        ? ['/api/w/nuser/account/get', '/weapi/w/nuser/account/get', '/login/status']
        : ['/api/w/nuser/account/get'],
      method: 'POST',
      profile: 'ios',
      data: () => ({})
    },
    {
      id: 'search',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/get', '/api/search/get', '/api/cloudsearch/pc'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ s: context.args.keyword, type: '1', limit: 20, offset: 0 })
    },
    {
      id: 'search_artist',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/get', '/api/search/get', '/api/cloudsearch/pc'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ s: context.args.keyword, type: '100', limit: 20, offset: 0 })
    },
    {
      id: 'search_playlist',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/get', '/api/search/get', '/api/cloudsearch/pc'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ s: context.args.keyword, type: '1000', limit: 20, offset: 0 })
    },
    {
      id: 'search_voice',
      category: 'search',
      kind: 'single',
      path: '/api/search/voice/get',
      method: 'POST',
      profile: 'pc',
      data: () => ({ keyword: context.args.keyword, scene: 'normal', limit: 20, offset: 0 })
    },
    {
      id: 'search_suggest_web',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/suggest/web', '/api/search/suggest/web', '/api/search/suggest'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ s: context.args.keyword })
    },
    {
      id: 'search_suggest_mobile',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/suggest/keyword', '/api/search/suggest/keyword', '/api/search/suggest'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ s: context.args.keyword })
    },
    {
      id: 'search_default',
      category: 'search',
      kind: 'fallback',
      paths: ['/eapi/search/defaultkeyword/get', '/api/search/defaultkeyword/get'],
      method: 'POST',
      profile: 'pc',
      data: () => ({})
    },
    {
      id: 'search_hot',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/hot', '/api/search/hot'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ type: 1111 })
    },
    {
      id: 'search_hot_detail',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/hotsearchlist/get', '/weapi/search/hot/detail', '/api/search/hot/detail'],
      method: 'POST',
      profile: 'pc',
      data: () => ({})
    },
    {
      id: 'search_multimatch',
      category: 'search',
      kind: 'fallback',
      paths: ['/weapi/search/suggest/multimatch', '/api/search/suggest/multimatch'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ s: context.args.keyword, type: 1 })
    },
    {
      id: 'user_playlist',
      category: 'playlist',
      kind: 'single',
      path: '/api/user/playlist',
      method: 'POST',
      profile: 'pc',
      data: () => ({ uid: context.dynamic.userId, limit: 100, offset: 0 }),
      skip: () => (!context.dynamic.userId ? 'MISSING_USER_ID' : '')
    },
    {
      id: 'playlist_detail',
      category: 'playlist',
      kind: 'single',
      path: '/api/v6/playlist/detail',
      method: 'GET',
      profile: 'pc',
      data: () => ({ id: context.dynamic.playlistId }),
      skip: () => (!context.dynamic.playlistId ? 'MISSING_PLAYLIST_ID' : '')
    },
    {
      id: 'recommend_resource',
      category: 'recommend',
      kind: 'fallback',
      paths: ['/weapi/v1/discovery/recommend/resource', '/api/v1/discovery/recommend/resource', '/recommend/resource'],
      method: 'POST',
      profile: 'ios',
      data: () => ({})
    },
    {
      id: 'daily_recommendation',
      category: 'recommend',
      kind: 'fallback',
      paths: ['/api/v1/discovery/recommend/songs', '/weapi/v1/discovery/recommend/songs', '/recommend/songs'],
      method: 'POST',
      profile: 'ios',
      data: () => ({})
    },
    {
      id: 'recommended_playlists',
      category: 'recommend',
      kind: 'fallback',
      paths: ['/weapi/personalized/playlist', '/api/personalized/playlist', '/personalized'],
      method: 'POST',
      profile: 'ios',
      data: () => ({ limit: context.args.limit, total: true, n: 1000 })
    },
    {
      id: 'song_url',
      category: 'download',
      kind: 'single',
      path: '/api/song/enhance/player/url/v1',
      method: 'POST',
      profile: 'pc',
      data: () => ({ ids: JSON.stringify([Number(context.dynamic.songId)]), level: 'exhigh', encodeType: 'flac' }),
      skip: () => (!context.dynamic.songId ? 'MISSING_SONG_ID' : '')
    },
    {
      id: 'song_detail',
      category: 'download',
      kind: 'single',
      path: '/api/song/detail/',
      method: 'GET',
      profile: 'pc',
      data: () => ({ ids: `[${context.dynamic.songId}]` }),
      skip: () => (!context.dynamic.songId ? 'MISSING_SONG_ID' : '')
    },
    {
      id: 'song_lyric',
      category: 'download',
      kind: 'single',
      path: '/api/song/lyric',
      method: 'GET',
      profile: 'pc',
      data: () => ({ id: context.dynamic.songId, lv: -1, tv: -1 }),
      skip: () => (!context.dynamic.songId ? 'MISSING_SONG_ID' : '')
    },
    {
      id: 'auth_qr_key',
      category: 'auth',
      kind: 'fallback',
      paths: ['/api/login/qrcode/unikey', '/weapi/login/qrcode/unikey', '/login/qr/key', '/login/qrcode/unikey'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ type: 1 })
    },
    {
      id: 'auth_qr_check',
      category: 'auth',
      kind: 'fallback',
      paths: ['/api/login/qrcode/client/login', '/weapi/login/qrcode/client/login', '/login/qr/check', '/login/qrcode/client/login'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ key: context.dynamic.qrKey, type: 1 }),
      skip: () => (!context.dynamic.qrKey ? 'MISSING_QR_KEY' : '')
    },
    {
      id: 'auth_login_email',
      category: 'auth',
      kind: 'fallback',
      paths: ['/api/login', '/weapi/login', '/login'],
      method: 'POST',
      profile: 'ios',
      data: () => ({ username: 'simulate@example.com', password: 'invalid_md5', rememberLogin: true })
    },
    {
      id: 'auth_login_captcha',
      category: 'auth',
      kind: 'fallback',
      paths: ['/api/login/cellphone', '/weapi/login/cellphone', '/login/cellphone'],
      method: 'POST',
      profile: 'ios',
      data: () => ({ phone: '00000000000', captcha: '000000', countrycode: '86', rememberLogin: true })
    },
    {
      id: 'send_text',
      category: 'message',
      kind: 'fallback',
      paths: ['/weapi/msg/private/send', '/api/msg/private/send'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ type: 'text', msg: safeMsg, userIds: safeUserIds }),
      note: 'safe mode uses empty userIds to avoid sending real message'
    },
    {
      id: 'send_song',
      category: 'message',
      kind: 'single',
      path: '/api/msg/private/send',
      method: 'POST',
      profile: 'ios',
      data: () => ({ id: context.dynamic.songId || '0', type: 'song', msg: safeMsg, userIds: safeUserIds })
    },
    {
      id: 'send_playlist',
      category: 'message',
      kind: 'fallback',
      paths: ['/weapi/msg/private/send', '/api/msg/private/send'],
      method: 'POST',
      profile: 'pc',
      data: () => ({ id: context.dynamic.playlistId || '0', type: 'playlist', msg: safeMsg, userIds: safeUserIds })
    }
  ]
}

function summarizeResponseBody(body) {
  if (body == null) return { hasBody: false }

  if (typeof body !== 'object') {
    return {
      hasBody: true,
      type: typeof body,
      preview: trimLargeString(body)
    }
  }

  const code = Number(body.code || 0)
  const message = sanitizeText(body.msg || body.message || body.error || '')
  const topKeys = Object.keys(body).slice(0, 30)

  return {
    hasBody: true,
    code: Number.isFinite(code) ? code : 0,
    message,
    topKeys
  }
}

async function runSpec(spec, context, endpointDir) {
  const skipReason = spec.skip ? spec.skip() : ''
  if (skipReason) {
    return {
      id: spec.id,
      category: spec.category,
      ok: false,
      skipped: true,
      skipReason,
      attempts: [],
      elapsedMs: 0
    }
  }

  const requestData = spec.data ? spec.data() : {}
  const started = Date.now()

  let transport = null
  let attempts = []
  let pathUsed = ''

  if (spec.kind === 'fallback') {
    const fallbackResult = await requestWithFallback({
      authState: context.authState,
      baseUrl: context.baseUrl,
      paths: spec.paths,
      method: spec.method,
      data: requestData,
      profile: spec.profile,
      timeoutMs: context.args.timeoutMs
    })
    transport = fallbackResult.result
    attempts = fallbackResult.attempts
    pathUsed = fallbackResult.pathUsed
  } else {
    transport = await requestSingle({
      authState: context.authState,
      baseUrl: context.baseUrl,
      pathName: spec.path,
      method: spec.method,
      data: requestData,
      profile: spec.profile,
      timeoutMs: context.args.timeoutMs
    })
    attempts = [
      {
        path: spec.path,
        statusCode: transport.statusCode,
        elapsedMs: transport.elapsedMs,
        transportError: transport.transportError || '',
        parseError: transport.parseError || ''
      }
    ]
    pathUsed = spec.path
  }

  const ended = Date.now()
  const bodySnapshot = snapshotValue(transport ? transport.body : null)
  const rawTextDigest = transport && transport.rawText
    ? {
        length: transport.rawText.length,
        sha1: hashSha1(transport.rawText),
        preview: trimLargeString(transport.rawText, 300)
      }
    : null

  const endpointOutput = {
    endpoint: {
      id: spec.id,
      category: spec.category,
      kind: spec.kind,
      method: spec.method,
      profile: spec.profile,
      pathUsed,
      requestedPaths: spec.kind === 'fallback' ? spec.paths : [spec.path],
      note: spec.note || ''
    },
    request: {
      baseUrl: context.baseUrl,
      data: snapshotValue(requestData),
      timeoutMs: context.args.timeoutMs,
      sideEffectMode: context.args.sideEffectMode
    },
    responseSummary: {
      ok: Boolean(transport && transport.ok),
      statusCode: transport ? transport.statusCode : 0,
      statusText: transport ? transport.statusText : 'NO_RESPONSE',
      elapsedMs: transport ? transport.elapsedMs : ended - started,
      parseError: transport ? transport.parseError || '' : '',
      transportError: transport ? transport.transportError || '' : '',
      body: summarizeResponseBody(transport ? transport.body : null),
      rawTextDigest,
      attempts
    },
    responseSnapshot: bodySnapshot
  }

  const fileName = `${String(context.seq).padStart(2, '0')}-${spec.id}.json`
  context.seq += 1
  await fsp.writeFile(path.join(endpointDir, fileName), JSON.stringify(endpointOutput, null, 2), 'utf8')

  return {
    id: spec.id,
    category: spec.category,
    ok: Boolean(transport && transport.ok),
    skipped: false,
    skipReason: '',
    statusCode: transport ? transport.statusCode : 0,
    elapsedMs: transport ? transport.elapsedMs : ended - started,
    pathUsed,
    attempts,
    body: transport ? transport.body : null,
    message: summarizeResponseBody(transport ? transport.body : null).message || ''
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable. Please use Node.js 18+.')
  }

  const loaded = await loadAuthState(args)
  const authState = loaded.authState
  const baseUrl = sanitizeText(args.baseUrl) || sanitizeText(authState.apiBaseUrl) || 'https://music.163.com'

  const runId = nowTag()
  const outputRoot = args.outputDir
    ? path.resolve(args.outputDir)
    : path.resolve(process.cwd(), 'tools', 'netease-api-sim', 'runs', runId)
  const endpointDir = path.join(outputRoot, 'endpoints')

  await ensureDir(endpointDir)

  const context = {
    args,
    authState,
    baseUrl,
    outputRoot,
    endpointDir,
    seq: 1,
    dynamic: {
      userId: normalizeId(authState.userId),
      songId: normalizeId(args.songId),
      playlistId: normalizeId(args.playlistId),
      qrKey: ''
    }
  }

  const specs = buildSpecs(context)
  const executed = []
  const executedMap = {}

  for (const spec of specs) {
    const result = await runSpec(spec, context, endpointDir)
    executed.push(result)
    executedMap[spec.id] = result

    if (spec.id === 'search' && !context.dynamic.songId && result.body) {
      context.dynamic.songId = pickFirstSongId(result.body)
    }

    if (spec.id === 'user_playlist' && !context.dynamic.playlistId && result.body) {
      context.dynamic.playlistId = pickFirstPlaylistId(result.body)
    }

    if (spec.id === 'auth_qr_key' && result.body) {
      const key = sanitizeText(result.body.unikey || (result.body.data && result.body.data.unikey))
      context.dynamic.qrKey = key
    }
  }

  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    baseUrl,
    authFile: loaded.authFile,
    sideEffectMode: args.sideEffectMode,
    params: {
      keyword: args.keyword,
      songId: context.dynamic.songId,
      playlistId: context.dynamic.playlistId,
      timeoutMs: args.timeoutMs,
      limit: args.limit
    },
    totals: {
      total: executed.length,
      succeeded: executed.filter((x) => x.ok).length,
      failed: executed.filter((x) => !x.ok && !x.skipped).length,
      skipped: executed.filter((x) => x.skipped).length
    },
    endpoints: executed.map((x) => ({
      id: x.id,
      category: x.category,
      ok: x.ok,
      skipped: x.skipped,
      skipReason: x.skipReason,
      statusCode: x.statusCode || 0,
      elapsedMs: x.elapsedMs || 0,
      pathUsed: x.pathUsed || ''
    }))
  }

  const unknownAudit = buildUnknownAudit(executedMap)

  await fsp.writeFile(path.join(outputRoot, 'run-report.json'), JSON.stringify(summary, null, 2), 'utf8')
  await fsp.writeFile(path.join(outputRoot, 'unknown-audit.json'), JSON.stringify(unknownAudit, null, 2), 'utf8')
  await fsp.writeFile(path.join(outputRoot, 'unknown-audit.md'), toMarkdownAudit(unknownAudit), 'utf8')

  const finalNote = {
    runId,
    outputRoot,
    report: path.join(outputRoot, 'run-report.json'),
    unknownAudit: path.join(outputRoot, 'unknown-audit.json'),
    unknownAuditMarkdown: path.join(outputRoot, 'unknown-audit.md')
  }

  console.log(JSON.stringify(finalNote, null, 2))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[netease-api-sim] ${message}`)
  process.exitCode = 1
})
