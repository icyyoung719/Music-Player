import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import crypto from 'crypto'
import os from 'os'
import { BrowserWindow } from 'electron'

const { buildAuthHeaders, ensureAuthStateLoaded } = require('./authManager') as {
  buildAuthHeaders: (extra?: Record<string, string>) => Record<string, string>
  ensureAuthStateLoaded: () => Promise<void>
}
const {
  resolveSongUrlWithLevelFallback,
  fetchSongMetadataById,
  isNeteaseAudioHost,
  sanitizeSongId,
  resolveAudioExtByResolvedUrl
} = require('./neteaseApi') as any
const {
  trackMetadataStore,
  ensureTrackMetadataLoaded,
  persistTrackMetadataForTask
} = require('./trackMetadata') as any

const MAX_DOWNLOAD_CONCURRENCY = 2
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'MyPlayerDownloads')
const DOWNLOAD_DIR_SONGS = 'Songs'
const DOWNLOAD_DIR_TEMP = 'Temp'
const DOWNLOAD_DIR_LISTS = 'Lists'

const downloadTasks = new Map<string, any>()
const pendingTaskIds: string[] = []
const activeDownloadHandles = new Map<string, any>()
let activeDownloadCount = 0

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function createTaskId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeFileName(name: unknown): string {
  return String(name ?? 'download')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'download'
}

function safeFolderName(name: unknown, fallback: string = 'default'): string {
  const value = safeFileName(name ?? fallback)
  return value || fallback
}

function maybeAddFileExt(fileName: string, url: string): string {
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(fileName)
  if (hasExt) return fileName
  try {
    const pathname = new URL(url).pathname ?? ''
    const ext = path.extname(pathname)
    if (ext) return `${fileName}${ext}`
  } catch {
    // fall through
  }
  return fileName
}

function forceFileExt(fileName: string, ext: unknown): string {
  const normalizedExt = String(ext ?? '').replace(/^\./, '').trim().toLowerCase()
  if (!normalizedExt) return fileName

  const parsed = path.parse(String(fileName ?? '').trim())
  const safeBase = parsed.name ?? parsed.base ?? 'download'
  return `${safeBase}.${normalizedExt}`
}

function isAllowedDownloadHost(rawUrl: string): boolean {
  return isNeteaseAudioHost(rawUrl)
}

function shouldEmitTaskToast(task: any): boolean {
  return !Boolean(task?.silentToast)
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

function emitGlobalToast(payload: any): void {
  const message = String(payload?.message ?? '').trim()
  if (!message) return

  const toastPayload = {
    id: createTaskId(),
    message,
    level: String(payload?.level ?? 'info'),
    createdAt: Date.now(),
    ...payload
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:toast', toastPayload)
    }
  }
}

function emitDownloadTaskUpdate(task: any): void {
  const payload = { ...task }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('netease:download-task-updated', payload)
    }
  }
}

function listDownloadTasks(): any[] {
  return Array.from(downloadTasks.values()).sort((a: any, b: any) => b.createdAt - a.createdAt)
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function getDownloadRootDir(): string {
  return DEFAULT_DOWNLOAD_DIR
}

interface DownloadDirInfo {
  dirType: string
  dirPath: string
  playlistFolder?: string
}

function resolveDownloadDir(dirType: unknown, playlistName?: unknown): DownloadDirInfo {
  const type = String(dirType ?? 'songs').trim().toLowerCase()
  const rootDir = getDownloadRootDir()

  if (type === 'temp') {
    return { dirType: 'temp', dirPath: path.join(rootDir, DOWNLOAD_DIR_TEMP) }
  }

  if (type === 'lists') {
    const child = safeFolderName(playlistName ?? '未命名歌单', '未命名歌单')
    return {
      dirType: 'lists',
      dirPath: path.join(rootDir, DOWNLOAD_DIR_LISTS, child),
      playlistFolder: child
    }
  }

  return { dirType: 'songs', dirPath: path.join(rootDir, DOWNLOAD_DIR_SONGS) }
}

async function ensureDownloadBaseDirs(): Promise<Record<string, string>> {
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

async function countFilesRecursive(targetDir: string): Promise<number> {
  let count = 0
  const stack: string[] = [targetDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: any[] = []
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

function normalizeFsPath(filePath: unknown): string {
  const resolved = path.resolve(String(filePath ?? ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = normalizeFsPath(basePath)
  const target = normalizeFsPath(targetPath)
  if (base === target) return true
  return target.startsWith(`${base}${path.sep}`)
}

function resolveDirTypeForPath(filePath: unknown, dirs: any): string {
  if (!filePath || !dirs) return ''
  if (isPathInside(String(filePath), dirs.songs)) return 'songs'
  if (isPathInside(String(filePath), dirs.temp)) return 'temp'
  if (isPathInside(String(filePath), dirs.lists)) return 'lists'
  return ''
}

async function fileExists(filePath: unknown): Promise<boolean> {
  if (!filePath) return false
  try {
    await fs.promises.access(String(filePath), fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const files: string[] = []
  const stack: string[] = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: any[] = []
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
        files.push(full)
      }
    }
  }
  return files
}

async function locateSongBySongId(songId: unknown, dirs: any, options: any = {}): Promise<any> {
  const id = String(songId ?? '').trim()
  if (!id) return null

  const includeTemp = options.includeTemp !== false
  const includeSongs = options.includeSongs !== false
  const includeLists = Boolean(options.includeLists)

  await ensureTrackMetadataLoaded()
  for (const [storedPath, metadata] of Object.entries(trackMetadataStore)) {
    if (!metadata || String((metadata as any).songId ?? '').trim() !== id) continue
    if (!(await fileExists(storedPath))) continue

    const dirType = resolveDirTypeForPath(storedPath, dirs)
    if (!dirType) continue
    if (dirType === 'temp' && !includeTemp) continue
    if (dirType === 'songs' && !includeSongs) continue
    if (dirType === 'lists' && !includeLists) continue

    return {
      path: storedPath,
      dirType
    }
  }

  return null
}

async function locateSongByFileName(fileName: unknown, dirs: any, options: any = {}): Promise<any> {
  const normalizedName = String(fileName ?? '').trim()
  if (!normalizedName) return null

  const includeTemp = options.includeTemp !== false
  const includeSongs = options.includeSongs !== false
  const includeLists = Boolean(options.includeLists)

  if (includeTemp) {
    const tempPath = path.join(dirs.temp, normalizedName)
    if (await fileExists(tempPath)) return { path: tempPath, dirType: 'temp' }
  }

  if (includeSongs) {
    const songsPath = path.join(dirs.songs, normalizedName)
    if (await fileExists(songsPath)) return { path: songsPath, dirType: 'songs' }
  }

  if (includeLists) {
    const listFiles = await listFilesRecursive(dirs.lists)
    const matchedPath = listFiles.find((filePath) => path.basename(filePath).toLowerCase() === normalizedName.toLowerCase())
    if (matchedPath) return { path: matchedPath, dirType: 'lists' }
  }

  return null
}

async function moveFileSafely(sourcePath: string, targetPath: string): Promise<string> {
  if (normalizeFsPath(sourcePath) === normalizeFsPath(targetPath)) return targetPath

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  try {
    await fs.promises.rename(sourcePath, targetPath)
    return targetPath
  } catch (err: any) {
    if (err?.code !== 'EXDEV' && err?.code !== 'EEXIST') {
      throw err
    }
  }

  if (!(await fileExists(targetPath))) {
    await fs.promises.copyFile(sourcePath, targetPath)
  }
  if (await fileExists(sourcePath)) {
    await fs.promises.unlink(sourcePath).catch(() => {})
  }
  return targetPath
}

async function copyFileSafely(sourcePath: string, targetPath: string): Promise<string> {
  if (normalizeFsPath(sourcePath) === normalizeFsPath(targetPath)) return targetPath
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  if (!(await fileExists(targetPath))) {
    await fs.promises.copyFile(sourcePath, targetPath)
  }
  return targetPath
}

function publishSkippedTask(task: any, infoMessage: unknown): void {
  downloadTasks.set(task.id, task)
  emitDownloadTaskUpdate(task)
  if (infoMessage && shouldEmitTaskToast(task)) {
    emitGlobalToast({
      level: 'info',
      message: infoMessage,
      taskId: task.id,
      taskStatus: task.status
    })
  }
}

async function reuseLocalSongForTask(
  payload: any,
  finalFileName: string,
  targetFilePath: string,
  dirs: any,
  dirResolved: DownloadDirInfo
): Promise<any> {
  const mode = String(payload.downloadMode || 'song-download-only').trim()
  const isPlaySong = mode === 'song-temp-queue-only'
  const isSongDownload = mode === 'song-download-only' || mode === 'song-download-and-queue'
  const isPlaylistDownload = mode.startsWith('playlist-download-')
  if (!isPlaySong && !isSongDownload && !isPlaylistDownload) return null

  let located = await locateSongBySongId(payload.songId, dirs, {
    includeTemp: true,
    includeSongs: true,
    includeLists: isPlaySong || isPlaylistDownload
  })

  if (!located) {
    located = await locateSongByFileName(finalFileName, dirs, {
      includeTemp: true,
      includeSongs: true,
      includeLists: isPlaySong || isPlaylistDownload
    })
  }

  if (!located) return null

  if (isPlaySong) {
    const skippedTask = createSkippedTask({
      ...payload,
      filePath: located.path,
      fileName: path.basename(located.path),
      skipReason: 'local-file-reused',
      targetDirType: located.dirType,
      playlistContext: payload.playlistContext
    })
    publishSkippedTask(skippedTask, `已使用本地文件播放: ${skippedTask.title || skippedTask.songId || path.basename(located.path)}`)
    return { ok: true, task: skippedTask }
  }

  if (isSongDownload) {
    if (located.dirType === 'songs') {
      const skippedTask = createSkippedTask({
        ...payload,
        filePath: located.path,
        fileName: path.basename(located.path),
        skipReason: 'already-in-songs',
        targetDirType: 'songs',
        playlistContext: payload.playlistContext
      })
      publishSkippedTask(skippedTask, `已存在于 Songs，无需重复下载: ${skippedTask.title || skippedTask.songId || path.basename(located.path)}`)
      return { ok: true, task: skippedTask }
    }

    if (located.dirType === 'temp') {
      const movedPath = await moveFileSafely(located.path, targetFilePath)
      const skippedTask = createSkippedTask({
        ...payload,
        filePath: movedPath,
        fileName: path.basename(movedPath),
        skipReason: 'moved-temp-to-songs',
        targetDirType: 'songs',
        playlistContext: payload.playlistContext
      })
      publishSkippedTask(skippedTask, `已将 Temp 文件移动到 Songs: ${skippedTask.title || skippedTask.songId || path.basename(movedPath)}`)
      return { ok: true, task: skippedTask }
    }
  }

  if (isPlaylistDownload) {
    const targetInLists = path.join(dirResolved.dirPath, finalFileName)

    if (located.dirType === 'lists' && normalizeFsPath(located.path) === normalizeFsPath(targetInLists)) {
      const skippedTask = createSkippedTask({
        ...payload,
        filePath: targetInLists,
        fileName: finalFileName,
        skipReason: 'already-in-target-list',
        targetDirType: 'lists',
        playlistContext: payload.playlistContext
      })
      publishSkippedTask(skippedTask, `歌单内已存在本地文件: ${skippedTask.title || skippedTask.songId || finalFileName}`)
      return { ok: true, task: skippedTask }
    }

    const copiedPath = await copyFileSafely(located.path, targetInLists)
    const skippedTask = createSkippedTask({
      ...payload,
      filePath: copiedPath,
      fileName: finalFileName,
      skipReason: 'copied-local-to-list',
      targetDirType: 'lists',
      playlistContext: payload.playlistContext
    })
    publishSkippedTask(skippedTask, `已复用本地文件到歌单目录: ${skippedTask.title || skippedTask.songId || finalFileName}`)
    return { ok: true, task: skippedTask }
  }

  return null
}

// ---------------------------------------------------------------------------
// Task creation helpers
// ---------------------------------------------------------------------------

function createSkippedTask(payload: any): any {
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

function startDownloadWithProgress(task: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let redirected = 0

    const run = (targetUrl: string) => {
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

async function runSingleTask(taskId: string): Promise<void> {
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
  } catch (err: any) {
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
    if (!nextTaskId) continue
    activeDownloadCount++

    runSingleTask(nextTaskId)
      .catch(() => {})
      .finally(() => {
        activeDownloadCount = Math.max(0, activeDownloadCount - 1)
        consumeDownloadQueue()
      })
  }
}

async function createDownloadTask(payload: any): Promise<any> {
  await ensureDownloadBaseDirs()

  const fileNameInput = safeFileName(payload.fileName || `song-${payload.songId || Date.now()}`)
  const finalFileName = maybeAddFileExt(fileNameInput, payload.url)
  const dirResolved = resolveDownloadDir(payload.targetDirType, payload.playlistName)
  await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
  const filePath = path.join(dirResolved.dirPath, finalFileName)

  const dirs = await ensureDownloadBaseDirs()
  const reusedLocal = await reuseLocalSongForTask(payload, finalFileName, filePath, dirs, dirResolved)
  if (reusedLocal) {
    return reusedLocal
  }

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

      publishSkippedTask(skippedTask, `已跳过重复下载: ${skippedTask.title || skippedTask.songId || finalFileName}`)
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

async function createSongDownloadTaskFromId(payload: any): Promise<any> {
  await ensureAuthStateLoaded()

  const songId = sanitizeSongId(payload?.songId)
  if (!songId) {
    return { ok: false, error: 'INVALID_SONG_ID' }
  }

  const level = String(payload?.level || 'exhigh').trim() || 'exhigh'

  const resolveResult: any = await resolveSongUrlWithLevelFallback(songId, level)
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
  const fileNameRaw = payload?.fileName || `${defaultTitle}-${level}.${defaultExt}`
  const fileName = forceFileExt(safeFileName(fileNameRaw), defaultExt)

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

function cancelDownloadTask(id: string): any {
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

export {}
