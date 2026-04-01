type Unsubscribe = () => void

type DownloadTask = {
  id?: string
  [key: string]: unknown
}

type DownloadServiceListener = (task: DownloadTask) => void

type DownloadApi = {
  neteaseDownloadTaskList?: () => Promise<any>
  neteaseDownloadSongTask?: (payload: unknown) => Promise<any>
  neteaseDownloadBySongId?: (payload: unknown) => Promise<any>
  neteaseDownloadPlaylistById?: (payload: unknown) => Promise<any>
  neteaseDownloadTaskCancel?: (payload: { id: string }) => Promise<any>
  neteaseOpenDownloadDir?: (payload: { dirType: string }) => Promise<any>
  neteaseClearTempDownloads?: () => Promise<any>
  onNeteaseDownloadTaskUpdate?: (listener: (task: DownloadTask) => void) => void
}

type EventBusLike = {
  emit?: (eventName: string, payload?: unknown) => void
}

type DownloadServiceOptions = {
  electronAPI?: DownloadApi
  eventBus?: EventBusLike
}

export function createDownloadService(options: DownloadServiceOptions = {}) {
  const { electronAPI, eventBus } = options

  const taskStateMap = new Map<string, DownloadTask>()
  const listeners = new Set<DownloadServiceListener>()

  function notify(task: DownloadTask): void {
    if (!task?.id) return
    taskStateMap.set(task.id, task)

    for (const listener of Array.from(listeners)) {
      try {
        listener(task)
      } catch (err) {
        console.warn('Download service listener failed:', err)
      }
    }

    eventBus?.emit?.('download:task.updated', { task })
  }

  function onTaskUpdate(listener: DownloadServiceListener): Unsubscribe {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getTasks(): DownloadTask[] {
    return Array.from(taskStateMap.values())
  }

  async function loadTasks(): Promise<any> {
    if (!electronAPI?.neteaseDownloadTaskList) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadTaskList()
    if (res?.ok && Array.isArray(res.tasks)) {
      taskStateMap.clear()
      for (const task of res.tasks) {
        notify(task)
      }
    }
    return res
  }

  async function createSongTask(payload: unknown): Promise<any> {
    if (!electronAPI?.neteaseDownloadSongTask) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadSongTask(payload)
    if (res?.task) {
      notify(res.task)
    }
    return res
  }

  async function createSongTaskById(payload: unknown): Promise<any> {
    if (!electronAPI?.neteaseDownloadBySongId) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadBySongId(payload)
    if (res?.task) {
      notify(res.task)
    }
    return res
  }

  async function createPlaylistTasks(payload: unknown): Promise<any> {
    if (!electronAPI?.neteaseDownloadPlaylistById) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadPlaylistById(payload)
    if (Array.isArray(res?.tasks)) {
      for (const task of res.tasks) {
        notify(task)
      }
    }
    return res
  }

  async function cancelTask(taskId: string): Promise<any> {
    if (!electronAPI?.neteaseDownloadTaskCancel) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadTaskCancel({ id: taskId })
    if (res?.task) {
      notify(res.task)
    }
    return res
  }

  async function openDir(dirType: string): Promise<any> {
    if (!electronAPI?.neteaseOpenDownloadDir) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseOpenDownloadDir({ dirType })
  }

  async function clearTemp(): Promise<any> {
    if (!electronAPI?.neteaseClearTempDownloads) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseClearTempDownloads()
  }

  function init(): void {
    electronAPI?.onNeteaseDownloadTaskUpdate?.((task) => {
      notify(task)
    })
  }

  return {
    init,
    onTaskUpdate,
    getTasks,
    loadTasks,
    createSongTask,
    createSongTaskById,
    createPlaylistTasks,
    cancelTask,
    openDir,
    clearTemp
  }
}
