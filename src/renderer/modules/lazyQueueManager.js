function isLazyNeteaseTrack(track) {
  return Boolean(track?.lazyNetease?.songId)
}

function buildLazySongTaskPayload(track) {
  const source = track?.lazyNetease || {}
  const level = String(source.level || 'exhigh')
  const safeName = String(source.title || track?.name || source.songId || 'netease-track')
    .replace(/[\\/:*?"<>|]/g, '_')

  return {
    songId: String(source.songId || ''),
    level: String(source.level || 'exhigh'),
    mode: 'song-temp-queue-only',
    silentToast: true,
    title: String(source.title || track?.name || ''),
    fileName: `${safeName || source.songId}-${level}`
  }
}

export function createLazyQueueManager(options = {}) {
  const {
    electronAPI,
    getPlaylist,
    getCurrentIndex,
    onTrackReady
  } = options

  const taskIndexMap = new Map()
  const waitersByIndex = new Map()

  function markTrackState(index, nextState, taskId = '') {
    const playlist = getPlaylist()
    const track = playlist[index]
    if (!isLazyNeteaseTrack(track)) return

    track.lazyNetease.state = String(nextState || track.lazyNetease.state || 'idle')
    track.lazyNetease.taskId = taskId ? String(taskId) : String(track.lazyNetease.taskId || '')
  }

  function resolveWaiters(index, ok) {
    const waiters = waitersByIndex.get(index)
    if (!waiters || !waiters.length) {
      waitersByIndex.delete(index)
      return
    }

    for (const waiter of waiters) {
      try {
        waiter(Boolean(ok))
      } catch {
        // Ignore waiter callback errors.
      }
    }

    waitersByIndex.delete(index)
  }

  function waitForTrackReady(index, timeoutMs = 60000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false)
      }, timeoutMs)

      const wrappedResolve = (ok) => {
        clearTimeout(timer)
        resolve(Boolean(ok))
      }

      const waiters = waitersByIndex.get(index) || []
      waiters.push(wrappedResolve)
      waitersByIndex.set(index, waiters)
    })
  }

  function applyResolvedTask(index, task) {
    const playlist = getPlaylist()
    const track = playlist[index]
    if (!track || !isLazyNeteaseTrack(track)) return false
    if (!task?.filePath) return false

    track.path = task.filePath
    track.file = null
    markTrackState(index, 'succeeded', task.id || '')

    if (task.songMetadata && typeof task.songMetadata === 'object') {
      track.metadataCache = {
        title: task.songMetadata.title || track.name,
        artist: task.songMetadata.artist || track.metadataCache?.artist || null,
        album: task.songMetadata.album || track.metadataCache?.album || null,
        duration: track.metadataCache?.duration || null
      }
    }

    return true
  }

  async function ensureTrackReadyForPlayback(index, options = {}) {
    const playlist = getPlaylist()
    const track = playlist[index]
    if (!track) return false
    if (!isLazyNeteaseTrack(track)) {
      return Boolean(track.path || track.file)
    }

    if (track.path || track.file) {
      markTrackState(index, 'succeeded', track.lazyNetease.taskId || '')
      return true
    }

    if (!electronAPI?.neteaseDownloadSongTask) return false

    const waitForReady = options.waitForReady !== false
    if (track.lazyNetease.state === 'downloading') {
      if (!waitForReady) return false
      return waitForTrackReady(index)
    }

    if (track.lazyNetease.state === 'failed' && !waitForReady) {
      return false
    }

    markTrackState(index, 'downloading')
    const taskRes = await electronAPI.neteaseDownloadSongTask(buildLazySongTaskPayload(track))
    if (!taskRes?.ok || !taskRes?.task?.id) {
      markTrackState(index, 'failed')
      resolveWaiters(index, false)
      return false
    }

    const task = taskRes.task
    markTrackState(index, task.status === 'failed' ? 'failed' : 'downloading', task.id)
    taskIndexMap.set(task.id, index)

    if (task.status === 'succeeded' || task.status === 'skipped') {
      const ok = applyResolvedTask(index, task)
      taskIndexMap.delete(task.id)
      resolveWaiters(index, ok)
      if (ok && typeof onTrackReady === 'function') {
        onTrackReady(index)
      }
      return ok
    }

    if (!waitForReady) {
      return false
    }

    return waitForTrackReady(index)
  }

  function maybePrefetchNextLazyTrack() {
    const playlist = getPlaylist()
    const nextIndex = getCurrentIndex() + 1
    if (nextIndex < 0 || nextIndex >= playlist.length) return

    const nextTrack = playlist[nextIndex]
    if (!isLazyNeteaseTrack(nextTrack)) return
    if (nextTrack.path || nextTrack.file) return
    if (nextTrack.lazyNetease.state === 'downloading' || nextTrack.lazyNetease.state === 'succeeded') return

    ensureTrackReadyForPlayback(nextIndex, { waitForReady: false }).catch(() => {})
  }

  function handleLazyDownloadTaskUpdate(task) {
    const taskId = String(task?.id || '')
    if (!taskId) return
    if (!taskIndexMap.has(taskId)) return

    const index = taskIndexMap.get(taskId)
    const playlist = getPlaylist()
    const track = playlist[index]
    if (!track || !isLazyNeteaseTrack(track)) {
      taskIndexMap.delete(taskId)
      resolveWaiters(index, false)
      return
    }

    if (task.status === 'succeeded' || task.status === 'skipped') {
      const ok = applyResolvedTask(index, task)
      taskIndexMap.delete(taskId)
      resolveWaiters(index, ok)
      if (ok && typeof onTrackReady === 'function') {
        onTrackReady(index)
      }
      return
    }

    if (task.status === 'failed' || task.status === 'canceled') {
      markTrackState(index, 'failed', taskId)
      taskIndexMap.delete(taskId)
      resolveWaiters(index, false)
    }
  }

  function reset() {
    for (const index of Array.from(waitersByIndex.keys())) {
      resolveWaiters(index, false)
    }
    taskIndexMap.clear()
  }

  function removeTrack(index) {
    resolveWaiters(index, false)
  }

  return {
    ensureTrackReadyForPlayback,
    maybePrefetchNextLazyTrack,
    handleLazyDownloadTaskUpdate,
    reset,
    removeTrack
  }
}