const fs = require('fs') as typeof import('fs')
const path = require('path') as typeof import('path')
const { app } = require('electron') as typeof import('electron')
const { requestBuffer } = require('./httpClient') as {
  requestBuffer: (url: string, options?: { headers?: Record<string, string>; timeout?: number }) => Promise<Buffer>
}
const { buildAuthHeaders, md5 } = require('./authManager') as {
  buildAuthHeaders: () => Record<string, string>
  md5: (value: string) => string
}
const { fetchSongLyricsById, resolveCoverExtByUrl, resolveCoverMimeByExt } = require('./neteaseApi') as {
  fetchSongLyricsById: (songId: string) => Promise<string>
  resolveCoverExtByUrl: (url: string) => string
  resolveCoverMimeByExt: (ext: string) => string
}
const { writeEmbeddedTags } = require('./id3Writer') as {
  writeEmbeddedTags: (
    filePath: string,
    metadata: TrackMetadataEntry,
    coverBuffer: Buffer | null,
    coverMime: string
  ) => Promise<boolean>
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

const TRACK_METADATA_STORE_NAME = 'netease-track-metadata.json'
const TRACK_COVER_DIR_NAME = 'netease-track-covers'

type DownloadTaskLike = {
  filePath?: string
  status?: string
  songId?: string
  title?: string
  songMetadata?: {
    songId?: string
    title?: string
    artist?: string
    album?: string
    year?: number | string | null
    coverUrl?: string
  } | null
}

type TrackMetadataEntry = {
  songId: string
  title: string
  artist: string
  album: string
  year: number | null
  coverPath: string
  coverUrl: string
  updatedAt: number
  lyrics?: string
}

let trackMetadataLoaded = false
// Exported as a live object reference - always mutate properties, never reassign.
const trackMetadataStore: Record<string, TrackMetadataEntry> = {}

function getTrackMetadataStorePath() {
  return path.join(app.getPath('userData'), TRACK_METADATA_STORE_NAME)
}

function getTrackCoverDirPath() {
  return path.join(app.getPath('userData'), TRACK_COVER_DIR_NAME)
}

function normalizeTrackPathKey(filePath: string): string {
  const resolved = path.resolve(String(filePath || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function ensureTrackMetadataLoaded() {
  if (trackMetadataLoaded) return
  trackMetadataLoaded = true

  try {
    const content = await fs.promises.readFile(getTrackMetadataStorePath(), 'utf8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      Object.assign(trackMetadataStore, parsed)
    }
  } catch (err) {
    const typedErr = err as NodeJS.ErrnoException
    if (typedErr.code !== 'ENOENT') {
      logProgramEvent({
        source: 'netease.trackMetadata',
        event: 'read-track-metadata-store-failed',
        message: 'Failed to read netease track metadata store',
        error: err
      })
    }
  }
}

async function persistTrackMetadataStore() {
  await fs.promises.mkdir(path.dirname(getTrackMetadataStorePath()), { recursive: true })
  await fs.promises.writeFile(getTrackMetadataStorePath(), JSON.stringify(trackMetadataStore, null, 2), 'utf8')
}

async function persistTrackMetadataForTask(task: DownloadTaskLike): Promise<void> {
  if (!task || !task.filePath || task.status !== 'succeeded') return

  const sourceMetadata = task.songMetadata && typeof task.songMetadata === 'object' ? task.songMetadata : null
  if (!sourceMetadata) return

  const entry: TrackMetadataEntry = {
    songId: sourceMetadata.songId || task.songId || '',
    title: sourceMetadata.title || task.title || path.basename(task.filePath),
    artist: sourceMetadata.artist || '',
    album: sourceMetadata.album || '',
    year: Number.isFinite(Number(sourceMetadata.year)) ? Number(sourceMetadata.year) : null,
    coverPath: '',
    coverUrl: sourceMetadata.coverUrl || '',
    updatedAt: Date.now()
  }

  if (entry.songId) {
    const lyrics = await fetchSongLyricsById(entry.songId)
    if (lyrics) {
      entry.lyrics = lyrics
    }
  }

  let coverBuffer: Buffer | null = null
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
      logProgramEvent({
        source: 'netease.trackMetadata',
        event: 'cache-cover-image-failed',
        message: 'Failed to cache NetEase cover image',
        error: err,
        data: { songId: entry.songId }
      })
    }
  }

  try {
    await writeEmbeddedTags(task.filePath, entry, coverBuffer, coverMime)
  } catch (err) {
    logProgramEvent({
      source: 'netease.trackMetadata',
      event: 'write-embedded-tags-failed',
      message: 'Failed to write embedded tags for downloaded audio',
      error: err,
      data: { filePath: task.filePath }
    })
  }

  await ensureTrackMetadataLoaded()
  trackMetadataStore[normalizeTrackPathKey(task.filePath)] = entry
  await persistTrackMetadataStore()
}

module.exports = {
  trackMetadataStore,
  ensureTrackMetadataLoaded,
  persistTrackMetadataStore,
  persistTrackMetadataForTask,
  normalizeTrackPathKey,
  getTrackMetadataStorePath,
  getTrackCoverDirPath
}

export {}
