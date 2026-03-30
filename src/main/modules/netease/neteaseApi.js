const path = require('path')
const { requestJson } = require('./httpClient')
const {
  buildAuthHeaders,
  requestNeteaseApi,
  postFormWithFallback,
  extractApiErrorMessage
} = require('./authManager')
const { logProgramEvent } = require('../logger')

const PLAYLIST_TRACK_BATCH_SIZE = 200

// ---------------------------------------------------------------------------
// Audio / cover extension helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ID sanitizers / page URLs
// ---------------------------------------------------------------------------

function sanitizeSongId(songId) {
  const text = String(songId || '').trim()
  if (!/^\d{1,20}$/.test(text)) return null
  return text
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

function normalizeSongArtists(song) {
  if (Array.isArray(song?.ar)) {
    return song.ar.map((item) => item?.name).filter(Boolean).join(' / ')
  }

  if (Array.isArray(song?.artists)) {
    return song.artists.map((item) => item?.name).filter(Boolean).join(' / ')
  }

  return ''
}

function toSafeInteger(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function chunkArray(items, size) {
  const chunkSize = Math.max(1, Number(size) || 1)
  const result = []
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize))
  }
  return result
}

function encodeFormData(data) {
  return Object.entries(data || {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value == null ? '' : String(value))}`)
    .join('&')
}

// ---------------------------------------------------------------------------
// Song / playlist metadata API
// ---------------------------------------------------------------------------

function extractSongMetadata(song, fallbackSongId) {
  if (!song || typeof song !== 'object') return null

  const artist = normalizeSongArtists(song)

  const album = song.al || song.album || null
  const publishTime = Number(album?.publishTime || 0)
  const year = publishTime > 0 ? new Date(publishTime).getFullYear() : null

  return {
    songId: String(song.id || fallbackSongId || ''),
    title: String(song.name || '').trim(),
    artist: String(artist || '').trim(),
    album: String(album?.name || '').trim(),
    durationMs: toSafeInteger(song.dt || song.duration),
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
    logProgramEvent({
      source: 'netease.api',
      event: 'fetch-song-metadata-failed',
      message: 'Failed to fetch song detail metadata',
      error: err,
      data: { songId }
    })
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
    logProgramEvent({
      source: 'netease.api',
      event: 'fetch-song-lyrics-failed',
      message: 'Failed to fetch song lyrics',
      error: err,
      data: { songId }
    })
    return ''
  }
}

async function fetchPlaylistTracksById(playlistId) {
  const url = `https://music.163.com/api/v6/playlist/detail?id=${playlistId}`
  const data = await requestJson(url)
  const playlist = data?.playlist
  if (!playlist) return null

  const name = String(playlist.name || `歌单 ${playlistId}`).trim()
  const creator = String(playlist?.creator?.nickname || '').trim()
  const trackIds = Array.isArray(playlist.trackIds)
    ? playlist.trackIds.map((item) => sanitizeSongId(item?.id)).filter(Boolean)
    : []

  let trackList = Array.isArray(playlist.tracks) ? playlist.tracks : []
  const hasCompleteTrackList = trackIds.length > 0 && trackList.length >= trackIds.length

  if (trackIds.length > 0 && !hasCompleteTrackList) {
    const songMap = new Map()
    const batches = chunkArray(trackIds, PLAYLIST_TRACK_BATCH_SIZE)

    for (const batch of batches) {
      const body = encodeFormData({
        c: JSON.stringify(batch.map((id) => ({ id: Number(id) })))
      })

      const response = await requestJson('https://music.163.com/api/v3/song/detail', {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }),
        body,
        timeout: 20000
      })

      const songs = Array.isArray(response?.songs) ? response.songs : []
      for (const song of songs) {
        const id = sanitizeSongId(song?.id)
        if (id) songMap.set(id, song)
      }
    }

    trackList = trackIds.map((id) => songMap.get(id)).filter(Boolean)
  }

  const tracks = trackList
    .map((track) => extractSongMetadata(track, track?.id))
    .filter(Boolean)

  return {
    id: String(playlistId),
    name,
    creator,
    description: String(playlist.description || '').trim(),
    coverUrl: String(playlist.coverImgUrl || '').trim(),
    tags: Array.isArray(playlist.tags) ? playlist.tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
    playCount: toSafeInteger(playlist.playCount),
    trackCount: Number(playlist.trackCount || tracks.length),
    tracks
  }
}

// ---------------------------------------------------------------------------
// Song URL resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Search / suggest helpers
// ---------------------------------------------------------------------------

const SEARCH_ALLOWED_TYPES = new Set(['1', '10', '100', '1000', '1002', '1004', '1006', '1009', '1014', '1018', '2000'])

function sanitizeSearchKeyword(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  return text.slice(0, 120)
}

function sanitizeSearchType(raw, fallback = '1') {
  const text = String(raw || '').trim()
  if (SEARCH_ALLOWED_TYPES.has(text)) return text
  return SEARCH_ALLOWED_TYPES.has(String(fallback)) ? String(fallback) : '1'
}

function sanitizeSearchLimit(raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return 20
  return Math.max(1, Math.min(50, Math.floor(value)))
}

function sanitizeSearchOffset(raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function normalizeSearchSongItem(song) {
  const metadata = extractSongMetadata(song, song?.id)
  return {
    id: String(metadata?.songId || song?.id || ''),
    name: metadata?.title || String(song?.name || '').trim(),
    artist: metadata?.artist || '',
    album: metadata?.album || '',
    durationMs: Number(metadata?.durationMs || 0),
    coverUrl: metadata?.coverUrl || ''
  }
}

function normalizeSearchArtistItem(artist) {
  return {
    id: String(artist?.id || ''),
    name: String(artist?.name || '').trim(),
    alias: Array.isArray(artist?.alias) ? artist.alias.map((item) => String(item || '').trim()).filter(Boolean) : [],
    albumSize: Number(artist?.albumSize || 0),
    mvSize: Number(artist?.mvSize || 0),
    picUrl: String(artist?.picUrl || artist?.img1v1Url || '').trim()
  }
}

function normalizeSearchPlaylistItem(playlist) {
  return {
    id: String(playlist?.id || ''),
    name: String(playlist?.name || '').trim(),
    creator: String(playlist?.creator?.nickname || '').trim(),
    trackCount: Number(playlist?.trackCount || 0),
    playCount: Number(playlist?.playCount || 0),
    coverUrl: String(playlist?.coverImgUrl || '').trim()
  }
}

function normalizeSearchItems(type, result) {
  if (type === '100') {
    const artists = Array.isArray(result?.artists) ? result.artists : []
    return artists.map(normalizeSearchArtistItem).filter((item) => item.id && item.name)
  }

  if (type === '1000') {
    const playlists = Array.isArray(result?.playlists) ? result.playlists : []
    return playlists.map(normalizeSearchPlaylistItem).filter((item) => item.id && item.name)
  }

  const songs = Array.isArray(result?.songs) ? result.songs : []
  return songs.map(normalizeSearchSongItem).filter((item) => item.id && item.name)
}

function extractSearchTotal(type, result, items) {
  if (type === '100') {
    return Number(result?.artistCount || items.length || 0)
  }

  if (type === '1000') {
    return Number(result?.playlistCount || items.length || 0)
  }

  return Number(result?.songCount || items.length || 0)
}

function normalizeSuggestPayload(data) {
  const result = data?.result || {}

  const keywords = new Set()
  const pushKeyword = (value) => {
    const text = String(value || '').trim()
    if (text) keywords.add(text)
  }

  if (Array.isArray(result?.allMatch)) {
    for (const item of result.allMatch) {
      pushKeyword(item?.keyword)
    }
  }

  const songs = Array.isArray(result?.songs)
    ? result.songs.map((item) => ({
        id: String(item?.id || ''),
        name: String(item?.name || '').trim(),
        artist: normalizeSongArtists(item)
      })).filter((item) => item.id && item.name)
    : []

  const artists = Array.isArray(result?.artists)
    ? result.artists.map((item) => ({
        id: String(item?.id || ''),
        name: String(item?.name || '').trim()
      })).filter((item) => item.id && item.name)
    : []

  const playlists = Array.isArray(result?.playlists)
    ? result.playlists.map((item) => ({
        id: String(item?.id || ''),
        name: String(item?.name || '').trim(),
        trackCount: Number(item?.trackCount || 0)
      })).filter((item) => item.id && item.name)
    : []

  for (const song of songs.slice(0, 4)) pushKeyword(song.name)
  for (const artist of artists.slice(0, 4)) pushKeyword(artist.name)
  for (const playlist of playlists.slice(0, 4)) pushKeyword(playlist.name)

  return {
    keywords: Array.from(keywords).slice(0, 12),
    songs: songs.slice(0, 6),
    artists: artists.slice(0, 6),
    playlists: playlists.slice(0, 6)
  }
}

async function searchNeteaseByKeyword(payload) {
  const keywords = sanitizeSearchKeyword(payload?.keywords)
  const type = sanitizeSearchType(payload?.type, '1')
  const limit = sanitizeSearchLimit(payload?.limit)
  const offset = sanitizeSearchOffset(payload?.offset)

  if (!keywords) {
    return { ok: false, error: 'INVALID_KEYWORDS' }
  }

  try {
    let requestResult = null
    if (type === '2000') {
      requestResult = await postFormWithFallback(
        ['/api/search/voice/get'],
        {
          keyword: keywords,
          scene: 'normal',
          limit,
          offset
        },
        12000,
        { cookieProfile: 'pc' }
      )
    } else {
      requestResult = await postFormWithFallback(
        ['/weapi/search/get', '/api/search/get', '/api/cloudsearch/pc'],
        {
          s: keywords,
          type,
          limit,
          offset
        },
        12000,
        { cookieProfile: 'pc' }
      )
    }

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        message: requestResult?.error || 'REQUEST_FAILED'
      }
    }

    const data = requestResult.result.data
    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) || 'REQUEST_FAILED'
      }
    }

    const result = data?.result || {}
    const items = normalizeSearchItems(type, result)
    const total = extractSearchTotal(type, result, items)
    const hasMore = offset + items.length < total

    return {
      ok: true,
      data: {
        keywords,
        type,
        limit,
        offset,
        total,
        hasMore,
        items
      }
    }
  } catch (err) {
    logProgramEvent({
      source: 'netease.api',
      event: 'search-keyword-failed',
      message: 'Failed to search NetEase content by keyword',
      error: err,
      data: { keywords, type, limit, offset }
    })
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

async function searchNeteaseSuggest(payload) {
  const keywords = sanitizeSearchKeyword(payload?.keywords)
  const mobile = payload?.type === 'mobile' || payload?.mobile === true

  if (!keywords) {
    return {
      ok: true,
      data: {
        keywords: [],
        songs: [],
        artists: [],
        playlists: []
      }
    }
  }

  const suggestPath = mobile
    ? ['/weapi/search/suggest/keyword', '/api/search/suggest/keyword', '/api/search/suggest']
    : ['/weapi/search/suggest/web', '/api/search/suggest/web', '/api/search/suggest']

  try {
    const requestResult = await postFormWithFallback(
      suggestPath,
      { s: keywords },
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        message: requestResult?.error || 'REQUEST_FAILED'
      }
    }

    const data = requestResult.result.data
    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) || 'REQUEST_FAILED'
      }
    }

    return {
      ok: true,
      data: normalizeSuggestPayload(data)
    }
  } catch (err) {
    logProgramEvent({
      source: 'netease.api',
      event: 'search-suggest-failed',
      message: 'Failed to fetch NetEase search suggestions',
      error: err,
      data: { keywords, mobile }
    })
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

async function fetchNeteaseSearchDefaultKeyword() {
  try {
    const requestResult = await postFormWithFallback(
      ['/eapi/search/defaultkeyword/get', '/api/search/defaultkeyword/get'],
      {},
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error || 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) || 'REQUEST_FAILED'
      }
    }

    return {
      ok: true,
      data: {
        keyword: String(data?.data?.showKeyword || data?.data?.realkeyword || '').trim(),
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

async function fetchNeteaseSearchHot() {
  try {
    const requestResult = await postFormWithFallback(
      ['/weapi/search/hot', '/api/search/hot'],
      { type: 1111 },
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error || 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) || 'REQUEST_FAILED'
      }
    }

    const hots = Array.isArray(data?.result?.hots)
      ? data.result.hots.map((item) => String(item?.first || '').trim()).filter(Boolean)
      : []

    return {
      ok: true,
      data: {
        hots,
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

async function fetchNeteaseSearchHotDetail() {
  try {
    const requestResult = await postFormWithFallback(
      ['/weapi/hotsearchlist/get', '/weapi/search/hot/detail', '/api/search/hot/detail'],
      {},
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error || 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) || 'REQUEST_FAILED'
      }
    }

    const list = Array.isArray(data?.data)
      ? data.data.map((item) => ({
          searchWord: String(item?.searchWord || '').trim(),
          score: Number(item?.score || 0),
          iconType: Number(item?.iconType || 0),
          content: String(item?.content || '').trim()
        })).filter((item) => item.searchWord)
      : []

    return { ok: true, data: { list, raw: data } }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

async function searchNeteaseMultimatch(payload) {
  const keywords = sanitizeSearchKeyword(payload?.keywords)
  const type = sanitizeSearchType(payload?.type, '1')

  if (!keywords) {
    return { ok: false, error: 'INVALID_KEYWORDS' }
  }

  try {
    const requestResult = await postFormWithFallback(
      ['/weapi/search/suggest/multimatch', '/api/search/suggest/multimatch'],
      { s: keywords, type },
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error || 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) || 'REQUEST_FAILED'
      }
    }

    return {
      ok: true,
      data: {
        keywords,
        result: data?.result || {},
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

function sanitizeMessageText(raw, maxLength = 500) {
  return String(raw || '').trim().slice(0, maxLength)
}

function sanitizeUserIds(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',')

  const unique = new Set()
  for (const item of list) {
    const id = sanitizeId(item)
    if (id) unique.add(id)
  }

  return Array.from(unique).slice(0, 20)
}

function toNeteaseUserIdsValue(userIds) {
  return `[${userIds.join(',')}]`
}

async function sendNeteasePrivateMessage(payload) {
  const sendType = String(payload?.sendType || 'text').trim().toLowerCase()
  const userIds = sanitizeUserIds(payload?.userIds)
  const msg = sanitizeMessageText(payload?.msg)

  if (!userIds.length) {
    return { ok: false, error: 'INVALID_USER_IDS' }
  }

  if (!msg) {
    return { ok: false, error: 'INVALID_MESSAGE' }
  }

  const userIdsValue = toNeteaseUserIdsValue(userIds)
  let paths = []
  let data = {}
  let options = { cookieProfile: 'pc' }

  if (sendType === 'song') {
    const id = sanitizeId(payload?.id || payload?.songId)
    if (!id) return { ok: false, error: 'INVALID_RESOURCE_ID' }
    paths = ['/api/msg/private/send']
    data = { id, msg, type: 'song', userIds: userIdsValue }
    options = { cookieProfile: 'ios' }
  } else if (sendType === 'album') {
    const id = sanitizeId(payload?.id || payload?.albumId)
    if (!id) return { ok: false, error: 'INVALID_RESOURCE_ID' }
    paths = ['/api/msg/private/send']
    data = { id, msg, type: 'album', userIds: userIdsValue }
    options = { cookieProfile: 'ios' }
  } else if (sendType === 'playlist') {
    const id = sanitizeId(payload?.id || payload?.playlistId)
    if (!id) return { ok: false, error: 'INVALID_RESOURCE_ID' }
    paths = ['/weapi/msg/private/send', '/api/msg/private/send']
    data = { id, msg, type: 'playlist', userIds: userIdsValue }
  } else {
    paths = ['/weapi/msg/private/send', '/api/msg/private/send']
    data = { type: 'text', msg, userIds: userIdsValue }
  }

  try {
    const requestResult = await postFormWithFallback(paths, data, 12000, options)
    if (!requestResult?.ok || !requestResult?.result?.data) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        message: requestResult?.error || 'REQUEST_FAILED'
      }
    }

    const result = requestResult.result.data
    const code = Number(result?.code || 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(result) || 'REQUEST_FAILED'
      }
    }

    return {
      ok: true,
      data: {
        sendType,
        userIds,
        code,
        raw: result
      }
    }
  } catch (err) {
    logProgramEvent({
      source: 'netease.api',
      event: 'send-private-message-failed',
      message: 'Failed to send NetEase private message',
      error: err,
      data: { sendType, userIdsCount: userIds.length }
    })
    return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
  }
}

module.exports = {
  normalizeAudioExt,
  resolveAudioExtByUrl,
  resolveAudioExtByResolvedUrl,
  resolveCoverExtByUrl,
  resolveCoverMimeByExt,
  sanitizeSongId,
  sanitizeId,
  getSongPageUrl,
  getPlaylistPageUrl,
  extractSongMetadata,
  fetchSongMetadataById,
  fetchSongLyricsById,
  fetchPlaylistTracksById,
  resolveSongDownloadUrlResponse,
  buildFallbackLevels,
  resolveSongUrlWithLevelFallback,
  isNeteaseAudioHost,
  sanitizeSearchKeyword,
  sanitizeSearchType,
  sanitizeSearchLimit,
  sanitizeSearchOffset,
  searchNeteaseByKeyword,
  searchNeteaseSuggest,
  fetchNeteaseSearchDefaultKeyword,
  fetchNeteaseSearchHot,
  fetchNeteaseSearchHotDetail,
  searchNeteaseMultimatch,
  sanitizeUserIds,
  sendNeteasePrivateMessage
}
