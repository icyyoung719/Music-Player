export function createDownloadService(options = {}) {
  const {
    electronAPI,
    eventBus
  } = options

  const taskStateMap = new Map()
  const listeners = new Set()

  function notify(task) {
    if (!task?.id) return
    taskStateMap.set(task.id, task)

    for (const listener of Array.from(listeners)) {
      try {
        listener(task)
      } catch (err) {
        console.warn('Download service listener failed:', err)
      }
    }

    if (eventBus) {
      eventBus.emit('download:task.updated', { task })
    }
  }

  function onTaskUpdate(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getTasks() {
    return Array.from(taskStateMap.values())
  }

  async function loadTasks() {
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

  async function createSongTask(payload) {
    if (!electronAPI?.neteaseDownloadSongTask) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadSongTask(payload)
    if (res?.task) {
      notify(res.task)
    }
    return res
  }

  async function createSongTaskById(payload) {
    if (!electronAPI?.neteaseDownloadBySongId) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadBySongId(payload)
    if (res?.task) {
      notify(res.task)
    }
    return res
  }

  async function createPlaylistTasks(payload) {
    if (!electronAPI?.neteaseDownloadPlaylistById) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadPlaylistById(payload)
    if (Array.isArray(res?.tasks)) {
      for (const task of res.tasks) {
        notify(task)
      }
    }
    return res
  }

  async function cancelTask(taskId) {
    if (!electronAPI?.neteaseDownloadTaskCancel) return { ok: false, error: 'API_UNAVAILABLE' }
    const res = await electronAPI.neteaseDownloadTaskCancel({ id: taskId })
    if (res?.task) {
      notify(res.task)
    }
    return res
  }

  async function openDir(dirType) {
    if (!electronAPI?.neteaseOpenDownloadDir) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseOpenDownloadDir({ dirType })
  }

  async function clearTemp() {
    if (!electronAPI?.neteaseClearTempDownloads) return { ok: false, error: 'API_UNAVAILABLE' }
    return electronAPI.neteaseClearTempDownloads()
  }

  function init() {
    if (electronAPI?.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        notify(task)
      })
    }
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