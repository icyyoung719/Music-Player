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
    neteaseDatabaseService,
    dom,
    eventBus
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
    if (!neteaseDatabaseService && !electronAPI?.neteaseGetDailyRecommendation) return

    state.loading = true
    state.lastError = ''
    renderState()

    const res = neteaseDatabaseService
      ? await neteaseDatabaseService.getDailyRecommendation()
      : await electronAPI.neteaseGetDailyRecommendation()

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

    if (state.playlist && eventBus) {
      eventBus.emit('cloud-playlist:encountered', {
        sourceKind: 'daily',
        playlist: {
          ...state.playlist,
          collected: true,
          sourceKinds: ['daily']
        }
      })
    }

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
    return {
      songId: String(track.id),
      title: safeText(track.name) || `歌曲 ${track.id}`,
      artist: safeText(track.artist),
      album: safeText(track.album),
      coverUrl: normalizeCoverUrl(track.coverUrl),
      durationMs: Number(track.durationMs || 0)
    }
  }

  function createLazyQueueTrack(item) {
    const base = buildTaskPayload(item)
    return {
      name: base.title,
      path: null,
      file: null,
      metadataCache: {
        title: base.title,
        artist: base.artist || null,
        album: base.album || null,
        duration: Number(base.durationMs || 0) > 0 ? Number(base.durationMs || 0) / 1000 : null
      },
      lazyNetease: {
        songId: base.songId,
        title: base.title,
        artist: base.artist,
        album: base.album,
        coverUrl: base.coverUrl,
        durationMs: base.durationMs,
        level: 'exhigh',
        state: 'idle',
        taskId: ''
      }
    }
  }

  async function playFirst() {
    if (!state.tracks.length || !eventBus) return

    const queueTracks = state.tracks.map(createLazyQueueTrack)
    eventBus.emit('playback:queue.replace', {
      tracks: queueTracks,
      startIndex: 0,
      options: { source: 'daily-recommendation-lazy' }
    })
    eventBus.emit('view:song.open')
  }

  function bindEvents() {
    dom.coverEl.addEventListener('click', playFirst)

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
