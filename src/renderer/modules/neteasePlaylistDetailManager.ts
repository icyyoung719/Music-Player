type PlaylistTrack = {
  songId?: string
  title?: string
  artist?: string
  album?: string
  durationMs?: number
  coverUrl?: string
}

type PlaylistDetail = {
  id?: string
  name?: string
  creator?: string
  trackCount?: number
  playCount?: number
  coverUrl?: string
  description?: string
  tags?: string[]
  tracks?: PlaylistTrack[]
}

type DetailResponse = {
  ok?: boolean
  data?: PlaylistDetail
  message?: string
  error?: string
  createdCount?: number
  task?: { id?: string }
}

type PlaylistDetailDom = {
  overlay?: HTMLElement | null
  closeBtn?: HTMLElement | null
  trackList?: HTMLElement | null
  status?: HTMLElement | null
  cover?: HTMLElement | null
  coverText?: HTMLElement | null
  collectBtn?: HTMLButtonElement | null
  name?: HTMLElement | null
  sub?: HTMLElement | null
  playBtn?: HTMLElement | null
  downloadBtn?: HTMLElement | null
  saveLocalBtn?: HTMLElement | null
}

type PlaylistDetailOptions = {
  electronAPI?: {
    neteaseDownloadSongTask?: (payload: Record<string, unknown>) => Promise<DetailResponse>
    neteaseDownloadPlaylistById?: (payload: Record<string, unknown>) => Promise<DetailResponse>
    neteasePlaylistDetail?: (payload: { playlistId: string }) => Promise<DetailResponse>
  }
  neteaseDatabaseService?: {
    getPlaylistDetail?: (playlistId: string) => Promise<DetailResponse>
  }
  downloadService?: {
    createSongTask?: (payload: Record<string, unknown>) => Promise<DetailResponse>
    createPlaylistTasks?: (payload: Record<string, unknown>) => Promise<DetailResponse>
  }
  eventBus?: {
    emit: (eventName: string, payload?: unknown) => void
  }
  dom?: PlaylistDetailDom
  requestDownloadStrategy?: () => Promise<string>
  getCloudPlaylistManager?: () => {
    saveCloudPlaylistReference: (payload: Record<string, unknown>) => Promise<{ ok?: boolean; message?: string; error?: string }>
    removeCloudPlaylistReference: (payload: { platformPlaylistId: string }) => Promise<{ ok?: boolean; message?: string; error?: string }>
  } | null
}

type CloudPlaylistReference = {
  id: string
  platform: 'netease'
  source: 'cloud'
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
}

function formatDuration(ms: unknown): string {
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min}:${String(rem).padStart(2, '0')}`
}

function formatPlayCount(value: unknown): string {
  const count = Number(value || 0)
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)} 亿`
  if (count >= 10000) return `${(count / 10000).toFixed(1)} 万`
  return String(Math.floor(count))
}

function escapeHtml(raw: unknown): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function coverStyle(url: unknown): string {
  const clean = String(url || '').trim()
  if (!clean) return ''
  return `background-image:url('${clean.replace(/'/g, "\\'")}')`
}

export function createNeteasePlaylistDetailManager(options: PlaylistDetailOptions = {}) {
  const {
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    eventBus,
    dom: domRaw,
    requestDownloadStrategy,
    getCloudPlaylistManager
  } = options

  if (!domRaw?.overlay || !domRaw?.closeBtn || !domRaw?.trackList) {
    return { init() {}, openByPlaylistId() {} }
  }

  const dom: PlaylistDetailDom & {
    overlay: HTMLElement
    closeBtn: HTMLElement
    trackList: HTMLElement
  } = domRaw as PlaylistDetailDom & {
    overlay: HTMLElement
    closeBtn: HTMLElement
    trackList: HTMLElement
  }

  const state: {
    playlistId: string
    playlistName: string
    requestToken: number
    sourceKind: string
    playlistData: PlaylistDetail | null
    collected: boolean
  } = {
    playlistId: '',
    playlistName: '',
    requestToken: 0,
    sourceKind: '',
    playlistData: null,
    collected: false
  }

  function setStatus(text: string, isError = false): void {
    if (!dom.status) return
    dom.status.textContent = String(text || '')
    dom.status.classList.toggle('is-error', Boolean(isError))
  }

  function setCover(url: string | undefined, fallbackText = '♪'): void {
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

  function openOverlay(): void {
    dom.overlay.classList.add('visible')
    dom.overlay.setAttribute('aria-hidden', 'false')
  }

  function closeOverlay(): void {
    dom.overlay.classList.remove('visible')
    dom.overlay.setAttribute('aria-hidden', 'true')
  }

  function renderCollectButton(): void {
    if (!dom.collectBtn) return
    dom.collectBtn.textContent = state.collected ? '取消收藏云端引用' : '收藏云端引用'
  }

  function renderSummary(playlist: PlaylistDetail): void {
    if (dom.name) {
      dom.name.textContent = playlist.name || `歌单 ${playlist.id || ''}`
    }

    if (dom.sub) {
      const sourceHint = state.sourceKind ? ` · 来源 ${state.sourceKind}` : ''
      dom.sub.textContent = `创建者 ${playlist.creator || '未知'} · ${playlist.trackCount || 0} 首 · 播放 ${formatPlayCount(playlist.playCount)}${sourceHint}`
    }

    const firstLetter = String(playlist.name || '♪').trim().slice(0, 1) || '♪'
    setCover(playlist.coverUrl, firstLetter)
  }

  function renderTracks(tracks: PlaylistTrack[] | undefined): void {
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

  function createLazyQueueTrack(item: PlaylistTrack): Record<string, unknown> {
    const songId = String(item?.songId || '').trim()
    const title = String(item?.title || '').trim() || `歌曲 ${songId}`
    const artist = String(item?.artist || '').trim()
    const album = String(item?.album || '').trim()
    const durationMs = Number(item?.durationMs || 0)
    const coverUrl = String(item?.coverUrl || '').trim()

    return {
      name: title,
      path: null,
      file: null,
      metadataCache: {
        title,
        artist: artist || null,
        album: album || null,
        duration: durationMs > 0 ? durationMs / 1000 : null
      },
      lazyNetease: {
        songId,
        title,
        artist,
        album,
        coverUrl,
        durationMs,
        level: 'exhigh',
        state: 'idle',
        taskId: ''
      }
    }
  }

  function getCurrentCloudReference(): CloudPlaylistReference | null {
    if (!state.playlistData) return null
    return {
      id: `netease-cloud-${state.playlistId}`,
      platform: 'netease',
      source: 'cloud',
      platformPlaylistId: state.playlistId,
      name: state.playlistData.name || state.playlistName || `歌单 ${state.playlistId}`,
      creator: {
        userId: '',
        nickname: String(state.playlistData.creator || '').trim()
      },
      coverUrl: String(state.playlistData.coverUrl || '').trim(),
      description: String(state.playlistData.description || '').trim(),
      trackCount: Number(state.playlistData.trackCount || 0),
      playCount: Number(state.playlistData.playCount || 0),
      tags: Array.isArray(state.playlistData.tags) ? state.playlistData.tags : [],
      collected: state.collected,
      sourceKinds: [state.sourceKind || 'playback']
    }
  }

  async function playSongById(songId: string): Promise<void> {
    const id = String(songId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法播放：歌曲 ID 无效。', true)
      return
    }

    const tracks = Array.isArray(state.playlistData?.tracks) ? state.playlistData.tracks : []
    const index = Math.max(0, tracks.findIndex((item) => String(item?.songId || '') === id))
    const queueTracks = tracks.map(createLazyQueueTrack)

    if (!queueTracks.length || !eventBus) {
      setStatus('当前歌单暂无可播放歌曲。', true)
      return
    }

    eventBus.emit('playback:queue.replace', {
      tracks: queueTracks,
      startIndex: index,
      options: {
        source: 'cloud-playlist-lazy',
        cloudPlaylistId: state.playlistId
      }
    })
    eventBus.emit('view:song.open')
    setStatus(`已从第 ${index + 1} 首开始播放云端歌单（按需下载）。`)
  }

  async function downloadSongById(songId: string): Promise<void> {
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
    const res = downloadService?.createSongTask
      ? await downloadService.createSongTask(payload)
      : await electronAPI?.neteaseDownloadSongTask?.(payload)

    if (!res?.ok || !res?.task?.id) {
      setStatus(`创建下载任务失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    setStatus('下载任务创建成功，可在下载队列中查看进度。')
  }

  async function playCurrentPlaylist(): Promise<void> {
    const tracks = Array.isArray(state.playlistData?.tracks) ? state.playlistData.tracks : []
    if (!tracks.length || !eventBus) {
      setStatus('当前歌单暂无可播放歌曲。', true)
      return
    }

    const queueTracks = tracks.map(createLazyQueueTrack)
    eventBus.emit('playback:queue.replace', {
      tracks: queueTracks,
      startIndex: 0,
      options: {
        source: 'cloud-playlist-lazy',
        cloudPlaylistId: state.playlistId
      }
    })
    eventBus.emit('view:song.open')
    setStatus(`已开始播放云端歌单，共 ${queueTracks.length} 首（按需下载）。`)
  }

  async function downloadCurrentPlaylist(): Promise<void> {
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
    const res = downloadService?.createPlaylistTasks
      ? await downloadService.createPlaylistTasks(payload)
      : await electronAPI?.neteaseDownloadPlaylistById?.(payload)

    if (!res?.ok) {
      setStatus(`创建歌单下载任务失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    setStatus(`歌单下载任务已创建：${res.createdCount || 0} 首。`)
  }

  async function toggleCollectCurrentPlaylist(): Promise<void> {
    const reference = getCurrentCloudReference()
    if (!reference) {
      setStatus('当前歌单信息未就绪，请稍后再试。', true)
      return
    }

    const cloudPlaylistManager = typeof getCloudPlaylistManager === 'function'
      ? getCloudPlaylistManager()
      : null
    if (!cloudPlaylistManager) {
      setStatus('云端歌单管理器未就绪。', true)
      return
    }

    if (!state.collected) {
      const res = await cloudPlaylistManager.saveCloudPlaylistReference({
        ...reference,
        collected: true
      })
      if (!res?.ok) {
        setStatus(`收藏失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
        return
      }
      state.collected = true
      renderCollectButton()
      setStatus('已收藏到云端歌单引用列表。')
      return
    }

    const removeRes = await cloudPlaylistManager.removeCloudPlaylistReference({
      platformPlaylistId: reference.platformPlaylistId
    })
    if (!removeRes?.ok) {
      setStatus(`取消收藏失败: ${removeRes?.message || removeRes?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    state.collected = false
    renderCollectButton()
    setStatus('已从云端歌单引用列表移除。')
  }

  async function saveCurrentPlaylistToLocal(): Promise<void> {
    const id = String(state.playlistId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法处理：歌单 ID 无效。', true)
      return
    }

    const strategy = typeof requestDownloadStrategy === 'function'
      ? await requestDownloadStrategy()
      : 'full-download'

    if (strategy === 'cancel') {
      setStatus('已取消操作。')
      return
    }

    if (strategy === 'lazy-play') {
      await playCurrentPlaylist()
      setStatus('已切换为按需播放，未执行全量下载。')
      return
    }

    const payload = {
      playlistId: id,
      level: 'exhigh',
      mode: 'playlist-download-and-save',
      duplicateStrategy: 'skip'
    }

    setStatus('正在下载并写入本地歌单...')
    const res = downloadService?.createPlaylistTasks
      ? await downloadService.createPlaylistTasks(payload)
      : await electronAPI?.neteaseDownloadPlaylistById?.(payload)

    if (!res?.ok) {
      setStatus(`下载失败: ${res?.message || res?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    setStatus(`下载任务已创建：${res.createdCount || 0} 首，完成后将写入本地歌单。`)
  }

  async function openByPlaylistId(
    playlistId: string,
    playlistName = '',
    options: { source?: string; cloudPlaylist?: { collected?: boolean } } = {}
  ): Promise<void> {
    const id = String(playlistId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setStatus('无法查看详情：歌单 ID 无效。', true)
      return
    }

    state.playlistId = id
    state.playlistName = String(playlistName || '').trim()
    state.sourceKind = String(options?.source || '').trim() || 'playback'
    state.playlistData = null
    state.collected = Boolean(options?.cloudPlaylist?.collected)
    renderCollectButton()

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
    const response = neteaseDatabaseService?.getPlaylistDetail
      ? await neteaseDatabaseService.getPlaylistDetail(id)
      : await electronAPI?.neteasePlaylistDetail?.({ playlistId: id })

    if (token !== state.requestToken) return

    if (!response?.ok || !response?.data) {
      setStatus(`加载失败: ${response?.message || response?.error || 'REQUEST_FAILED'}`, true)
      return
    }

    const playlist = response.data
    state.playlistData = playlist
    renderSummary(playlist)
    renderTracks(playlist.tracks)
    renderCollectButton()

    if (eventBus) {
      eventBus.emit('cloud-playlist:encountered', {
        sourceKind: state.sourceKind || 'playback',
        playlist: {
          id,
          platformPlaylistId: id,
          name: playlist.name,
          creator: {
            userId: '',
            nickname: playlist.creator || ''
          },
          coverUrl: playlist.coverUrl,
          description: playlist.description,
          trackCount: playlist.trackCount,
          playCount: playlist.playCount,
          tags: playlist.tags,
          collected: true,
          sourceKinds: [state.sourceKind || 'playback']
        }
      })
    }

    setStatus(`已加载 ${playlist.trackCount || 0} 首歌曲。`)
  }

  function bindEvents(): void {
    dom.closeBtn.addEventListener('click', () => {
      closeOverlay()
    })

    dom.overlay.addEventListener('click', (event: MouseEvent) => {
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

    if (dom.saveLocalBtn) {
      dom.saveLocalBtn.addEventListener('click', () => {
        saveCurrentPlaylistToLocal()
      })
    }

    if (dom.collectBtn) {
      dom.collectBtn.addEventListener('click', () => {
        toggleCollectCurrentPlaylist()
      })
    }

    dom.trackList.addEventListener('click', (event: MouseEvent) => {
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
  }

  function init(): void {
    bindEvents()
  }

  return {
    init,
    openByPlaylistId,
    close: closeOverlay
  }
}
