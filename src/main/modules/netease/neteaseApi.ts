import path from 'path'
import type { IncomingHttpHeaders } from 'http'

type AnyRecord = Record<string, unknown>

type PostFormWithFallbackResult = {
  ok?: boolean
  error?: string
  result?: {
    data?: unknown
  }
}

type SongDownloadResolvedSource = {
  type?: unknown
  url?: unknown
}

type SongLike = {
  id?: unknown
  name?: unknown
  ar?: unknown
  artists?: unknown
  al?: unknown
  album?: unknown
  dt?: unknown
  duration?: unknown
}

type PlaylistTrackIdLike = {
  id?: unknown
}

type SongDownloadItemLike = {
  id?: unknown
  url?: unknown
  level?: unknown
  type?: unknown
  size?: unknown
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' ? (value as AnyRecord) : {}
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

const { requestJson } = require('./httpClient') as {
  requestJson: (url: string, options?: Record<string, unknown>) => Promise<unknown>
}
const {
  buildAuthHeaders,
  requestNeteaseApi,
  postFormWithFallback,
  extractApiErrorMessage
} = require('./authManager') as {
  buildAuthHeaders: (extra?: Record<string, string>) => Record<string, string>
  requestNeteaseApi: (path: string, params?: Record<string, unknown>) => Promise<unknown>
  postFormWithFallback: (paths: string[], data: Record<string, unknown>, timeout: number, options?: Record<string, unknown>) => Promise<PostFormWithFallbackResult>
  extractApiErrorMessage: (data: unknown) => string
}
const { logProgramEvent } = require('../logger') as {
  logProgramEvent: (payload: {
    source?: string
    event?: string
    message?: string
    data?: unknown
    error?: unknown
  }) => void
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

function resolveAudioExtByResolvedUrl(resolved: SongDownloadResolvedSource | unknown): string {
  const payload = asRecord(resolved)
  const fromTypeValue = normalizeAudioExt(payload.type)
  if (fromTypeValue) return fromTypeValue
  const fromUrl = resolveAudioExtByUrl(payload.url)
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

function normalizeSongArtists(song: SongLike | unknown): string {
  const payload = asRecord(song)
  const ar = Array.isArray(payload.ar) ? payload.ar : []
  if (ar.length > 0) {
    return ar
      .map((item: unknown) => String(asRecord(item).name ?? '').trim())
      .filter(Boolean)
      .join(' / ')
  }
  const artists = Array.isArray(payload.artists) ? payload.artists : []
  if (artists.length > 0) {
    return artists
      .map((item: unknown) => String(asRecord(item).name ?? '').trim())
      .filter(Boolean)
      .join(' / ')
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

const PLAYLIST_UNKNOWN_TITLE = '未知歌曲'
const PLAYLIST_UNKNOWN_ARTIST = '未知歌手'
const PLAYLIST_UNKNOWN_ALBUM = '未知专辑'

function normalizePlaylistTrackMetadata(metadata: SongMetadata): SongMetadata {
  const title = String(metadata.title ?? '').trim()
  const artist = String(metadata.artist ?? '').trim()
  const album = String(metadata.album ?? '').trim()

  return {
    ...metadata,
    title: title || PLAYLIST_UNKNOWN_TITLE,
    artist: artist || PLAYLIST_UNKNOWN_ARTIST,
    album: album || PLAYLIST_UNKNOWN_ALBUM
  }
}

function extractSongMetadata(song: SongLike | unknown, fallbackSongId?: unknown): SongMetadata | null {
  if (!song || typeof song !== 'object') return null

  const payload = song as SongLike
  const album = asRecord(payload.al ?? payload.album)

  const artist = normalizeSongArtists(song)
  const publishTime = Number(album.publishTime ?? 0)
  const year = publishTime > 0 ? new Date(publishTime).getFullYear() : null

  return {
    songId: String(payload.id ?? fallbackSongId ?? ''),
    title: String(payload.name ?? '').trim(),
    artist: String(artist ?? '').trim(),
    album: String(album.name ?? '').trim(),
    durationMs: toSafeInteger(payload.dt ?? payload.duration),
    year: Number.isFinite(year as number) ? year : null,
    coverUrl: String(album.picUrl ?? '').trim()
  }
}

async function fetchSongMetadataById(songId: string): Promise<SongMetadata | null> {
  try {
    const url = `https://music.163.com/api/song/detail/?ids=[${songId}]`
    const data = asRecord(await requestJson(url))
    const songs = Array.isArray(data.songs) ? data.songs : []
    const song = songs[0] ?? null
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
    const data = asRecord(await requestJson(url))
    const lrcPayload = asRecord(data.lrc)
    const lrc = lrcPayload.lyric ?? ''
    return String(lrc).trim()
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
  const data = asRecord(await requestJson(url))
  const playlist = asRecord(data.playlist)

  if (!Object.keys(playlist).length) return null

  const name = String(playlist.name ?? `歌单 ${playlistId}`).trim()
  const creator = String(asRecord(playlist.creator).nickname ?? '').trim()
  const trackIds = Array.isArray(playlist.trackIds)
    ? playlist.trackIds
        .map((item: unknown) => sanitizeSongId((item as PlaylistTrackIdLike)?.id))
        .filter((id): id is string => Boolean(id))
    : []

  let trackList = Array.isArray(playlist.tracks) ? playlist.tracks : []
  const hasCompleteTrackList = trackIds.length > 0 && trackList.length >= trackIds.length

  if (trackIds.length > 0 && !hasCompleteTrackList) {
    const songMap = new Map<string, SongLike>()
    const batches = chunkArray(trackIds, PLAYLIST_TRACK_BATCH_SIZE)

    for (const batch of batches) {
      const c = JSON.stringify(
        batch.map((id) => ({ id: Number(id) }))
      )
      const body = encodeFormData({ c })

      const response = asRecord(await requestJson('https://music.163.com/api/v3/song/detail', {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(body))
        }),
        body,
        timeout: 20000
      }))

      const songs = Array.isArray(response?.songs) ? response.songs : []
      for (const song of songs) {
        const songPayload = song as SongLike
        const id = sanitizeSongId(songPayload?.id)
        if (id) songMap.set(id, songPayload)
      }
    }

    trackList = trackIds.map((id) => songMap.get(id)).filter(Boolean)
  }

  const tracks = trackList
    .map((track: unknown) => extractSongMetadata(track, (track as SongLike)?.id))
    .filter((track): track is SongMetadata => Boolean(track))
    .map((track: SongMetadata) => normalizePlaylistTrackMetadata(track))


  return {
    id: String(playlistId),
    name,
    creator,
    description: String(playlist.description ?? '').trim(),
    coverUrl: String(playlist.coverImgUrl ?? '').trim(),
    tags: Array.isArray(playlist.tags)
      ? playlist.tags.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
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

function resolveSongDownloadUrlResponse(json: unknown, songId: string): SongDownloadUrlResponse | null {
  const payload = asRecord(json)
  const dataList = Array.isArray(payload.data) ? payload.data : []
  const exact = dataList.find((item: unknown) => String((item as SongDownloadItemLike)?.id ?? '') === String(songId))
  const first = exact ?? dataList[0]
  const firstPayload = first as SongDownloadItemLike | undefined
  const url = String(firstPayload?.url ?? '').trim()

  if (!url) return null

  return {
    url,
    songId: String(firstPayload?.id ?? songId),
    level: String(firstPayload?.level ?? ''),
    type: String(firstPayload?.type ?? ''),
    size: Number(firstPayload?.size ?? 0)
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

      lastMessage = extractApiErrorMessage(data) ?? lastMessage
    } catch (err) {
      const errorMsg = toErrorMessage(err) || 'REQUEST_FAILED'
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
const SEARCH_UNKNOWN_ARTIST = '未知歌手'
const SEARCH_UNKNOWN_ALBUM = '未知专辑'

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

function normalizeSearchSongItem(song: unknown): SearchSongItem {
  const payload = song as SongLike
  const metadata = extractSongMetadata(song, payload?.id)
  const artist = String(metadata?.artist ?? '').trim()
  const album = String(metadata?.album ?? '').trim()
  return {
    id: String(metadata?.songId ?? payload?.id ?? ''),
    name: metadata?.title ?? String(payload?.name ?? '').trim(),
    artist: artist || SEARCH_UNKNOWN_ARTIST,
    album: album || SEARCH_UNKNOWN_ALBUM,
    durationMs: Number(metadata?.durationMs ?? 0),
    coverUrl: metadata?.coverUrl ?? ''
  }
}

function normalizeSearchArtistItem(artist: unknown): SearchArtistItem {
  const payload = asRecord(artist)
  return {
    id: String(payload.id ?? ''),
    name: String(payload.name ?? '').trim(),
    alias: Array.isArray(payload.alias)
      ? payload.alias.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : [],
    albumSize: Number(payload.albumSize ?? 0),
    mvSize: Number(payload.mvSize ?? 0),
    picUrl: String(payload.picUrl ?? payload.img1v1Url ?? '').trim()
  }
}

function normalizeSearchPlaylistItem(playlist: unknown): SearchPlaylistItem {
  const payload = asRecord(playlist)
  const creator = asRecord(payload.creator)
  return {
    id: String(payload.id ?? ''),
    name: String(payload.name ?? '').trim(),
    creator: String(creator.nickname ?? '').trim(),
    trackCount: Number(payload.trackCount ?? 0),
    playCount: Number(payload.playCount ?? 0),
    coverUrl: String(payload.coverImgUrl ?? '').trim()
  }
}

function normalizeSearchItems(type: string, result: unknown): (SearchSongItem | SearchArtistItem | SearchPlaylistItem)[] {
  const payload = asRecord(result)
  if (type === '100') {
    const artists = Array.isArray(payload.artists) ? payload.artists : []
    return artists
      .map((artist: unknown) => normalizeSearchArtistItem(artist))
      .filter((item) => item.id && item.name)
  }

  if (type === '1000') {
    const playlists = Array.isArray(payload.playlists) ? payload.playlists : []
    return playlists
      .map((playlist: unknown) => normalizeSearchPlaylistItem(playlist))
      .filter((item) => item.id && item.name)
  }

  const songs = Array.isArray(payload.songs) ? payload.songs : []
  return songs.map((song: unknown) => normalizeSearchSongItem(song)).filter((item) => item.id && item.name)
}

function extractSearchTotal(type: string, result: unknown, items: unknown[]): number {
  const payload = asRecord(result)
  if (type === '100') {
    return Number(payload.artistCount ?? items.length ?? 0)
  }

  if (type === '1000') {
    return Number(payload.playlistCount ?? items.length ?? 0)
  }

  return Number(payload.songCount ?? items.length ?? 0)
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

function normalizeSuggestPayload(data: unknown): SuggestPayload {
  const payload = asRecord(data)
  const result = asRecord(payload.result)
  const keywords = new Set<string>()

  const pushKeyword = (value: unknown): void => {
    const text = String(value ?? '').trim()
    if (text) keywords.add(text)
  }

  if (Array.isArray(result?.allMatch)) {
    for (const item of result.allMatch) {
      pushKeyword(asRecord(item).keyword)
    }
  }

  const songs: SuggestSongItem[] = Array.isArray(result?.songs)
    ? result.songs
        .map((item: unknown) => {
          const source = asRecord(item)
          return {
            id: String(source.id ?? ''),
            name: String(source.name ?? '').trim(),
            artist: normalizeSongArtists(source)
          }
        })
        .filter((item: SuggestSongItem) => item.id && item.name)
    : []

  const artists: SuggestArtistItem[] = Array.isArray(result?.artists)
    ? result.artists
        .map((item: unknown) => {
          const source = asRecord(item)
          return {
            id: String(source.id ?? ''),
            name: String(source.name ?? '').trim()
          }
        })
        .filter((item: SuggestArtistItem) => item.id && item.name)
    : []

  const playlists: SuggestPlaylistItem[] = Array.isArray(result?.playlists)
    ? result.playlists
        .map((item: unknown) => {
          const source = asRecord(item)
          return {
            id: String(source.id ?? ''),
            name: String(source.name ?? '').trim(),
            trackCount: Number(source.trackCount ?? 0)
          }
        })
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

async function searchNeteaseByKeyword(payload: Record<string, unknown>): Promise<SearchResult> {
  const keywords = sanitizeSearchKeyword(payload?.keywords)
  const type = sanitizeSearchType(payload?.type, '1')
  const limit = sanitizeSearchLimit(payload?.limit)
  const offset = sanitizeSearchOffset(payload?.offset)

  if (!keywords) {
    return { ok: false, error: 'INVALID_KEYWORDS' }
  }

  try {
    let requestResult: PostFormWithFallbackResult | null = null
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

    const data = asRecord(requestResult.result.data)
    const code = Number(data.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    const result = asRecord(data.result)
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
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
  }
}

interface SuggestResult {
  ok: boolean
  error?: string
  code?: number
  message?: string
  data?: SuggestPayload
}

async function searchNeteaseSuggest(payload: Record<string, unknown>): Promise<SuggestResult> {
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

    const data = asRecord(requestResult.result.data)
    const code = Number(data.code ?? 0)
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
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
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

    const data = asRecord(requestResult.result.data)
    const code = Number(data.code ?? 0)
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
        keyword: String(asRecord(data.data).showKeyword ?? asRecord(data.data).realkeyword ?? '').trim(),
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
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

    const data = asRecord(requestResult.result.data)
    const code = Number(data.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    const result = asRecord(data.result)
    const hots = Array.isArray(result.hots)
      ? result.hots.map((item: unknown) => String(asRecord(item).first ?? '').trim()).filter(Boolean)
      : []

    return {
      ok: true,
      data: {
        hots,
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
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

    const data = asRecord(requestResult.result.data)
    const code = Number(data.code ?? 0)
    if (code && code !== 200) {
      return {
        ok: false,
        error: 'REQUEST_FAILED',
        code,
        message: extractApiErrorMessage(data) ?? 'REQUEST_FAILED'
      }
    }

    const list: HotDetailItem[] = Array.isArray(data.data)
      ? data.data
          .map((item: unknown) => {
            const source = asRecord(item)
            return {
              searchWord: String(source.searchWord ?? '').trim(),
              score: Number(source.score ?? 0),
              iconType: Number(source.iconType ?? 0),
              content: String(source.content ?? '').trim()
            }
          })
          .filter((item: HotDetailItem) => item.searchWord)
      : []

    return { ok: true, data: { list, raw: data } }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
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

async function searchNeteaseMultimatch(payload: Record<string, unknown>): Promise<MultimatchResult> {
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

    const data = asRecord(requestResult.result.data)
    const code = Number(data.code ?? 0)
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
        result: asRecord(data.result),
        raw: data
      }
    }
  } catch (err) {
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
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

async function sendNeteasePrivateMessage(payload: Record<string, unknown>): Promise<SendMessageResult> {
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

    const result = asRecord(requestResult.result.data)
    const code = Number(result.code ?? 0)
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
    return { ok: false, error: 'REQUEST_FAILED', message: toErrorMessage(err) }
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
