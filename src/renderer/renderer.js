// renderer.js
const fileInput = document.getElementById('fileInput')
const folderBtn = document.getElementById('folderBtn')
const clearBtn = document.getElementById('clearBtn')
const playBtn = document.getElementById('playBtn')
const prevBtn = document.getElementById('prevBtn')
const nextBtn = document.getElementById('nextBtn')
const loopBtn = document.getElementById('loopBtn')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const trackAlbum = document.getElementById('trackAlbum')
const coverImg = document.getElementById('coverImg')
const coverPlaceholder = document.querySelector('.cover-placeholder')
const playlistEl = document.getElementById('playlist')
const progressContainer = document.getElementById('progressContainer')
const progressBar = document.getElementById('progressBar')
const currentTimeEl = document.getElementById('currentTime')
const totalTimeEl = document.getElementById('totalTime')
const savedPlaylistSelect = document.getElementById('savedPlaylistSelect')
const savedCreateBtn = document.getElementById('savedCreateBtn')
const savedRenameBtn = document.getElementById('savedRenameBtn')
const savedDeleteBtn = document.getElementById('savedDeleteBtn')
const savedAddCurrentBtn = document.getElementById('savedAddCurrentBtn')
const savedImportBtn = document.getElementById('savedImportBtn')
const savedExportBtn = document.getElementById('savedExportBtn')
const savedTracksEl = document.getElementById('savedTracks')

let audio = new Audio()
let playlist = []   // Array of { name, path, file?, metadataCache? }
let currentIndex = -1
let isLooping = false
let savedState = { playlists: [], trackLibrary: {} }
let selectedSavedPlaylistId = null

// Format seconds as m:ss
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Convert an absolute file-system path to a properly encoded file:// URL
function filePathToURL(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized
  return encodeURI('file://' + withLeadingSlash).replace(/#/g, '%23')
}

function getFileNameFromPath(filePath) {
  return (filePath || '').split(/[/\\]/).pop() || filePath || '未知歌曲'
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function getTrackUniqueKey(track) {
  if (track.path) return `path:${normalizePath(track.path)}`

  if (track.file) {
    let resolvedPath = null
    if (window.electronAPI && window.electronAPI.getPathForFile) {
      try {
        resolvedPath = window.electronAPI.getPathForFile(track.file)
      } catch {
        resolvedPath = null
      }
    }

    if (resolvedPath) return `path:${normalizePath(resolvedPath)}`

    return `file:${track.file.name}|${track.file.size}|${track.file.lastModified}`
  }

  return `name:${track.name}`
}

function getCurrentTrackPath(track) {
  if (track.path) return track.path
  if (track.file && window.electronAPI && window.electronAPI.getPathForFile) {
    try {
      return window.electronAPI.getPathForFile(track.file)
    } catch {
      return null
    }
  }
  return null
}

function requestPlaylistName(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.left = '0'
    overlay.style.top = '0'
    overlay.style.width = '100vw'
    overlay.style.height = '100vh'
    overlay.style.background = 'rgba(0, 0, 0, 0.45)'
    overlay.style.display = 'flex'
    overlay.style.alignItems = 'center'
    overlay.style.justifyContent = 'center'
    overlay.style.zIndex = '9999'

    const panel = document.createElement('div')
    panel.style.width = 'min(420px, 92vw)'
    panel.style.background = '#1f2b4a'
    panel.style.border = '1px solid rgba(255,255,255,0.15)'
    panel.style.borderRadius = '10px'
    panel.style.padding = '14px'
    panel.style.color = '#fff'

    const titleEl = document.createElement('div')
    titleEl.textContent = title
    titleEl.style.fontSize = '14px'
    titleEl.style.marginBottom = '10px'

    const input = document.createElement('input')
    input.type = 'text'
    input.value = defaultValue || ''
    input.style.width = '100%'
    input.style.padding = '8px 10px'
    input.style.borderRadius = '6px'
    input.style.border = '1px solid rgba(255,255,255,0.25)'
    input.style.background = 'rgba(255,255,255,0.1)'
    input.style.color = '#fff'
    input.style.outline = 'none'

    const actions = document.createElement('div')
    actions.style.display = 'flex'
    actions.style.justifyContent = 'flex-end'
    actions.style.gap = '8px'
    actions.style.marginTop = '12px'

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.style.padding = '6px 12px'
    cancelBtn.style.borderRadius = '6px'
    cancelBtn.style.background = 'rgba(255,255,255,0.2)'
    cancelBtn.style.color = '#fff'

    const okBtn = document.createElement('button')
    okBtn.textContent = '确定'
    okBtn.style.padding = '6px 12px'
    okBtn.style.borderRadius = '6px'

    const close = (value) => {
      overlay.remove()
      resolve(value)
    }

    cancelBtn.addEventListener('click', () => close(null))
    okBtn.addEventListener('click', () => close(input.value))
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value)
      if (e.key === 'Escape') close(null)
    })

    actions.appendChild(cancelBtn)
    actions.appendChild(okBtn)
    panel.appendChild(titleEl)
    panel.appendChild(input)
    panel.appendChild(actions)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    input.focus()
    input.select()
  })
}

// Reset progress bar and time display
function resetProgress() {
  progressBar.style.width = '0%'
  currentTimeEl.textContent = '0:00'
  totalTimeEl.textContent = '0:00'
}

// Rebuild the playlist DOM
function updatePlaylistUI() {
  playlistEl.innerHTML = ''
  if (playlist.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'playlist-empty'
    empty.textContent = '拖入或添加歌曲'
    playlistEl.appendChild(empty)
    return
  }
  playlist.forEach((track, index) => {
    const item = document.createElement('div')
    item.className = 'playlist-item' + (index === currentIndex ? ' active' : '')

    const idxSpan = document.createElement('span')
    idxSpan.className = 'playlist-index'
    idxSpan.textContent = index + 1

    const titleSpan = document.createElement('span')
    titleSpan.className = 'playlist-item-title'
    titleSpan.textContent = track.name

    const delBtn = document.createElement('button')
    delBtn.className = 'playlist-delete-btn'
    delBtn.textContent = '✕'
    delBtn.title = '从列表移除'
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      removeTrack(index)
    })

    item.appendChild(idxSpan)
    item.appendChild(titleSpan)
    item.appendChild(delBtn)
    item.addEventListener('click', () => loadTrack(index))
    playlistEl.appendChild(item)
  })

  // Scroll active item into view
  const activeItem = playlistEl.querySelector('.playlist-item.active')
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest' })
}

// Load and auto-play a track by playlist index
async function loadTrack(index) {
  if (index < 0 || index >= playlist.length) return
  currentIndex = index
  const track = playlist[index]

  // Reset display
  trackTitle.textContent = track.name
  trackArtist.textContent = ''
  trackAlbum.textContent = ''
  coverImg.style.display = 'none'
  coverImg.src = ''
  coverPlaceholder.style.display = 'flex'
  resetProgress()

  // Stop previous playback
  audio.pause()

  // Set audio source
  if (track.file) {
    audio.src = URL.createObjectURL(track.file)
  } else {
    audio.src = filePathToURL(track.path)
  }

  // Resolve filesystem path for metadata
  let filePath = track.path
  if (track.file && window.electronAPI && window.electronAPI.getPathForFile) {
    filePath = window.electronAPI.getPathForFile(track.file)
  }

  if (filePath && window.electronAPI) {
    window.electronAPI.playAudio(filePath)
    const meta = await window.electronAPI.getMetadata(filePath)
    if (meta) {
      trackTitle.textContent = meta.title || track.name
      trackArtist.textContent = meta.artist || ''
      const albumParts = [meta.album, meta.year].filter(Boolean)
      trackAlbum.textContent = albumParts.join(' · ')
      if (meta.coverDataUrl) {
        coverImg.src = meta.coverDataUrl
        coverImg.style.display = 'block'
        coverPlaceholder.style.display = 'none'
      }

      track.metadataCache = {
        title: meta.title || track.name,
        artist: meta.artist || null,
        album: meta.album || null,
        duration: meta.duration || null
      }
    }
  }

  audio.play()
  playBtn.textContent = '⏸ 暂停'
  updatePlaylistUI()
}

// Append newTracks to the current playlist; auto-play if the queue was empty
function appendToPlaylist(newTracks) {
  if (!newTracks.length) return
  const wasEmpty = playlist.length === 0

  const existingKeys = new Set(playlist.map(getTrackUniqueKey))
  const dedupedTracks = []

  for (const track of newTracks) {
    const key = getTrackUniqueKey(track)
    if (existingKeys.has(key)) continue
    existingKeys.add(key)
    dedupedTracks.push(track)
  }

  if (!dedupedTracks.length) return

  playlist = playlist.concat(dedupedTracks)
  updatePlaylistUI()
  if (wasEmpty) loadTrack(0)
}

// Remove a single track from the playlist by index
function removeTrack(index) {
  if (index === currentIndex) {
    audio.pause()
    audio.src = ''
    playBtn.textContent = '▶️ 播放'
    if (playlist.length > 1) {
      const nextIndex = index < playlist.length - 1 ? index : index - 1
      playlist.splice(index, 1)
      currentIndex = -1
      loadTrack(nextIndex)
      return
    } else {
      playlist.splice(index, 1)
      currentIndex = -1
      resetProgress()
      trackTitle.textContent = '未选择歌曲'
      trackArtist.textContent = ''
      trackAlbum.textContent = ''
      coverImg.style.display = 'none'
      coverImg.src = ''
      coverPlaceholder.style.display = 'flex'
    }
  } else {
    playlist.splice(index, 1)
    if (index < currentIndex) currentIndex--
  }
  updatePlaylistUI()
}

// Clear the entire playlist
function clearPlaylist() {
  playlist = []
  currentIndex = -1
  audio.pause()
  audio.src = ''
  playBtn.textContent = '▶️ 播放'
  resetProgress()
  trackTitle.textContent = '未选择歌曲'
  trackArtist.textContent = ''
  trackAlbum.textContent = ''
  coverImg.style.display = 'none'
  coverImg.src = ''
  coverPlaceholder.style.display = 'flex'
  updatePlaylistUI()
}

function getSelectedSavedPlaylist() {
  return savedState.playlists.find(item => item.id === selectedSavedPlaylistId) || null
}

function renderSavedPlaylistSelect() {
  savedPlaylistSelect.innerHTML = ''

  if (!savedState.playlists.length) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = '暂无歌单'
    savedPlaylistSelect.appendChild(opt)
    savedPlaylistSelect.disabled = true
    return
  }

  savedPlaylistSelect.disabled = false
  savedState.playlists.forEach(item => {
    const opt = document.createElement('option')
    opt.value = item.id
    opt.textContent = `${item.name} (${item.trackIds.length})`
    if (item.id === selectedSavedPlaylistId) {
      opt.selected = true
    }
    savedPlaylistSelect.appendChild(opt)
  })
}

function renderSavedTracks() {
  savedTracksEl.innerHTML = ''
  const selected = getSelectedSavedPlaylist()

  if (!selected) {
    const empty = document.createElement('div')
    empty.className = 'saved-empty'
    empty.textContent = '请先创建或选择一个歌单'
    savedTracksEl.appendChild(empty)
    return
  }

  if (!selected.trackIds.length) {
    const empty = document.createElement('div')
    empty.className = 'saved-empty'
    empty.textContent = '歌单为空，可将“当前列表”添加进来'
    savedTracksEl.appendChild(empty)
    return
  }

  selected.trackIds.forEach((trackId, index) => {
    const track = savedState.trackLibrary[trackId]
    const title = track?.metadataCache?.title || getFileNameFromPath(track?.path)
    const item = document.createElement('div')
    item.className = 'saved-track-item'

    const idx = document.createElement('span')
    idx.className = 'playlist-index'
    idx.textContent = index + 1

    const titleEl = document.createElement('span')
    titleEl.className = 'saved-track-title'
    titleEl.textContent = title

    const removeBtn = document.createElement('button')
    removeBtn.className = 'saved-track-remove'
    removeBtn.textContent = '✕'
    removeBtn.title = '从歌单移除'
    removeBtn.addEventListener('click', async () => {
      if (!window.electronAPI || !window.electronAPI.playlistRemoveTrack) return
      await window.electronAPI.playlistRemoveTrack(selected.id, trackId)
      await refreshSavedPlaylists(selected.id)
    })

    item.appendChild(idx)
    item.appendChild(titleEl)
    item.appendChild(removeBtn)
    savedTracksEl.appendChild(item)
  })
}

async function refreshSavedPlaylists(preferredId = null) {
  if (!window.electronAPI || !window.electronAPI.playlistList) return

  const payload = await window.electronAPI.playlistList()
  savedState = {
    playlists: Array.isArray(payload?.playlists) ? payload.playlists : [],
    trackLibrary: payload?.trackLibrary && typeof payload.trackLibrary === 'object' ? payload.trackLibrary : {}
  }

  const existingIds = new Set(savedState.playlists.map(item => item.id))
  if (preferredId && existingIds.has(preferredId)) {
    selectedSavedPlaylistId = preferredId
  } else if (selectedSavedPlaylistId && existingIds.has(selectedSavedPlaylistId)) {
    selectedSavedPlaylistId = selectedSavedPlaylistId
  } else {
    selectedSavedPlaylistId = savedState.playlists[0]?.id || null
  }

  renderSavedPlaylistSelect()
  renderSavedTracks()
}

function collectCurrentQueueAsTrackInputs() {
  const trackInputs = []
  const usedPaths = new Set()

  for (const track of playlist) {
    const filePath = getCurrentTrackPath(track)
    if (!filePath) continue

    const normalizedPath = normalizePath(filePath)
    if (usedPaths.has(normalizedPath)) continue
    usedPaths.add(normalizedPath)

    trackInputs.push({
      path: filePath,
      metadataCache: track.metadataCache || { title: track.name || getFileNameFromPath(filePath) }
    })
  }

  return trackInputs
}

async function createSavedPlaylist() {
  if (!window.electronAPI || !window.electronAPI.playlistCreate) {
    alert('歌单功能不可用，请重启应用后重试')
    return
  }

  const input = await requestPlaylistName('输入新歌单名称：', '我的歌单')
  if (input === null) return
  const name = input || '我的歌单'

  try {
    const result = await window.electronAPI.playlistCreate(name)
    if (!result?.ok) {
      alert('创建歌单失败')
      return
    }
    await refreshSavedPlaylists(result.playlist.id)
  } catch {
    alert('创建歌单失败，请查看控制台日志')
  }
}

async function renameSavedPlaylist() {
  const selected = getSelectedSavedPlaylist()
  if (!selected) {
    alert('请先选择歌单')
    return
  }

  const input = await requestPlaylistName('输入新的歌单名称：', selected.name)
  if (input === null) return
  const name = input || selected.name

  const result = await window.electronAPI.playlistRename(selected.id, name)
  if (!result?.ok) {
    alert('重命名失败')
    return
  }

  await refreshSavedPlaylists(selected.id)
}

async function deleteSavedPlaylist() {
  const selected = getSelectedSavedPlaylist()
  if (!selected) {
    alert('请先选择歌单')
    return
  }

  const confirmed = confirm(`确认删除歌单 “${selected.name}” 吗？`)
  if (!confirmed) return

  const result = await window.electronAPI.playlistDelete(selected.id)
  if (!result?.ok) {
    alert('删除失败')
    return
  }

  await refreshSavedPlaylists()
}

async function addCurrentQueueToSavedPlaylist() {
  const selected = getSelectedSavedPlaylist()
  if (!selected) {
    alert('请先选择歌单')
    return
  }

  const tracks = collectCurrentQueueAsTrackInputs()
  if (!tracks.length) {
    alert('当前播放列表没有可添加的本地歌曲')
    return
  }

  const result = await window.electronAPI.playlistAddTracks(selected.id, tracks)
  if (!result?.ok) {
    alert('添加失败')
    return
  }

  await refreshSavedPlaylists(selected.id)
  alert(`已添加 ${result.addedCount} 首到歌单`) 
}

async function importSavedPlaylist() {
  if (!window.electronAPI || !window.electronAPI.playlistImport) return
  const result = await window.electronAPI.playlistImport()
  if (!result || result.canceled) return
  if (!result.ok) {
    alert('导入失败，请检查 JSON 格式')
    return
  }

  await refreshSavedPlaylists()
  alert(`导入完成：${result.importedPlaylistCount} 个歌单`) 
}

async function exportSavedPlaylist() {
  const selected = getSelectedSavedPlaylist()
  if (!selected) {
    alert('请先选择歌单')
    return
  }

  const result = await window.electronAPI.playlistExport(selected.id)
  if (!result || result.canceled) return
  if (!result.ok) {
    alert('导出失败')
    return
  }

  alert('导出成功')
}

// Select multiple files via file input
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files)
  if (!files.length) return
  appendToPlaylist(files.map(f => ({ name: f.name, file: f, path: null })))
  fileInput.value = ''
})

// Select folder via Electron dialog and append its tracks
folderBtn.addEventListener('click', async () => {
  if (!window.electronAPI || !window.electronAPI.selectFolder) return
  const paths = await window.electronAPI.selectFolder()
  if (!paths || !paths.length) return
  appendToPlaylist(paths.map(p => ({
    name: p.split(/[/\\]/).pop(),
    path: p,
    file: null
  })))
})

// Clear playlist button
clearBtn.addEventListener('click', () => {
  if (playlist.length === 0) return
  clearPlaylist()
})

if (savedPlaylistSelect) {
  savedPlaylistSelect.addEventListener('change', () => {
    selectedSavedPlaylistId = savedPlaylistSelect.value || null
    renderSavedTracks()
  })
}

if (savedCreateBtn) savedCreateBtn.addEventListener('click', createSavedPlaylist)
if (savedRenameBtn) savedRenameBtn.addEventListener('click', renameSavedPlaylist)
if (savedDeleteBtn) savedDeleteBtn.addEventListener('click', deleteSavedPlaylist)
if (savedAddCurrentBtn) savedAddCurrentBtn.addEventListener('click', addCurrentQueueToSavedPlaylist)
if (savedImportBtn) savedImportBtn.addEventListener('click', importSavedPlaylist)
if (savedExportBtn) savedExportBtn.addEventListener('click', exportSavedPlaylist)

// Play / Pause
playBtn.addEventListener('click', () => {
  if (playlist.length === 0) {
    alert('请先选择音乐文件 🎵')
    return
  }
  if (currentIndex === -1) {
    loadTrack(0)
    return
  }
  if (audio.paused) {
    audio.play()
    playBtn.textContent = '⏸ 暂停'
  } else {
    audio.pause()
    playBtn.textContent = '▶️ 播放'
  }
})

// Previous track
prevBtn.addEventListener('click', () => {
  if (playlist.length === 0) return
  const newIndex = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1
  loadTrack(newIndex)
})

// Next track
nextBtn.addEventListener('click', () => {
  if (playlist.length === 0) return
  const newIndex = currentIndex >= playlist.length - 1 ? 0 : currentIndex + 1
  loadTrack(newIndex)
})

// Single-song loop toggle
loopBtn.addEventListener('click', () => {
  isLooping = !isLooping
  audio.loop = isLooping
  loopBtn.classList.toggle('btn-active', isLooping)
  loopBtn.title = isLooping ? '单曲循环: 开' : '单曲循环: 关'
})

// Auto-advance to next track when current one ends (only when not looping)
audio.addEventListener('ended', () => {
  if (isLooping) return  // audio.loop already handles repetition
  if (currentIndex < playlist.length - 1) {
    loadTrack(currentIndex + 1)
  } else {
    playBtn.textContent = '▶️ 播放'
  }
})

// Update progress bar and current time while playing
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return
  const pct = (audio.currentTime / audio.duration) * 100
  progressBar.style.width = pct + '%'
  currentTimeEl.textContent = formatTime(audio.currentTime)
})

// Show total duration once metadata is loaded
audio.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audio.duration)
})

// Click on progress bar to seek
progressContainer.addEventListener('click', (e) => {
  if (!audio.duration) return
  const rect = progressContainer.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration
})

// Show empty-state hint on initial load
updatePlaylistUI()
refreshSavedPlaylists()
