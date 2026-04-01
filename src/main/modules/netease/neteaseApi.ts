import path from 'path'
import type { IncomingHttpHeaders } from 'http'

const { requestJson } = require('./httpClient') as {
  requestJson: (url: string, options?: any) => Promise<unknown>
}
const {
  buildAuthHeaders,
  requestNeteaseApi,
  postFormWithFallback,
  extractApiErrorMessage
} = require('./authManager') as {
  buildAuthHeaders: (extra?: Record<string, string>) => Record<string, string>
  requestNeteaseApi: (path: string, params?: Record<string, unknown>) => Promise<unknown>
  postFormWithFallback: (paths: string[], data: Record<string, unknown>, timeout: number, options?: Record<string, unknown>) => Promise<any>
  extractApiErrorMessage: (data: unknown) => string
}
const { logProgramEvent } = require('../logger') as {
  logProgramEvent: (payload: any) => void
}

const PLAYLIST_TRACK_BATCH_SIZE = 200
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus'])
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

// ---------------------------------------------------------------------------
// Audio / cover extension helpers
// ---------------------------------------------------------------------------

function normalizeAudioExt(value: unknown): string {
  const text = String(value ?? '').replace(/^\./, '').trim().toLowerCase()
  return AUDIO_EXTENSIONS.has(text) ? text : ''
}

function resolveAudioExtByUrl(rawUrl: unknown): string {
  try {
    const ext = path.extname(new URL(String(rawUrl)).pathname ?? '')
    return normalizeAudioExt(ext)
  } catch {
    return ''
  }
}

function resolveAudioExtByResolvedUrl(resolved: any): string {
  const fromType = normalizeAudioExt(resolved?.type)
  if (fromType) return fromType
  const fromUrl = resolveAudioExtByUrl(resolved?.url)
  if (fromUrl) return fromUrl
  return 'mp3'
}

function resolveCoverExtByUrl(rawUrl: unknown): string {
  try {
    const ext = path.extname(new URL(String(rawUrl)).pathname ?? '').replace('.', '').toLowerCase()
    return COVER_EXTENSIONS.has(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg'
  } catch {
    return 'jpg'
  }
}

function resolveCoverMimeByExt(ext: unknown): string {
  const value = String(ext ?? '').replace('.', '').toLowerCase()
  if (value === 'png') return 'image/png'
  if (value === 'webp') return 'image/webp'
  return 'image/jpeg'
}

// ---------------------------------------------------------------------------
// ID sanitizers / page URLs
// ---------------------------------------------------------------------------

function sanitizeSongId(songId: unknown): string | null {
  const text = String(songId ?? '').trim()
  return /^\d{1,20}$/.test(text) ? text : null
}

function sanitizeId(id: unknown): string | null {
  const text = String(id ?? '').trim()
  return /^\d{1,20}$/.test(text) ? text : null
}

function getSongPageUrl(songId: string): string {
  return `https://music.163.com/#/song?id=${songId}`
}

function getPlaylistPageUrl(playlistId: string): string {
  return `https://music.163.com/#/playlist?id=${playlistId}`
}

function normalizeSongArtists(song: any): string {
  if (Array.isArray(song?.ar)) {
    return song.ar.map((item: any) => item?.name).filter(Boolean).join(' / ')
  }
  if (Array.isArray(song?.artists)) {
    return song.artists.map((item: any) => item?.name).filter(Boolean).join(' / ')
  }
  return ''
}

function toSafeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function chunkArray<T>(items: T[], size: unknown): T[][] {
  const chunkSize = Math.max(1, Number(size) ?? 1)
  const result: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize))
  }
  return result
}

function encodeFormData(data: Record<string, unknown>): string {
  return Object.entries(data ?? {})
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value == null ? '' : String(value))}`
    )
    .join('&')
}

// ---------------------------------------------------------------------------
// Song / playlist metadata API
// ---------------------------------------------------------------------------

interface SongMetadata {
  readonly songId: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly durationMs: number
  readonly year: number | null
  readonly coverUrl: string
}

interface PlaylistDetail {
  readonly id: string
  readonly name: string
  readonly creator: string
  readonly description: string
  readonly coverUrl: string
  readonly tags: string[]
  readonly playCount: number
  readonly trackCount: number
  readonly tracks: SongMetadata[]
}

function extractSongMetadata(song: any, fallbackSongId?: unknown): SongMetadata | null {
  if (!song || typeof song !== 'object') return null

  const artist = normalizeSongArtists(song)
  const album = song.al ?? song.album
  const publishTime = Number(album?.publishTime ?? 0)
  const year = publishTime > 0 ? new Date(publishTime).getFullYear() : null

  return {
    songId: String(song.id ?? fallbackSongId ?? ''),
    title: String(song.name ?? '').trim(),
    artist: String(artist ?? '').trim(),
    album: String(album?.name ?? '').trim(),
    durationMs: toSafeInteger(song.dt ?? song.duration),
    year: Number.isFinite(year as number) ? year : null,
    coverUrl: String(album?.picUrl ?? '').trim()
  }
}

async function fetchSongMetadataById(songId: string): Promise<SongMetadata | null> {
  try {
    const url = `https://music.163.com/api/song/detail/?ids=[${songId}]`
    const data = (await requestJson(url)) as any
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

async function fetchSongLyricsById(songId: string): Promise<string> {
  try {
    const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=-1&tv=-1`
    const data = (await requestJson(url)) as any
    const lrc = data?.lrc?.lyric ?? ''
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

async function fetchPlaylistTracksById(playlistId: string): Promise<PlaylistDetail | null> {
  const url = `https://music.163.com/api/v6/playlist/detail?id=${playlistId}`
  const data = (await requestJson(url)) as any
  const playlist = data?.playlist

  if (!playlist) return null

  const name = String(playlist.name ?? `歌单 ${playlistId}`).trim()
  const creator = String(playlist?.creator?.nickname ?? '').trim()
  const trackIds = Array.isArray(playlist.trackIds)
    ? playlist.trackIds.map((item: any) => sanitizeSongId(item?.id)).filter(Boolean)
    : []

  let trackList = Array.isArray(playlist.tracks) ? playlist.tracks : []
  const hasCompleteTrackList = trackIds.length > 0 && trackList.length >= trackIds.length

  if (trackIds.length > 0 && !hasCompleteTrackList) {
    const songMap = new Map<string, any>()
    const batches = chunkArray(trackIds, PLAYLIST_TRACK_BATCH_SIZE)

    for (const batch of batches) {
      const c = JSON.stringify(
        batch.map((id) => ({ id: Number(id) }))
      )
      const body = encodeFormData({ c })

      const response = (await requestJson('https://music.163.com/api/v3/song/detail', {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(body))
        }),
        body,
        timeout: 20000
      })) as any

      const songs = Array.isArray(response?.songs) ? response.songs : []
      for (const song of songs) {
        const id = sanitizeSongId(song?.id)
        if (id) songMap.set(id, song)
      }
    }

    trackList = trackIds.map((id: string) => songMap.get(id)).filter(Boolean)
  }

  const tracks = trackList
    .map((track: any) => extractSongMetadata(track, track?.id))
    .filter(Boolean) as SongMetadata[]

  return {
    id: String(playlistId),
    name,
    creator,
    description: String(playlist.description ?? '').trim(),
    coverUrl: String(playlist.coverImgUrl ?? '').trim(),
    tags: Array.isArray(playlist.tags)
      ? playlist.tags.map((item: any) => String(item ?? '').trim()).filter(Boolean)
      : [],
    playCount: toSafeInteger(playlist.playCount),
    trackCount: Number(playlist.trackCount ?? tracks.length),
    tracks
  }
}

// ---------------------------------------------------------------------------
// Song URL resolution
// ---------------------------------------------------------------------------

interface SongDownloadUrlResponse {
  url: string
  songId: string
  level: string
  type: string
  size: number
}

interface ResolveSongUrlResult {
  ok: boolean
  resolved?: SongDownloadUrlResponse
  pickedLevel?: string
  attempts?: Array<{ level: string; ok: boolean; error?: string }>
  error?: string
  message?: string
}

function resolveSongDownloadUrlResponse(json: any, songId: string): SongDownloadUrlResponse | null {
  const dataList = Array.isArray(json?.data) ? json.data : []
  const exact = dataList.find((item: any) => String(item?.id ?? '') === String(songId))
  const first = exact ?? dataList[0]
  const url = first?.url ?? ''

  if (!url) return null

  return {
    url,
    songId: String(first?.id ?? songId),
    level: first?.level ?? '',
    type: first?.type ?? '',
    size: Number(first?.size ?? 0)
  }
}

function buildFallbackLevels(preferred: unknown): string[] {
  const base = [preferred, 'exhigh', 'higher', 'standard', 'lossless']
  const seen = new Set<string>()
  const result: string[] = []

  for (const level of base) {
    const v = String(level ?? '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    result.push(v)
  }

  return result
}

async function resolveSongUrlWithLevelFallback(
  songId: string,
  preferredLevel: unknown
): Promise<ResolveSongUrlResult> {
  const levels = buildFallbackLevels(preferredLevel)
  const attempts: Array<{ level: string; ok: boolean; error?: string }> = []
  let lastMessage = ''

  for (const level of levels) {
    try {
      const data = (await requestNeteaseApi('/api/song/enhance/player/url/v1', {
        ids: JSON.stringify([Number(songId)]),
        level,
        encodeType: 'flac'
      })) as any

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

      lastMessage = extractApiErrorMessage(data) ?? lastMessage
    } catch (err) {
      const errorMsg = (err as any)?.message ?? 'REQUEST_FAILED'
      attempts.push({ level, ok: false, error: errorMsg })
      lastMessage = errorMsg
    }
  }

  return {
    ok: false,
    error: 'URL_NOT_FOUND',
    message: lastMessage ?? '未获取到可用音源，可能受版权或账号权限限制',
    attempts
  }
}

function isNeteaseAudioHost(rawUrl: string): boolean {
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

const SEARCH_ALLOWED_TYPES = new Set<string>([
  '1', '10', '100', '1000', '1002', '1004', '1006', '1009', '1014', '1018', '2000'
])

function sanitizeSearchKeyword(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  return text.slice(0, 120)
}

function sanitizeSearchType(raw: unknown, fallback: string = '1'): string {
  const text = String(raw ?? '').trim()
  if (SEARCH_ALLOWED_TYPES.has(text)) return text
  return SEARCH_ALLOWED_TYPES.has(String(fallback)) ? String(fallback) : '1'
}

function sanitizeSearchLimit(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return 20
  return Math.max(1, Math.min(50, Math.floor(value)))
}

function sanitizeSearchOffset(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

interface SearchSongItem {
  readonly id: string
  readonly name: string
  readonly artist: string
  readonly album: string
  readonly durationMs: number
  readonly coverUrl: string
}

interface SearchArtistItem {
  readonly id: string
  readonly name: string
  readonly alias: string[]
  readonly albumSize: number
  readonly mvSize: number
  readonly picUrl: string
}

interface SearchPlaylistItem {
  readonly id: string
  readonly name: string
  readonly creator: string
  readonly trackCount: number
  readonly playCount: number
  readonly coverUrl: string
}

function normalizeSearchSongItem(song: any): SearchSongItem {
  const metadata = extractSongMetadata(song, song?.id)
  return {
    id: String(metadata?.songId ?? song?.id ?? ''),
    name: metadata?.title ?? String(song?.name ?? '').trim(),
    artist: metadata?.artist ?? '',
    album: metadata?.album ?? '',
    durationMs: Number(metadata?.durationMs ?? 0),
    coverUrl: metadata?.coverUrl ?? ''
  }
}

function normalizeSearchArtistItem(artist: any): SearchArtistItem {
  return {
    id: String(artist?.id ?? ''),
    name: String(artist?.name ?? '').trim(),
    alias: Array.isArray(artist?.alias)
      ? artist.alias.map((item: any) => String(item ?? '').trim()).filter(Boolean)
      : [],
    albumSize: Number(artist?.albumSize ?? 0),
    mvSize: Number(artist?.mvSize ?? 0),
    picUrl: String(artist?.picUrl ?? artist?.img1v1Url ?? '').trim()
  }
}

function normalizeSearchPlaylistItem(playlist: any): SearchPlaylistItem {
  return {
    id: String(playlist?.id ?? ''),
    name: String(playlist?.name ?? '').trim(),
    creator: String(playlist?.creator?.nickname ?? '').trim(),
    trackCount: Number(playlist?.trackCount ?? 0),
    playCount: Number(playlist?.playCount ?? 0),
    coverUrl: String(playlist?.coverImgUrl ?? '').trim()
  }
}

function normalizeSearchItems(type: string, result: any): (SearchSongItem | SearchArtistItem | SearchPlaylistItem)[] {
  if (type === '100') {
    const artists = Array.isArray(result?.artists) ? result.artists : []
    return artists
      .map((artist: any) => normalizeSearchArtistItem(artist))
      .filter((item: any) => item.id && item.name)
  }

  if (type === '1000') {
    const playlists = Array.isArray(result?.playlists) ? result.playlists : []
    return playlists
      .map((playlist: any) => normalizeSearchPlaylistItem(playlist))
      .filter((item: any) => item.id && item.name)
  }

  const songs = Array.isArray(result?.songs) ? result.songs : []
  return songs.map((song: any) => normalizeSearchSongItem(song)).filter((item: any) => item.id && item.name)
}

function extractSearchTotal(type: string, result: any, items: unknown[]): number {
  if (type === '100') {
    return Number(result?.artistCount ?? items.length ?? 0)
  }

  if (type === '1000') {
    return Number(result?.playlistCount ?? items.length ?? 0)
  }

  return Number(result?.songCount ?? items.length ?? 0)
}

interface SuggestSongItem {
  id: string
  name: string
  artist: string
}

interface SuggestArtistItem {
  id: string
  name: string
}

interface SuggestPlaylistItem {
  id: string
  name: string
  trackCount: number
}

interface SuggestPayload {
  keywords: string[]
  songs: SuggestSongItem[]
  artists: SuggestArtistItem[]
  playlists: SuggestPlaylistItem[]
}

function normalizeSuggestPayload(data: any): SuggestPayload {
  const result = data?.result ?? {}
  const keywords = new Set<string>()

  const pushKeyword = (value: unknown): void => {
    const text = String(value ?? '').trim()
    if (text) keywords.add(text)
  }

  if (Array.isArray(result?.allMatch)) {
    for (const item of result.allMatch) {
      pushKeyword(item?.keyword)
    }
  }

  const songs: SuggestSongItem[] = Array.isArray(result?.songs)
    ? result.songs
        .map((item: any) => ({
          id: String(item?.id ?? ''),
          name: String(item?.name ?? '').trim(),
          artist: normalizeSongArtists(item)
        }))
        .filter((item: SuggestSongItem) => item.id && item.name)
    : []

  const artists: SuggestArtistItem[] = Array.isArray(result?.artists)
    ? result.artists
        .map((item: any) => ({
          id: String(item?.id ?? ''),
          name: String(item?.name ?? '').trim()
        }))
        .filter((item: SuggestArtistItem) => item.id && item.name)
    : []

  const playlists: SuggestPlaylistItem[] = Array.isArray(result?.playlists)
    ? result.playlists
        .map((item: any) => ({
          id: String(item?.id ?? ''),
          name: String(item?.name ?? '').trim(),
          trackCount: Number(item?.trackCount ?? 0)
        }))
        .filter((item: SuggestPlaylistItem) => item.id && item.name)
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

interface SearchResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: {
    keywords: string
    type: string
    limit: number
    offset: number
    total: number
    hasMore: boolean
    items: (SearchSongItem | SearchArtistItem | SearchPlaylistItem)[]
  }
}

async function searchNeteaseByKeyword(payload: any): Promise<SearchResult> {
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
        message: requestResult?.error ?? 'REQUEST_FAILED'
      }
    }

    const data = requestResult.result.data
    const code = Number(data?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    const result = data?.result ?? {}
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
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

interface SuggestResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: SuggestPayload
}

async function searchNeteaseSuggest(payload: any): Promise<SuggestResult> {
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
    const requestResult = await postFormWithFallback(suggestPath, { s: keywords }, 12000, {
      cookieProfile: 'pc'
    })

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        message: requestResult?.error ?? 'REQUEST_FAILED'
      }
    }

    const data = requestResult.result.data
    const code = Number(data?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
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
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

interface DefaultKeywordResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: {
    keyword: string
    raw: unknown
  }
}

interface HotKeywordResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: {
    hots: string[]
    raw: unknown
  }
}

interface HotDetailItem {
  searchWord: string
  score: number
  iconType: number
  content: string
}

interface HotDetailResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: {
    list: HotDetailItem[]
    raw: unknown
  }
}

async function fetchNeteaseSearchDefaultKeyword(): Promise<DefaultKeywordResult> {
  try {
    const requestResult = await postFormWithFallback(
      ['/eapi/search/defaultkeyword/get', '/api/search/defaultkeyword/get'],
      {},
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error ?? 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    return {
      ok: true,
      data: {
        keyword: String(data?.data?.showKeyword ?? data?.data?.realkeyword ?? '').trim(),
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

async function fetchNeteaseSearchHot(): Promise<HotKeywordResult> {
  try {
    const requestResult = await postFormWithFallback(
      ['/weapi/search/hot', '/api/search/hot'],
      { type: 1111 },
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error ?? 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    const hots = Array.isArray(data?.result?.hots)
      ? data.result.hots.map((item: any) => String(item?.first ?? '').trim()).filter(Boolean)
      : []

    return {
      ok: true,
      data: {
        hots,
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

async function fetchNeteaseSearchHotDetail(): Promise<HotDetailResult> {
  try {
    const requestResult = await postFormWithFallback(
      ['/weapi/hotsearchlist/get', '/weapi/search/hot/detail', '/api/search/hot/detail'],
      {},
      12000,
      { cookieProfile: 'pc' }
    )

    if (!requestResult?.ok || !requestResult?.result?.data) {
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error ?? 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    const list: HotDetailItem[] = Array.isArray(data?.data)
      ? data.data
          .map((item: any) => ({
            searchWord: String(item?.searchWord ?? '').trim(),
            score: Number(item?.score ?? 0),
            iconType: Number(item?.iconType ?? 0),
            content: String(item?.content ?? '').trim()
          }))
          .filter((item: HotDetailItem) => item.searchWord)
      : []

    return { ok: true, data: { list, raw: data } }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

interface MultimatchResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: {
    keywords: string
    result: unknown
    raw: unknown
  }
}

async function searchNeteaseMultimatch(payload: any): Promise<MultimatchResult> {
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
      return { ok: false, error: 'REQUEST_FAILED', message: requestResult?.error ?? 'REQUEST_FAILED' }
    }

    const data = requestResult.result.data
    const code = Number(data?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    return {
      ok: true,
      data: {
        keywords,
        result: data?.result ?? {},
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

function sanitizeMessageText(raw: unknown, maxLength: number = 500): string {
  return String(raw ?? '').trim().slice(0, maxLength)
}

function sanitizeUserIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
  const unique = new Set<string>()

  for (const item of list) {
    const id = sanitizeId(item)
    if (id) unique.add(id)
  }

  return Array.from(unique).slice(0, 20)
}

function toNeteaseUserIdsValue(userIds: string[]): string {
  return `[${userIds.join(',')}]`
}

interface SendMessageResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: {
    sendType: string
    userIds: string[]
    code: number
    raw: unknown
  }
}

async function sendNeteasePrivateMessage(payload: any): Promise<SendMessageResult> {
  const sendType = String(payload?.sendType ?? 'text').trim().toLowerCase()
  const userIds = sanitizeUserIds(payload?.userIds)
  const msg = sanitizeMessageText(payload?.msg)

  if (!userIds.length) {
    return { ok: false, error: 'INVALID_USER_IDS' }
  }

  if (!msg) {
    return { ok: false, error: 'INVALID_MESSAGE' }
  }

  const userIdsValue = toNeteaseUserIdsValue(userIds)
  let paths: string[] = []
  let data: Record<string, unknown> = {}
  let options: Record<string, unknown> = { cookieProfile: 'pc' }

  if (sendType === 'song') {
    const id = sanitizeId(payload?.id ?? payload?.songId)
    if (!id) return { ok: false, error: 'INVALID_RESOURCE_ID' }
    paths = ['/api/msg/private/send']
    data = { id, msg, type: 'song', userIds: userIdsValue }
    options = { cookieProfile: 'ios' }
  } else if (sendType === 'album') {
    const id = sanitizeId(payload?.id ?? payload?.albumId)
    if (!id) return { ok: false, error: 'INVALID_RESOURCE_ID' }
    paths = ['/api/msg/private/send']
    data = { id, msg, type: 'album', userIds: userIdsValue }
    options = { cookieProfile: 'ios' }
  } else if (sendType === 'playlist') {
    const id = sanitizeId(payload?.id ?? payload?.playlistId)
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
        message: requestResult?.error ?? 'REQUEST_FAILED'
      }
    }

    const result = requestResult.result.data
    const code = Number(result?.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(result) ?? 'REQUEST_FAILED'
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
    return { ok: false, error: 'REQUEST_FAILED', message: (err as any)?.message ?? '' }
  }
}

export {
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
