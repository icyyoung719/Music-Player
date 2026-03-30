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

  if (!dom?.coverEl || !dom?.metaEl) {
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
  const playSessionState = new Map()
  let activePlaySessionId = 0

  function normalizeCoverUrl(url) {
    const text = safeText(url)
    if (!text) return ''
    return text.replace(/^http:\/\//i, 'https://')
  }

  function resolvePreferredCover(tracks) {
    for (const track of tracks) {
      const url = normalizeCoverUrl(track?.coverUrl)
      if (url) return url
    }
    return ''
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
      dom.metaEl.textContent = '每日推荐 | 登录后可同步今日歌曲'
      renderCover('')
      return
    }

    if (state.loading) {
      dom.metaEl.textContent = '每日推荐 | 正在更新今日歌曲'
      return
    }

    if (state.lastError) {
      dom.metaEl.textContent = '每日推荐 | 加载失败，稍后自动重试'
      return
    }

    if (!state.tracks.length) {
      dom.metaEl.textContent = '每日推荐 | 暂无可展示内容'
      renderCover('')
      return
    }

    const first = state.tracks[0]
    const artistText = first.artist ? ` - ${first.artist}` : ''
    dom.metaEl.textContent = `每日推荐 | 从「${truncate(first.name, 14)}」听起${artistText}`
    renderCover(resolvePreferredCover(state.tracks))
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
      silentToast: true,
      title: track.name,
      fileName: `${safeName || track.id}-exhigh.mp3`
    }
  }

  function isReadyQueueTask(task) {
    if (!task || !task.filePath) return false
    return task.status === 'succeeded' || task.status === 'skipped'
  }

  function getLocalTrackFromTask(task, mapped) {
    return {
      name: safeText(task.songMetadata?.title || task.title || mapped?.track?.name || '网易云下载'),
      path: task.filePath,
      file: null
    }
  }

  async function enqueueTrack(track) {
    if (!electronAPI?.neteaseDownloadSongTask || !track) return

    const taskRes = await electronAPI.neteaseDownloadSongTask(buildTaskPayload(track))
    if (!taskRes?.ok || !taskRes?.task?.id) return

    queueTaskState.set(taskRes.task.id, {
      track,
      replaceQueueOnDone: true
    })

    // Skip duplicates immediately if cached file already exists.
    if (isReadyQueueTask(taskRes.task)) {
      handleDownloadTaskUpdate(taskRes.task)
    }
  }

  async function enqueueTrackWithSession(track, index, playSessionId) {
    if (!electronAPI?.neteaseDownloadSongTask || !track) return

    const taskRes = await electronAPI.neteaseDownloadSongTask(buildTaskPayload(track))
    if (!taskRes?.ok || !taskRes?.task?.id) return

    queueTaskState.set(taskRes.task.id, {
      track,
      index,
      playSessionId,
      replaceQueueOnDone: index === 0,
      appendOnDone: index > 0
    })

    if (isReadyQueueTask(taskRes.task)) {
      handleDownloadTaskUpdate(taskRes.task)
    }
  }

  function handleDownloadTaskUpdate(task) {
    if (!task?.id || !isReadyQueueTask(task)) return
    if (handledTaskIds.has(task.id)) return

    const mapped = queueTaskState.get(task.id)
    if (!mapped) return

    handledTaskIds.add(task.id)

    const localTrack = getLocalTrackFromTask(task, mapped)

    const isSessionTask = Number.isInteger(mapped.playSessionId) && mapped.playSessionId > 0
    const sessionId = isSessionTask ? mapped.playSessionId : 0
    const session = sessionId ? playSessionState.get(sessionId) : null

    if (sessionId && sessionId !== activePlaySessionId) {
      queueTaskState.delete(task.id)
      return
    }

    if (session && mapped.appendOnDone && !session.started) {
      session.pendingTracks.push(localTrack)
      queueTaskState.delete(task.id)
      return
    }

    if (mapped.replaceQueueOnDone && typeof onReplaceQueueWithTracks === 'function') {
      const seedTracks = session
        ? [localTrack].concat(session.pendingTracks)
        : [localTrack]
      onReplaceQueueWithTracks(seedTracks, 0, { source: 'daily-recommendation' })
      if (session) {
        session.started = true
        session.pendingTracks = []
      }
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
      return
    }

    activePlaySessionId += 1
    const playSessionId = activePlaySessionId
    playSessionState.set(playSessionId, {
      started: false,
      pendingTracks: []
    })

    for (let index = 0; index < state.tracks.length; index += 1) {
      await enqueueTrackWithSession(state.tracks[index], index, playSessionId)
    }

    // Keep only active session state to avoid stale accumulation.
    for (const existingId of Array.from(playSessionState.keys())) {
      if (existingId !== playSessionId) {
        playSessionState.delete(existingId)
      }
    }
  }

  function bindEvents() {
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
