type RecommendedPlaylist = {
  id: string
  platform: string
  source: string
  platformPlaylistId: string
  name: string
  creator: {
    userId: string
    nickname: string
  }
  coverUrl: string
  description: string
  trackCount: number
  playCount: number
  tags: string[]
  collected: boolean
  sourceKinds: string[]
  updatedAt: string
}

type RecommendedPlaylistManagerOptions = {
  electronAPI?: {
    neteaseAuthGetAccountSummary?: (payload: { refresh: boolean }) => Promise<any>
    neteaseGetRecommendedPlaylists?: () => Promise<{ ok?: boolean; data?: unknown[]; error?: string; message?: string }>
    onNeteaseAuthStateUpdate?: (handler: (payload?: any) => void) => void
  }
  neteaseDatabaseService?: {
    getRecommendedPlaylists?: () => Promise<{ ok?: boolean; data?: unknown[]; error?: string; message?: string }>
  }
  eventBus?: {
    emit?: (eventName: string, payload?: unknown) => void
  }
  dom?: {
    gridEl?: HTMLElement | null
    statusEl?: HTMLElement | null
  }
  onOpenPlaylistDetail?: (playlistId: string, name: string, options: { source: string; cloudPlaylist: RecommendedPlaylist | null }) => void
}

function safeText(value: unknown): string {
  return String(value || '').trim()
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeCoverUrl(value: unknown): string {
  const text = safeText(value)
  if (!text) return ''
  return text.replace(/^http:\/\//i, 'https://')
}

function normalizeRecommendedPlaylist(raw: unknown): RecommendedPlaylist | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, any>
  const playlistId = safeText(payload.platformPlaylistId || payload.id)
  if (!/^\d{1,20}$/.test(playlistId)) return null

  const sourceKinds = Array.isArray(payload.sourceKinds)
    ? payload.sourceKinds.map((item: unknown) => safeText(item)).filter(Boolean)
    : []

  return {
    id: safeText(payload.id) || `netease-cloud-${playlistId}`,
    platform: safeText(payload.platform) || 'netease',
    source: safeText(payload.source) || 'cloud',
    platformPlaylistId: playlistId,
    name: safeText(payload.name) || `歌单 ${playlistId}`,
    creator: {
      userId: safeText(payload.creator?.userId),
      nickname: safeText(payload.creator?.nickname) || '网易云音乐'
    },
    coverUrl: normalizeCoverUrl(payload.coverUrl),
    description: safeText(payload.description),
    trackCount: Math.max(0, Math.trunc(toSafeNumber(payload.trackCount, 0))),
    playCount: Math.max(0, Math.trunc(toSafeNumber(payload.playCount, 0))),
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag: unknown) => safeText(tag)).filter(Boolean) : [],
    collected: Boolean(payload.collected),
    sourceKinds,
    updatedAt: safeText(payload.updatedAt)
  }
}

function formatPlayCount(playCount: number): string {
  if (playCount >= 100000000) return `${(playCount / 100000000).toFixed(1)} 亿`
  if (playCount >= 10000) return `${(playCount / 10000).toFixed(1)} 万`
  return `${Math.max(0, Math.trunc(playCount))}`
}

export function createRecommendedPlaylistManager(options: RecommendedPlaylistManagerOptions = {}) {
  const {
    electronAPI,
    neteaseDatabaseService,
    eventBus,
    dom,
    onOpenPlaylistDetail
  } = options

  if (!(dom?.gridEl instanceof HTMLElement) || !(dom?.statusEl instanceof HTMLElement)) {
    return { init() {} }
  }

  const gridEl = dom.gridEl
  const statusEl = dom.statusEl

  const state = {
    loading: false,
    isLoggedIn: false,
    playlists: [] as RecommendedPlaylist[],
    lastError: ''
  }

  function setStatus(text: string): void {
    statusEl.textContent = text
    statusEl.classList.remove('page-hidden')
  }

  function hideStatus(): void {
    statusEl.textContent = ''
    statusEl.classList.add('page-hidden')
  }

  function renderCards(): void {
    gridEl.innerHTML = ''

    if (!state.isLoggedIn) {
      setStatus('登录后可查看个性化推荐歌单')
      return
    }

    if (state.loading) {
      setStatus('推荐歌单加载中...')
      return
    }

    if (state.lastError) {
      setStatus('推荐歌单加载失败，请稍后重试')
      return
    }

    if (!state.playlists.length) {
      setStatus('暂无推荐歌单')
      return
    }

    hideStatus()
    const fragment = document.createDocumentFragment()

    for (const playlist of state.playlists) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'playlist-card recommend-playlist-card'
      button.dataset.recommendPlaylistId = playlist.platformPlaylistId
      button.title = playlist.name

      const thumb = document.createElement('div')
      thumb.className = 'playlist-thumb'
      if (playlist.coverUrl) {
        thumb.style.backgroundImage = `url(${playlist.coverUrl})`
        thumb.style.backgroundSize = 'cover'
        thumb.style.backgroundPosition = 'center'
      }

      const name = document.createElement('div')
      name.className = 'playlist-name'
      name.textContent = playlist.name

      const meta = document.createElement('div')
      meta.className = 'recommend-playlist-meta'
      const trackText = playlist.trackCount > 0 ? `${playlist.trackCount} 首` : '歌单'
      const playText = playlist.playCount > 0 ? `${formatPlayCount(playlist.playCount)} 次播放` : '推荐'
      meta.textContent = `${trackText} · ${playText}`

      button.appendChild(thumb)
      button.appendChild(name)
      button.appendChild(meta)
      fragment.appendChild(button)
    }

    gridEl.appendChild(fragment)
  }

  async function refreshLoginState(): Promise<void> {
    if (!electronAPI?.neteaseAuthGetAccountSummary) {
      state.isLoggedIn = false
      return
    }

    const summary = await electronAPI.neteaseAuthGetAccountSummary({ refresh: false })
    state.isLoggedIn = Boolean(summary?.ok && (summary?.state?.isLoggedIn || summary?.account?.isLoggedIn))
  }

  async function refreshRecommendedPlaylists(): Promise<void> {
    state.loading = true
    state.lastError = ''
    renderCards()

    await refreshLoginState()
    if (!state.isLoggedIn) {
      state.loading = false
      state.playlists = []
      renderCards()
      return
    }

    const result = neteaseDatabaseService?.getRecommendedPlaylists
      ? await neteaseDatabaseService.getRecommendedPlaylists()
      : await electronAPI?.neteaseGetRecommendedPlaylists?.()

    state.loading = false
    if (!result?.ok) {
      if (result?.error === 'NOT_LOGGED_IN') {
        state.isLoggedIn = false
        state.playlists = []
      }
      state.lastError = safeText(result?.message || result?.error || 'REQUEST_FAILED')
      renderCards()
      return
    }

    const playlists = Array.isArray(result?.data)
      ? result.data.map(normalizeRecommendedPlaylist).filter(Boolean)
      : []

    state.playlists = (playlists as RecommendedPlaylist[]).slice(0, 6)
    state.lastError = ''
    renderCards()
  }

  function bindEvents(): void {
    gridEl.addEventListener('click', (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const button = target.closest('[data-recommend-playlist-id]')
      if (!(button instanceof HTMLElement)) return

      const playlistId = safeText(button.dataset.recommendPlaylistId)
      if (!/^\d{1,20}$/.test(playlistId)) return

      const playlist = state.playlists.find((item) => item.platformPlaylistId === playlistId) || null
      if (!playlist) return

      eventBus?.emit?.('cloud-playlist:encountered', {
        sourceKind: 'recommend',
        playlist: {
          ...playlist,
          collected: true,
          sourceKinds: Array.from(new Set([...(playlist.sourceKinds || []), 'recommend']))
        }
      })

      if (typeof onOpenPlaylistDetail === 'function') {
        onOpenPlaylistDetail(playlistId, playlist.name, {
          source: 'recommend-playlist',
          cloudPlaylist: playlist
        })
      }
    })

    if (electronAPI?.onNeteaseAuthStateUpdate) {
      electronAPI.onNeteaseAuthStateUpdate((payload) => {
        state.isLoggedIn = Boolean(payload?.state?.isLoggedIn || payload?.account?.isLoggedIn)
        void refreshRecommendedPlaylists()
      })
    }
  }

  async function init(): Promise<void> {
    bindEvents()
    renderCards()
    await refreshRecommendedPlaylists()
  }

  return {
    init,
    refreshRecommendedPlaylists
  }
}