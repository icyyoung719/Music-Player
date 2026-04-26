import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const { logProgramEvent } = require('../logger') as {
  logProgramEvent: (payload: {
    source?: string
    event?: string
    message?: string
    data?: unknown
    error?: unknown
  }) => void
}

type CatalogRow = {
  filePath: string
  normalizedPath: string
  songId: string
  fileName: string
  fileNameLower: string
  dirType: string
  status: 'available' | 'missing'
  updatedAt: number
}

type CatalogQueryOptions = {
  includeTemp?: boolean
  includeSongs?: boolean
  includeLists?: boolean
}

type CatalogLookupResult = {
  path: string
  dirType: string
}

type UpsertSongFilePayload = {
  filePath: unknown
  songId?: unknown
  dirType?: unknown
}

type CatalogHydrationPayload = {
  dirs?: {
    songs?: string
    temp?: string
    lists?: string
  }
  songIdByNormalizedPath?: Record<string, string>
}

type DatabaseSyncLike = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
  }
}

let catalogDb: DatabaseSyncLike | null = null
let catalogReady = false
let catalogHydrated = false
let catalogHydrationPromise: Promise<void> | null = null

function getCatalogDbPath(): string {
  return path.join(app.getPath('userData'), 'netease-song-catalog.sqlite')
}

function normalizeFsPath(filePath: unknown): string {
  const resolved = path.resolve(String(filePath ?? ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function normalizeDirType(dirType: unknown): string {
  const value = String(dirType ?? '').trim().toLowerCase()
  if (value === 'temp' || value === 'songs' || value === 'lists') return value
  return 'songs'
}

function resolveEnabledDirTypes(options: CatalogQueryOptions = {}): string[] {
  const includeTemp = options.includeTemp !== false
  const includeSongs = options.includeSongs !== false
  const includeLists = Boolean(options.includeLists)
  const dirTypes: string[] = []
  if (includeSongs) dirTypes.push('songs')
  if (includeTemp) dirTypes.push('temp')
  if (includeLists) dirTypes.push('lists')
  return dirTypes
}

function isSqliteSupported(): boolean {
  try {
    require('node:sqlite')
    return true
  } catch {
    return false
  }
}

function coerceCatalogRow(raw: unknown): CatalogRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const filePath = String(row.file_path || '').trim()
  const normalizedPath = String(row.normalized_path || '').trim()
  if (!filePath || !normalizedPath) return null

  return {
    filePath,
    normalizedPath,
    songId: String(row.song_id || '').trim(),
    fileName: String(row.file_name || '').trim(),
    fileNameLower: String(row.file_name_lc || '').trim(),
    dirType: normalizeDirType(row.dir_type),
    status: String(row.status || '').trim().toLowerCase() === 'missing' ? 'missing' : 'available',
    updatedAt: Number(row.updated_at || 0) || 0
  }
}

function ensureCatalogSchema(db: DatabaseSyncLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS song_files (
      normalized_path TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      song_id TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_name_lc TEXT NOT NULL DEFAULT '',
      dir_type TEXT NOT NULL DEFAULT 'songs',
      status TEXT NOT NULL DEFAULT 'available',
      updated_at INTEGER NOT NULL
    )
  `)

  db.exec('CREATE INDEX IF NOT EXISTS idx_song_files_song_id ON song_files(song_id, status, updated_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_song_files_file_name ON song_files(file_name_lc, status, updated_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_song_files_dir_type ON song_files(dir_type, status, updated_at DESC)')
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const files: string[] = []
  const stack: string[] = [rootDir]

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
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }

  return files
}

export function ensureLocalSongCatalogReady(): void {
  if (catalogReady) return
  catalogReady = true

  if (!isSqliteSupported()) {
    logProgramEvent({
      source: 'netease.localSongCatalog',
      event: 'sqlite-not-available',
      message: 'node:sqlite is unavailable, local song catalog is disabled'
    })
    return
  }

  try {
    fs.mkdirSync(path.dirname(getCatalogDbPath()), { recursive: true })
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (filePath: string) => DatabaseSyncLike }
    const db = new DatabaseSync(getCatalogDbPath())
    ensureCatalogSchema(db)
    catalogDb = db
  } catch (err) {
    catalogDb = null
    logProgramEvent({
      source: 'netease.localSongCatalog',
      event: 'catalog-init-failed',
      message: 'Failed to initialize local song catalog',
      error: err
    })
  }
}

function upsertLocalSongFileInternal(payload: UpsertSongFilePayload): void {
  if (!payload?.filePath) return
  if (!catalogDb) return

  const filePathValue = path.resolve(String(payload.filePath))
  const normalizedPath = normalizeFsPath(filePathValue)
  const fileName = path.basename(filePathValue)
  const fileNameLower = fileName.toLowerCase()
  const songId = String(payload.songId ?? '').trim()
  const dirType = normalizeDirType(payload.dirType)
  const now = Date.now()

  catalogDb
    .prepare(`
      INSERT INTO song_files (
        normalized_path,
        file_path,
        song_id,
        file_name,
        file_name_lc,
        dir_type,
        status,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?)
      ON CONFLICT(normalized_path) DO UPDATE SET
        file_path = excluded.file_path,
        song_id = CASE WHEN excluded.song_id <> '' THEN excluded.song_id ELSE song_files.song_id END,
        file_name = excluded.file_name,
        file_name_lc = excluded.file_name_lc,
        dir_type = excluded.dir_type,
        status = 'available',
        updated_at = excluded.updated_at
    `)
    .run(normalizedPath, filePathValue, songId, fileName, fileNameLower, dirType, now)
}

export async function ensureLocalSongCatalogHydrated(payload: CatalogHydrationPayload = {}): Promise<void> {
  ensureLocalSongCatalogReady()
  if (!catalogDb) return
  if (catalogHydrated) return
  if (catalogHydrationPromise) {
    await catalogHydrationPromise
    return
  }

  const dirs = payload.dirs || {}
  const songIdMap = payload.songIdByNormalizedPath || {}

  catalogHydrationPromise = (async () => {
    try {
      const songsRoot = String(dirs.songs || '').trim()
      const tempRoot = String(dirs.temp || '').trim()
      const listsRoot = String(dirs.lists || '').trim()

      const [songFiles, tempFiles, listFiles] = await Promise.all([
        songsRoot ? listFilesRecursive(songsRoot) : Promise.resolve([]),
        tempRoot ? listFilesRecursive(tempRoot) : Promise.resolve([]),
        listsRoot ? listFilesRecursive(listsRoot) : Promise.resolve([])
      ])

      // Full migration mode: mark all existing rows missing first, then rebuild from live filesystem.
      catalogDb!.prepare("UPDATE song_files SET status = 'missing', updated_at = ?").run(Date.now())

      for (const filePath of songFiles) {
        upsertLocalSongFileInternal({ filePath, songId: songIdMap[normalizeFsPath(filePath)] || '', dirType: 'songs' })
      }
      for (const filePath of tempFiles) {
        upsertLocalSongFileInternal({ filePath, songId: songIdMap[normalizeFsPath(filePath)] || '', dirType: 'temp' })
      }
      for (const filePath of listFiles) {
        upsertLocalSongFileInternal({ filePath, songId: songIdMap[normalizeFsPath(filePath)] || '', dirType: 'lists' })
      }

      catalogHydrated = true
    } catch (err) {
      logProgramEvent({
        source: 'netease.localSongCatalog',
        event: 'catalog-hydration-failed',
        message: 'Failed to hydrate local song catalog',
        error: err
      })
      throw err
    } finally {
      catalogHydrationPromise = null
    }
  })()

  await catalogHydrationPromise
}

export function upsertLocalSongFile(payload: UpsertSongFilePayload): void {
  if (!payload?.filePath) return
  ensureLocalSongCatalogReady()
  if (!catalogDb) return

  try {
    upsertLocalSongFileInternal(payload)
  } catch (err) {
    const filePathValue = path.resolve(String(payload.filePath))
    const songId = String(payload.songId ?? '').trim()
    const dirType = normalizeDirType(payload.dirType)
    logProgramEvent({
      source: 'netease.localSongCatalog',
      event: 'catalog-upsert-failed',
      message: 'Failed to upsert local song file',
      data: { filePath: filePathValue, songId, dirType },
      error: err
    })
  }
}

export function markLocalSongCatalogDirTypeMissing(dirType: unknown): void {
  ensureLocalSongCatalogReady()
  if (!catalogDb) return
  const normalized = normalizeDirType(dirType)
  try {
    catalogDb
      .prepare("UPDATE song_files SET status = 'missing', updated_at = ? WHERE dir_type = ?")
      .run(Date.now(), normalized)
  } catch (err) {
    logProgramEvent({
      source: 'netease.localSongCatalog',
      event: 'catalog-mark-dir-missing-failed',
      message: 'Failed to mark catalog entries missing by dir type',
      data: { dirType: normalized },
      error: err
    })
  }
}

export function markLocalSongFileMissing(filePath: unknown): void {
  if (!filePath) return
  ensureLocalSongCatalogReady()
  if (!catalogDb) return

  const normalizedPath = normalizeFsPath(filePath)
  try {
    catalogDb
      .prepare('UPDATE song_files SET status = \'missing\', updated_at = ? WHERE normalized_path = ?')
      .run(Date.now(), normalizedPath)
  } catch (err) {
    logProgramEvent({
      source: 'netease.localSongCatalog',
      event: 'catalog-mark-missing-failed',
      message: 'Failed to mark local song file as missing',
      data: { filePath: String(filePath) },
      error: err
    })
  }
}

function mapLookupRowsByPriority(rows: CatalogRow[]): CatalogRow[] {
  const priority: Record<string, number> = { songs: 1, temp: 2, lists: 3 }
  return rows.sort((a, b) => {
    const pa = priority[a.dirType] || 99
    const pb = priority[b.dirType] || 99
    if (pa !== pb) return pa - pb
    return b.updatedAt - a.updatedAt
  })
}

function queryRowsBySongId(songId: string, options: CatalogQueryOptions = {}): CatalogRow[] {
  ensureLocalSongCatalogReady()
  if (!catalogDb) return []

  const dirTypes = resolveEnabledDirTypes(options)
  if (dirTypes.length === 0) return []

  const placeholders = dirTypes.map(() => '?').join(', ')
  const rows = catalogDb
    .prepare(
      `
      SELECT normalized_path, file_path, song_id, file_name, file_name_lc, dir_type, status, updated_at
      FROM song_files
      WHERE song_id = ?
        AND status = 'available'
        AND dir_type IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT 40
    `
    )
    .all(songId, ...dirTypes)

  return mapLookupRowsByPriority(rows.map(coerceCatalogRow).filter(Boolean) as CatalogRow[])
}

function queryRowsByFileName(fileName: string, options: CatalogQueryOptions = {}): CatalogRow[] {
  ensureLocalSongCatalogReady()
  if (!catalogDb) return []

  const dirTypes = resolveEnabledDirTypes(options)
  if (dirTypes.length === 0) return []

  const placeholders = dirTypes.map(() => '?').join(', ')
  const normalizedName = String(fileName || '').trim().toLowerCase()
  if (!normalizedName) return []

  const rows = catalogDb
    .prepare(
      `
      SELECT normalized_path, file_path, song_id, file_name, file_name_lc, dir_type, status, updated_at
      FROM song_files
      WHERE file_name_lc = ?
        AND status = 'available'
        AND dir_type IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT 80
    `
    )
    .all(normalizedName, ...dirTypes)

  return mapLookupRowsByPriority(rows.map(coerceCatalogRow).filter(Boolean) as CatalogRow[])
}

function resolveFirstExistingRow(rows: CatalogRow[]): CatalogLookupResult | null {
  for (const row of rows) {
    try {
      fs.accessSync(row.filePath, fs.constants.F_OK)
      return { path: row.filePath, dirType: row.dirType }
    } catch {
      markLocalSongFileMissing(row.filePath)
    }
  }
  return null
}

export function findLocalSongBySongId(songId: unknown, options: CatalogQueryOptions = {}): CatalogLookupResult | null {
  const id = String(songId ?? '').trim()
  if (!id) return null
  const rows = queryRowsBySongId(id, options)
  return resolveFirstExistingRow(rows)
}

export function findLocalSongByFileName(fileName: unknown, options: CatalogQueryOptions = {}): CatalogLookupResult | null {
  const name = String(fileName ?? '').trim()
  if (!name) return null
  const rows = queryRowsByFileName(name, options)
  return resolveFirstExistingRow(rows)
}

export { getCatalogDbPath }
