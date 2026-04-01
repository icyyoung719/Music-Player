import type { EventBus, Unsubscribe } from './eventBus.js'

type DownloadTask = {
  id: string
  [key: string]: unknown
}

type DownloadServiceListener = (task: DownloadTask) => void

type ServiceErrorCode = 'API_UNAVAILABLE'

type ServiceErrorResult = {
  ok: false
  error: ServiceErrorCode
}

type DownloadTaskListResult =
  | {
      ok: true
      tasks: DownloadTask[]
    }
  | ServiceErrorResult

type DownloadTaskResult =
  | {
      ok: true
      task?: DownloadTask
      tasks?: DownloadTask[]
      [key: string]: unknown
    }
  | ServiceErrorResult

type DownloadApi = {
  neteaseDownloadTaskList?: () => Promise<DownloadTaskListResult>
  neteaseDownloadSongTask?: (payload: unknown) => Promise<DownloadTaskResult>
  neteaseDownloadBySongId?: (payload: unknown) => Promise<DownloadTaskResult>
  neteaseDownloadPlaylistById?: (payload: unknown) => Promise<DownloadTaskResult>
  neteaseDownloadTaskCancel?: (payload: { id: string }) => Promise<DownloadTaskResult>
  neteaseOpenDownloadDir?: (payload: { dirType: string }) => Promise<unknown>
  neteaseClearTempDownloads?: () => Promise<unknown>
  onNeteaseDownloadTaskUpdate?: (listener: (task: DownloadTask) => void) => Unsubscribe
}

type DownloadServiceOptions = {
  electronAPI?: DownloadApi
  eventBus?: EventBus
}

function createApiUnavailable(): ServiceErrorResult {
  return { ok: false, error: 'API_UNAVAILABLE' }
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

    eventBus?.emit('download:task.updated', { task })
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

  async function loadTasks(): Promise<DownloadTaskListResult> {
    if (!electronAPI?.neteaseDownloadTaskList) return createApiUnavailable()
    const res = await electronAPI.neteaseDownloadTaskList()
    if (res?.ok && Array.isArray(res.tasks)) {
      taskStateMap.clear()
      for (const task of res.tasks) {
        notify(task)
      }
    }
    return res
  }

  async function createSongTask(payload: unknown): Promise<DownloadTaskResult> {
    if (!electronAPI?.neteaseDownloadSongTask) return createApiUnavailable()
    const res = await electronAPI.neteaseDownloadSongTask(payload)
    if (res.ok && res.task) {
      notify(res.task)
    }
    return res
  }

  async function createSongTaskById(payload: unknown): Promise<DownloadTaskResult> {
    if (!electronAPI?.neteaseDownloadBySongId) return createApiUnavailable()
    const res = await electronAPI.neteaseDownloadBySongId(payload)
    if (res.ok && res.task) {
      notify(res.task)
    }
    return res
  }

  async function createPlaylistTasks(payload: unknown): Promise<DownloadTaskResult> {
    if (!electronAPI?.neteaseDownloadPlaylistById) return createApiUnavailable()
    const res = await electronAPI.neteaseDownloadPlaylistById(payload)
    if (res.ok && Array.isArray(res.tasks)) {
      for (const task of res.tasks) {
        notify(task)
      }
    }
    return res
  }

  async function cancelTask(taskId: string): Promise<DownloadTaskResult> {
    if (!electronAPI?.neteaseDownloadTaskCancel) return createApiUnavailable()
    const res = await electronAPI.neteaseDownloadTaskCancel({ id: taskId })
    if (res.ok && res.task) {
      notify(res.task)
    }
    return res
  }

  async function openDir(dirType: string): Promise<unknown> {
    if (!electronAPI?.neteaseOpenDownloadDir) return createApiUnavailable()
    return electronAPI.neteaseOpenDownloadDir({ dirType })
  }

  async function clearTemp(): Promise<unknown> {
    if (!electronAPI?.neteaseClearTempDownloads) return createApiUnavailable()
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
