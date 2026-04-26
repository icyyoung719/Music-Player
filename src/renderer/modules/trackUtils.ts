import type { ElectronAPI } from '../core/electronApi.js'

type LazyNeteaseTrack = {
  songId?: string | number
}

type TrackLike = {
  name?: string
  path?: string | null
  file?: File | null
  lazyNetease?: LazyNeteaseTrack | null
}

export function formatTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function filePathToURL(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized
  return encodeURI('file://' + withLeadingSlash).replace(/#/g, '%23')
}

export function getFileNameFromPath(filePath: string | null | undefined): string {
  return (filePath || '').split(/[/\\]/).pop() || filePath || '未知歌曲'
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

export function getTrackUniqueKey(track: TrackLike, _electronAPI?: Pick<ElectronAPI, 'getPathForFile'>): string {
  if (track?.lazyNetease?.songId) {
    return `netease:${String(track.lazyNetease.songId)}`
  }

  if (track.path) return `path:${normalizePath(track.path)}`

  if (track.file) {
    return `file:${track.file.name}|${track.file.size}|${track.file.lastModified}`
  }

  return `name:${track.name || ''}`
}

export function getCurrentTrackPath(track: TrackLike, electronAPI?: Pick<ElectronAPI, 'getPathForFile'>): string | null {
  if (track.path) return track.path
  if (track.file && electronAPI?.getPathForFile) {
    try {
      return electronAPI.getPathForFile(track.file)
    } catch {
      return null
    }
  }
  return null
}
