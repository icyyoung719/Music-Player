type DownloadTaskItem = {
  id: string
  status?: string
  filePath?: string
  title?: string
  songId?: string
  progress?: number
  totalBytes?: number
  receivedBytes?: number
  error?: string
  skipReason?: string
  targetDirType?: string
  addToQueue?: boolean
  savePlaylistName?: string
  savePlaylistBatchKey?: string
  songMetadata?: {
    title?: string
    artist?: string
    album?: string
  } | null
  createdAt?: number
}

type DownloadTaskResult = {
  ok?: boolean
  error?: string
  message?: string
  task?: DownloadTaskItem
  tasks?: DownloadTaskItem[]
  createdCount?: number
  failedCount?: number
  removedFiles?: number
}

type ResolvedSongItem = {
  id?: string
  name?: string
  artist?: string
  album?: string
  year?: number
  durationMs?: number
  coverUrl?: string
}

type ResolvedPlaylistTrack = {
  name?: string
  artist?: string
  album?: string
  durationMs?: number
}

type ResolvedPlaylistItem = {
  id?: string
  name?: string
  creator?: string
  description?: string
  coverUrl?: string
  tags?: string[]
  playCount?: number
  trackCount?: number
  tracks?: ResolvedPlaylistTrack[]
}

type DownloadManagerDom = {
  songPreview?: HTMLElement
  playlistPreview?: HTMLElement
  qualitySelect?: HTMLSelectElement
  songIdInput?: HTMLInputElement
  playlistIdInput?: HTMLInputElement
  songResolveBtn?: HTMLElement
  playlistResolveBtn?: HTMLElement
  songOnlyBtn?: HTMLElement
  songTempQueueBtn?: HTMLElement
  songAndQueueBtn?: HTMLElement
  playlistOnlyBtn?: HTMLElement
  playlistAndQueueBtn?: HTMLElement
  playlistAndSaveBtn?: HTMLElement
  openSongsDirBtn?: HTMLElement
  openTempDirBtn?: HTMLElement
  openListsDirBtn?: HTMLElement
  clearTempBtn?: HTMLElement
  taskFilterSelect?: HTMLSelectElement
  taskList?: HTMLElement
}

type DownloadManagerOptions = {
  electronAPI?: {
    neteaseResolveId?: (payload: { type: 'song' | 'playlist'; id: string }) => Promise<{ ok?: boolean; item?: ResolvedSongItem | ResolvedPlaylistItem }>
    neteaseDownloadSongTask?: (payload: Record<string, unknown>) => Promise<DownloadTaskResult>
    neteaseDownloadPlaylistById?: (payload: Record<string, unknown>) => Promise<DownloadTaskResult>
    neteaseDownloadTaskList?: () => Promise<{ ok?: boolean; tasks?: DownloadTaskItem[] }>
    neteaseDownloadTaskCancel?: (payload: { id: string }) => Promise<DownloadTaskResult>
    neteaseOpenDownloadDir?: (payload: { dirType: string }) => Promise<DownloadTaskResult>
    neteaseClearTempDownloads?: () => Promise<DownloadTaskResult>
    onNeteaseDownloadTaskUpdate?: (handler: (task: DownloadTaskItem) => void) => void
  }
  neteaseDatabaseService?: {
    resolveById?: (type: 'song' | 'playlist', id: string) => Promise<{ ok?: boolean; item?: ResolvedSongItem | ResolvedPlaylistItem }>
  }
  downloadService?: {
    createSongTask: (payload: Record<string, unknown>) => Promise<unknown>
    createPlaylistTasks: (payload: Record<string, unknown>) => Promise<unknown>
    loadTasks: () => Promise<unknown>
    cancelTask: (taskId: string) => Promise<unknown>
    openDir: (dirType: string) => Promise<unknown>
    clearTemp: () => Promise<unknown>
    onTaskUpdate: (handler: (task: DownloadTaskItem) => void) => void
  }
  dom?: DownloadManagerDom
  eventBus?: {
    emit: (eventName: string, payload?: unknown) => void
    request?: (eventName: string, payload?: unknown) => Promise<unknown>
  }
}

function formatTaskStatus(status: unknown): string {
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
      return String(status ?? '未知')
  }
}

function normalizeId(raw: unknown): string | null {
  const text = String(raw ?? '').trim()
  return /^\d{1,20}$/.test(text) ? text : null
}

export function createDownloadManager(options: DownloadManagerOptions): { init: () => void } {
  const {
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    dom,
    eventBus
  } = options || {}

  if (!dom) {
    return { init() {} }
  }
  const domSafe: DownloadManagerDom = dom

  const QUALITY_STORAGE_KEY = 'netease.download.quality.v1'
  const taskStateMap = new Map<string, DownloadTaskItem>()
  const handledQueueTaskIds = new Set<string>()
  const handledSaveTaskIds = new Set<string>()

  let resolvedSong: ResolvedSongItem | null = null
  let resolvedPlaylist: ResolvedPlaylistItem | null = null

  function emit(eventName: string, payload: unknown): void {
    if (!eventBus) return
    eventBus.emit(eventName, payload)
  }

  async function request(eventName: string, payload: unknown): Promise<unknown> {
    if (!eventBus?.request) return undefined
    return eventBus.request(eventName, payload)
  }

  function escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function formatDuration(durationMs: unknown): string {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs ?? 0) / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return totalSeconds > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : '--:--'
  }

  function formatCount(value: unknown): string {
    const numeric = Number(value ?? 0)
    if (!Number.isFinite(numeric) || numeric <= 0) return '0'
    return new Intl.NumberFormat('zh-CN').format(numeric)
  }

  function renderPreviewMessage(container: HTMLElement | undefined, text: unknown, isError: boolean = false): void {
    if (!container) return
    container.classList.remove('download-preview-rich')
    container.classList.toggle('is-error', isError)
    container.innerHTML = `<div class="download-preview-message">${escapeHtml(text)}</div>`
  }

  function buildMetaChips(values: unknown[]): string {
    return values
      .filter((value) => String(value || '').trim())
      .map((value) => `<span class="download-preview-chip">${escapeHtml(value)}</span>`)
      .join('')
  }

  function buildDetailRows(rows: Array<{ label: unknown; value: unknown }>): string {
    return rows
      .filter((row) => row && String(row.value || '').trim())
      .map((row) => `
        <div class="download-preview-detail-row">
          <span class="download-preview-detail-label">${escapeHtml(row.label)}</span>
          <span class="download-preview-detail-value">${escapeHtml(row.value)}</span>
        </div>
      `)
      .join('')
  }

  function buildTrackRows(tracks: ResolvedPlaylistTrack[], maxItems: number = 8): string {
    const items = Array.isArray(tracks) ? tracks.slice(0, maxItems) : []
    if (!items.length) return ''

    return `
      <div class="download-preview-track-list">
        ${items.map((track, index: number) => {
          const meta = [track.artist || '未知歌手', track.album || '未知专辑', formatDuration(track.durationMs)]
            .filter((value) => String(value || '').trim())
            .join(' · ')

          return `
            <div class="download-preview-track-item">
              <div class="download-preview-track-index">${index + 1}</div>
              <div class="download-preview-track-main">
                <div class="download-preview-track-title">${escapeHtml(track.name || '未知歌曲')}</div>
                <div class="download-preview-track-meta">${escapeHtml(meta)}</div>
              </div>
            </div>
          `
        }).join('')}
      </div>
    `
  }

  function renderRichPreview(container: HTMLElement | undefined, payload: {
    title?: unknown
    subtitle?: unknown
    coverUrl?: unknown
    chips?: unknown[]
    rows?: Array<{ label: unknown; value: unknown }>
    tracks?: ResolvedPlaylistTrack[]
    footnote?: unknown
  }): void {
    if (!container) return

    const {
      title,
      subtitle,
      coverUrl,
      chips = [],
      rows = [],
      tracks = [],
      footnote = ''
    } = payload || {}

    const safeTitle = escapeHtml(title || '未命名')
    const safeSubtitle = String(subtitle || '').trim()
    const safeCoverUrl = String(coverUrl || '').trim()

    container.classList.add('download-preview-rich')
    container.classList.remove('is-error')
    container.innerHTML = `
      <div class="download-preview-rich-inner">
        <div class="download-preview-cover${safeCoverUrl ? ' has-image' : ''}">
          ${safeCoverUrl
            ? `<img src="${escapeHtml(safeCoverUrl)}" alt="${safeTitle} 封面">`
            : '<span>♪</span>'}
        </div>
        <div class="download-preview-content">
          <div class="download-preview-title">${safeTitle}</div>
          ${safeSubtitle ? `<div class="download-preview-subtitle">${escapeHtml(safeSubtitle)}</div>` : ''}
          ${chips.length ? `<div class="download-preview-chips">${buildMetaChips(chips)}</div>` : ''}
          ${rows.length ? `<div class="download-preview-details">${buildDetailRows(rows)}</div>` : ''}
          ${tracks.length ? buildTrackRows(tracks) : ''}
          ${footnote ? `<div class="download-preview-footnote">${escapeHtml(footnote)}</div>` : ''}
        </div>
      </div>
    `
  }

  function renderSongPreviewCard(item: ResolvedSongItem): void {
    renderRichPreview(domSafe.songPreview, {
      title: item.name || `歌曲 ${item.id || ''}`,
      subtitle: item.artist || '未知歌手',
      coverUrl: item.coverUrl || '',
      chips: [item.album || '', item.year ? `${item.year} 年` : '', formatDuration(item.durationMs)],
      rows: [
        { label: '歌曲 ID', value: item.id || '' },
        { label: '专辑', value: item.album || '未知专辑' },
        { label: '时长', value: formatDuration(item.durationMs) },
        { label: '来源', value: '网易云单曲查询' }
      ]
    })
  }

  function renderPlaylistPreviewCard(item: ResolvedPlaylistItem): void {
    const remainingCount = Math.max(0, Number(item.trackCount || 0) - Math.min(Array.isArray(item.tracks) ? item.tracks.length : 0, 8))
    const tagText = Array.isArray(item.tags) ? item.tags.join(' / ') : ''

    renderRichPreview(domSafe.playlistPreview, {
      title: item.name || `歌单 ${item.id || ''}`,
      subtitle: item.creator ? `创建者: ${item.creator}` : '创建者未知',
      coverUrl: item.coverUrl || '',
      chips: [
        `${formatCount(item.trackCount)} 首`,
        item.playCount ? `${formatCount(item.playCount)} 次播放` : '',
        tagText
      ],
      rows: [
        { label: '歌单 ID', value: item.id || '' },
        { label: '创建者', value: item.creator || '未知' },
        { label: '标签', value: tagText || '未提供' },
        { label: '简介', value: item.description || '暂无简介' }
      ],
      tracks: Array.isArray(item.tracks) ? item.tracks : [],
      footnote: remainingCount > 0 ? `当前展示前 8 首，剩余 ${remainingCount} 首会在下载时一并处理。` : ''
    })
  }

  function setSongPreview(text: unknown, isError: boolean = false): void {
    renderPreviewMessage(domSafe.songPreview, text, isError)
  }

  function setPlaylistPreview(text: unknown, isError: boolean = false): void {
    renderPreviewMessage(domSafe.playlistPreview, text, isError)
  }

  function getCurrentQuality(): string {
    return domSafe.qualitySelect ? String(domSafe.qualitySelect.value || 'exhigh') : 'exhigh'
  }

  function persistQuality(): void {
    if (!domSafe.qualitySelect) return
    localStorage.setItem(QUALITY_STORAGE_KEY, getCurrentQuality())
  }

  function restoreQuality(): void {
    if (!domSafe.qualitySelect) return
    const cached = String(localStorage.getItem(QUALITY_STORAGE_KEY) || '').trim()
    if (!cached) return
    const hasOption = Array.from(domSafe.qualitySelect.options).some((item) => item.value === cached)
    if (hasOption) domSafe.qualitySelect.value = cached
  }

  async function resolveSong(): Promise<void> {
    const songId = normalizeId(domSafe.songIdInput?.value)
    if (!songId) {
      setSongPreview('请输入有效歌曲 ID。', true)
      return
    }

    setSongPreview('正在查询歌曲...')
    const res = neteaseDatabaseService?.resolveById
      ? await neteaseDatabaseService.resolveById('song', songId)
      : await electronAPI?.neteaseResolveId?.({ type: 'song', id: songId })
    if (!res?.ok || !res.item) {
      resolvedSong = null
      setSongPreview('歌曲查询失败，可能 ID 不存在或请求受限。', true)
      return
    }

    resolvedSong = res.item
    renderSongPreviewCard(res.item)
  }

  async function resolvePlaylist(): Promise<void> {
    const playlistId = normalizeId(domSafe.playlistIdInput?.value)
    if (!playlistId) {
      setPlaylistPreview('请输入有效歌单 ID。', true)
      return
    }

    setPlaylistPreview('正在查询歌单...')
    const res = neteaseDatabaseService?.resolveById
      ? await neteaseDatabaseService.resolveById('playlist', playlistId)
      : await electronAPI?.neteaseResolveId?.({ type: 'playlist', id: playlistId })
    if (!res?.ok || !res.item) {
      resolvedPlaylist = null
      setPlaylistPreview('歌单查询失败，可能 ID 不存在或请求受限。', true)
      return
    }

    resolvedPlaylist = res.item
    renderPlaylistPreviewCard(res.item)
  }

  function updateTask(task: DownloadTaskItem): void {
    if (!task?.id) return
    taskStateMap.set(task.id, task)
    renderTasks()
    handlePostTaskHooks(task)
  }

  async function handlePostTaskHooks(task: DownloadTaskItem): Promise<void> {
    if (task.status !== 'succeeded') return

    if (task.addToQueue && !handledQueueTaskIds.has(task.id)) {
      handledQueueTaskIds.add(task.id)
      emit('playback:queue.append', {
        tracks: [{
          path: task.filePath,
          name: task.title || task.songId || '网易云下载',
          file: null
        }]
      })
    }

    const savePlaylistName = String(task.savePlaylistName || '').trim()
    if (!savePlaylistName || handledSaveTaskIds.has(task.id)) return

    handledSaveTaskIds.add(task.id)
    const playlistKey = String(task.savePlaylistBatchKey || savePlaylistName).trim()
    const playlistId = await request('playlist:ensure-by-name', {
      name: savePlaylistName,
      playlistKey
    })
    if (!playlistId) return

    await request('playlist:add-track', {
      playlistId,
      track: {
        path: task.filePath,
        title: task.songMetadata?.title || task.title || '网易云下载',
        artist: task.songMetadata?.artist || '',
        album: task.songMetadata?.album || '',
        duration: null
      }
    })
  }

  function shouldShowTask(task: DownloadTaskItem, filter: string): boolean {
    if (filter === 'all') return true
    if (filter === 'active') {
      return task.status === 'pending' || task.status === 'downloading'
    }
    return task.status === filter
  }

  function renderTasks(): void {
    if (!domSafe.taskList) return

    const filter = domSafe.taskFilterSelect ? domSafe.taskFilterSelect.value : 'all'
    const tasks = Array.from(taskStateMap.values())
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .filter((item) => shouldShowTask(item, filter))

    if (!tasks.length) {
      domSafe.taskList.innerHTML = '<div class="netease-task-empty">暂无下载任务</div>'
      return
    }

    domSafe.taskList.innerHTML = tasks.map((task) => {
      const totalBytes = Number(task.totalBytes || 0)
      const receivedBytes = Number(task.receivedBytes || 0)
      const progress = totalBytes > 0
        ? `${Math.round((receivedBytes / totalBytes) * 100)}%`
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

  async function loadTasks(): Promise<void> {
    const res = (downloadService
      ? await downloadService.loadTasks()
      : await electronAPI?.neteaseDownloadTaskList?.()) as { ok?: boolean; tasks?: DownloadTaskItem[] } | undefined
    if (!res?.ok || !Array.isArray(res.tasks)) return

    taskStateMap.clear()
    for (const task of res.tasks) {
      taskStateMap.set(task.id, task)
      handlePostTaskHooks(task)
    }
    renderTasks()
  }

  async function createSongTask(mode: string): Promise<void> {
    const songId = normalizeId(domSafe.songIdInput?.value)
    if (!songId) {
      setSongPreview('请输入有效歌曲 ID。', true)
      return
    }

    persistQuality()
    const level = getCurrentQuality()
    const payload = {
      songId,
      level,
      mode,
      title: resolvedSong?.name || `歌曲 ${songId}`,
      fileName: `${songId}-${level}`,
      duplicateStrategy: 'skip'
    }

    const res = (downloadService
      ? await downloadService.createSongTask(payload)
      : await electronAPI?.neteaseDownloadSongTask?.(payload)) as DownloadTaskResult | undefined

    if (!res?.ok || !res.task) {
      setSongPreview(`创建下载任务失败: ${res?.message || res?.error || 'UNKNOWN'}`, true)
      return
    }

    updateTask(res.task)
    setSongPreview(`任务已创建: ${res.task.id}`)
  }

  async function createPlaylistTasks(mode: string): Promise<void> {
    const playlistId = normalizeId(domSafe.playlistIdInput?.value)
    if (!playlistId) {
      setPlaylistPreview('请输入有效歌单 ID。', true)
      return
    }

    persistQuality()
    const level = getCurrentQuality()
    const payload = {
      playlistId,
      level,
      mode,
      duplicateStrategy: 'skip'
    }

    const res = (downloadService
      ? await downloadService.createPlaylistTasks(payload)
      : await electronAPI?.neteaseDownloadPlaylistById?.(payload)) as DownloadTaskResult | undefined

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

  async function cancelTask(taskId: string): Promise<void> {
    if (!taskId) return
    const res = (downloadService
      ? await downloadService.cancelTask(taskId)
      : await electronAPI?.neteaseDownloadTaskCancel?.({ id: taskId })) as DownloadTaskResult | undefined
    if (res?.ok && res.task) {
      updateTask(res.task)
    }
  }

  async function openDir(dirType: string): Promise<void> {
    const res = (downloadService
      ? await downloadService.openDir(dirType)
      : await electronAPI?.neteaseOpenDownloadDir?.({ dirType })) as DownloadTaskResult | undefined
    if (!res?.ok) {
      emit('toast:push', { level: 'error', message: `打开目录失败: ${res?.message || res?.error || 'UNKNOWN'}` })
    }
  }

  async function clearTemp(): Promise<void> {
    const res = (downloadService
      ? await downloadService.clearTemp()
      : await electronAPI?.neteaseClearTempDownloads?.()) as DownloadTaskResult | undefined
    if (!res?.ok) {
      emit('toast:push', { level: 'error', message: `清理缓存失败: ${res?.message || res?.error || 'UNKNOWN'}` })
      return
    }

    emit('toast:push', { level: 'info', message: `已清理缓存歌曲 ${res.removedFiles || 0} 首` })
  }

  function bindEvents(): void {
    domSafe.songResolveBtn?.addEventListener('click', resolveSong)
    domSafe.playlistResolveBtn?.addEventListener('click', resolvePlaylist)

    domSafe.songOnlyBtn?.addEventListener('click', () => createSongTask('song-download-only'))
    domSafe.songTempQueueBtn?.addEventListener('click', () => createSongTask('song-temp-queue-only'))
    domSafe.songAndQueueBtn?.addEventListener('click', () => createSongTask('song-download-and-queue'))

    domSafe.playlistOnlyBtn?.addEventListener('click', () => createPlaylistTasks('playlist-download-only'))
    domSafe.playlistAndQueueBtn?.addEventListener('click', () => createPlaylistTasks('playlist-download-and-queue'))
    domSafe.playlistAndSaveBtn?.addEventListener('click', () => createPlaylistTasks('playlist-download-and-save'))

    domSafe.openSongsDirBtn?.addEventListener('click', () => openDir('songs'))
    domSafe.openTempDirBtn?.addEventListener('click', () => openDir('temp'))
    domSafe.openListsDirBtn?.addEventListener('click', () => openDir('lists'))
    domSafe.clearTempBtn?.addEventListener('click', clearTemp)

    domSafe.qualitySelect?.addEventListener('change', persistQuality)
    domSafe.taskFilterSelect?.addEventListener('change', renderTasks)

    domSafe.songIdInput?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        resolveSong()
      }
    })

    domSafe.playlistIdInput?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        resolvePlaylist()
      }
    })

    domSafe.taskList?.addEventListener('click', (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.dataset.action !== 'cancel-task') return
      const parent = target.closest('[data-task-id]')
      if (!parent) return
      const taskId = parent.getAttribute('data-task-id')
      if (taskId) cancelTask(taskId)
    })
  }

  function init(): void {
    restoreQuality()
    bindEvents()
    loadTasks()

    if (downloadService) {
      downloadService.onTaskUpdate((task: DownloadTaskItem) => {
        updateTask(task)
      })
    } else if (electronAPI?.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task: DownloadTaskItem) => {
        updateTask(task)
      })
    }
  }

  return { init }
}
