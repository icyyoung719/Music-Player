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
} = require('./neteaseApi') as {
  resolveSongUrlWithLevelFallback: (songId: string, level: string) => Promise<ResolveSongUrlResult>
  fetchSongMetadataById: (songId: string) => Promise<SongMetadata | null>
  isNeteaseAudioHost: (rawUrl: string) => boolean
  sanitizeSongId: (songId: unknown) => string | null
  resolveAudioExtByResolvedUrl: (resolved: { type?: unknown; url?: unknown } | unknown) => string
}
const {
  persistTrackMetadataForTask,
  getTrackMetadataStorePath
} = require('./trackMetadata') as {
  persistTrackMetadataForTask: (task: DownloadTask) => Promise<void>
  getTrackMetadataStorePath: () => string
}
const {
  findLocalSongBySongId,
  findLocalSongByFileName,
  upsertLocalSongFile,
  markLocalSongFileMissing,
  ensureLocalSongCatalogReady,
  ensureLocalSongCatalogHydrated
} = require('./localSongCatalog') as {
  findLocalSongBySongId: (songId: string, options: LocateSongOptions) => LocalSongCatalogEntry | null
  findLocalSongByFileName: (fileName: string, options: LocateSongOptions) => LocalSongCatalogEntry | null
  upsertLocalSongFile: (payload: { filePath: string; songId: string; dirType: DownloadDirType | string }) => void
  markLocalSongFileMissing: (filePath: string) => void
  ensureLocalSongCatalogReady: () => void
  ensureLocalSongCatalogHydrated: (payload: {
    dirs: DownloadBaseDirs
    songIdByNormalizedPath: Record<string, string>
  }) => Promise<void>
}

const MAX_DOWNLOAD_CONCURRENCY = 2
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'MyPlayerDownloads')
const DOWNLOAD_DIR_SONGS = 'Songs'
const DOWNLOAD_DIR_TEMP = 'Temp'
const DOWNLOAD_DIR_LISTS = 'Lists'

type DownloadDirType = 'songs' | 'temp' | 'lists'
type DownloadTaskStatus = 'pending' | 'downloading' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
type DownloadMode =
  | 'song-download-only'
  | 'song-temp-queue-only'
  | 'song-download-and-queue'
  | 'playlist-download-only'
  | 'playlist-download-and-queue'
  | 'playlist-download-and-save'

interface SongMetadata {
  songId: string
  title: string
  artist: string
  album: string
  durationMs: number
  year: number | null
  coverUrl: string
}

interface LocalSongCatalogEntry {
  path: string
  fileName?: string
  songId?: string
  dirType: DownloadDirType | string
}

interface LocateSongOptions {
  includeTemp?: boolean
  includeSongs?: boolean
  includeLists?: boolean
}

interface DownloadBaseDirs {
  root: string
  songs: string
  temp: string
  lists: string
}

interface DownloadTask {
  id: string
  source: string
  songId: string
  title: string
  songMetadata: SongMetadata | null
  url: string
  filePath: string
  status: DownloadTaskStatus
  progress: number
  totalBytes: number
  receivedBytes: number
  error: string
  skipReason: string
  downloadMode: DownloadMode | string
  targetDirType: DownloadDirType | string
  playlistContext: Record<string, unknown> | null
  addToQueue: boolean
  silentToast: boolean
  savePlaylistName: string
  savePlaylistBatchKey: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
}

interface DownloadTaskPayload {
  source?: string
  songId?: string
  title?: string
  songMetadata?: SongMetadata | null
  url?: string
  filePath?: string
  fileName?: string
  error?: string
  skipReason?: string
  downloadMode?: DownloadMode | string
  targetDirType?: DownloadDirType | string
  playlistContext?: Record<string, unknown> | null
  addToQueue?: boolean
  silentToast?: boolean
  savePlaylistName?: string
  savePlaylistBatchKey?: string
  duplicateStrategy?: string
  playlistName?: string
  level?: string
}

interface ResolveSongUrlResult {
  ok: boolean
  resolved?: {
    url?: string
    type?: string
  }
  pickedLevel?: string
  attempts?: Array<{ level: string; ok: boolean; error?: string }>
  error?: string
  message?: string
}

interface TaskMutationResult {
  ok: boolean
  task?: DownloadTask
  error?: string
  message?: string
  attempts?: Array<{ level: string; ok: boolean; error?: string }>
  pickedLevel?: string
}

interface ActiveDownloadHandle {
  request: http.ClientRequest
  stream: fs.WriteStream
}

interface AppToastPayload {
  id?: string
  message?: string
  level?: 'info' | 'success' | 'warning' | 'error' | string
  createdAt?: number
  taskId?: string
  taskStatus?: DownloadTaskStatus | string
  scope?: string
  error?: string
  [key: string]: unknown
}

const downloadTasks = new Map<string, DownloadTask>()
const pendingTaskIds: string[] = []
const activeDownloadHandles = new Map<string, ActiveDownloadHandle>()
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

function shouldEmitTaskToast(task: DownloadTask | null | undefined): boolean {
  return !Boolean(task?.silentToast)
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

function emitGlobalToast(payload: AppToastPayload): void {
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

function emitDownloadTaskUpdate(task: DownloadTask): void {
  const payload = { ...task }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('netease:download-task-updated', payload)
    }
  }
}

function listDownloadTasks(): DownloadTask[] {
  return Array.from(downloadTasks.values()).sort((a, b) => b.createdAt - a.createdAt)
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

async function ensureDownloadBaseDirs(): Promise<DownloadBaseDirs> {
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
    let entries: fs.Dirent[] = []
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

async function loadSongIdMapFromTrackMetadataStore(): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  try {
    const metadataStorePath = String(getTrackMetadataStorePath?.() || '').trim()
    if (!metadataStorePath) return map
    const content = await fs.promises.readFile(metadataStorePath, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return map

    for (const [storedPath, metadata] of Object.entries(parsed as Record<string, { songId?: unknown }>)) {
      const songId = String(metadata?.songId ?? '').trim()
      if (!songId) continue
      map[normalizeFsPath(storedPath)] = songId
    }
  } catch {
    // Keep empty map when metadata store is unavailable or malformed.
  }
  return map
}

async function ensureCatalogHydratedForDownloads(dirs: DownloadBaseDirs): Promise<void> {
  ensureLocalSongCatalogReady()
  const songIdByNormalizedPath = await loadSongIdMapFromTrackMetadataStore()
  await ensureLocalSongCatalogHydrated({
    dirs,
    songIdByNormalizedPath
  })
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

function resolveDirTypeForPath(filePath: unknown, dirs: DownloadBaseDirs): DownloadDirType | '' {
  if (!filePath || !dirs) return ''
  if (isPathInside(String(filePath), dirs.songs)) return 'songs'
  if (isPathInside(String(filePath), dirs.temp)) return 'temp'
  if (isPathInside(String(filePath), dirs.lists)) return 'lists'
  return ''
}

function resolveSongIdForCatalog(taskLike: DownloadTaskPayload | DownloadTask | null | undefined): string {
  const fromPayload = String(taskLike?.songId ?? '').trim()
  if (fromPayload) return fromPayload

  const fromMetadata = String(taskLike?.songMetadata?.songId ?? '').trim()
  if (fromMetadata) return fromMetadata

  return ''
}

function upsertSongCatalogForTask(
  taskLike: DownloadTaskPayload | DownloadTask | null | undefined,
  filePath: unknown,
  dirType: DownloadDirType | string
): void {
  const normalizedFilePath = String(filePath ?? '').trim()
  if (!normalizedFilePath) return

  try {
    upsertLocalSongFile({
      filePath: normalizedFilePath,
      songId: resolveSongIdForCatalog(taskLike),
      dirType
    })
  } catch {
    // Ignore catalog write errors to avoid interrupting download flows.
  }
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

async function locateSongBySongId(
  songId: unknown,
  _dirs: DownloadBaseDirs,
  options: LocateSongOptions = {}
): Promise<LocalSongCatalogEntry | null> {
  const id = String(songId ?? '').trim()
  if (!id) return null

  const includeTemp = options.includeTemp !== false
  const includeSongs = options.includeSongs !== false
  const includeLists = Boolean(options.includeLists)

  const fromCatalog = findLocalSongBySongId(id, {
    includeTemp,
    includeSongs,
    includeLists
  })
  return fromCatalog || null
}

async function locateSongByFileName(
  fileName: unknown,
  _dirs: DownloadBaseDirs,
  options: LocateSongOptions = {}
): Promise<LocalSongCatalogEntry | null> {
  const normalizedName = String(fileName ?? '').trim()
  if (!normalizedName) return null

  const includeTemp = options.includeTemp !== false
  const includeSongs = options.includeSongs !== false
  const includeLists = Boolean(options.includeLists)

  const fromCatalog = findLocalSongByFileName(normalizedName, {
    includeTemp,
    includeSongs,
    includeLists
  })
  return fromCatalog || null
}

async function moveFileSafely(sourcePath: string, targetPath: string): Promise<string> {
  if (normalizeFsPath(sourcePath) === normalizeFsPath(targetPath)) return targetPath

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  try {
    await fs.promises.rename(sourcePath, targetPath)
    return targetPath
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'EXDEV' && code !== 'EEXIST') {
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

function publishSkippedTask(task: DownloadTask, infoMessage: unknown): void {
  downloadTasks.set(task.id, task)
  emitDownloadTaskUpdate(task)
  if (infoMessage && shouldEmitTaskToast(task)) {
    emitGlobalToast({
      level: 'info',
      message: String(infoMessage),
      taskId: task.id,
      taskStatus: task.status
    })
  }
}

async function reuseLocalSongForTask(
  payload: DownloadTaskPayload,
  finalFileName: string,
  targetFilePath: string,
  dirs: DownloadBaseDirs,
  dirResolved: DownloadDirInfo
): Promise<TaskMutationResult | null> {
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
    upsertSongCatalogForTask(payload, located.path, located.dirType)
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
      upsertSongCatalogForTask(payload, located.path, 'songs')
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
      markLocalSongFileMissing(located.path)
      upsertSongCatalogForTask(payload, movedPath, 'songs')
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
      upsertSongCatalogForTask(payload, targetInLists, 'lists')
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
    upsertSongCatalogForTask(payload, copiedPath, 'lists')
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

function createSkippedTask(payload: DownloadTaskPayload): DownloadTask {
  const id = createTaskId()
  const now = Date.now()
  return {
    id,
    source: payload.source || 'song-id',
    songId: String(payload.songId || ''),
    title: payload.title || payload.fileName || `song-${payload.songId || now}`,
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : null,
    url: String(payload.url || ''),
    filePath: String(payload.filePath || ''),
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

function startDownloadWithProgress(task: DownloadTask): Promise<string> {
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

          res.on('data', (chunk: Buffer) => {
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

          stream.on('error', (err: Error) => {
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
    upsertSongCatalogForTask(task, task.filePath, task.targetDirType || 'songs')
    emitDownloadTaskUpdate(task)
    if (shouldEmitTaskToast(task)) {
      emitGlobalToast({
        level: 'success',
        message: `下载完成: ${task.title || task.songId || path.basename(task.filePath || '')}`,
        taskId: task.id,
        taskStatus: task.status
      })
    }
  } catch (err: unknown) {
    const isCanceled = downloadTasks.get(taskId)?.status === 'canceled'
    if (!isCanceled) {
      task.status = 'failed'
      task.error = err instanceof Error ? err.message : 'DOWNLOAD_FAILED'
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

async function createDownloadTask(payload: DownloadTaskPayload): Promise<TaskMutationResult> {
  ensureLocalSongCatalogReady()
  const dirs = await ensureDownloadBaseDirs()
  await ensureCatalogHydratedForDownloads(dirs)

  const fileNameInput = safeFileName(payload.fileName || `song-${payload.songId || Date.now()}`)
  const finalFileName = maybeAddFileExt(fileNameInput, String(payload.url || ''))
  const dirResolved = resolveDownloadDir(payload.targetDirType, payload.playlistName)
  await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
  const filePath = path.join(dirResolved.dirPath, finalFileName)

  const reusedLocal = await reuseLocalSongForTask(payload, finalFileName, filePath, dirs, dirResolved)
  if (reusedLocal) {
    return reusedLocal
  }

  const duplicateStrategy = String(payload.duplicateStrategy || 'skip').trim().toLowerCase()
  if (duplicateStrategy === 'skip') {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
      upsertSongCatalogForTask(payload, filePath, dirResolved.dirType)
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

  const task: DownloadTask = {
    id,
    source: payload.source || 'song-id',
    songId: String(payload.songId || ''),
    title: payload.title || finalFileName,
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : null,
    url: String(payload.url || ''),
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

async function createSongDownloadTaskFromId(payload: DownloadTaskPayload): Promise<TaskMutationResult> {
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
  const resolvedUrl = String(resolved?.url || '').trim()
  if (!resolvedUrl) {
    return {
      ok: false,
      error: 'URL_NOT_FOUND',
      message: resolveResult.message,
      attempts: resolveResult.attempts || []
    }
  }
  const songMetadata = await fetchSongMetadataById(songId)

  if (!isNeteaseAudioHost(resolvedUrl)) {
    return {
      ok: false,
      error: 'URL_NOT_ALLOWED',
      message: `音源地址不在白名单域名内: ${resolvedUrl}`
    }
  }

  const defaultExt = resolveAudioExtByResolvedUrl(resolved)
  const defaultTitle = songMetadata?.title || `歌曲 ${songId}`
  const fileNameRaw = payload?.fileName || `${defaultTitle}-${level}.${defaultExt}`
  const fileName = forceFileExt(safeFileName(fileNameRaw), defaultExt)

  const created = await createDownloadTask({
    source: payload?.source || 'song-id',
    songId,
    url: resolvedUrl,
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

function cancelDownloadTask(id: string): TaskMutationResult {
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

export {
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
