function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min}:${String(rem).padStart(2, '0')}`
}

function formatPlayCount(value) {
  const count = Number(value || 0)
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)} 亿`
  if (count >= 10000) return `${(count / 10000).toFixed(1)} 万`
  return String(Math.floor(count))
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function coverStyle(url) {
  const clean = String(url || '').trim()
  if (!clean) return ''
  return `background-image:url('${clean.replace(/'/g, "\\'")}')`
}

export function createNeteasePlaylistDetailManager(options = {}) {
  const {
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    eventBus,
    dom
  } = options

  if (!dom?.overlay || !dom?.closeBtn || !dom?.trackList) {
    return { init() {}, openByPlaylistId() {} }
  }

  const state = {
    playlistId: '',
    playlistName: '',
    requestToken: 0
  }

  const autoQueueTaskIds = new Set()

  function setStatus(text, isError = false) {
    if (!dom.status) return
    dom.status.textContent = String(text || '')
    dom.status.classList.toggle('is-error', Boolean(isError))
  }

  function setCover(url, fallbackText = '♪') {
    if (!dom.cover) return
    const style = coverStyle(url)
    if (style) {
      dom.cover.style.cssText = style
      dom.cover.classList.add('has-image')
      if (dom.coverText) dom.coverText.textContent = ''
      return
    }

    dom.cover.style.cssText = ''
    dom.cover.classList.remove('has-image')
    if (dom.coverText) dom.coverText.textContent = fallbackText
  }

  function openOverlay() {
    dom.overlay.classList.add('visible')
    dom.overlay.setAttribute('aria-hidden', 'false')
  }

  function closeOverlay() {
    dom.overlay.classList.remove('visible')
    dom.overlay.setAttribute('aria-hidden', 'true')
  }

  function renderSummary(playlist) {
    if (dom.name) {
      dom.name.textContent = playlist.name || `歌单 ${playlist.id || ''}`
    }

    if (dom.sub) {
      dom.sub.textContent = `创建者 ${playlist.creator || '未知'} · ${playlist.trackCount || 0} 首 · 播放 ${formatPlayCount(playlist.playCount)}`
    }

    const firstLetter = String(playlist.name || '♪').trim().slice(0, 1) || '♪'
    setCover(playlist.coverUrl, firstLetter)
  }

  function renderTracks(tracks) {
    const list = Array.isArray(tracks) ? tracks : []
    if (!list.length) {
      dom.trackList.innerHTML = '<div class="netease-search-empty">该歌单暂无可展示歌曲</div>'
      return
    }

    const html = list
      .map((item) => {
        const itemId = escapeHtml(item.songId || '')
        const title = escapeHtml(item.title || '未知歌曲')
        const artist = escapeHtml(item.artist || '未知歌手')
        const album = escapeHtml(item.album || '未知专辑')
        const duration = formatDuration(item.durationMs)
        const style = coverStyle(item.coverUrl)
        const coverClass = style ? 'netease-result-cover has-image' : 'netease-result-cover'
        const coverText = style ? '' : '♪'

        return `
          <article class="netease-result-card netease-result-card-song" data-song-id="${itemId}">
            <div class="${coverClass}" ${style ? `style="${style}"` : ''}>${coverText}</div>
            <div class="netease-result-content">
              <div class="netease-result-title">${title}</div>
              <div class="netease-result-meta">${artist} · ${album}</div>
              <div class="netease-result-foot">
                <span class="netease-result-duration">${duration}</span>
                <div class="netease-result-actions">
                  <button type="button" data-action="playlist-song-play" data-item-id="${itemId}">播放</button>
                  <button type="button" data-action="playlist-song-download" data-item-id="${itemId}">下载</button>
                </div>
              </div>
            </div>
          </article>
        `
      })
      .join('')

    dom.trackList.innerHTML = html
  }

  function handleTaskUpdate(task) {
    if (!task?.id) return
    if (task.status !== 'succeeded') return
    if (!autoQueueTaskIds.has(task.id)) return

    autoQueueTaskIds.delete(task.id)
    if (task.filePath && eventBus) {
      eventBus.emit('playback:queue.append', {
        tracks: [{
          path: task.filePath,
          name: task.title || task.songId || '网易云下载',
          file: null
        }]
      })
    }
  }

  async function playSongById(songId) {
    const id = String(songId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法播放：歌曲 ID 无效。', true)
      return
    }

    const payload = {
      songId: id,
      level: 'exhigh',
      mode: 'song-temp-queue-only'
    }

    setStatus('正在创建歌曲播放任务...')
    const res = downloadService
      ? await downloadService.createSongTask(payload)
      : await electronAPI.neteaseDownloadSongTask(payload)

    if (!res?.ok || !res?.task?.id) {
      setStatus(`创建播放任务失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    autoQueueTaskIds.add(res.task.id)
    setStatus('歌曲已加入待播队列，下载完成后会自动加入播放列表。')
  }

  async function downloadSongById(songId) {
    const id = String(songId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法下载：歌曲 ID 无效。', true)
      return
    }

    const payload = {
      songId: id,
      level: 'exhigh',
      mode: 'song-download-only'
    }

    setStatus('正在创建歌曲下载任务...')
    const res = downloadService
      ? await downloadService.createSongTask(payload)
      : await electronAPI.neteaseDownloadSongTask(payload)

    if (!res?.ok || !res?.task?.id) {
      setStatus(`创建下载任务失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    setStatus('下载任务创建成功，可在下载队列中查看进度。')
  }

  async function playCurrentPlaylist() {
    const id = String(state.playlistId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法播放：歌单 ID 无效。', true)
      return
    }

    const payload = {
      playlistId: id,
      level: 'exhigh',
      mode: 'playlist-download-and-queue',
      duplicateStrategy: 'skip'
    }

    setStatus('正在创建歌单播放任务...')
    const res = downloadService
      ? await downloadService.createPlaylistTasks(payload)
      : await electronAPI.neteaseDownloadPlaylistById(payload)

    if (!res?.ok) {
      setStatus(`创建歌单播放任务失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    const tasks = Array.isArray(res.tasks) ? res.tasks : []
    for (const task of tasks) {
      if (task?.id) autoQueueTaskIds.add(task.id)
    }

    setStatus(`歌单任务已创建：${res.createdCount || 0} 首入队，完成后会自动加入播放列表。`)
  }

  async function downloadCurrentPlaylist() {
    const id = String(state.playlistId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法下载：歌单 ID 无效。', true)
      return
    }

    const payload = {
      playlistId: id,
      level: 'exhigh',
      mode: 'playlist-download-only',
      duplicateStrategy: 'skip'
    }

    setStatus('正在创建歌单下载任务...')
    const res = downloadService
      ? await downloadService.createPlaylistTasks(payload)
      : await electronAPI.neteaseDownloadPlaylistById(payload)

    if (!res?.ok) {
      setStatus(`创建歌单下载任务失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    setStatus(`歌单下载任务已创建：${res.createdCount || 0} 首。`)
  }

  async function openByPlaylistId(playlistId, playlistName = '') {
    const id = String(playlistId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法查看详情：歌单 ID 无效。', true)
      return
    }

    state.playlistId = id
    state.playlistName = String(playlistName || '').trim()

    openOverlay()
    if (dom.name) {
      dom.name.textContent = state.playlistName || `歌单 ${id}`
    }
    if (dom.sub) {
      dom.sub.textContent = '正在加载歌单详情...'
    }
    renderTracks([])
    setCover('', '♪')
    setStatus('正在加载歌单详情...')

    const token = ++state.requestToken
    const response = neteaseDatabaseService
      ? await neteaseDatabaseService.getPlaylistDetail(id)
      : await electronAPI.neteasePlaylistDetail({ playlistId: id })

    if (token !== state.requestToken) return

    if (!response?.ok || !response?.data) {
      setStatus(`加载失败: ${response?.message || response?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    const playlist = response.data
    renderSummary(playlist)
    renderTracks(playlist.tracks)
    setStatus(`已加载 ${playlist.trackCount || 0} 首歌曲。`)
  }

  function bindEvents() {
    dom.closeBtn.addEventListener('click', () => {
      closeOverlay()
    })

    dom.overlay.addEventListener('click', (event) => {
      if (event.target === dom.overlay) {
        closeOverlay()
      }
    })

    if (dom.playBtn) {
      dom.playBtn.addEventListener('click', () => {
        playCurrentPlaylist()
      })
    }

    if (dom.downloadBtn) {
      dom.downloadBtn.addEventListener('click', () => {
        downloadCurrentPlaylist()
      })
    }

    dom.trackList.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const button = target.closest('button[data-action]')
      if (!(button instanceof HTMLElement)) return

      const action = String(button.dataset.action || '').trim()
      const itemId = String(button.dataset.itemId || '').trim()
      if (!itemId) return

      if (action === 'playlist-song-play') {
        playSongById(itemId)
      }

      if (action === 'playlist-song-download') {
        downloadSongById(itemId)
      }
    })

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (!dom.overlay.classList.contains('visible')) return
      event.preventDefault()
      closeOverlay()
    })

    if (downloadService) {
      downloadService.onTaskUpdate((task) => {
        handleTaskUpdate(task)
      })
    } else if (electronAPI.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        handleTaskUpdate(task)
      })
    }
  }

  function init() {
    bindEvents()
  }

  return {
    init,
    openByPlaylistId,
    close: closeOverlay
  }
}
