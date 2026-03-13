const path = require('path')
const { requestJson } = require('./httpClient')
const { buildAuthHeaders, requestNeteaseApi, extractApiErrorMessage } = require('./authManager')
const { logProgramEvent } = require('../logger')

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

// ---------------------------------------------------------------------------
// Song / playlist metadata API
// ---------------------------------------------------------------------------

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
  isNeteaseAudioHost
}
