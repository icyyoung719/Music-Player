import { formatTime, getFileNameFromPath, normalizePath } from './trackUtils.js'

const RECENTLY_PLAYED_STORAGE_KEY = 'musicPlayer.recentlyPlayed.v1'
const RECENTLY_PLAYED_LIMIT = 50

function safeReadStorage() {
  try {
    const raw = localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeWriteStorage(items) {
  try {
    localStorage.setItem(RECENTLY_PLAYED_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Ignore storage quota and serialization errors.
  }
}

function sanitizeDuration(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeRecord(item) {
  if (!item || typeof item !== 'object') return null
  const filePath = String(item.filePath || '').trim()
  if (!filePath) return null

  const key = String(item.key || `path:${normalizePath(filePath)}`).trim()
  if (!key) return null

  const title = String(item.title || '').trim() || getFileNameFromPath(filePath)
  const artist = String(item.artist || '').trim()
  const album = String(item.album || '').trim()
  const coverDataUrl = String(item.coverDataUrl || '').trim()
  const playedAt = Number(item.playedAt)

  return {
    key,
    filePath,
    title,
    artist,
    album,
    duration: sanitizeDuration(item.duration),
    coverDataUrl,
    playedAt: Number.isFinite(playedAt) && playedAt > 0 ? playedAt : Date.now()
  }
}

function dedupeAndTrim(records) {
  const result = []
  const seen = new Set()

  for (const item of records) {
    const normalized = normalizeRecord(item)
    if (!normalized) continue
    if (seen.has(normalized.key)) continue
    seen.add(normalized.key)
    result.push(normalized)
    if (result.length >= RECENTLY_PLAYED_LIMIT) break
  }

  return result
}

export function createRecentlyPlayedManager(options) {
  const {
    dom,
    eventBus
  } = options || {}

  let records = dedupeAndTrim(
    safeReadStorage().sort((a, b) => (Number(b?.playedAt) || 0) - (Number(a?.playedAt) || 0))
  )

  function emit(eventName, payload) {
    if (!eventBus) return
    eventBus.emit(eventName, payload)
  }

  function persistAndNotify() {
    safeWriteStorage(records)
    emit('recently-played:updated', { count: records.length })
  }

  function getAll() {
    return records.slice()
  }

  function recordFromPlayback(payload) {
    const filePath = String(payload?.filePath || '').trim()
    if (!filePath) return

    const key = String(payload?.trackKey || `path:${normalizePath(filePath)}`).trim()
    if (!key) return

    const metadata = payload?.metadata || {}
    const nextRecord = normalizeRecord({
      key,
      filePath,
      title: metadata.title || payload?.track?.name || getFileNameFromPath(filePath),
      artist: metadata.artist || payload?.track?.metadataCache?.artist || '',
      album: metadata.album || payload?.track?.metadataCache?.album || '',
      duration: metadata.duration || payload?.track?.metadataCache?.duration,
      coverDataUrl: metadata.coverDataUrl || payload?.track?.metadataCache?.coverDataUrl || '',
      playedAt: payload?.playedAt || Date.now()
    })

    if (!nextRecord) return

    records = [nextRecord].concat(records.filter((item) => item.key !== nextRecord.key)).slice(0, RECENTLY_PLAYED_LIMIT)
    persistAndNotify()
  }

  function removeByKey(key) {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) return
    const before = records.length
    records = records.filter((item) => item.key !== normalizedKey)
    if (records.length === before) return
    persistAndNotify()
  }

  function clear() {
    if (!records.length) return
    records = []
    persistAndNotify()
  }

  function render() {
    if (!dom?.listEl) return

    dom.listEl.innerHTML = ''

    if (!records.length) {
      const empty = document.createElement('div')
      empty.className = 'playlist-detail-empty'
      empty.textContent = '最近播放还是空的，播放一首本地歌曲后会显示在这里。'
      dom.listEl.appendChild(empty)
      if (dom.countEl) dom.countEl.textContent = '0 首歌曲'
      return
    }

    if (dom.countEl) dom.countEl.textContent = `${records.length} 首歌曲`

    const fragment = document.createDocumentFragment()

    records.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'playlist-detail-track-row'
      row.title = '点击立即播放'

      const indexEl = document.createElement('span')
      indexEl.className = 'playlist-col-index'
      indexEl.textContent = String(index + 1).padStart(2, '0')

      const coverEl = document.createElement('span')
      coverEl.className = 'playlist-col-cover'
      coverEl.textContent = '♪'

      if (item.coverDataUrl) {
        const coverImg = document.createElement('img')
        coverImg.alt = '歌曲封面'
        coverImg.loading = 'lazy'
        coverImg.src = item.coverDataUrl
        coverEl.classList.add('has-image')
        coverEl.textContent = ''
        coverEl.appendChild(coverImg)
      }

      const titleEl = document.createElement('span')
      titleEl.className = 'playlist-col-title'
      titleEl.textContent = item.title || getFileNameFromPath(item.filePath)

      const artistEl = document.createElement('span')
      artistEl.className = 'playlist-col-artist'
      artistEl.textContent = item.artist || '未知歌手'

      const albumEl = document.createElement('span')
      albumEl.className = 'playlist-col-album'
      albumEl.textContent = item.album || '未知专辑'

      const durationEl = document.createElement('span')
      durationEl.className = 'playlist-col-duration'
      durationEl.textContent = item.duration ? formatTime(item.duration) : '--:--'

      const actionWrap = document.createElement('span')
      actionWrap.className = 'playlist-col-action recently-played-col-action'

      const appendBtn = document.createElement('button')
      appendBtn.className = 'playlist-track-remove-btn'
      appendBtn.textContent = '加入当前列表'
      appendBtn.title = '加入当前播放列表'
      appendBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        emit('playback:queue.append', {
          tracks: [
            {
              name: item.title || getFileNameFromPath(item.filePath),
              path: item.filePath,
              file: null,
              metadataCache: {
                title: item.title,
                artist: item.artist,
                album: item.album,
                duration: item.duration,
                coverDataUrl: item.coverDataUrl
              }
            }
          ]
        })
      })

      const removeBtn = document.createElement('button')
      removeBtn.className = 'playlist-track-remove-btn danger'
      removeBtn.textContent = '移除'
      removeBtn.title = '从最近播放移除'
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        removeByKey(item.key)
      })

      actionWrap.appendChild(appendBtn)
      actionWrap.appendChild(removeBtn)

      row.appendChild(indexEl)
      row.appendChild(coverEl)
      row.appendChild(titleEl)
      row.appendChild(artistEl)
      row.appendChild(albumEl)
      row.appendChild(durationEl)
      row.appendChild(actionWrap)

      row.addEventListener('click', () => {
        emit('playback:queue.replace', {
          tracks: [
            {
              name: item.title || getFileNameFromPath(item.filePath),
              path: item.filePath,
              file: null,
              metadataCache: {
                title: item.title,
                artist: item.artist,
                album: item.album,
                duration: item.duration,
                coverDataUrl: item.coverDataUrl
              }
            }
          ],
          startIndex: 0,
          options: {}
        })
        emit('view:song.open')
      })

      fragment.appendChild(row)
    })

    dom.listEl.appendChild(fragment)
  }

  function init() {
    records = dedupeAndTrim(
      safeReadStorage().sort((a, b) => (Number(b?.playedAt) || 0) - (Number(a?.playedAt) || 0))
    )
    safeWriteStorage(records)

    if (dom?.clearBtn) {
      dom.clearBtn.addEventListener('click', () => {
        if (!records.length) return
        const confirmed = window.confirm('确定清空最近播放记录吗？')
        if (!confirmed) return
        clear()
      })
    }

    if (eventBus) {
      eventBus.on('playback:track.started', recordFromPlayback)
      eventBus.on('view:recently-played.render', () => {
        render()
      })
    }

    render()
  }

  return {
    init,
    render,
    getAll,
    clear,
    removeByKey
  }
}
