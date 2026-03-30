function safeText(value) {
  return String(value || '').trim()
}

function normalizeTrack(track) {
  if (!track || typeof track !== 'object') return null
  const id = safeText(track.id)
  if (!id) return null

  return {
    id,
    name: safeText(track.name) || `歌曲 ${id}`,
    artist: safeText(track.artist),
    album: safeText(track.album),
    durationMs: Number(track.durationMs || 0),
    coverUrl: safeText(track.coverUrl),
    reason: safeText(track.reason)
  }
}

function truncate(value, maxLen = 18) {
  const text = safeText(value)
  if (!text) return ''
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen - 1)}…`
}

export function createDailyRecommendationManager(options) {
  const {
    electronAPI,
    dom,
    onReplaceQueueWithTracks,
    onAppendTracksToQueue,
    onShowSongPage
  } = options

  if (!dom?.coverEl || !dom?.metaEl || !dom?.statusEl || !dom?.playBtn || !dom?.appendBtn) {
    return { init() {} }
  }

  let state = {
    loading: false,
    isLoggedIn: false,
    tracks: [],
    playlist: null,
    lastError: ''
  }

  const queueTaskState = new Map()
  const handledTaskIds = new Set()

  function setStatus(text, isError = false) {
    dom.statusEl.textContent = text
    dom.statusEl.classList.toggle('is-error', isError)
  }

  function setActionDisabled(disabled) {
    dom.playBtn.disabled = disabled
    dom.appendBtn.disabled = disabled
    if (dom.refreshBtn) dom.refreshBtn.disabled = disabled
  }

  function renderCover(url) {
    if (!url) {
      dom.coverEl.style.backgroundImage = ''
      return
    }

    dom.coverEl.style.backgroundImage = `url(${url})`
    dom.coverEl.style.backgroundSize = 'cover'
    dom.coverEl.style.backgroundPosition = 'center'
  }

  function renderState() {
    if (!state.isLoggedIn) {
      setActionDisabled(true)
      setStatus('请先登录网易云账号后加载每日推荐。', true)
      dom.metaEl.textContent = '每日推荐 | 登录后可同步今日歌曲'
      renderCover('')
      return
    }

    if (state.loading) {
      setActionDisabled(true)
      setStatus('正在拉取今日推荐...')
      return
    }

    if (state.lastError) {
      setActionDisabled(false)
      setStatus(`日推加载失败: ${state.lastError}`, true)
      return
    }

    if (!state.tracks.length) {
      setActionDisabled(true)
      setStatus('今日暂无推荐歌曲。')
      dom.metaEl.textContent = '每日推荐 | 暂无可展示内容'
      renderCover('')
      return
    }

    const first = state.tracks[0]
    const artistText = first.artist ? ` - ${first.artist}` : ''
    dom.metaEl.textContent = `每日推荐 | 从「${truncate(first.name, 14)}」听起${artistText}`
    renderCover(first.coverUrl)
    setStatus(`已加载 ${state.tracks.length} 首今日推荐歌曲`) 
    setActionDisabled(false)
  }

  async function refreshDailyRecommendation() {
    if (!electronAPI?.neteaseGetDailyRecommendation) return

    state.loading = true
    state.lastError = ''
    renderState()

    const res = await electronAPI.neteaseGetDailyRecommendation()

    state.loading = false
    if (!res?.ok) {
      if (res?.error === 'NOT_LOGGED_IN') {
        state.isLoggedIn = false
      }
      state.lastError = safeText(res?.message || res?.error || 'REQUEST_FAILED')
      state.tracks = []
      state.playlist = null
      renderState()
      return
    }

    const tracks = Array.isArray(res?.data?.tracks)
      ? res.data.tracks.map(normalizeTrack).filter(Boolean)
      : []

    state.tracks = tracks
    state.playlist = res?.data?.playlist || null
    state.lastError = ''
    renderState()
  }

  async function refreshAuthSummary(force = false) {
    if (!electronAPI?.neteaseAuthGetAccountSummary) return
    const res = await electronAPI.neteaseAuthGetAccountSummary({ refresh: force })
    state.isLoggedIn = Boolean(res?.ok && (res?.state?.isLoggedIn || res?.account?.isLoggedIn))
    if (!state.isLoggedIn) {
      state.tracks = []
      state.playlist = null
      state.lastError = ''
      renderState()
      return
    }

    await refreshDailyRecommendation()
  }

  function buildTaskPayload(track) {
    const safeName = safeText(track.name).replace(/[\\/:*?"<>|]/g, '_')
    return {
      songId: track.id,
      level: 'exhigh',
      mode: 'song-temp-queue-only',
      title: track.name,
      fileName: `${safeName || track.id}-exhigh.mp3`
    }
  }

  async function enqueueTracks(tracks, mode) {
    if (!electronAPI?.neteaseDownloadSongTask || !Array.isArray(tracks) || !tracks.length) return

    let created = 0
    let failed = 0

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index]
      const taskRes = await electronAPI.neteaseDownloadSongTask(buildTaskPayload(track))
      if (!taskRes?.ok || !taskRes?.task?.id) {
        failed += 1
        continue
      }

      created += 1
      queueTaskState.set(taskRes.task.id, {
        track,
        replaceQueueOnDone: mode === 'replace-play-first' && index === 0,
        appendOnDone: mode === 'append-all' || (mode === 'replace-play-first' && index > 0)
      })
    }

    setStatus(`已创建 ${created} 个任务${failed ? `，失败 ${failed} 个` : ''}`)
  }

  function handleDownloadTaskUpdate(task) {
    if (!task?.id || task.status !== 'succeeded') return
    if (handledTaskIds.has(task.id)) return

    const mapped = queueTaskState.get(task.id)
    if (!mapped) return

    handledTaskIds.add(task.id)

    const localTrack = {
      name: safeText(task.songMetadata?.title || task.title || mapped.track.name || '网易云下载'),
      path: task.filePath,
      file: null
    }

    if (mapped.replaceQueueOnDone && typeof onReplaceQueueWithTracks === 'function') {
      onReplaceQueueWithTracks([localTrack], 0, { source: 'daily-recommendation' })
      if (typeof onShowSongPage === 'function') {
        onShowSongPage()
      }
    } else if (mapped.appendOnDone && typeof onAppendTracksToQueue === 'function') {
      onAppendTracksToQueue([localTrack])
    }

    queueTaskState.delete(task.id)
  }

  async function playFirst() {
    if (!state.tracks.length) {
      setStatus('当前没有可播放的日推歌曲。', true)
      return
    }

    await enqueueTracks(state.tracks, 'replace-play-first')
  }

  async function appendAll() {
    if (!state.tracks.length) {
      setStatus('当前没有可加入队列的日推歌曲。', true)
      return
    }

    await enqueueTracks(state.tracks, 'append-all')
  }

  function bindEvents() {
    dom.playBtn.addEventListener('click', playFirst)
    dom.appendBtn.addEventListener('click', appendAll)
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener('click', () => refreshDailyRecommendation())
    }

    dom.coverEl.addEventListener('click', playFirst)

    if (electronAPI?.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        handleDownloadTaskUpdate(task)
      })
    }

    if (electronAPI?.onNeteaseAuthStateUpdate) {
      electronAPI.onNeteaseAuthStateUpdate((payload) => {
        state.isLoggedIn = Boolean(payload?.state?.isLoggedIn || payload?.account?.isLoggedIn)
        if (!state.isLoggedIn) {
          state.tracks = []
          state.playlist = null
          state.lastError = ''
          renderState()
          return
        }

        refreshDailyRecommendation()
      })
    }
  }

  async function init() {
    bindEvents()
    renderState()
    await refreshAuthSummary(true)
  }

  return {
    init,
    refreshDailyRecommendation
  }
}
