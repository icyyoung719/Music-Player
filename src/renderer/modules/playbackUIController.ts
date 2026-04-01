// @ts-nocheck
import { formatTime } from './trackUtils.js'

export function createPlaybackUIController(options = {}) {
  const {
    dom,
    electronAPI,
    audio,
    getPlaylist,
    getCurrentIndex,
    getTrackArtistText,
    getTrackDurationText,
    getTrackCoverDataUrl,
    onHydrateTrack,
    onSaveTrack,
    onRemoveTrack,
    onLoadTrack,
    onResetLyrics,
    onHomeCoverChanged
  } = options

  let isQueueOverlayOpen = false

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

  function setBottomNowPlayingCover(coverDataUrl) {
    if (!dom.bottomTrackCoverImgEl || !dom.bottomTrackCoverPlaceholderEl) return

    if (coverDataUrl) {
      dom.bottomTrackCoverImgEl.src = coverDataUrl
      dom.bottomTrackCoverImgEl.style.display = 'block'
      dom.bottomTrackCoverPlaceholderEl.style.display = 'none'
      return
    }

    dom.bottomTrackCoverImgEl.src = ''
    dom.bottomTrackCoverImgEl.style.display = 'none'
    dom.bottomTrackCoverPlaceholderEl.style.display = 'inline'
  }

  function openQueueOverlay() {
    if (!dom.queueOverlayEl) return
    isQueueOverlayOpen = true
    dom.queueOverlayEl.classList.add('visible')
    dom.queueOverlayEl.setAttribute('aria-hidden', 'false')
  }

  function closeQueueOverlay() {
    if (!dom.queueOverlayEl) return
    isQueueOverlayOpen = false
    dom.queueOverlayEl.classList.remove('visible')
    dom.queueOverlayEl.setAttribute('aria-hidden', 'true')
  }

  function toggleQueueOverlay() {
    if (isQueueOverlayOpen) {
      closeQueueOverlay()
      return
    }
    openQueueOverlay()
  }

  function getQueueOverlayOpenState() {
    return isQueueOverlayOpen
  }

  function reportPlayerState() {
    if (!electronAPI || !electronAPI.reportPlayerState) return

    const playlist = getPlaylist()
    const currentIndex = getCurrentIndex()
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
    setBottomNowPlayingCover('')
    if (typeof onResetLyrics === 'function') {
      onResetLyrics()
    }
    if (typeof onHomeCoverChanged === 'function') {
      onHomeCoverChanged(null)
    }
    dom.coverImg.style.display = 'none'
    dom.coverImg.src = ''
    dom.coverPlaceholder.style.display = 'flex'
  }

  function updatePlaylistUI() {
    const playlist = getPlaylist()
    const currentIndex = getCurrentIndex()

    dom.playlistEl.innerHTML = ''
    if (playlist.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'playlist-empty'
      empty.textContent = '拖入或添加歌曲'
      dom.playlistEl.appendChild(empty)
      return
    }

    playlist.forEach((track, index) => {
      if (typeof onHydrateTrack === 'function') {
        onHydrateTrack(index, track)
      }

      const item = document.createElement('div')
      item.className = 'playlist-item' + (index === currentIndex ? ' active' : '')

      const idxSpan = document.createElement('span')
      idxSpan.className = 'playlist-index'
      idxSpan.textContent = index + 1

      const cover = document.createElement('span')
      cover.className = 'playlist-cover'
      const coverDataUrl = getTrackCoverDataUrl(track)
      if (coverDataUrl) {
        const coverImg = document.createElement('img')
        coverImg.src = coverDataUrl
        coverImg.alt = '歌曲封面'
        cover.appendChild(coverImg)
      } else {
        cover.textContent = '♪'
      }

      const body = document.createElement('div')
      body.className = 'playlist-item-body'

      const titleSpan = document.createElement('span')
      titleSpan.className = 'playlist-item-title'
      if (track?.lazyNetease?.songId && !track.path && !track.file) {
        titleSpan.textContent = `${track.name} · 云端`
      } else {
        titleSpan.textContent = track.name
      }

      const metaSpan = document.createElement('span')
      metaSpan.className = 'playlist-item-meta'
      metaSpan.textContent = `${getTrackArtistText(track)} · ${getTrackDurationText(track)}`

      body.appendChild(titleSpan)
      body.appendChild(metaSpan)

      const actions = document.createElement('span')
      actions.className = 'playlist-item-actions'

      const saveBtn = document.createElement('button')
      saveBtn.className = 'playlist-item-action'
      saveBtn.textContent = '添加到歌单'
      saveBtn.title = '添加到某个歌单'
      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (typeof onSaveTrack === 'function') {
          await onSaveTrack(index)
        }
      })

      const delBtn = document.createElement('button')
      delBtn.className = 'playlist-item-action playlist-delete-btn'
      delBtn.textContent = '移除'
      delBtn.title = '从列表移除'
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (typeof onRemoveTrack === 'function') {
          onRemoveTrack(index)
        }
      })

      actions.appendChild(saveBtn)
      actions.appendChild(delBtn)

      item.appendChild(idxSpan)
      item.appendChild(cover)
      item.appendChild(body)
      item.appendChild(actions)
      item.addEventListener('click', () => {
        if (typeof onLoadTrack === 'function') {
          onLoadTrack(index)
        }
      })
      dom.playlistEl.appendChild(item)
    })

    const activeItem = dom.playlistEl.querySelector('.playlist-item.active')
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest' })
  }

  return {
    setPlayButtonState,
    setBottomNowPlaying,
    setBottomNowPlayingCover,
    openQueueOverlay,
    closeQueueOverlay,
    toggleQueueOverlay,
    getQueueOverlayOpenState,
    reportPlayerState,
    resetProgress,
    updateProgressUIByRatio,
    resetTrackMeta,
    updatePlaylistUI
  }
}