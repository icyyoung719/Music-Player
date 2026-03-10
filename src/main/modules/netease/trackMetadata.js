const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { requestBuffer } = require('./httpClient')
const { buildAuthHeaders, md5 } = require('./authManager')
const { fetchSongLyricsById, resolveCoverExtByUrl, resolveCoverMimeByExt } = require('./neteaseApi')
const { writeId3TagsToMp3 } = require('./id3Writer')

const TRACK_METADATA_STORE_NAME = 'netease-track-metadata.json'
const TRACK_COVER_DIR_NAME = 'netease-track-covers'

let trackMetadataLoaded = false
// Exported as a live object reference — always mutate properties, never reassign.
const trackMetadataStore = {}

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
    if (parsed && typeof parsed === 'object') {
      Object.assign(trackMetadataStore, parsed)
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to read netease track metadata store:', err)
    }
  }
}

async function persistTrackMetadataStore() {
  await fs.promises.mkdir(path.dirname(getTrackMetadataStorePath()), { recursive: true })
  await fs.promises.writeFile(getTrackMetadataStorePath(), JSON.stringify(trackMetadataStore, null, 2), 'utf8')
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

module.exports = {
  trackMetadataStore,
  ensureTrackMetadataLoaded,
  persistTrackMetadataStore,
  persistTrackMetadataForTask,
  normalizeTrackPathKey,
  getTrackMetadataStorePath,
  getTrackCoverDirPath
}
