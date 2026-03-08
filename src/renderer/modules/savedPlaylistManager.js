import { getFileNameFromPath } from './trackUtils.js'

export function createSavedPlaylistManager(options) {
  const {
    electronAPI,
    dom,
    promptForPlaylistName,
    getCurrentQueueTrackInputs,
    appendTracksToQueue,
    replaceQueueWithTracks
  } = options

  let savedState = { playlists: [], trackLibrary: {} }
  let selectedSavedPlaylistId = null

  function getSelectedSavedPlaylist() {
    return savedState.playlists.find((item) => item.id === selectedSavedPlaylistId) || null
  }

  function renderSavedPlaylistSelect() {
    dom.savedPlaylistSelect.innerHTML = ''

    if (!savedState.playlists.length) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '暂无歌单'
      dom.savedPlaylistSelect.appendChild(opt)
      dom.savedPlaylistSelect.disabled = true
      return
    }

    dom.savedPlaylistSelect.disabled = false
    savedState.playlists.forEach((item) => {
      const opt = document.createElement('option')
      opt.value = item.id
      opt.textContent = `${item.name} (${item.trackIds.length})`
      if (item.id === selectedSavedPlaylistId) {
        opt.selected = true
      }
      dom.savedPlaylistSelect.appendChild(opt)
    })
  }

  function renderSavedTracks() {
    dom.savedTracksEl.innerHTML = ''
    const selected = getSelectedSavedPlaylist()

    if (!selected) {
      const empty = document.createElement('div')
      empty.className = 'saved-empty'
      empty.textContent = '请先创建或选择一个歌单'
      dom.savedTracksEl.appendChild(empty)
      return
    }

    if (!selected.trackIds.length) {
      const empty = document.createElement('div')
      empty.className = 'saved-empty'
      empty.textContent = '歌单为空，可将“当前列表”添加进来'
      dom.savedTracksEl.appendChild(empty)
      return
    }

    selected.trackIds.forEach((trackId, index) => {
      const track = savedState.trackLibrary[trackId]
      const title = track?.metadataCache?.title || getFileNameFromPath(track?.path)
      const item = document.createElement('div')
      item.className = 'saved-track-item'

      const idx = document.createElement('span')
      idx.className = 'playlist-index'
      idx.textContent = index + 1

      const titleEl = document.createElement('span')
      titleEl.className = 'saved-track-title'
      titleEl.textContent = title

      const removeBtn = document.createElement('button')
      removeBtn.className = 'saved-track-remove'
      removeBtn.textContent = '✕'
      removeBtn.title = '从歌单移除'
      removeBtn.addEventListener('click', async () => {
        if (!electronAPI || !electronAPI.playlistRemoveTrack) return
        await electronAPI.playlistRemoveTrack(selected.id, trackId)
        await refreshSavedPlaylists(selected.id)
      })

      item.appendChild(idx)
      item.appendChild(titleEl)
      item.appendChild(removeBtn)
      dom.savedTracksEl.appendChild(item)
    })
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

    renderSavedPlaylistSelect()
    renderSavedTracks()
  }

  function collectSelectedSavedPlaylistTracksForQueue() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      return { ok: false, reason: 'NO_PLAYLIST', tracks: [] }
    }

    if (!selected.trackIds.length) {
      return { ok: false, reason: 'EMPTY_PLAYLIST', tracks: [] }
    }

    const tracks = []
    for (const trackId of selected.trackIds) {
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

    if (!tracks.length) {
      return { ok: false, reason: 'NO_VALID_TRACKS', tracks: [] }
    }

    return { ok: true, tracks, playlist: selected }
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
      if (!result?.ok) {
        alert('创建歌单失败')
        return
      }
      await refreshSavedPlaylists(result.playlist.id)
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
    const name = input || selected.name

    const result = await electronAPI.playlistRename(selected.id, name)
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

  async function addCurrentQueueToSavedPlaylist() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const tracks = getCurrentQueueTrackInputs()
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

  function appendSavedPlaylistToCurrentQueue() {
    const result = collectSelectedSavedPlaylistTracksForQueue()
    if (!result.ok) {
      if (result.reason === 'NO_PLAYLIST') {
        alert('请先选择歌单')
      } else {
        alert('该歌单没有可用歌曲')
      }
      return
    }

    appendTracksToQueue(result.tracks)
  }

  function replaceCurrentQueueWithSavedPlaylist() {
    const result = collectSelectedSavedPlaylistTracksForQueue()
    if (!result.ok) {
      if (result.reason === 'NO_PLAYLIST') {
        alert('请先选择歌单')
      } else {
        alert('该歌单没有可用歌曲')
      }
      return
    }

    replaceQueueWithTracks(result.tracks)
  }

  async function importSavedPlaylist() {
    if (!electronAPI || !electronAPI.playlistImport) return
    const result = await electronAPI.playlistImport()
    if (!result || result.canceled) return
    if (!result.ok) {
      alert('导入失败，请检查 JSON 格式')
      return
    }

    await refreshSavedPlaylists()
    alert(`导入完成：${result.importedPlaylistCount} 个歌单`)
  }

  async function exportSavedPlaylist() {
    const selected = getSelectedSavedPlaylist()
    if (!selected) {
      alert('请先选择歌单')
      return
    }

    const result = await electronAPI.playlistExport(selected.id)
    if (!result || result.canceled) return
    if (!result.ok) {
      alert('导出失败')
      return
    }

    alert('导出成功')
  }

  function bindEvents() {
    if (dom.savedPlaylistSelect) {
      dom.savedPlaylistSelect.addEventListener('change', () => {
        selectedSavedPlaylistId = dom.savedPlaylistSelect.value || null
        renderSavedTracks()
      })
    }

    if (dom.savedCreateBtn) dom.savedCreateBtn.addEventListener('click', createSavedPlaylist)
    if (dom.savedRenameBtn) dom.savedRenameBtn.addEventListener('click', renameSavedPlaylist)
    if (dom.savedDeleteBtn) dom.savedDeleteBtn.addEventListener('click', deleteSavedPlaylist)
    if (dom.savedAppendToQueueBtn) dom.savedAppendToQueueBtn.addEventListener('click', appendSavedPlaylistToCurrentQueue)
    if (dom.savedReplaceQueueBtn) dom.savedReplaceQueueBtn.addEventListener('click', replaceCurrentQueueWithSavedPlaylist)
    if (dom.savedAddCurrentBtn) dom.savedAddCurrentBtn.addEventListener('click', addCurrentQueueToSavedPlaylist)
    if (dom.savedImportBtn) dom.savedImportBtn.addEventListener('click', importSavedPlaylist)
    if (dom.savedExportBtn) dom.savedExportBtn.addEventListener('click', exportSavedPlaylist)
  }

  async function init() {
    bindEvents()
    await refreshSavedPlaylists()
  }

  return {
    init,
    refreshSavedPlaylists
  }
}
