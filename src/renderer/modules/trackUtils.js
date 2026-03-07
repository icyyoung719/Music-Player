export function formatTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function filePathToURL(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized
  return encodeURI('file://' + withLeadingSlash).replace(/#/g, '%23')
}

export function getFileNameFromPath(filePath) {
  return (filePath || '').split(/[/\\]/).pop() || filePath || '未知歌曲'
}

export function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

export function getTrackUniqueKey(track, electronAPI) {
  if (track.path) return `path:${normalizePath(track.path)}`

  if (track.file) {
    let resolvedPath = null
    if (electronAPI && electronAPI.getPathForFile) {
      try {
        resolvedPath = electronAPI.getPathForFile(track.file)
      } catch {
        resolvedPath = null
      }
    }

    if (resolvedPath) return `path:${normalizePath(resolvedPath)}`

    return `file:${track.file.name}|${track.file.size}|${track.file.lastModified}`
  }

  return `name:${track.name}`
}

export function getCurrentTrackPath(track, electronAPI) {
  if (track.path) return track.path
  if (track.file && electronAPI && electronAPI.getPathForFile) {
    try {
      return electronAPI.getPathForFile(track.file)
    } catch {
      return null
    }
  }
  return null
}
