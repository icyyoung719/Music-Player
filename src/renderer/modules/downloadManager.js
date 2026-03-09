function formatTaskStatus(status) {
  switch (status) {
    case 'pending':
      return '排队中'
    case 'downloading':
      return '下载中'
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '失败'
    case 'skipped':
      return '已跳过'
    case 'canceled':
      return '已取消'
    default:
      return status || '未知'
  }
}

function normalizeId(raw) {
  const text = String(raw || '').trim()
  return /^\d{1,20}$/.test(text) ? text : null
}

export function createDownloadManager(options) {
  const {
    electronAPI,
    dom,
    onAppendTrack,
    onPushToast,
    onEnsureSavedPlaylist,
    onAppendTrackToSavedPlaylist
  } = options || {}

  if (!electronAPI || !dom) {
    return { init() {} }
  }

  const QUALITY_STORAGE_KEY = 'netease.download.quality.v1'
  const taskStateMap = new Map()
  const handledQueueTaskIds = new Set()
  const handledSaveTaskIds = new Set()

  let resolvedSong = null
  let resolvedPlaylist = null

  function setSongPreview(text, isError = false) {
    if (!dom.songPreview) return
    dom.songPreview.textContent = text
    dom.songPreview.style.color = isError ? '#cf3f3f' : ''
  }

  function setPlaylistPreview(text, isError = false) {
    if (!dom.playlistPreview) return
    dom.playlistPreview.textContent = text
    dom.playlistPreview.style.color = isError ? '#cf3f3f' : ''
  }

  function getCurrentQuality() {
    return dom.qualitySelect ? String(dom.qualitySelect.value || 'exhigh') : 'exhigh'
  }

  function persistQuality() {
    if (!dom.qualitySelect) return
    localStorage.setItem(QUALITY_STORAGE_KEY, getCurrentQuality())
  }

  function restoreQuality() {
    if (!dom.qualitySelect) return
    const cached = String(localStorage.getItem(QUALITY_STORAGE_KEY) || '').trim()
    if (!cached) return
    const hasOption = Array.from(dom.qualitySelect.options).some((item) => item.value === cached)
    if (hasOption) dom.qualitySelect.value = cached
  }

  async function resolveSong() {
    const songId = normalizeId(dom.songIdInput?.value)
    if (!songId) {
      setSongPreview('请输入有效歌曲 ID。', true)
      return
    }

    setSongPreview('正在查询歌曲...')
    const res = await electronAPI.neteaseResolveId({ type: 'song', id: songId })
    if (!res?.ok || !res.item) {
      resolvedSong = null
      setSongPreview('歌曲查询失败，可能 ID 不存在或请求受限。', true)
      return
    }

    resolvedSong = res.item
    setSongPreview(
      `歌曲: ${res.item.name} | 歌手: ${res.item.artist || '未知'} | 专辑: ${res.item.album || '未知'}`
    )
  }

  async function resolvePlaylist() {
    const playlistId = normalizeId(dom.playlistIdInput?.value)
    if (!playlistId) {
      setPlaylistPreview('请输入有效歌单 ID。', true)
      return
    }

    setPlaylistPreview('正在查询歌单...')
    const res = await electronAPI.neteaseResolveId({ type: 'playlist', id: playlistId })
    if (!res?.ok || !res.item) {
      resolvedPlaylist = null
      setPlaylistPreview('歌单查询失败，可能 ID 不存在或请求受限。', true)
      return
    }

    resolvedPlaylist = res.item
    const preview = Array.isArray(res.item.tracks)
      ? res.item.tracks.slice(0, 4).map((track, index) => `${index + 1}. ${track.name}`).join(' | ')
      : ''

    setPlaylistPreview(
      `歌单: ${res.item.name} | 创建者: ${res.item.creator || '未知'} | 曲目数: ${res.item.trackCount || 0}${preview ? ` | 预览: ${preview}` : ''}`
    )
  }

  function updateTask(task) {
    if (!task?.id) return
    taskStateMap.set(task.id, task)
    renderTasks()
    handlePostTaskHooks(task)
  }

  async function handlePostTaskHooks(task) {
    if (task.status !== 'succeeded') return

    if (task.addToQueue && !handledQueueTaskIds.has(task.id) && typeof onAppendTrack === 'function') {
      handledQueueTaskIds.add(task.id)
      onAppendTrack({
        path: task.filePath,
        name: task.title || task.songId || '网易云下载'
      })
    }

    const savePlaylistName = String(task.savePlaylistName || '').trim()
    if (!savePlaylistName || handledSaveTaskIds.has(task.id)) return
    if (typeof onEnsureSavedPlaylist !== 'function' || typeof onAppendTrackToSavedPlaylist !== 'function') return

    handledSaveTaskIds.add(task.id)
    const playlistKey = String(task.savePlaylistBatchKey || savePlaylistName).trim()
    const playlistId = await onEnsureSavedPlaylist(savePlaylistName, playlistKey)
    if (!playlistId) return

    await onAppendTrackToSavedPlaylist(playlistId, {
      path: task.filePath,
      title: task.songMetadata?.title || task.title || '网易云下载',
      artist: task.songMetadata?.artist || '',
      album: task.songMetadata?.album || '',
      duration: null
    })
  }

  function shouldShowTask(task, filter) {
    if (filter === 'all') return true
    if (filter === 'active') {
      return task.status === 'pending' || task.status === 'downloading'
    }
    return task.status === filter
  }

  function renderTasks() {
    if (!dom.taskList) return

    const filter = dom.taskFilterSelect ? dom.taskFilterSelect.value : 'all'
    const tasks = Array.from(taskStateMap.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((item) => shouldShowTask(item, filter))

    if (!tasks.length) {
      dom.taskList.innerHTML = '<div class="netease-task-empty">暂无下载任务</div>'
      return
    }

    dom.taskList.innerHTML = tasks.map((task) => {
      const progress = task.totalBytes > 0
        ? `${Math.round((task.receivedBytes / task.totalBytes) * 100)}%`
        : `${Math.round((task.progress || 0) * 100)}%`

      const canCancel = task.status === 'pending' || task.status === 'downloading'
      const errorText = task.error ? ` | ${task.error}` : task.skipReason ? ` | ${task.skipReason}` : ''
      const tag = task.targetDirType === 'temp'
        ? '缓存'
        : task.targetDirType === 'lists'
          ? '歌单目录'
          : '单曲目录'

      return `
        <div class="download-task-item" data-task-id="${task.id}">
          <div class="download-task-line"><strong>${task.title || task.songId || task.id}</strong></div>
          <div class="download-task-line">状态: ${formatTaskStatus(task.status)} | 进度: ${progress} | 目标: ${tag}${errorText}</div>
          <div class="download-task-line download-task-path">${task.filePath || ''}</div>
          ${canCancel ? '<button class="download-task-cancel" data-action="cancel-task">取消</button>' : ''}
        </div>
      `
    }).join('')
  }

  async function loadTasks() {
    const res = await electronAPI.neteaseDownloadTaskList()
    if (!res?.ok || !Array.isArray(res.tasks)) return

    taskStateMap.clear()
    for (const task of res.tasks) {
      taskStateMap.set(task.id, task)
      handlePostTaskHooks(task)
    }
    renderTasks()
  }

  async function createSongTask(mode) {
    const songId = normalizeId(dom.songIdInput?.value)
    if (!songId) {
      setSongPreview('请输入有效歌曲 ID。', true)
      return
    }

    persistQuality()
    const level = getCurrentQuality()
    const res = await electronAPI.neteaseDownloadSongTask({
      songId,
      level,
      mode,
      title: resolvedSong?.name || `歌曲 ${songId}`,
      fileName: `${songId}-${level}.mp3`,
      duplicateStrategy: 'skip'
    })

    if (!res?.ok || !res.task) {
      setSongPreview(`创建下载任务失败: ${res?.message || res?.error || 'UNKNOWN'}`, true)
      return
    }

    updateTask(res.task)
    setSongPreview(`任务已创建: ${res.task.id}`)
  }

  async function createPlaylistTasks(mode) {
    const playlistId = normalizeId(dom.playlistIdInput?.value)
    if (!playlistId) {
      setPlaylistPreview('请输入有效歌单 ID。', true)
      return
    }

    persistQuality()
    const level = getCurrentQuality()
    const res = await electronAPI.neteaseDownloadPlaylistById({
      playlistId,
      level,
      mode,
      duplicateStrategy: 'skip'
    })

    if (!res?.ok) {
      setPlaylistPreview(`歌单下载任务创建失败: ${res?.message || res?.error || 'UNKNOWN'}`, true)
      return
    }

    if (Array.isArray(res.tasks)) {
      for (const task of res.tasks) {
        updateTask(task)
      }
    }

    setPlaylistPreview(`已创建 ${res.createdCount || 0} 个任务${res.failedCount ? `，失败 ${res.failedCount}` : ''}`)
  }

  async function cancelTask(taskId) {
    if (!taskId) return
    const res = await electronAPI.neteaseDownloadTaskCancel({ id: taskId })
    if (res?.ok && res.task) {
      updateTask(res.task)
    }
  }

  async function openDir(dirType) {
    const res = await electronAPI.neteaseOpenDownloadDir({ dirType })
    if (!res?.ok && typeof onPushToast === 'function') {
      onPushToast({ level: 'error', message: `打开目录失败: ${res?.message || res?.error || 'UNKNOWN'}` })
    }
  }

  async function clearTemp() {
    const res = await electronAPI.neteaseClearTempDownloads()
    if (!res?.ok) {
      if (typeof onPushToast === 'function') {
        onPushToast({ level: 'error', message: `清理缓存失败: ${res?.message || res?.error || 'UNKNOWN'}` })
      }
      return
    }

    if (typeof onPushToast === 'function') {
      onPushToast({ level: 'info', message: `已清理缓存歌曲 ${res.removedFiles || 0} 首` })
    }
  }

  function bindEvents() {
    dom.songResolveBtn?.addEventListener('click', resolveSong)
    dom.playlistResolveBtn?.addEventListener('click', resolvePlaylist)

    dom.songOnlyBtn?.addEventListener('click', () => createSongTask('song-download-only'))
    dom.songTempQueueBtn?.addEventListener('click', () => createSongTask('song-temp-queue-only'))
    dom.songAndQueueBtn?.addEventListener('click', () => createSongTask('song-download-and-queue'))

    dom.playlistOnlyBtn?.addEventListener('click', () => createPlaylistTasks('playlist-download-only'))
    dom.playlistAndQueueBtn?.addEventListener('click', () => createPlaylistTasks('playlist-download-and-queue'))
    dom.playlistAndSaveBtn?.addEventListener('click', () => createPlaylistTasks('playlist-download-and-save'))

    dom.openSongsDirBtn?.addEventListener('click', () => openDir('songs'))
    dom.openTempDirBtn?.addEventListener('click', () => openDir('temp'))
    dom.openListsDirBtn?.addEventListener('click', () => openDir('lists'))
    dom.clearTempBtn?.addEventListener('click', clearTemp)

    dom.qualitySelect?.addEventListener('change', persistQuality)
    dom.taskFilterSelect?.addEventListener('change', renderTasks)

    dom.songIdInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        resolveSong()
      }
    })

    dom.playlistIdInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        resolvePlaylist()
      }
    })

    dom.taskList?.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.dataset.action !== 'cancel-task') return
      const parent = target.closest('[data-task-id]')
      if (!parent) return
      const taskId = parent.getAttribute('data-task-id')
      if (taskId) cancelTask(taskId)
    })
  }

  function init() {
    restoreQuality()
    bindEvents()
    loadTasks()

    if (electronAPI.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        updateTask(task)
      })
    }
  }

  return { init }
}
