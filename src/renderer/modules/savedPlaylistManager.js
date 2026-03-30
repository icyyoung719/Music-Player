import { formatTime, getFileNameFromPath } from './trackUtils.js'

export function createSavedPlaylistManager(options) {
  const {
    electronAPI,
    dom,
    promptForPlaylistName,
    eventBus
  } = options

  let savedState = { playlists: [], trackLibrary: {} }
  let selectedSavedPlaylistId = null
  let activeView = 'recommend'
  const trackCoverCache = new Map()
  let detailRenderToken = 0
  let lastRenderedPlaylistId = undefined

  function emit(eventName, payload) {
    if (!eventBus) return
    eventBus.emit(eventName, payload)
  }

  async function request(eventName, payload) {
    if (!eventBus) return undefined
    return eventBus.request(eventName, payload)
  }

  function getSelectedSavedPlaylist() {
    return savedState.playlists.find((item) => item.id === selectedSavedPlaylistId) || null
  }

  function getQueueTracksForPlaylist(playlist = getSelectedSavedPlaylist()) {
    if (!playlist) {
      return []
    }

    const tracks = []

    for (const trackId of playlist.trackIds) {
      const savedTrack = savedState.trackLibrary[trackId]
      if (!savedTrack || !savedTrack.path) continue

      const title = savedTrack.metadataCache?.title || getFileNameFromPath(savedTrack.path)
      tracks.push({
        name: title,
        path: savedTrack.path,
        file: null,
        metadataCache: savedTrack.metadataCache || { title }
      })
    }

    return tracks
  }

  function updateActionButtons(selected) {
    const hasPlaylist = Boolean(selected)

    if (dom.detailPlayAllBtn) dom.detailPlayAllBtn.disabled = !hasPlaylist
    if (dom.detailAppendBtn) dom.detailAppendBtn.disabled = !hasPlaylist
    if (dom.detailAddCurrentBtn) dom.detailAddCurrentBtn.disabled = !hasPlaylist
    if (dom.detailTitleEditBtn) dom.detailTitleEditBtn.disabled = !hasPlaylist
    if (dom.detailDeleteBtn) dom.detailDeleteBtn.disabled = !hasPlaylist
  }

  function applyDetailCover(coverDataUrl, fallbackText = '♪') {
    if (!dom.detailCoverEl || !dom.detailCoverTextEl) return

    if (coverDataUrl) {
      dom.detailCoverEl.style.backgroundImage = `url(${coverDataUrl})`
      dom.detailCoverEl.classList.add('has-image')
      dom.detailCoverTextEl.style.display = 'none'
      return
    }

    dom.detailCoverEl.style.backgroundImage = ''
    dom.detailCoverEl.classList.remove('has-image')
    dom.detailCoverTextEl.style.display = 'inline'
    dom.detailCoverTextEl.textContent = fallbackText
  }

  async function getTrackCoverDataUrl(trackId, filePath) {
    if (!filePath || !electronAPI || !electronAPI.getMetadata) {
      return null
    }

    if (trackCoverCache.has(trackId)) {
      return trackCoverCache.get(trackId)
    }

    try {
      const meta = await electronAPI.getMetadata(filePath)
      const coverDataUrl = meta?.coverDataUrl || null
      trackCoverCache.set(trackId, coverDataUrl)
      return coverDataUrl
    } catch {
      trackCoverCache.set(trackId, null)
      return null
    }
  }

  function renderSidebarPlaylists() {
    if (!dom.sidebarListEl) return

    dom.sidebarListEl.innerHTML = ''

    if (!savedState.playlists.length) {
      const empty = document.createElement('div')
      empty.className = 'menu-item menu-item-empty'
      empty.textContent = '还没有本地歌单'
      dom.sidebarListEl.appendChild(empty)
      return
    }

    savedState.playlists.forEach((playlist) => {
      const item = document.createElement('div')
      item.className = 'menu-item created-playlist-item'
      if (activeView === 'playlist-detail' && playlist.id === selectedSavedPlaylistId) {
        item.classList.add('active')
      }
      item.dataset.playlistId = playlist.id
      item.title = playlist.name

      const name = document.createElement('span')
      name.className = 'created-playlist-name'
      name.textContent = playlist.name

      const count = document.createElement('span')
      count.className = 'created-playlist-count'
      count.textContent = playlist.trackIds.length

      item.appendChild(name)
      item.appendChild(count)
      dom.sidebarListEl.appendChild(item)
    })
  }

  function renderPlaylistDetail(force = false) {
    const selected = getSelectedSavedPlaylist()
    const currentPlaylistId = selected?.id || null
    if (!force && currentPlaylistId === lastRenderedPlaylistId) {
      return
    }
    lastRenderedPlaylistId = currentPlaylistId
    const renderToken = ++detailRenderToken
    updateActionButtons(selected)

    if (dom.detailTitleEl) {
      dom.detailTitleEl.textContent = selected ? selected.name : '还没有本地歌单'
    }

    if (dom.detailSubtitleEl) {
      dom.detailSubtitleEl.textContent = selected
        ? '本地歌单 · 点击歌曲可直接播放'
        : '点击“新建歌单”后，就能在这里查看歌单详情与曲目。'
    }

    if (dom.detailMetaEl) {
      dom.detailMetaEl.textContent = selected ? `${selected.trackIds.length} 首歌曲` : '0 首歌曲'
    }

    const fallbackCoverText = selected
      ? (selected.name || '♪').trim().charAt(0).toUpperCase() || '♪'
      : '♪'
    applyDetailCover(null, fallbackCoverText)

    if (!dom.detailTrackListEl) {
      return
    }

    dom.detailTrackListEl.innerHTML = ''

    if (!selected) {
      const empty = document.createElement('div')
      empty.className = 'playlist-detail-empty'
      empty.textContent = '先创建一个本地歌单，再从左侧进入查看详情。'
      dom.detailTrackListEl.appendChild(empty)
      return
    }

    if (!selected.trackIds.length) {
      const empty = document.createElement('div')
      empty.className = 'playlist-detail-empty'
      empty.textContent = '歌单还是空的，可通过下载并加入本地歌单来补充曲目。'
      dom.detailTrackListEl.appendChild(empty)
      return
    }

    const firstTrackId = selected.trackIds[0]
    const firstTrack = firstTrackId ? savedState.trackLibrary[firstTrackId] : null
    if (firstTrack?.path) {
      getTrackCoverDataUrl(firstTrackId, firstTrack.path).then((coverDataUrl) => {
        if (renderToken !== detailRenderToken) return
        if (selectedSavedPlaylistId !== currentPlaylistId) return
        if (!dom.detailCoverEl || !dom.detailCoverEl.isConnected) return
        applyDetailCover(coverDataUrl, fallbackCoverText)
      })
    }

    const fragment = document.createDocumentFragment()

    selected.trackIds.forEach((trackId, index) => {
      const track = savedState.trackLibrary[trackId]
      if (!track || !track.path) return

      const row = document.createElement('div')
      row.className = 'playlist-detail-track-row'
      row.title = '点击播放这首歌'

      const title = track.metadataCache?.title || getFileNameFromPath(track.path)
      const artist = track.metadataCache?.artist || '未知歌手'
      const album = track.metadataCache?.album || '未知专辑'
      const duration = Number(track.metadataCache?.duration)

      const indexEl = document.createElement('span')
      indexEl.className = 'playlist-col-index'
      indexEl.textContent = String(index + 1).padStart(2, '0')

      const coverEl = document.createElement('span')
      coverEl.className = 'playlist-col-cover'
      coverEl.textContent = '♪'

      const coverImg = document.createElement('img')
      coverImg.alt = '歌曲封面'
      coverImg.loading = 'lazy'
      coverEl.appendChild(coverImg)

      const titleEl = document.createElement('span')
      titleEl.className = 'playlist-col-title'
      titleEl.textContent = title

      const artistEl = document.createElement('span')
      artistEl.className = 'playlist-col-artist'
      artistEl.textContent = artist

      const albumEl = document.createElement('span')
      albumEl.className = 'playlist-col-album'
      albumEl.textContent = album

      const durationEl = document.createElement('span')
      durationEl.className = 'playlist-col-duration'
      durationEl.textContent = Number.isFinite(duration) ? formatTime(duration) : '--:--'

      const actionWrap = document.createElement('span')
      actionWrap.className = 'playlist-col-action'

      const removeBtn = document.createElement('button')
      removeBtn.className = 'playlist-track-remove-btn'
      removeBtn.textContent = '移除'
      removeBtn.title = '从歌单移除'
      removeBtn.addEventListener('click', async (event) => {
        event.stopPropagation()
        if (!electronAPI || !electronAPI.playlistRemoveTrack) return
        await electronAPI.playlistRemoveTrack(selected.id, trackId)
        lastRenderedPlaylistId = undefined
        await refreshSavedPlaylists(selected.id)
      })

      actionWrap.appendChild(removeBtn)

      row.appendChild(indexEl)
      row.appendChild(coverEl)
      row.appendChild(titleEl)
      row.appendChild(artistEl)
      row.appendChild(albumEl)
      row.appendChild(durationEl)
      row.appendChild(actionWrap)

      getTrackCoverDataUrl(trackId, track.path).then((coverDataUrl) => {
        if (!coverEl.isConnected) return
        if (!coverDataUrl) {
          coverEl.classList.remove('has-image')
          coverEl.textContent = '♪'
          coverEl.appendChild(coverImg)
          return
        }

        coverImg.src = coverDataUrl
        coverEl.classList.add('has-image')
        coverEl.textContent = ''
        coverEl.appendChild(coverImg)
      })

      row.addEventListener('click', () => {
        emit('playback:queue.replace', {
          tracks: getQueueTracksForPlaylist(selected),
          startIndex: index,
          options: {}
        })
      })

      fragment.appendChild(row)
    })

    dom.detailTrackListEl.appendChild(fragment)
  }

  async function refreshSavedPlaylists(preferredId = null) {
    if (!electronAPI || !electronAPI.playlistList) return

    const payload = await electronAPI.playlistList()
    savedState = {
      playlists: Array.isArray(payload?.playlists) ? payload.playlists : [],
      trackLibrary: payload?.trackLibrary && typeof payload.trackLibrary === 'object' ? payload.trackLibrary : {}
    }

    const existingIds = new Set(savedState.playlists.map((item) => item.id))
    if (preferredId && existingIds.has(preferredId)) {
      selectedSavedPlaylistId = preferredId
    } else if (selectedSavedPlaylistId && existingIds.has(selectedSavedPlaylistId)) {
      selectedSavedPlaylistId = selectedSavedPlaylistId
    } else {
      selectedSavedPlaylistId = savedState.playlists[0]?.id || null
    }

    renderSidebarPlaylists()
    renderPlaylistDetail(true)
  }

  async function createSavedPlaylist() {
    if (!electronAPI || !electronAPI.playlistCreate) {
      alert('歌单功能不可用，请重启应用后重试')
      return
    }

    const input = await promptForPlaylistName('输入新歌单名称：', '我的歌单')
    if (input === null) return

    const name = input || '我的歌单'

    try {
      const result = await electronAPI.playlistCreate(name)
      if (!result?.ok || !result.playlist?.id) {
        alert('创建歌单失败')
        return
      }

      await refreshSavedPlaylists(result.playlist.id)
      emit('view:playlist.open', { playlistId: result.playlist.id })
    } catch {
      alert('创建歌单失败，请查看控制台日志')
    }
  }

  async function renameSavedPlaylist() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const input = await promptForPlaylistName('输入新的歌单名称：', selected.name)
    if (input === null) return

    const result = await electronAPI.playlistRename(selected.id, input || selected.name)
    if (!result?.ok) {
      alert('重命名失败')
      return
    }

    await refreshSavedPlaylists(selected.id)
  }

  async function deleteSavedPlaylist() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const confirmed = confirm(`确认删除歌单 “${selected.name}” 吗？`)
    if (!confirmed) return

    const result = await electronAPI.playlistDelete(selected.id)
    if (!result?.ok) {
      alert('删除失败')
      return
    }

    await refreshSavedPlaylists()
  }

  function appendSelectedPlaylistToCurrentQueue() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const tracks = getQueueTracksForPlaylist(selected)
    if (!tracks.length) {
      alert('该歌单没有可用歌曲')
      return
    }

    emit('playback:queue.append', { tracks })
  }

  function playSelectedPlaylist() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const tracks = getQueueTracksForPlaylist(selected)
    if (!tracks.length) {
      alert('该歌单没有可用歌曲')
      return
    }

    emit('playback:queue.replace', {
      tracks,
      startIndex: 0,
      options: {}
    })
    emit('view:song.open')
  }

  async function addCurrentQueueToSavedPlaylist() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const tracks = (await request('playback:queue.collect-current-track-inputs')) || []

    if (!tracks.length) {
      alert('当前播放列表没有可添加的本地歌曲')
      return
    }

    const result = await electronAPI.playlistAddTracks(selected.id, tracks)
    if (!result?.ok) {
      alert('添加失败')
      return
    }

    await refreshSavedPlaylists(selected.id)
    alert(`已添加 ${result.addedCount} 首到歌单`)
  }

  function openPlaylist(playlistId) {
    if (playlistId) {
      const target = savedState.playlists.find((item) => item.id === playlistId)
      if (target) {
        selectedSavedPlaylistId = target.id
      }
    }

    if (!selectedSavedPlaylistId && savedState.playlists.length) {
      selectedSavedPlaylistId = savedState.playlists[0].id
    }

    renderSidebarPlaylists()
    renderPlaylistDetail(true)
    return Boolean(getSelectedSavedPlaylist())
  }

  function setActiveView(view) {
    activeView = view
    renderSidebarPlaylists()
  }

  function bindEvents() {
    if (dom.sidebarCreateBtn) {
      dom.sidebarCreateBtn.addEventListener('click', createSavedPlaylist)
    }

    if (dom.detailTitleEditBtn) {
      dom.detailTitleEditBtn.addEventListener('click', renameSavedPlaylist)
    }

    if (dom.detailDeleteBtn) {
      dom.detailDeleteBtn.addEventListener('click', deleteSavedPlaylist)
    }

    if (dom.detailAppendBtn) {
      dom.detailAppendBtn.addEventListener('click', appendSelectedPlaylistToCurrentQueue)
    }

    if (dom.detailAddCurrentBtn) {
      dom.detailAddCurrentBtn.addEventListener('click', addCurrentQueueToSavedPlaylist)
    }

    if (dom.detailPlayAllBtn) {
      dom.detailPlayAllBtn.addEventListener('click', playSelectedPlaylist)
    }
  }

  async function init() {
    bindEvents()
    await refreshSavedPlaylists()
  }

  return {
    init,
    openPlaylist,
    refreshSavedPlaylists,
    setActiveView
  }
}
