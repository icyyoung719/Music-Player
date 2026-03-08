import {
  formatTime,
  filePathToURL,
  getFileNameFromPath,
  normalizePath,
  getTrackUniqueKey,
  getCurrentTrackPath
} from './trackUtils.js'

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
    dom.currentTimeEl.textContent = '0:00'
    dom.totalTimeEl.textContent = '0:00'
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
      titleSpan.textContent = track.name

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

  async function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return
    currentIndex = index
    const track = playlist[index]

    dom.trackTitle.textContent = track.name
    dom.trackArtist.textContent = ''
    dom.trackAlbum.textContent = ''
    setBottomNowPlaying(track.name, '')
    dom.coverImg.style.display = 'none'
    dom.coverImg.src = ''
    dom.coverPlaceholder.style.display = 'flex'
    resetProgress()

    audio.pause()

    if (track.file) {
      audio.src = URL.createObjectURL(track.file)
    } else {
      audio.src = filePathToURL(track.path)
    }

    let filePath = track.path
    if (track.file && electronAPI && electronAPI.getPathForFile) {
      filePath = electronAPI.getPathForFile(track.file)
    }

    if (filePath && electronAPI) {
      electronAPI.playAudio(filePath)
      const meta = await electronAPI.getMetadata(filePath)
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

        track.metadataCache = {
          title: meta.title || track.name,
          artist: meta.artist || null,
          album: meta.album || null,
          duration: meta.duration || null
        }
      }
    }

    try {
      await audio.play()
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

  function removeTrack(index) {
    if (index === currentIndex) {
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
    playlist = []
    currentIndex = -1
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
      audio.play().then(() => {
        setPlayButtonState(true)
        reportPlayerState()
      }).catch((err) => {
        console.warn('Failed to resume audio:', err)
      })
    } else {
      audio.pause()
      setPlayButtonState(false)
      reportPlayerState()
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

  function replaceCurrentQueueWithTracks(tracks) {
    if (playlist.length > 0) {
      const confirmed = confirm('确认使用所选歌单替换当前播放列表吗？')
      if (!confirmed) return
    }

    clearPlaylist()
    appendToPlaylist(tracks)
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
      if (!audio.duration) return
      const pct = (audio.currentTime / audio.duration) * 100
      dom.progressBar.style.width = pct + '%'
      dom.currentTimeEl.textContent = formatTime(audio.currentTime)
    })

    audio.addEventListener('loadedmetadata', () => {
      dom.totalTimeEl.textContent = formatTime(audio.duration)
    })

    dom.progressContainer.addEventListener('click', (e) => {
      if (!audio.duration) return
      const rect = dom.progressContainer.getBoundingClientRect()
      const ratio = (e.clientX - rect.left) / rect.width
      audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration
    })
  }

  function init() {
    bindControlEvents()
    bindAudioEvents()
    updatePlaylistUI()
    setPlayButtonState(false)
    reportPlayerState()
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
    hasQueue: () => playlist.length > 0
  }
}
