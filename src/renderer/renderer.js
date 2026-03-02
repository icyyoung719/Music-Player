// renderer.js
const fileInput = document.getElementById('fileInput')
const folderBtn = document.getElementById('folderBtn')
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

let audio = new Audio()
let playlist = []   // Array of { name, path, file? }
let currentIndex = -1
let isLooping = false

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

// Reset progress bar and time display
function resetProgress() {
  progressBar.style.width = '0%'
  currentTimeEl.textContent = '0:00'
  totalTimeEl.textContent = '0:00'
}

// Rebuild the playlist DOM
function updatePlaylistUI() {
  playlistEl.innerHTML = ''
  playlist.forEach((track, index) => {
    const item = document.createElement('div')
    item.className = 'playlist-item' + (index === currentIndex ? ' active' : '')

    const idxSpan = document.createElement('span')
    idxSpan.className = 'playlist-index'
    idxSpan.textContent = index + 1

    const titleSpan = document.createElement('span')
    titleSpan.className = 'playlist-item-title'
    titleSpan.textContent = track.name

    item.appendChild(idxSpan)
    item.appendChild(titleSpan)
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
    }
  }

  audio.play()
  playBtn.textContent = '⏸ 暂停'
  updatePlaylistUI()
}

// Replace the current playlist with newTracks and start playing the first one
function replacePlaylist(newTracks) {
  playlist = newTracks
  currentIndex = -1
  updatePlaylistUI()
  if (newTracks.length > 0) loadTrack(0)
}

// Select multiple files via file input
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files)
  if (!files.length) return
  replacePlaylist(files.map(f => ({ name: f.name, file: f, path: null })))
  fileInput.value = ''
})

// Select folder via Electron dialog
folderBtn.addEventListener('click', async () => {
  if (!window.electronAPI || !window.electronAPI.selectFolder) return
  const paths = await window.electronAPI.selectFolder()
  if (!paths || !paths.length) return
  replacePlaylist(paths.map(p => ({
    name: p.split(/[/\\]/).pop(),
    path: p,
    file: null
  })))
})

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
