// @ts-nocheck
function safeText(value) {
  return String(value || '').trim()
}

function normalizeCloudPlaylist(item) {
  if (!item || typeof item !== 'object') return null
  const playlistId = safeText(item.platformPlaylistId || item.id)
  if (!/^\d{1,20}$/.test(playlistId)) return null

  const sourceKinds = Array.isArray(item.sourceKinds)
    ? item.sourceKinds.map((value) => safeText(value)).filter(Boolean)
    : []

  return {
    id: safeText(item.id) || `netease-cloud-${playlistId}`,
    platform: safeText(item.platform) || 'netease',
    source: safeText(item.source) || 'cloud',
    platformPlaylistId: playlistId,
    name: safeText(item.name) || `歌单 ${playlistId}`,
    creator: {
      userId: safeText(item?.creator?.userId),
      nickname: safeText(item?.creator?.nickname)
    },
    coverUrl: safeText(item.coverUrl),
    description: safeText(item.description),
    trackCount: Number(item.trackCount || 0),
    playCount: Number(item.playCount || 0),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => safeText(tag)).filter(Boolean) : [],
    collected: item.collected !== false,
    sourceKinds,
    updatedAt: safeText(item.updatedAt)
  }
}

function renderSourceTag(sourceKinds) {
  const tags = Array.isArray(sourceKinds) ? sourceKinds : []
  if (tags.includes('daily')) return '日推'
  if (tags.includes('playback')) return '播放来源'
  if (tags.includes('created')) return '我创建'
  if (tags.includes('subscribed')) return '我收藏'
  return '云端'
}

export function createCloudPlaylistManager(options = {}) {
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

  const state = {
    loading: false,
    playlists: [],
    isLoggedIn: false,
    lastError: ''
  }

  function emitState() {
    if (typeof onStateChanged === 'function') {
      onStateChanged({ ...state })
    }
  }

  function setListLoading() {
    dom.listEl.innerHTML = '<div class="menu-item menu-item-empty">正在加载云端歌单...</div>'
  }

  function renderList() {
    if (state.loading) {
      setListLoading()
      return
    }

    if (!state.isLoggedIn) {
      dom.listEl.innerHTML = '<div class="menu-item menu-item-empty">登录后可同步云端歌单</div>'
      return
    }

    if (state.lastError) {
      dom.listEl.innerHTML = `<div class="menu-item menu-item-empty">${state.lastError}</div>`
      return
    }

    if (!state.playlists.length) {
      dom.listEl.innerHTML = '<div class="menu-item menu-item-empty">暂无云端歌单</div>'
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

    dom.listEl.innerHTML = html
  }

  async function refreshLoginState() {
    if (!electronAPI?.neteaseAuthGetAccountSummary) {
      state.isLoggedIn = false
      return
    }

    const summary = await electronAPI.neteaseAuthGetAccountSummary({ refresh: false })
    state.isLoggedIn = Boolean(summary?.ok && (summary?.state?.isLoggedIn || summary?.account?.isLoggedIn))
  }

  function mergePlaylists(input) {
    const dedupMap = new Map()
    for (const item of input.map(normalizeCloudPlaylist).filter(Boolean)) {
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

  async function listLocalRefs() {
    if (neteaseDatabaseService?.listCloudPlaylists) {
      return neteaseDatabaseService.listCloudPlaylists()
    }

    if (electronAPI?.neteaseCloudPlaylistList) {
      return electronAPI.neteaseCloudPlaylistList()
    }

    return { ok: false, error: 'API_UNAVAILABLE' }
  }

  async function syncFromAccount() {
    if (neteaseDatabaseService?.getUserPlaylists) {
      return neteaseDatabaseService.getUserPlaylists()
    }

    if (electronAPI?.neteaseUserPlaylists) {
      return electronAPI.neteaseUserPlaylists()
    }

    return { ok: false, error: 'API_UNAVAILABLE' }
  }

  async function refreshCloudPlaylists() {
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

  async function saveCloudPlaylistReference(payload) {
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

  async function removeCloudPlaylistReference(payload) {
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

  function bindEvents() {
    dom.listEl.addEventListener('click', (event) => {
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

    dom.refreshBtn?.addEventListener('click', () => {
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
        const playlist = normalizeCloudPlaylist(payload?.playlist)
        if (!playlist) return
        await saveCloudPlaylistReference({
          ...playlist,
          collected: true,
          sourceKinds: Array.from(new Set([...(playlist.sourceKinds || []), safeText(payload?.sourceKind)]))
        })
        refreshCloudPlaylists()
      })
    }
  }

  async function init() {
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
