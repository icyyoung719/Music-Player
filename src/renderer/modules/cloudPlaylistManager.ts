import type {
  AuthStateUpdatePayload,
  NeteaseAuthStateResult,
  NeteaseCloudPlaylistItem,
  NeteaseCloudPlaylistResult
} from '../core/electronApi.js'

type CloudPlaylist = {
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

type CloudPlaylistManagerOptions = {
  electronAPI?: {
    neteaseAuthGetAccountSummary?: (payload: { refresh: boolean }) => Promise<NeteaseAuthStateResult>
    neteaseCloudPlaylistList?: () => Promise<NeteaseCloudPlaylistResult>
    neteaseUserPlaylists?: () => Promise<NeteaseCloudPlaylistResult>
    neteaseCloudPlaylistSaveRef?: (payload: CloudPlaylist) => Promise<{ ok?: boolean; error?: string }>
    neteaseCloudPlaylistRemoveRef?: (payload: { platformPlaylistId: string }) => Promise<{ ok?: boolean; error?: string }>
    onNeteaseAuthStateUpdate?: (handler: (payload?: AuthStateUpdatePayload) => void) => void
  }
  neteaseDatabaseService?: {
    listCloudPlaylists?: () => Promise<NeteaseCloudPlaylistResult>
    getUserPlaylists?: () => Promise<NeteaseCloudPlaylistResult>
    saveCloudPlaylistRef?: (payload: CloudPlaylist) => Promise<{ ok?: boolean; error?: string }>
    removeCloudPlaylistRef?: (payload: { platformPlaylistId: string }) => Promise<{ ok?: boolean; error?: string }>
  }
  eventBus?: {
    on: (eventName: string, handler: (payload?: unknown) => void) => void
  }
  dom?: {
    listEl?: HTMLElement | null
    refreshBtn?: HTMLElement | null
  }
  onOpenPlaylistDetail?: (playlistId: string, name: string, options: { source: string; cloudPlaylist: CloudPlaylist | null }) => void
  onStateChanged?: (state: { loading: boolean; playlists: CloudPlaylist[]; isLoggedIn: boolean; lastError: string }) => void
}

type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== 'object') return {}
  return value as AnyRecord
}

function safeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeCloudPlaylist(item: unknown): CloudPlaylist | null {
  const source = asRecord(item as NeteaseCloudPlaylistItem)
  if (Object.keys(source).length === 0) return null
  const playlistId = safeText(source.platformPlaylistId || source.id)
  if (!/^\d{1,20}$/.test(playlistId)) return null

  const sourceKinds = Array.isArray(source.sourceKinds)
    ? source.sourceKinds.map((value) => safeText(value)).filter(Boolean)
    : []

  return {
    id: safeText(source.id) || `netease-cloud-${playlistId}`,
    platform: safeText(source.platform) || 'netease',
    source: safeText(source.source) || 'cloud',
    platformPlaylistId: playlistId,
    name: safeText(source.name) || `歌单 ${playlistId}`,
    creator: {
      userId: safeText(asRecord(source.creator).userId),
      nickname: safeText(asRecord(source.creator).nickname)
    },
    coverUrl: safeText(source.coverUrl),
    description: safeText(source.description),
    trackCount: Number(source.trackCount || 0),
    playCount: Number(source.playCount || 0),
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => safeText(tag)).filter(Boolean) : [],
    collected: source.collected !== false,
    sourceKinds,
    updatedAt: safeText(source.updatedAt)
  }
}

function renderSourceTag(sourceKinds: string[] | undefined): string {
  const tags = Array.isArray(sourceKinds) ? sourceKinds : []
  if (tags.includes('daily')) return '日推'
  if (tags.includes('playback')) return '播放来源'
  if (tags.includes('created')) return '我创建'
  if (tags.includes('subscribed')) return '我收藏'
  return '云端'
}

export function createCloudPlaylistManager(options: CloudPlaylistManagerOptions = {}) {
  const {
    electronAPI,
    neteaseDatabaseService,
    eventBus,
    dom,
    onOpenPlaylistDetail,
    onStateChanged
  } = options

  if (!dom?.listEl) {
    return { init() {} }
  }
  const listEl = dom.listEl
  const refreshBtn = dom.refreshBtn

  const state = {
    loading: false,
    playlists: [] as CloudPlaylist[],
    isLoggedIn: false,
    lastError: ''
  }

  function emitState(): void {
    if (typeof onStateChanged === 'function') {
      onStateChanged({ ...state })
    }
  }

  function setListLoading(): void {
    listEl.innerHTML = '<div class="menu-item menu-item-empty">正在加载云端歌单...</div>'
  }

  function renderList(): void {
    if (state.loading) {
      setListLoading()
      return
    }

    if (!state.isLoggedIn) {
      listEl.innerHTML = '<div class="menu-item menu-item-empty">登录后可同步云端歌单</div>'
      return
    }

    if (state.lastError) {
      listEl.innerHTML = `<div class="menu-item menu-item-empty">${state.lastError}</div>`
      return
    }

    if (!state.playlists.length) {
      listEl.innerHTML = '<div class="menu-item menu-item-empty">暂无云端歌单</div>'
      return
    }

    const html = state.playlists
      .map((item) => {
        const title = item.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const sourceTag = renderSourceTag(item.sourceKinds)
        return `
          <button
            class="menu-item created-playlist-item cloud-playlist-item"
            type="button"
            data-cloud-playlist-id="${item.platformPlaylistId}"
            title="${title}"
          >
            <span class="created-playlist-name">☁ ${title}</span>
            <span class="created-playlist-count">${sourceTag}</span>
          </button>
        `
      })
      .join('')

    listEl.innerHTML = html
  }

  async function refreshLoginState(): Promise<void> {
    if (!electronAPI?.neteaseAuthGetAccountSummary) {
      state.isLoggedIn = false
      return
    }

    const summary = await electronAPI.neteaseAuthGetAccountSummary({ refresh: false })
    state.isLoggedIn = Boolean(summary?.ok && (summary?.state?.isLoggedIn || summary?.account?.isLoggedIn))
  }

  function mergePlaylists(input: NeteaseCloudPlaylistItem[]): CloudPlaylist[] {
    const dedupMap = new Map<string, CloudPlaylist>()
    for (const raw of input) {
      const item = normalizeCloudPlaylist(raw)
      if (!item) continue
      const key = item.platformPlaylistId
      const existing = dedupMap.get(key)
      if (!existing) {
        dedupMap.set(key, item)
        continue
      }

      const sourceKinds = Array.from(new Set([...(existing.sourceKinds || []), ...(item.sourceKinds || [])]))
      dedupMap.set(key, {
        ...existing,
        ...item,
        sourceKinds,
        collected: existing.collected || item.collected
      })
    }

    return Array.from(dedupMap.values())
  }

  async function listLocalRefs(): Promise<NeteaseCloudPlaylistResult> {
    if (neteaseDatabaseService?.listCloudPlaylists) {
      return neteaseDatabaseService.listCloudPlaylists()
    }

    if (electronAPI?.neteaseCloudPlaylistList) {
      return electronAPI.neteaseCloudPlaylistList()
    }

    return { ok: false, error: 'API_UNAVAILABLE' }
  }

  async function syncFromAccount(): Promise<NeteaseCloudPlaylistResult> {
    if (neteaseDatabaseService?.getUserPlaylists) {
      return neteaseDatabaseService.getUserPlaylists()
    }

    if (electronAPI?.neteaseUserPlaylists) {
      return electronAPI.neteaseUserPlaylists()
    }

    return { ok: false, error: 'API_UNAVAILABLE' }
  }

  async function refreshCloudPlaylists(): Promise<void> {
    state.loading = true
    state.lastError = ''
    renderList()

    await refreshLoginState()

    if (!state.isLoggedIn) {
      state.playlists = []
      state.loading = false
      renderList()
      emitState()
      return
    }

    const [localRefs, userPlaylists] = await Promise.all([listLocalRefs(), syncFromAccount()])

    const localItems = Array.isArray(localRefs?.data) ? localRefs.data : []
    const accountItems = Array.isArray(userPlaylists?.data) ? userPlaylists.data : []
    state.playlists = mergePlaylists([...accountItems, ...localItems])

    if (!userPlaylists?.ok && !localRefs?.ok) {
      state.lastError = '云端歌单加载失败，请稍后重试'
    }

    state.loading = false
    renderList()
    emitState()
  }

  async function saveCloudPlaylistReference(payload: unknown): Promise<{ ok?: boolean; error?: string }> {
    const safePayload = normalizeCloudPlaylist(payload)
    if (!safePayload) return { ok: false, error: 'INVALID_PLAYLIST_ID' }

    if (neteaseDatabaseService?.saveCloudPlaylistRef) {
      return neteaseDatabaseService.saveCloudPlaylistRef(safePayload)
    }

    if (electronAPI?.neteaseCloudPlaylistSaveRef) {
      return electronAPI.neteaseCloudPlaylistSaveRef(safePayload)
    }

    return { ok: false, error: 'API_UNAVAILABLE' }
  }

  async function removeCloudPlaylistReference(payload: { platformPlaylistId?: string; playlistId?: string; id?: string }): Promise<{ ok?: boolean; error?: string }> {
    const playlistId = safeText(payload?.platformPlaylistId || payload?.playlistId || payload?.id)
    if (!/^\d{1,20}$/.test(playlistId)) {
      return { ok: false, error: 'INVALID_PLAYLIST_ID' }
    }

    if (neteaseDatabaseService?.removeCloudPlaylistRef) {
      return neteaseDatabaseService.removeCloudPlaylistRef({ platformPlaylistId: playlistId })
    }

    if (electronAPI?.neteaseCloudPlaylistRemoveRef) {
      return electronAPI.neteaseCloudPlaylistRemoveRef({ platformPlaylistId: playlistId })
    }

    return { ok: false, error: 'API_UNAVAILABLE' }
  }

  function bindEvents(): void {
    listEl.addEventListener('click', (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const button = target.closest('[data-cloud-playlist-id]')
      if (!(button instanceof HTMLElement)) return
      const playlistId = safeText(button.dataset.cloudPlaylistId)
      if (!/^\d{1,20}$/.test(playlistId)) return

      const playlist = state.playlists.find((item) => item.platformPlaylistId === playlistId)
      if (typeof onOpenPlaylistDetail === 'function') {
        onOpenPlaylistDetail(playlistId, playlist?.name || '', {
          source: 'cloud-playlist',
          cloudPlaylist: playlist || null
        })
      }
    })

    refreshBtn?.addEventListener('click', () => {
      refreshCloudPlaylists()
    })

    if (electronAPI?.onNeteaseAuthStateUpdate) {
      electronAPI.onNeteaseAuthStateUpdate((payload) => {
        state.isLoggedIn = Boolean(payload?.state?.isLoggedIn || payload?.account?.isLoggedIn)
        refreshCloudPlaylists()
      })
    }

    if (eventBus) {
      eventBus.on('cloud-playlist:encountered', async (payload) => {
        const sourcePayload = asRecord(payload)
        const playlist = normalizeCloudPlaylist(sourcePayload.playlist)
        if (!playlist) return
        await saveCloudPlaylistReference({
          ...playlist,
          collected: true,
          sourceKinds: Array.from(new Set([...(playlist.sourceKinds || []), safeText(sourcePayload.sourceKind)]))
        })
        refreshCloudPlaylists()
      })
    }
  }

  async function init(): Promise<void> {
    bindEvents()
    await refreshCloudPlaylists()
  }

  return {
    init,
    refreshCloudPlaylists,
    saveCloudPlaylistReference,
    removeCloudPlaylistReference,
    getState() {
      return { ...state }
    }
  }
}
