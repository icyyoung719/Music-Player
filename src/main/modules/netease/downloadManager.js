const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const os = require('os')
const { BrowserWindow } = require('electron')
const { buildAuthHeaders, ensureAuthStateLoaded } = require('./authManager')
const {
  resolveSongUrlWithLevelFallback,
  fetchSongMetadataById,
  isNeteaseAudioHost,
  sanitizeSongId,
  resolveAudioExtByResolvedUrl
} = require('./neteaseApi')
const { persistTrackMetadataForTask } = require('./trackMetadata')

const MAX_DOWNLOAD_CONCURRENCY = 2
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'MyPlayerDownloads')
const DOWNLOAD_DIR_SONGS = 'Songs'
const DOWNLOAD_DIR_TEMP = 'Temp'
const DOWNLOAD_DIR_LISTS = 'Lists'

const downloadTasks = new Map()
const pendingTaskIds = []
const activeDownloadHandles = new Map()
let activeDownloadCount = 0

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function createTaskId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeFileName(name) {
  return String(name || 'download')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'download'
}

function safeFolderName(name, fallback = 'default') {
  const value = safeFileName(name || fallback)
  return value || fallback
}

function maybeAddFileExt(fileName, url) {
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(fileName)
  if (hasExt) return fileName
  try {
    const pathname = new URL(url).pathname || ''
    const ext = path.extname(pathname)
    if (ext) return `${fileName}${ext}`
  } catch {
    return fileName
  }
  return fileName
}

function isAllowedDownloadHost(rawUrl) {
  return isNeteaseAudioHost(rawUrl)
}

function shouldEmitTaskToast(task) {
  return !Boolean(task?.silentToast)
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

function emitGlobalToast(payload) {
  const message = String(payload?.message || '').trim()
  if (!message) return

  const toastPayload = {
    id: createTaskId(),
    message,
    level: String(payload?.level || 'info'),
    createdAt: Date.now(),
    ...payload
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:toast', toastPayload)
    }
  }
}

function emitDownloadTaskUpdate(task) {
  const payload = { ...task }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('netease:download-task-updated', payload)
    }
  }
}

function listDownloadTasks() {
  return Array.from(downloadTasks.values()).sort((a, b) => b.createdAt - a.createdAt)
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function getDownloadRootDir() {
  return DEFAULT_DOWNLOAD_DIR
}

function resolveDownloadDir(dirType, playlistName) {
  const type = String(dirType || 'songs').trim().toLowerCase()
  const rootDir = getDownloadRootDir()

  if (type === 'temp') {
    return { dirType: 'temp', dirPath: path.join(rootDir, DOWNLOAD_DIR_TEMP) }
  }

  if (type === 'lists') {
    const child = safeFolderName(playlistName || '未命名歌单', '未命名歌单')
    return {
      dirType: 'lists',
      dirPath: path.join(rootDir, DOWNLOAD_DIR_LISTS, child),
      playlistFolder: child
    }
  }

  return { dirType: 'songs', dirPath: path.join(rootDir, DOWNLOAD_DIR_SONGS) }
}

async function ensureDownloadBaseDirs() {
  const root = getDownloadRootDir()
  const songsDir = resolveDownloadDir('songs').dirPath
  const tempDir = resolveDownloadDir('temp').dirPath
  const listsDir = path.join(root, DOWNLOAD_DIR_LISTS)

  await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.mkdir(songsDir, { recursive: true })
  await fs.promises.mkdir(tempDir, { recursive: true })
  await fs.promises.mkdir(listsDir, { recursive: true })

  return {
    root,
    songs: songsDir,
    temp: tempDir,
    lists: listsDir
  }
}

async function countFilesRecursive(targetDir) {
  let count = 0
  const stack = [targetDir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        count++
      }
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Task creation helpers
// ---------------------------------------------------------------------------

function createSkippedTask(payload) {
  const id = createTaskId()
  const now = Date.now()
  return {
    id,
    source: payload.source || 'song-id',
    songId: payload.songId || '',
    title: payload.title || payload.fileName || `song-${payload.songId || now}`,
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : null,
    url: payload.url,
    filePath: payload.filePath,
    status: 'skipped',
    progress: 1,
    totalBytes: 0,
    receivedBytes: 0,
    error: payload.error || '',
    skipReason: payload.skipReason || 'duplicate',
    downloadMode: payload.downloadMode || 'song-download-only',
    targetDirType: payload.targetDirType || 'songs',
    playlistContext:
      payload.playlistContext && typeof payload.playlistContext === 'object'
        ? payload.playlistContext
        : null,
    addToQueue: Boolean(payload.addToQueue),
    silentToast: Boolean(payload.silentToast),
    savePlaylistName: String(payload.savePlaylistName || '').trim(),
    savePlaylistBatchKey: String(payload.savePlaylistBatchKey || '').trim(),
    createdAt: now,
    updatedAt: now,
    finishedAt: now
  }
}

// ---------------------------------------------------------------------------
// Download execution
// ---------------------------------------------------------------------------

function startDownloadWithProgress(task) {
  return new Promise((resolve, reject) => {
    let redirected = 0

    const run = (targetUrl) => {
      const client = targetUrl.startsWith('https:') ? https : http
      const req = client.get(
        targetUrl,
        {
          headers: buildAuthHeaders()
        },
        (res) => {
          if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            if (redirected >= 4) {
              reject(new Error('TOO_MANY_REDIRECTS'))
              res.resume()
              return
            }

            redirected++
            const nextUrl = new URL(res.headers.location, targetUrl).toString()
            res.resume()
            run(nextUrl)
            return
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP_${res.statusCode || 'UNKNOWN'}`))
            res.resume()
            return
          }

          const totalBytes = Number(res.headers['content-length'] || 0)
          let receivedBytes = 0
          const stream = fs.createWriteStream(task.filePath)
          activeDownloadHandles.set(task.id, { request: req, stream })

          res.on('data', (chunk) => {
            receivedBytes += chunk.length
            task.receivedBytes = receivedBytes
            task.totalBytes = totalBytes
            task.progress = totalBytes > 0 ? receivedBytes / totalBytes : 0
            task.updatedAt = Date.now()
            emitDownloadTaskUpdate(task)
          })

          res.pipe(stream)

          stream.on('finish', () => {
            stream.close(() => resolve(task.filePath))
          })

          stream.on('error', (err) => {
            stream.close(() => reject(err))
          })
        }
      )

      req.on('error', reject)
      req.setTimeout(60000, () => {
        req.destroy(new Error('DOWNLOAD_TIMEOUT'))
      })
    }

    run(task.url)
  })
}

async function runSingleTask(taskId) {
  const task = downloadTasks.get(taskId)
  if (!task || task.status !== 'pending') return

  task.status = 'downloading'
  task.startedAt = Date.now()
  task.updatedAt = Date.now()
  emitDownloadTaskUpdate(task)

  try {
    await fs.promises.mkdir(path.dirname(task.filePath), { recursive: true })
    await startDownloadWithProgress(task)

    task.status = 'succeeded'
    task.progress = 1
    task.finishedAt = Date.now()
    task.updatedAt = Date.now()
    await persistTrackMetadataForTask(task)
    emitDownloadTaskUpdate(task)
    if (shouldEmitTaskToast(task)) {
      emitGlobalToast({
        level: 'success',
        message: `下载完成: ${task.title || task.songId || path.basename(task.filePath || '')}`,
        taskId: task.id,
        taskStatus: task.status
      })
    }
  } catch (err) {
    const isCanceled = task.status === 'canceled'
    if (!isCanceled) {
      task.status = 'failed'
      task.error = err?.message || 'DOWNLOAD_FAILED'
      task.finishedAt = Date.now()
      task.updatedAt = Date.now()
      emitDownloadTaskUpdate(task)
      if (shouldEmitTaskToast(task)) {
        emitGlobalToast({
          level: 'error',
          message: `下载失败: ${task.title || task.songId || task.id}`,
          taskId: task.id,
          taskStatus: task.status,
          error: task.error
        })
      }
    }
  } finally {
    activeDownloadHandles.delete(taskId)
  }
}

async function consumeDownloadQueue() {
  while (activeDownloadCount < MAX_DOWNLOAD_CONCURRENCY && pendingTaskIds.length > 0) {
    const nextTaskId = pendingTaskIds.shift()
    activeDownloadCount++

    runSingleTask(nextTaskId)
      .catch(() => {})
      .finally(() => {
        activeDownloadCount = Math.max(0, activeDownloadCount - 1)
        consumeDownloadQueue()
      })
  }
}

async function createDownloadTask(payload) {
  await ensureDownloadBaseDirs()

  const fileNameInput = safeFileName(payload.fileName || `song-${payload.songId || Date.now()}`)
  const finalFileName = maybeAddFileExt(fileNameInput, payload.url)
  const dirResolved = resolveDownloadDir(payload.targetDirType, payload.playlistName)
  await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
  const filePath = path.join(dirResolved.dirPath, finalFileName)

  const duplicateStrategy = String(payload.duplicateStrategy || 'skip').trim().toLowerCase()
  if (duplicateStrategy === 'skip') {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
      const skippedTask = createSkippedTask({
        ...payload,
        filePath,
        fileName: finalFileName,
        skipReason: 'duplicate-file',
        targetDirType: dirResolved.dirType,
        playlistContext: payload.playlistContext
      })

      downloadTasks.set(skippedTask.id, skippedTask)
      emitDownloadTaskUpdate(skippedTask)
      if (shouldEmitTaskToast(skippedTask)) {
        emitGlobalToast({
          level: 'info',
          message: `已跳过重复下载: ${skippedTask.title || skippedTask.songId || finalFileName}`,
          taskId: skippedTask.id,
          taskStatus: skippedTask.status
        })
      }
      return { ok: true, task: skippedTask }
    } catch {
      // ignore access errors, continue to create normal task
    }
  }

  const id = createTaskId()
  const now = Date.now()

  const task = {
    id,
    source: payload.source || 'song-id',
    songId: payload.songId || '',
    title: payload.title || finalFileName,
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : null,
    url: payload.url,
    filePath,
    status: 'pending',
    progress: 0,
    totalBytes: 0,
    receivedBytes: 0,
    error: '',
    skipReason: '',
    downloadMode: payload.downloadMode || 'song-download-only',
    targetDirType: dirResolved.dirType,
    playlistContext:
      payload.playlistContext && typeof payload.playlistContext === 'object'
        ? payload.playlistContext
        : null,
    addToQueue: Boolean(payload.addToQueue),
    silentToast: Boolean(payload.silentToast),
    savePlaylistName: String(payload.savePlaylistName || '').trim(),
    savePlaylistBatchKey: String(payload.savePlaylistBatchKey || '').trim(),
    createdAt: now,
    updatedAt: now
  }

  downloadTasks.set(task.id, task)
  pendingTaskIds.push(task.id)
  emitDownloadTaskUpdate(task)
  consumeDownloadQueue()

  return { ok: true, task }
}

async function createSongDownloadTaskFromId(payload) {
  await ensureAuthStateLoaded()

  const songId = sanitizeSongId(payload?.songId)
  if (!songId) {
    return { ok: false, error: 'INVALID_SONG_ID' }
  }

  const level = String(payload?.level || 'exhigh').trim() || 'exhigh'

  const resolveResult = await resolveSongUrlWithLevelFallback(songId, level)
  if (!resolveResult.ok || !resolveResult.resolved?.url) {
    return {
      ok: false,
      error: 'URL_NOT_FOUND',
      message: resolveResult.message,
      attempts: resolveResult.attempts || []
    }
  }

  const resolved = resolveResult.resolved
  const songMetadata = await fetchSongMetadataById(songId)

  if (!isNeteaseAudioHost(resolved.url)) {
    return {
      ok: false,
      error: 'URL_NOT_ALLOWED',
      message: `音源地址不在白名单域名内: ${resolved.url}`
    }
  }

  const defaultExt = resolveAudioExtByResolvedUrl(resolved)
  const defaultTitle = songMetadata?.title || `歌曲 ${songId}`
  const fileName = safeFileName(payload?.fileName || `${defaultTitle}-${level}.${defaultExt}`)

  const created = await createDownloadTask({
    source: payload?.source || 'song-id',
    songId,
    url: resolved.url,
    fileName,
    title: payload?.title || defaultTitle,
    songMetadata,
    targetDirType: payload?.targetDirType || 'songs',
    playlistName: payload?.playlistName || '',
    duplicateStrategy: payload?.duplicateStrategy || 'skip',
    downloadMode: payload?.downloadMode || 'song-download-only',
    playlistContext: payload?.playlistContext || null,
    addToQueue: Boolean(payload?.addToQueue),
    silentToast: Boolean(payload?.silentToast),
    savePlaylistName: payload?.savePlaylistName || '',
    savePlaylistBatchKey: payload?.savePlaylistBatchKey || ''
  })

  return {
    ...created,
    pickedLevel: resolveResult.pickedLevel,
    attempts: resolveResult.attempts
  }
}

function cancelDownloadTask(id) {
  const task = downloadTasks.get(id)
  if (!task) return { ok: false, error: 'TASK_NOT_FOUND' }

  if (task.status === 'pending') {
    const index = pendingTaskIds.indexOf(id)
    if (index >= 0) pendingTaskIds.splice(index, 1)
    task.status = 'canceled'
    task.updatedAt = Date.now()
    emitDownloadTaskUpdate(task)
    return { ok: true, task }
  }

  if (task.status === 'downloading') {
    task.status = 'canceled'
    task.updatedAt = Date.now()
    const handle = activeDownloadHandles.get(id)
    if (handle?.request) {
      handle.request.destroy(new Error('TASK_CANCELED'))
    }
    if (handle?.stream) {
      handle.stream.destroy(new Error('TASK_CANCELED'))
    }
    emitDownloadTaskUpdate(task)
    return { ok: true, task }
  }

  return { ok: false, error: 'TASK_NOT_CANCELABLE' }
}

module.exports = {
  downloadTasks,
  pendingTaskIds,
  activeDownloadHandles,
  createTaskId,
  safeFileName,
  safeFolderName,
  isAllowedDownloadHost,
  emitGlobalToast,
  emitDownloadTaskUpdate,
  listDownloadTasks,
  resolveDownloadDir,
  ensureDownloadBaseDirs,
  countFilesRecursive,
  createDownloadTask,
  createSongDownloadTaskFromId,
  cancelDownloadTask
}
