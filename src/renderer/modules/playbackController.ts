// @ts-nocheck
import {
  formatTime,
  filePathToURL,
  getFileNameFromPath,
  normalizePath,
  getTrackUniqueKey,
  getCurrentTrackPath
} from './trackUtils.js'
import { createLyricManager } from './lyricManager.js'
import { createPlaybackFadeManager } from './playbackFadeManager.js'
import { createLazyQueueManager } from './lazyQueueManager.js'
import { createPlaybackUIController } from './playbackUIController.js'

const PREFETCH_BEFORE_SECONDS = 20
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.aac', '.ogg', '.wav', '.m4a', '.opus', '.wma'])

export function createPlaybackController(options) {
  const {
    electronAPI,
    dom,
    eventBus
  } = options

  function emit(eventName, payload) {
    if (!eventBus) return
    eventBus.emit(eventName, payload)
  }

  const audio = new Audio()
  let playlist = []
  let currentIndex = -1
  let isLooping = false
  let isSeeking = false
  let previewSeekRatio = null
  let lyricManager = null
  const fadeManager = createPlaybackFadeManager({ audio })
  let fadeSettings = fadeManager.getSettings()
  let loadRequestId = 0
  const metadataHydrationKeys = new Set()
  const lazyQueueManager = createLazyQueueManager({
    electronAPI,
    getPlaylist: () => playlist,
    getCurrentIndex: () => currentIndex,
    onTrackReady: (index) => {
      if (index === currentIndex) {
        updatePlaylistUI()
      }
    }
  })
  const uiController = createPlaybackUIController({
    dom,
    electronAPI,
    audio,
    getPlaylist: () => playlist,
    getCurrentIndex: () => currentIndex,
    getTrackArtistText,
    getTrackDurationText,
    getTrackCoverDataUrl,
    onHydrateTrack: (index, track) => {
      hydrateTrackDisplayMetadata(index, track)
    },
    onSaveTrack: (index) => saveTrackToSavedPlaylist(index),
    onRemoveTrack: (index) => removeTrack(index),
    onLoadTrack: (index) => loadTrack(index),
    onResetLyrics: () => {
      if (lyricManager) lyricManager.setLyrics(null)
    },
    onHomeCoverChanged: (dataUrl) => {
      emit('playback:home-cover.changed', dataUrl)
    }
  })

  function setPlayButtonState(isPlaying) {
    uiController.setPlayButtonState(isPlaying)
  }

  function setBottomNowPlaying(title, artist) {
    uiController.setBottomNowPlaying(title, artist)
  }

  function setBottomNowPlayingCover(dataUrl) {
    uiController.setBottomNowPlayingCover(dataUrl)
  }

  function openQueueOverlay() {
    uiController.openQueueOverlay()
  }

  function closeQueueOverlay() {
    uiController.closeQueueOverlay()
  }

  function toggleQueueOverlay() {
    uiController.toggleQueueOverlay()
  }

  function reportPlayerState() {
    uiController.reportPlayerState()
  }

  function resetProgress() {
    uiController.resetProgress()
  }

  function updateProgressUIByRatio(ratio, currentTime) {
    uiController.updateProgressUIByRatio(ratio, currentTime)
  }

  function resetTrackMeta() {
    uiController.resetTrackMeta()
  }

  function updatePlaylistUI() {
    uiController.updatePlaylistUI()
    reportPlayerState()
  }

  function getAudioExtFromPath(filePath) {
    const source = String(filePath || '')
    const match = source.match(/\.([a-z0-9]+)$/i)
    if (!match) return ''
    return `.${match[1].toLowerCase()}`
  }

  function isSupportedAudioPath(filePath) {
    return SUPPORTED_AUDIO_EXTENSIONS.has(getAudioExtFromPath(filePath))
  }

  function isSupportedAudioFile(file) {
    if (!file) return false
    if (typeof file.type === 'string' && file.type.startsWith('audio/')) return true
    return isSupportedAudioPath(file.name)
  }

  function tryGetFilePath(file) {
    if (!file || !electronAPI?.getPathForFile) return ''
    try {
      return electronAPI.getPathForFile(file) || ''
    } catch {
      return ''
    }
  }

  function createTrackInputByPath(filePath) {
    if (!isSupportedAudioPath(filePath)) return null
    return {
      name: getFileNameFromPath(filePath),
      path: filePath,
      file: null
    }
  }

  function createTrackInputByFile(file) {
    if (!isSupportedAudioFile(file)) return null
    return {
      name: file.name || '未知歌曲',
      file,
      path: null
    }
  }

  async function readDirectoryEntries(directoryEntry) {
    return new Promise((resolve, reject) => {
      const reader = directoryEntry.createReader()
      const allEntries = []

      const readNext = () => {
        reader.readEntries((entries) => {
          if (!entries || entries.length === 0) {
            resolve(allEntries)
            return
          }

          allEntries.push(...entries)
          readNext()
        }, reject)
      }

      readNext()
    })
  }

  async function readFileEntry(fileEntry) {
    return new Promise((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
  }

  function getDroppedFileIdentity(file) {
    if (!file) return ''
    const fileName = String(file.name || '').toLowerCase()
    const fileSize = Number(file.size) || 0
    const lastModified = Number(file.lastModified) || 0
    if (fileName || fileSize || lastModified) {
      return `file:${fileName}|size:${fileSize}|mtime:${lastModified}`
    }

    const filePath = normalizePath(tryGetFilePath(file))
    if (filePath) return `path:${filePath}`

    return ''
  }

  async function collectFilesFromDropEntry(entry, pushFile) {
    if (!entry) return

    if (entry.isFile) {
      const file = await readFileEntry(entry)
      pushFile(file)
      return
    }

    if (!entry.isDirectory) return
    const children = await readDirectoryEntries(entry)
    for (const childEntry of children) {
      await collectFilesFromDropEntry(childEntry, pushFile)
    }
  }

  async function collectDropTrackInputs(dataTransfer) {
    const items = Array.from(dataTransfer?.items || [])
    const tracks = []
    const looseFiles = []
    const seenFiles = new Set()

    const pushLooseFile = (file) => {
      const identity = getDroppedFileIdentity(file)
      if (!identity || seenFiles.has(identity)) return
      seenFiles.add(identity)
      looseFiles.push(file)
    }

    // Windows Explorer multi-select is most reliable via dataTransfer.files.
    if (dataTransfer?.files?.length) {
      for (const file of Array.from(dataTransfer.files)) {
        pushLooseFile(file)
      }
    } else {
      for (const item of items) {
        if (item.kind !== 'file') continue

        try {
          const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
          await collectFilesFromDropEntry(entry, pushLooseFile)
        } catch (err) {
          console.warn('Failed to collect dropped item:', err)
        }
      }
    }

    for (const file of looseFiles) {
      const track = createTrackInputByFile(file)
      if (track) tracks.push(track)
    }

    return tracks
  }

  function stopFade(options = {}) {
    fadeManager.stopFade(options)
  }

  function runFadeTo(targetVolume, durationMs) {
    return fadeManager.runFadeTo(targetVolume, durationMs)
  }


  function getTrackArtistText(track) {
    const artist = track?.metadataCache?.artist
      || track?.lazyNetease?.artist
      || track?.lazyNetease?.artists
      || ''

    return String(artist || '').trim() || '未知歌手'
  }

  function getTrackDurationText(track) {
    const durationSeconds = Number(track?.metadataCache?.duration)
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return formatTime(durationSeconds)
    }

    const durationMs = Number(track?.lazyNetease?.durationMs)
    if (Number.isFinite(durationMs) && durationMs > 0) {
      return formatTime(durationMs / 1000)
    }

    return '--:--'
  }

  function getTrackCoverDataUrl(track) {
    return track?.metadataCache?.coverDataUrl
      || track?.lazyNetease?.coverDataUrl
      || track?.lazyNetease?.coverUrl
      || ''
  }

  async function saveTrackToSavedPlaylist(index) {
    const track = playlist[index]
    const filePath = getCurrentTrackPath(track, electronAPI)
    if (!filePath) {
      alert('该歌曲暂无本地文件，暂不支持收藏到本地歌单')
      return
    }

    if (!electronAPI?.playlistList || !electronAPI?.playlistCreate || !electronAPI?.playlistAddTracks) {
      return
    }

    const listResult = await electronAPI.playlistList()
    const existing = Array.isArray(listResult?.playlists) ? listResult.playlists : []

    let playlistId = ''
    if (existing.length) {
      const tips = existing.map((item, idx) => `${idx + 1}. ${item.name}`).join('\n')
      const input = prompt(`选择歌单序号，或输入新歌单名称：\n${tips}`, '1')
      if (input === null) return

      const trimmed = String(input || '').trim()
      const choice = Number.parseInt(trimmed, 10)
      if (Number.isFinite(choice) && choice >= 1 && choice <= existing.length) {
        playlistId = existing[choice - 1].id
      } else {
        const created = await electronAPI.playlistCreate(trimmed || (track.name || '收藏歌曲'))
        playlistId = created?.ok ? created.playlist?.id || '' : ''
      }
    } else {
      const name = prompt('输入新歌单名称：', track.name || '收藏歌曲')
      if (name === null) return
      const created = await electronAPI.playlistCreate(String(name || '').trim() || '收藏歌曲')
      playlistId = created?.ok ? created.playlist?.id || '' : ''
    }

    if (!playlistId) {
      alert('收藏失败，未能确定目标歌单')
      return
    }

    const metadataCache = {
      title: track?.metadataCache?.title || track?.name || getFileNameFromPath(filePath),
      artist: track?.metadataCache?.artist || null,
      album: track?.metadataCache?.album || null,
      duration: track?.metadataCache?.duration || null
    }

    const addResult = await electronAPI.playlistAddTracks(playlistId, [{ path: filePath, metadataCache }])
    if (!addResult?.ok) {
      alert('收藏失败，添加歌曲时出错')
      return
    }

    emit('playlist:saved.changed', { playlistId })

    alert('已添加到歌单')
  }

  async function saveCurrentQueueAsSavedPlaylist() {
    const tracks = collectCurrentQueueAsTrackInputs()
    if (!tracks.length) {
      alert('当前播放列表没有可收藏的本地歌曲')
      return
    }

    if (!electronAPI?.playlistCreate || !electronAPI?.playlistAddTracks) {
      return
    }

    const name = prompt('输入要收藏成的歌单名称：', `播放列表 ${new Date().toLocaleDateString()}`)
    if (name === null) return
    const created = await electronAPI.playlistCreate(String(name || '').trim() || `播放列表 ${Date.now()}`)
    const playlistId = created?.ok ? created.playlist?.id || '' : ''
    if (!playlistId) {
      alert('创建歌单失败')
      return
    }

    const result = await electronAPI.playlistAddTracks(playlistId, tracks)
    if (!result?.ok) {
      alert('歌单收藏失败')
      return
    }

    emit('playlist:saved.changed', { playlistId })

    alert(`已收藏到歌单：${created.playlist?.name || '未命名歌单'}`)
  }

  async function hydrateTrackDisplayMetadata(index, track) {
    const filePath = getCurrentTrackPath(track, electronAPI)
    if (!filePath || !electronAPI?.getMetadata) return

    const key = `${index}:${normalizePath(filePath)}`
    if (metadataHydrationKeys.has(key)) return
    if (track?.metadataCache?.duration && track?.metadataCache?.artist && track?.metadataCache?.coverDataUrl) return

    metadataHydrationKeys.add(key)
    try {
      const meta = await electronAPI.getMetadata(filePath)
      if (!meta) return

      const targetTrack = playlist[index]
      if (!targetTrack) return
      targetTrack.metadataCache = {
        ...targetTrack.metadataCache,
        title: meta.title || targetTrack.metadataCache?.title || targetTrack.name,
        artist: meta.artist || targetTrack.metadataCache?.artist || null,
        album: meta.album || targetTrack.metadataCache?.album || null,
        duration: Number.isFinite(meta.duration) ? meta.duration : targetTrack.metadataCache?.duration || null,
        coverDataUrl: meta.coverDataUrl || targetTrack.metadataCache?.coverDataUrl || ''
      }

      updatePlaylistUI()
    } catch {
      // Ignore metadata hydration errors for queue preview cards.
    }
  }


  async function ensureTrackReadyForPlayback(index, options = {}) {
    return lazyQueueManager.ensureTrackReadyForPlayback(index, options)
  }

  function maybePrefetchNextLazyTrack() {
    lazyQueueManager.maybePrefetchNextLazyTrack()
  }

  function handleLazyDownloadTaskUpdate(task) {
    lazyQueueManager.handleLazyDownloadTaskUpdate(task)
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
    const nextCover = getTrackCoverDataUrl(track)
    if (nextCover) {
      dom.coverImg.src = nextCover
      dom.coverImg.style.display = 'block'
      dom.coverPlaceholder.style.display = 'none'
      setBottomNowPlayingCover(nextCover)
      emit('playback:home-cover.changed', nextCover)
    } else {
      dom.coverImg.style.display = 'none'
      dom.coverImg.src = ''
      dom.coverPlaceholder.style.display = 'flex'
      setBottomNowPlayingCover('')
      emit('playback:home-cover.changed', null)
    }
    resetProgress()
    updatePlaylistUI()
    reportPlayerState()

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
          setBottomNowPlayingCover(meta.coverDataUrl)
          emit('playback:home-cover.changed', meta.coverDataUrl)
        } else {
          setBottomNowPlayingCover('')
          emit('playback:home-cover.changed', null)
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
          duration: meta.duration || null,
          coverDataUrl: meta.coverDataUrl || ''
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

      const trackKey = getTrackUniqueKey(track, electronAPI)
      const filePath = getCurrentTrackPath(track, electronAPI)
      emit('playback:track.started', {
        track,
        trackKey,
        filePath,
        playedAt: Date.now(),
        metadata: {
          title: track?.metadataCache?.title || track?.name || '',
          artist: track?.metadataCache?.artist || '',
          album: track?.metadataCache?.album || '',
          duration: Number(track?.metadataCache?.duration) || null,
          coverDataUrl: track?.metadataCache?.coverDataUrl || ''
        }
      })
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
    lazyQueueManager.reset()
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
    lazyQueueManager.removeTrack(index)

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
    lazyQueueManager.reset()
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
    const appendTracks = (tracks, options = {}) => {
      const { openQueue = false } = options
      if (!tracks.length) return
      appendToPlaylist(tracks)
      if (openQueue) {
        openQueueOverlay()
      }
    }

    dom.fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files)
      if (!files.length) return
      appendTracks(files.map((file) => ({ name: file.name, file, path: null })), { openQueue: true })
      dom.fileInput.value = ''
    })

    const handleAddFolder = async () => {
      if (!electronAPI || !electronAPI.selectFolder) return
      const paths = await electronAPI.selectFolder()
      if (!paths || !paths.length) return
      appendTracks(paths.map((p) => ({ name: p.split(/[/\\]/).pop(), path: p, file: null })), { openQueue: true })
    }

    dom.folderBtn.addEventListener('click', handleAddFolder)

    if (dom.songPageEl) {
      let dragDepth = 0

      const hasFilePayload = (event) => {
        const types = Array.from(event.dataTransfer?.types || [])
        return types.includes('Files')
      }

      const clearDragState = () => {
        dragDepth = 0
        dom.songPageEl.classList.remove('drag-over')
      }

      dom.songPageEl.addEventListener('dragenter', (event) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        dragDepth += 1
        dom.songPageEl.classList.add('drag-over')
      })

      dom.songPageEl.addEventListener('dragover', (event) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      })

      dom.songPageEl.addEventListener('dragleave', (event) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        dragDepth = Math.max(0, dragDepth - 1)
        if (dragDepth === 0) {
          dom.songPageEl.classList.remove('drag-over')
        }
      })

      dom.songPageEl.addEventListener('drop', async (event) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        clearDragState()

        let tracks = []
        try {
          tracks = await collectDropTrackInputs(event.dataTransfer)
        } catch (err) {
          console.warn('Failed to parse drop payload:', err)
          return
        }
        if (!tracks.length) return
        appendTracks(tracks, { openQueue: false })
      })
    }

    if (dom.songAddFileBtn) {
      dom.songAddFileBtn.addEventListener('click', () => {
        openQueueOverlay()
        dom.fileInput.click()
      })
    }

    if (dom.songAddFolderBtn) {
      dom.songAddFolderBtn.addEventListener('click', async () => {
        openQueueOverlay()
        await handleAddFolder()
      })
    }

    if (dom.songOpenQueueBtn) {
      dom.songOpenQueueBtn.addEventListener('click', openQueueOverlay)
    }

    if (dom.queueToggleBtn) {
      dom.queueToggleBtn.addEventListener('click', toggleQueueOverlay)
    }

    if (dom.queueCloseBtn) {
      dom.queueCloseBtn.addEventListener('click', closeQueueOverlay)
    }

    if (dom.queueOverlayBackdropEl) {
      dom.queueOverlayBackdropEl.addEventListener('click', closeQueueOverlay)
    }

    if (dom.queueSaveBtn) {
      dom.queueSaveBtn.addEventListener('click', saveCurrentQueueAsSavedPlaylist)
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (!uiController.getQueueOverlayOpenState()) return
      event.preventDefault()
      closeQueueOverlay()
    })

    dom.clearBtn.addEventListener('click', () => {
      if (playlist.length === 0) return
      clearPlaylist()
    })

    dom.playBtn.addEventListener('click', () => togglePlayback({ silent: false }))
    dom.prevBtn.addEventListener('click', playPreviousTrack)
    dom.nextBtn.addEventListener('click', playNextTrack)
    dom.loopBtn.addEventListener('click', toggleLoopState)

    if (dom.songBackBtn) {
      dom.songBackBtn.addEventListener('click', () => {
        emit('view:home.open')
      })
    }
    if (dom.homeGoSongBtn) {
      dom.homeGoSongBtn.addEventListener('click', () => {
        emit('view:song.open')
      })
    }
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
    fadeSettings = fadeManager.updateSettings(nextSettings)
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
