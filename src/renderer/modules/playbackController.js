import {
  formatTime,
  filePathToURL,
  getFileNameFromPath,
  normalizePath,
  getTrackUniqueKey,
  getCurrentTrackPath
} from './trackUtils.js'
import { createLyricManager } from './lyricManager.js'

const PREFETCH_BEFORE_SECONDS = 20
const FADE_SETTINGS_STORAGE_KEY = 'musicPlayer.playbackFade.v1'
const DEFAULT_FADE_SETTINGS = {
  fadeInMs: 250,
  fadeOutMs: 350
}

export function createPlaybackController(options) {
  const {
    electronAPI,
    dom,
    onShowHomePage,
    onShowSongPage,
    onSetHomeNowCover
  } = options

  const audio = new Audio()
  let playlist = []
  let currentIndex = -1
  let isLooping = false
  let isSeeking = false
  let previewSeekRatio = null
  let lyricManager = null
  const lazyTaskIndexMap = new Map()
  const lazyWaitersByIndex = new Map()
  let fadeSettings = loadFadeSettings()
  let fadeTimer = null
  let fadeToken = 0
  let loadRequestId = 0

  function clampFadeDuration(value, fallbackValue) {
    if (!Number.isFinite(value)) return fallbackValue
    return Math.max(0, Math.min(5000, Math.round(value)))
  }

  function sanitizeFadeSettings(input = {}) {
    return {
      fadeInMs: clampFadeDuration(Number(input.fadeInMs), DEFAULT_FADE_SETTINGS.fadeInMs),
      fadeOutMs: clampFadeDuration(Number(input.fadeOutMs), DEFAULT_FADE_SETTINGS.fadeOutMs)
    }
  }

  function loadFadeSettings() {
    try {
      const raw = localStorage.getItem(FADE_SETTINGS_STORAGE_KEY)
      if (!raw) return { ...DEFAULT_FADE_SETTINGS }
      const parsed = JSON.parse(raw)
      return sanitizeFadeSettings(parsed || {})
    } catch (err) {
      console.warn('Failed to load fade settings:', err)
      return { ...DEFAULT_FADE_SETTINGS }
    }
  }

  function persistFadeSettings() {
    try {
      localStorage.setItem(FADE_SETTINGS_STORAGE_KEY, JSON.stringify(fadeSettings))
    } catch (err) {
      console.warn('Failed to save fade settings:', err)
    }
  }

  function stopFade(options = {}) {
    const { resetVolume = false } = options
    if (fadeTimer) {
      clearInterval(fadeTimer)
      fadeTimer = null
    }
    fadeToken += 1
    if (resetVolume) {
      audio.volume = 1
    }
  }

  function runFadeTo(targetVolume, durationMs) {
    const safeTarget = Math.max(0, Math.min(1, Number(targetVolume) || 0))
    const safeDuration = Math.max(0, Number(durationMs) || 0)

    stopFade()

    if (safeDuration <= 0 || Math.abs(audio.volume - safeTarget) < 0.001) {
      audio.volume = safeTarget
      return Promise.resolve(true)
    }

    const localToken = fadeToken
    const startVolume = audio.volume
    const delta = safeTarget - startVolume
    const startAt = Date.now()

    return new Promise((resolve) => {
      fadeTimer = setInterval(() => {
        if (localToken !== fadeToken) {
          resolve(false)
          return
        }

        const elapsed = Date.now() - startAt
        const progress = Math.max(0, Math.min(1, elapsed / safeDuration))
        audio.volume = Math.max(0, Math.min(1, startVolume + delta * progress))

        if (progress >= 1) {
          clearInterval(fadeTimer)
          fadeTimer = null
          resolve(true)
        }
      }, 20)
    })
  }

  function setPlayButtonState(isPlaying) {
    if (!dom.playBtn) return
    dom.playBtn.textContent = isPlaying ? '⏸' : '▶'
    dom.playBtn.title = isPlaying ? '暂停' : '播放'
  }

  function setBottomNowPlaying(title, artist) {
    if (dom.bottomTrackTitleEl) dom.bottomTrackTitleEl.textContent = title || '\u00a0'
    if (dom.bottomTrackArtistEl) dom.bottomTrackArtistEl.textContent = artist || '\u00a0'
    if (dom.homeNowTitleEl) dom.homeNowTitleEl.textContent = title || 'Little Busters!'
    if (dom.homeNowArtistEl) dom.homeNowArtistEl.textContent = artist || 'Rita / VISUAL ARTS'
    if (dom.homeFeaturedTitleEl && title) dom.homeFeaturedTitleEl.textContent = title
  }

  function reportPlayerState() {
    if (!electronAPI || !electronAPI.reportPlayerState) return

    const hasQueue = playlist.length > 0
    const currentTrack = currentIndex >= 0 && currentIndex < playlist.length ? playlist[currentIndex] : null
    const title = dom.trackTitle && dom.trackTitle.textContent ? dom.trackTitle.textContent : (currentTrack?.name || '')

    electronAPI.reportPlayerState({
      hasQueue,
      isPlaying: hasQueue && !audio.paused,
      title
    })
  }

  function resetProgress() {
    dom.progressBar.style.width = '0%'
    dom.progressContainer.style.setProperty('--progress', '0%')
    dom.currentTimeEl.textContent = '0:00'
    dom.totalTimeEl.textContent = '0:00'
  }

  function updateProgressUIByRatio(ratio, currentTime) {
    const safeRatio = Math.max(0, Math.min(1, ratio || 0))
    const pct = safeRatio * 100
    const pctText = pct + '%'
    dom.progressBar.style.width = pctText
    dom.progressContainer.style.setProperty('--progress', pctText)

    if (Number.isFinite(currentTime)) {
      dom.currentTimeEl.textContent = formatTime(currentTime)
    }
  }

  function resetTrackMeta() {
    dom.trackTitle.textContent = '未选择歌曲'
    dom.trackArtist.textContent = ''
    dom.trackAlbum.textContent = ''
    setBottomNowPlaying('', '')
    onSetHomeNowCover(null)
    dom.coverImg.style.display = 'none'
    dom.coverImg.src = ''
    dom.coverPlaceholder.style.display = 'flex'
  }

  function updatePlaylistUI() {
    dom.playlistEl.innerHTML = ''
    if (playlist.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'playlist-empty'
      empty.textContent = '拖入或添加歌曲'
      dom.playlistEl.appendChild(empty)
      return
    }

    playlist.forEach((track, index) => {
      const item = document.createElement('div')
      item.className = 'playlist-item' + (index === currentIndex ? ' active' : '')

      const idxSpan = document.createElement('span')
      idxSpan.className = 'playlist-index'
      idxSpan.textContent = index + 1

      const titleSpan = document.createElement('span')
      titleSpan.className = 'playlist-item-title'
      if (track?.lazyNetease?.songId && !track.path && !track.file) {
        titleSpan.textContent = `${track.name} · 云端`
      } else {
        titleSpan.textContent = track.name
      }

      const delBtn = document.createElement('button')
      delBtn.className = 'playlist-delete-btn'
      delBtn.textContent = '✕'
      delBtn.title = '从列表移除'
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        removeTrack(index)
      })

      item.appendChild(idxSpan)
      item.appendChild(titleSpan)
      item.appendChild(delBtn)
      item.addEventListener('click', () => loadTrack(index))
      dom.playlistEl.appendChild(item)
    })

    const activeItem = dom.playlistEl.querySelector('.playlist-item.active')
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest' })
    reportPlayerState()
  }

  function isLazyNeteaseTrack(track) {
    return Boolean(track?.lazyNetease?.songId)
  }

  function markLazyTrackState(index, nextState, taskId = '') {
    const track = playlist[index]
    if (!isLazyNeteaseTrack(track)) return

    track.lazyNetease.state = String(nextState || track.lazyNetease.state || 'idle')
    track.lazyNetease.taskId = taskId ? String(taskId) : String(track.lazyNetease.taskId || '')
  }

  function resolveLazyWaiters(index, ok) {
    const waiters = lazyWaitersByIndex.get(index)
    if (!waiters || !waiters.length) {
      lazyWaitersByIndex.delete(index)
      return
    }

    for (const waiter of waiters) {
      try {
        waiter(Boolean(ok))
      } catch {
        // Ignore waiter errors.
      }
    }

    lazyWaitersByIndex.delete(index)
  }

  function waitForLazyTrackReady(index, timeoutMs = 60000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false)
      }, timeoutMs)

      const wrappedResolve = (ok) => {
        clearTimeout(timer)
        resolve(Boolean(ok))
      }

      const waiters = lazyWaitersByIndex.get(index) || []
      waiters.push(wrappedResolve)
      lazyWaitersByIndex.set(index, waiters)
    })
  }

  function buildLazySongTaskPayload(track) {
    const source = track?.lazyNetease || {}
    const level = String(source.level || 'exhigh')
    const safeName = String(source.title || track?.name || source.songId || 'netease-track')
      .replace(/[\\/:*?"<>|]/g, '_')

    return {
      songId: String(source.songId || ''),
      level: String(source.level || 'exhigh'),
      mode: 'song-temp-queue-only',
      silentToast: true,
      title: String(source.title || track?.name || ''),
      fileName: `${safeName || source.songId}-${level}`
    }
  }

  function applyLazyResolvedTask(index, task) {
    const track = playlist[index]
    if (!track || !isLazyNeteaseTrack(track)) return false
    if (!task?.filePath) return false

    track.path = task.filePath
    track.file = null
    markLazyTrackState(index, 'succeeded', task.id || '')

    if (task.songMetadata && typeof task.songMetadata === 'object') {
      track.metadataCache = {
        title: task.songMetadata.title || track.name,
        artist: task.songMetadata.artist || track.metadataCache?.artist || null,
        album: task.songMetadata.album || track.metadataCache?.album || null,
        duration: track.metadataCache?.duration || null
      }
    }

    return true
  }

  async function ensureTrackReadyForPlayback(index, options = {}) {
    const track = playlist[index]
    if (!track) return false
    if (!isLazyNeteaseTrack(track)) {
      return Boolean(track.path || track.file)
    }

    if (track.path || track.file) {
      markLazyTrackState(index, 'succeeded', track.lazyNetease.taskId || '')
      return true
    }

    if (!electronAPI?.neteaseDownloadSongTask) return false

    const waitForReady = options.waitForReady !== false
    if (track.lazyNetease.state === 'downloading') {
      if (!waitForReady) return false
      return waitForLazyTrackReady(index)
    }

    if (track.lazyNetease.state === 'failed' && !waitForReady) {
      return false
    }

    markLazyTrackState(index, 'downloading')
    const taskRes = await electronAPI.neteaseDownloadSongTask(buildLazySongTaskPayload(track))
    if (!taskRes?.ok || !taskRes?.task?.id) {
      markLazyTrackState(index, 'failed')
      resolveLazyWaiters(index, false)
      return false
    }

    const task = taskRes.task
    markLazyTrackState(index, task.status === 'failed' ? 'failed' : 'downloading', task.id)
    lazyTaskIndexMap.set(task.id, index)

    if (task.status === 'succeeded' || task.status === 'skipped') {
      const ok = applyLazyResolvedTask(index, task)
      lazyTaskIndexMap.delete(task.id)
      resolveLazyWaiters(index, ok)
      return ok
    }

    if (!waitForReady) {
      return false
    }

    return waitForLazyTrackReady(index)
  }

  function maybePrefetchNextLazyTrack() {
    const nextIndex = currentIndex + 1
    if (nextIndex < 0 || nextIndex >= playlist.length) return
    const nextTrack = playlist[nextIndex]
    if (!isLazyNeteaseTrack(nextTrack)) return
    if (nextTrack.path || nextTrack.file) return
    if (nextTrack.lazyNetease.state === 'downloading' || nextTrack.lazyNetease.state === 'succeeded') return

    ensureTrackReadyForPlayback(nextIndex, { waitForReady: false })
      .catch(() => {})
  }

  function handleLazyDownloadTaskUpdate(task) {
    const taskId = String(task?.id || '')
    if (!taskId) return
    if (!lazyTaskIndexMap.has(taskId)) return

    const index = lazyTaskIndexMap.get(taskId)
    const track = playlist[index]
    if (!track || !isLazyNeteaseTrack(track)) {
      lazyTaskIndexMap.delete(taskId)
      resolveLazyWaiters(index, false)
      return
    }

    if (task.status === 'succeeded' || task.status === 'skipped') {
      const ok = applyLazyResolvedTask(index, task)
      lazyTaskIndexMap.delete(taskId)
      resolveLazyWaiters(index, ok)
      if (index === currentIndex) {
        updatePlaylistUI()
      }
      return
    }

    if (task.status === 'failed' || task.status === 'canceled') {
      markLazyTrackState(index, 'failed', taskId)
      lazyTaskIndexMap.delete(taskId)
      resolveLazyWaiters(index, false)
    }
  }

  async function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return
    const requestId = ++loadRequestId
    currentIndex = index
    let track = playlist[index]

    dom.trackTitle.textContent = track.name
    dom.trackArtist.textContent = track.metadataCache?.artist || ''
    dom.trackAlbum.textContent = track.metadataCache?.album || ''
    setBottomNowPlaying(track.name, track.metadataCache?.artist || '')
    dom.coverImg.style.display = 'none'
    dom.coverImg.src = ''
    dom.coverPlaceholder.style.display = 'flex'
    resetProgress()

    if (lyricManager) {
      lyricManager.setLyrics(null)
    }

    const shouldFadeOutCurrent = !audio.paused && audio.src && fadeSettings.fadeOutMs > 0
    if (shouldFadeOutCurrent) {
      await runFadeTo(0, fadeSettings.fadeOutMs)
      if (requestId !== loadRequestId) return
    } else {
      stopFade()
    }

    audio.pause()

    if (isLazyNeteaseTrack(track) && track.lazyNetease?.coverUrl) {
      onSetHomeNowCover(track.lazyNetease.coverUrl)
    }

    const ready = await ensureTrackReadyForPlayback(index, { waitForReady: true })
    if (requestId !== loadRequestId) return
    if (!ready) {
      setPlayButtonState(false)
      updatePlaylistUI()
      reportPlayerState()
      return
    }

    track = playlist[index]

    if (track.file) {
      audio.src = URL.createObjectURL(track.file)
    } else if (track.path) {
      audio.src = filePathToURL(track.path)
    } else {
      setPlayButtonState(false)
      updatePlaylistUI()
      reportPlayerState()
      return
    }

    let filePath = track.path
    if (track.file && electronAPI && electronAPI.getPathForFile) {
      filePath = electronAPI.getPathForFile(track.file)
    }

    if (filePath && electronAPI) {
      electronAPI.playAudio(filePath)
      const meta = await electronAPI.getMetadata(filePath)
      if (requestId !== loadRequestId) return
      if (meta) {
        dom.trackTitle.textContent = meta.title || track.name
        dom.trackArtist.textContent = meta.artist || ''
        setBottomNowPlaying(meta.title || track.name, meta.artist || '')
        const albumParts = [meta.album, meta.year].filter(Boolean)
        dom.trackAlbum.textContent = albumParts.join(' · ')

        if (meta.coverDataUrl) {
          dom.coverImg.src = meta.coverDataUrl
          dom.coverImg.style.display = 'block'
          dom.coverPlaceholder.style.display = 'none'
          onSetHomeNowCover(meta.coverDataUrl)
        } else {
          onSetHomeNowCover(null)
        }

        // Set Lyrics
        if (lyricManager) {
          let lyricData = ''
          if (Array.isArray(meta.lyrics) && meta.lyrics.length > 0) {
            const first = meta.lyrics[0]
            lyricData = (first && typeof first === 'object' && typeof first.text === 'string')
              ? first.text
              : (typeof first === 'string' ? first : '')
          } else if (typeof meta.lyrics === 'string') {
            lyricData = meta.lyrics
          } else if (meta.lyrics) {
            lyricData = String(meta.lyrics)
          }
          lyricManager.setLyrics(lyricData)
        }

        track.metadataCache = {
          title: meta.title || track.name,
          artist: meta.artist || null,
          album: meta.album || null,
          duration: meta.duration || null
        }
      }
    }

    try {
      audio.volume = fadeSettings.fadeInMs > 0 ? 0 : 1
      await audio.play()
      if (requestId !== loadRequestId) return
      if (fadeSettings.fadeInMs > 0) {
        await runFadeTo(1, fadeSettings.fadeInMs)
        if (requestId !== loadRequestId) return
      }
      setPlayButtonState(true)
    } catch (err) {
      console.warn('Failed to play audio:', err)
      setPlayButtonState(false)
    }

    updatePlaylistUI()
    reportPlayerState()
  }

  function appendToPlaylist(newTracks) {
    if (!newTracks.length) return
    const wasEmpty = playlist.length === 0

    const existingKeys = new Set(playlist.map((track) => getTrackUniqueKey(track, electronAPI)))
    const dedupedTracks = []

    for (const track of newTracks) {
      const key = getTrackUniqueKey(track, electronAPI)
      if (existingKeys.has(key)) continue
      existingKeys.add(key)
      dedupedTracks.push(track)
    }

    if (!dedupedTracks.length) return

    playlist = playlist.concat(dedupedTracks)
    updatePlaylistUI()
    if (wasEmpty) loadTrack(0)
  }

  function setQueueTracks(nextTracks, startIndex = 0) {
    loadRequestId += 1
    playlist = Array.isArray(nextTracks) ? nextTracks.slice() : []
    lazyTaskIndexMap.clear()
    lazyWaitersByIndex.clear()
    currentIndex = -1
    stopFade({ resetVolume: true })
    audio.pause()
    audio.src = ''
    setPlayButtonState(false)
    resetProgress()
    resetTrackMeta()
    updatePlaylistUI()
    reportPlayerState()

    if (!playlist.length) {
      return
    }

    const safeIndex = Math.max(0, Math.min(startIndex, playlist.length - 1))
    loadTrack(safeIndex)
  }

  function removeTrack(index) {
    resolveLazyWaiters(index, false)

    if (index === currentIndex) {
      loadRequestId += 1
      stopFade({ resetVolume: true })
      audio.pause()
      audio.src = ''
      setPlayButtonState(false)

      if (playlist.length > 1) {
        const nextIndex = index < playlist.length - 1 ? index : index - 1
        playlist.splice(index, 1)
        currentIndex = -1
        loadTrack(nextIndex)
        return
      }

      playlist.splice(index, 1)
      currentIndex = -1
      resetProgress()
      resetTrackMeta()
    } else {
      playlist.splice(index, 1)
      if (index < currentIndex) currentIndex--
    }

    updatePlaylistUI()
  }

  function clearPlaylist() {
    loadRequestId += 1
    for (const index of Array.from(lazyWaitersByIndex.keys())) {
      resolveLazyWaiters(index, false)
    }
    lazyTaskIndexMap.clear()
    playlist = []
    currentIndex = -1
    stopFade({ resetVolume: true })
    audio.pause()
    audio.src = ''
    setPlayButtonState(false)
    resetProgress()
    resetTrackMeta()
    updatePlaylistUI()
    reportPlayerState()
  }

  function playPreviousTrack() {
    if (playlist.length === 0) return
    const newIndex = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1
    loadTrack(newIndex)
  }

  function playNextTrack() {
    if (playlist.length === 0) return
    const newIndex = currentIndex >= playlist.length - 1 ? 0 : currentIndex + 1
    loadTrack(newIndex)
  }

  function togglePlayback(options = {}) {
    const { silent = false } = options
    if (playlist.length === 0) {
      if (!silent) alert('请先选择音乐文件 🎵')
      return
    }

    if (currentIndex === -1) {
      loadTrack(0)
      return
    }

    if (audio.paused) {
      stopFade()
      audio.volume = fadeSettings.fadeInMs > 0 ? 0 : 1
      audio.play().then(() => {
        if (fadeSettings.fadeInMs > 0) {
          runFadeTo(1, fadeSettings.fadeInMs)
        }
        setPlayButtonState(true)
        reportPlayerState()
      }).catch((err) => {
        console.warn('Failed to resume audio:', err)
      })
    } else {
      runFadeTo(0, fadeSettings.fadeOutMs).then((completed) => {
        if (!completed) return
        if (audio.paused) return
        audio.pause()
        setPlayButtonState(false)
        reportPlayerState()
      })
    }
  }

  function toggleLoopState() {
    isLooping = !isLooping
    audio.loop = isLooping
    dom.loopBtn.classList.toggle('btn-active', isLooping)
    dom.loopBtn.title = isLooping ? '单曲循环: 开' : '单曲循环: 关'
  }

  function seekBy(seconds) {
    if (!audio.duration) return
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
  }

  function collectCurrentQueueAsTrackInputs() {
    const trackInputs = []
    const usedPaths = new Set()

    for (const track of playlist) {
      const filePath = getCurrentTrackPath(track, electronAPI)
      if (!filePath) continue

      const normalizedPath = normalizePath(filePath)
      if (usedPaths.has(normalizedPath)) continue
      usedPaths.add(normalizedPath)

      trackInputs.push({
        path: filePath,
        metadataCache: track.metadataCache || { title: track.name || getFileNameFromPath(filePath) }
      })
    }

    return trackInputs
  }

  function replaceCurrentQueueWithTracks(tracks, startIndex = 0, _options = {}) {
    setQueueTracks(tracks, startIndex)
  }

  function handleExternalPlayerControl(action) {
    switch (action) {
      case 'toggle-play':
        togglePlayback({ silent: true })
        break
      case 'next-track':
        playNextTrack()
        break
      case 'previous-track':
        playPreviousTrack()
        break
      default:
        break
    }
  }

  function bindControlEvents() {
    dom.fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files)
      if (!files.length) return
      appendToPlaylist(files.map((file) => ({ name: file.name, file, path: null })))
      dom.fileInput.value = ''
    })

    dom.folderBtn.addEventListener('click', async () => {
      if (!electronAPI || !electronAPI.selectFolder) return
      const paths = await electronAPI.selectFolder()
      if (!paths || !paths.length) return
      appendToPlaylist(paths.map((p) => ({ name: p.split(/[/\\]/).pop(), path: p, file: null })))
    })

    dom.clearBtn.addEventListener('click', () => {
      if (playlist.length === 0) return
      clearPlaylist()
    })

    dom.playBtn.addEventListener('click', () => togglePlayback({ silent: false }))
    dom.prevBtn.addEventListener('click', playPreviousTrack)
    dom.nextBtn.addEventListener('click', playNextTrack)
    dom.loopBtn.addEventListener('click', toggleLoopState)

    if (dom.songBackBtn) dom.songBackBtn.addEventListener('click', onShowHomePage)
    if (dom.homeGoSongBtn) dom.homeGoSongBtn.addEventListener('click', onShowSongPage)
  }

  function bindAudioEvents() {
    const getSeekRatioFromClientX = (clientX) => {
      const rect = dom.progressContainer.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      return Math.max(0, Math.min(1, ratio))
    }

    const updateSeekPreview = (ratio) => {
      if (!audio.duration) return
      previewSeekRatio = Math.max(0, Math.min(1, ratio))
      updateProgressUIByRatio(previewSeekRatio, previewSeekRatio * audio.duration)
    }

    const commitSeekPreview = () => {
      if (!audio.duration || previewSeekRatio === null) return
      audio.currentTime = previewSeekRatio * audio.duration
      previewSeekRatio = null
    }

    const endSeeking = (pointerId, shouldCommit = true) => {
      if (!isSeeking) return
      if (shouldCommit) {
        commitSeekPreview()
      } else {
        previewSeekRatio = null
      }
      isSeeking = false
      dom.progressContainer.classList.remove('seeking')
      if (pointerId !== undefined && dom.progressContainer.hasPointerCapture(pointerId)) {
        dom.progressContainer.releasePointerCapture(pointerId)
      }
    }

    audio.addEventListener('ended', () => {
      if (isLooping) return
      if (currentIndex < playlist.length - 1) {
        loadTrack(currentIndex + 1)
      } else {
        setPlayButtonState(false)
        reportPlayerState()
      }
    })

    audio.addEventListener('play', () => {
      setPlayButtonState(true)
      reportPlayerState()
    })

    audio.addEventListener('pause', () => {
      if (!audio.ended) setPlayButtonState(false)
      reportPlayerState()
    })

    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || isSeeking) return
      updateProgressUIByRatio(audio.currentTime / audio.duration, audio.currentTime)

      if (audio.duration - audio.currentTime <= PREFETCH_BEFORE_SECONDS) {
        maybePrefetchNextLazyTrack()
      }

      if (lyricManager) {
        lyricManager.updateTime(audio.currentTime)
      }
    })

    audio.addEventListener('loadedmetadata', () => {
      dom.totalTimeEl.textContent = formatTime(audio.duration)
      updateProgressUIByRatio(audio.duration ? audio.currentTime / audio.duration : 0, audio.currentTime)
    })

    dom.progressContainer.addEventListener('pointerdown', (e) => {
      if (!audio.duration) return
      isSeeking = true
      dom.progressContainer.classList.add('seeking')
      dom.progressContainer.setPointerCapture(e.pointerId)
      updateSeekPreview(getSeekRatioFromClientX(e.clientX))
    })

    dom.progressContainer.addEventListener('pointermove', (e) => {
      if (!isSeeking) return
      updateSeekPreview(getSeekRatioFromClientX(e.clientX))
    })

    dom.progressContainer.addEventListener('pointerup', (e) => {
      if (!isSeeking) return
      updateSeekPreview(getSeekRatioFromClientX(e.clientX))
      endSeeking(e.pointerId)
    })

    dom.progressContainer.addEventListener('pointercancel', (e) => {
      endSeeking(e.pointerId, false)
    })
  }

  function init() {
    lyricManager = createLyricManager('lyricsContainer', 'lyricsWrapper')

    if (electronAPI?.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        handleLazyDownloadTaskUpdate(task)
      })
    }
    
    bindControlEvents()
    bindAudioEvents()
    updatePlaylistUI()
    setPlayButtonState(false)
    audio.volume = 1
    reportPlayerState()
  }

  function updateFadeSettings(nextSettings = {}) {
    fadeSettings = sanitizeFadeSettings({ ...fadeSettings, ...nextSettings })
    persistFadeSettings()
    return { ...fadeSettings }
  }

  function getFadeSettings() {
    return { ...fadeSettings }
  }

  return {
    init,
    togglePlayback,
    playPreviousTrack,
    playNextTrack,
    toggleLoopState,
    seekBy,
    clearPlaylist,
    appendToPlaylist,
    collectCurrentQueueAsTrackInputs,
    replaceCurrentQueueWithTracks,
    handleExternalPlayerControl,
    updateFadeSettings,
    getFadeSettings,
    hasQueue: () => playlist.length > 0,
    refreshLyricsScroll: () => {
      if (lyricManager) lyricManager.refreshScroll()
    }
  }
}
