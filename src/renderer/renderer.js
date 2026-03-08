// renderer.js
import { initTheme } from './modules/theme.js'
import {
  formatTime,
  filePathToURL,
  getFileNameFromPath,
  normalizePath,
  getTrackUniqueKey,
  getCurrentTrackPath
} from './modules/trackUtils.js'

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
const bottomTrackTitleEl = document.getElementById('bottomTrackTitle')
const bottomTrackArtistEl = document.getElementById('bottomTrackArtist')
const homePageEl = document.getElementById('homePage')
const songPageEl = document.getElementById('songPage')
const songBackBtn = document.getElementById('songBackBtn')
const homeGoSongBtn = document.getElementById('homeGoSongBtn')
const homeNowTitleEl = document.getElementById('homeNowTitle')
const homeNowArtistEl = document.getElementById('homeNowArtist')
const homeNowCoverImgEl = document.getElementById('homeNowCoverImg')
const homeNowCoverPlaceholderEl = document.getElementById('homeNowCoverPlaceholder')
const homeFeaturedCoverEl = document.getElementById('homeFeaturedCover')
const homeFeaturedTitleEl = document.getElementById('homeFeaturedTitle')
const savedPlaylistSelect = document.getElementById('savedPlaylistSelect')
const savedCreateBtn = document.getElementById('savedCreateBtn')
const savedRenameBtn = document.getElementById('savedRenameBtn')
const savedDeleteBtn = document.getElementById('savedDeleteBtn')
const savedAppendToQueueBtn = document.getElementById('savedAppendToQueueBtn')
const savedReplaceQueueBtn = document.getElementById('savedReplaceQueueBtn')
const savedAddCurrentBtn = document.getElementById('savedAddCurrentBtn')
const savedImportBtn = document.getElementById('savedImportBtn')
const savedExportBtn = document.getElementById('savedExportBtn')
const savedTracksEl = document.getElementById('savedTracks')
const shortcutBtn = document.getElementById('shortcutBtn')
const shortcutOverlay = document.getElementById('shortcutOverlay')
const shortcutList = document.getElementById('shortcutList')
const shortcutCloseBtn = document.getElementById('shortcutCloseBtn')
const shortcutResetBtn = document.getElementById('shortcutResetBtn')
const shortcutConfirmBtn = document.getElementById('shortcutConfirmBtn')
const windowMinimizeBtn = document.getElementById('windowMinimizeBtn')

let audio = new Audio()
let playlist = []   // Array of { name, path, file?, metadataCache? }
let currentIndex = -1
let isLooping = false
let savedState = { playlists: [], trackLibrary: {} }
let selectedSavedPlaylistId = null
const SHORTCUT_STORAGE_KEY = 'musicPlayer.shortcuts.v1'
const SEEK_SECONDS = 5
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const shortcutActions = {
  togglePlay: { label: '播放 / 暂停', defaultKey: 'Space' },
  seekBackward: { label: `快退 ${SEEK_SECONDS} 秒`, defaultKey: 'ArrowLeft' },
  seekForward: { label: `快进 ${SEEK_SECONDS} 秒`, defaultKey: 'ArrowRight' },
  previousTrack: { label: '上一首', defaultKey: '' },
  nextTrack: { label: '下一首', defaultKey: '' },
  toggleLoop: { label: '切换单曲循环', defaultKey: '' },
  showHomePage: { label: '打开主页面', defaultKey: '' },
  showSongPage: { label: '打开歌曲页', defaultKey: '' },
  toggleTheme: { label: '切换明暗主题', defaultKey: '' },
  openShortcuts: { label: '打开快捷键面板', defaultKey: '' },
  minimizeWindow: { label: '最小化窗口', defaultKey: '' },
  clearPlaylist: { label: '清空当前列表', defaultKey: '' }
}
const shortcutActionOrder = Object.keys(shortcutActions)
const defaultShortcuts = Object.fromEntries(
  shortcutActionOrder.map((action) => [action, shortcutActions[action].defaultKey])
)
let shortcutConfig = { ...defaultShortcuts }
let draftShortcutConfig = null
let waitingShortcutAction = null

function cloneShortcutConfig(config) {
  return Object.fromEntries(shortcutActionOrder.map(action => [action, config[action] || '']))
}

function getShortcutEditingConfig() {
  return draftShortcutConfig || shortcutConfig
}

function hasUnsavedShortcutChanges() {
  if (!draftShortcutConfig) return false
  return shortcutActionOrder.some(action => (draftShortcutConfig[action] || '') !== (shortcutConfig[action] || ''))
}

function normalizeKeyName(key) {
  if (typeof key !== 'string') return null
  if (key === ' ') return 'Space'
  const value = key.trim()
  if (!value) return null
  if (value.length === 1) return value.toUpperCase()
  return value
}

function normalizeShortcutString(shortcut) {
  if (typeof shortcut !== 'string') return null
  const parts = shortcut.split('+').map(part => part.trim()).filter(Boolean)
  if (!parts.length) return ''

  const modifiers = []
  let baseKey = null

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') {
      if (!modifiers.includes('Ctrl')) modifiers.push('Ctrl')
      continue
    }
    if (lower === 'alt') {
      if (!modifiers.includes('Alt')) modifiers.push('Alt')
      continue
    }
    if (lower === 'shift') {
      if (!modifiers.includes('Shift')) modifiers.push('Shift')
      continue
    }
    if (lower === 'meta' || lower === 'cmd' || lower === 'win' || lower === 'super') {
      if (!modifiers.includes('Meta')) modifiers.push('Meta')
      continue
    }

    const normalized = normalizeKeyName(part)
    if (!normalized) continue
    baseKey = normalized
  }

  if (!baseKey) {
    return modifiers.length ? null : ''
  }

  const order = ['Ctrl', 'Alt', 'Shift', 'Meta']
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return modifiers.length ? `${modifiers.join('+')}+${baseKey}` : baseKey
}

function getShortcutFromKeyboardEvent(e) {
  const key = normalizeKeyName(e.key)
  if (!key) return null
  if (MODIFIER_KEYS.has(key)) return null

  const modifiers = []
  if (e.ctrlKey) modifiers.push('Ctrl')
  if (e.altKey) modifiers.push('Alt')
  if (e.shiftKey) modifiers.push('Shift')
  if (e.metaKey) modifiers.push('Meta')

  return modifiers.length ? `${modifiers.join('+')}+${key}` : key
}

function formatShortcutKey(shortcut) {
  const normalized = normalizeShortcutString(shortcut)
  if (!normalized) return '未设置'
  return normalized.replaceAll('Arrow', 'Arrow ')
}

function isEditableElement(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function saveShortcutConfig() {
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcutConfig))
  } catch (err) {
    console.warn('Failed to persist shortcuts:', err)
  }
}

function loadShortcutConfig() {
  try {
    const raw = localStorage.getItem(SHORTCUT_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return

    for (const action of shortcutActionOrder) {
      const key = normalizeShortcutString(parsed[action])
      if (typeof key === 'string') {
        shortcutConfig[action] = key
      }
    }
  } catch (err) {
    console.warn('Failed to load shortcuts:', err)
  }
}

function setShortcutForAction(action, key) {
  if (!draftShortcutConfig) return

  const normalizedKey = normalizeShortcutString(key)
  if (!normalizedKey) return

  for (const actionName of shortcutActionOrder) {
    if (draftShortcutConfig[actionName] === normalizedKey) {
      draftShortcutConfig[actionName] = ''
    }
  }

  draftShortcutConfig[action] = normalizedKey
  renderShortcutPanel()
}

function resetShortcuts() {
  if (!draftShortcutConfig) return
  draftShortcutConfig = { ...defaultShortcuts }
  waitingShortcutAction = null
  renderShortcutPanel()
}

function clearShortcutForAction(action) {
  if (!draftShortcutConfig) return
  draftShortcutConfig[action] = ''
  renderShortcutPanel()
}

function applyShortcutChanges() {
  if (!draftShortcutConfig) return
  shortcutConfig = cloneShortcutConfig(draftShortcutConfig)
  saveShortcutConfig()
}

function toggleLoopState() {
  isLooping = !isLooping
  audio.loop = isLooping
  loopBtn.classList.toggle('btn-active', isLooping)
  loopBtn.title = isLooping ? '单曲循环: 开' : '单曲循环: 关'
}

function handleShortcutAction(action) {
  switch (action) {
    case 'togglePlay':
      togglePlayback({ silent: true })
      break
    case 'seekBackward':
      if (!audio.duration) return
      audio.currentTime = Math.max(0, audio.currentTime - SEEK_SECONDS)
      break
    case 'seekForward':
      if (!audio.duration) return
      audio.currentTime = Math.min(audio.duration, audio.currentTime + SEEK_SECONDS)
      break
    case 'previousTrack':
      playPreviousTrack()
      break
    case 'nextTrack':
      playNextTrack()
      break
    case 'toggleLoop':
      toggleLoopState()
      break
    case 'showHomePage':
      showHomePage()
      break
    case 'showSongPage':
      showSongPage()
      break
    case 'toggleTheme': {
      const themeToggle = document.querySelector('[data-theme-toggle]')
      if (themeToggle) themeToggle.click()
      break
    }
    case 'openShortcuts':
      showShortcutPanel()
      break
    case 'minimizeWindow':
      if (window.electronAPI && window.electronAPI.minimizeWindow) {
        window.electronAPI.minimizeWindow()
      }
      break
    case 'clearPlaylist':
      if (playlist.length > 0) {
        clearPlaylist()
      }
      break
    default:
      break
  }
}

function renderShortcutPanel() {
  if (!shortcutList) return
  shortcutList.innerHTML = ''
  const currentConfig = getShortcutEditingConfig()

  shortcutActionOrder.forEach((action) => {
    const row = document.createElement('div')
    row.className = 'shortcut-row'

    const nameEl = document.createElement('div')
    nameEl.className = 'shortcut-name'
    nameEl.textContent = shortcutActions[action].label

    const keyEl = document.createElement('div')
    keyEl.className = 'shortcut-key'
    keyEl.textContent = waitingShortcutAction === action ? '请按键...' : formatShortcutKey(currentConfig[action])

    const editBtn = document.createElement('button')
    editBtn.textContent = waitingShortcutAction === action ? '取消' : '修改'
    editBtn.addEventListener('click', () => {
      waitingShortcutAction = waitingShortcutAction === action ? null : action
      renderShortcutPanel()
    })

    const clearBtn = document.createElement('button')
    clearBtn.textContent = '清空'
    clearBtn.title = '清空该动作的快捷键绑定'
    clearBtn.disabled = !currentConfig[action]
    clearBtn.addEventListener('click', () => {
      clearShortcutForAction(action)
    })

    row.appendChild(nameEl)
    row.appendChild(keyEl)
    row.appendChild(editBtn)
    row.appendChild(clearBtn)
    shortcutList.appendChild(row)
  })
}

function showShortcutPanel() {
  if (!shortcutOverlay) return
  draftShortcutConfig = cloneShortcutConfig(shortcutConfig)
  waitingShortcutAction = null
  renderShortcutPanel()
  shortcutOverlay.classList.add('visible')
  shortcutOverlay.setAttribute('aria-hidden', 'false')
}

function hideShortcutPanel(options = {}) {
  if (!shortcutOverlay) return
  const { force = false } = options

  if (!force && hasUnsavedShortcutChanges()) {
    const confirmed = confirm('快捷键修改尚未保存，确认放弃本次修改并退出吗？')
    if (!confirmed) {
      return false
    }
  }

  waitingShortcutAction = null
  draftShortcutConfig = null
  shortcutOverlay.classList.remove('visible')
  shortcutOverlay.setAttribute('aria-hidden', 'true')
  return true
}

function matchShortcutActionByKey(key) {
  const normalizedKey = normalizeShortcutString(key)
  if (!normalizedKey) return null
  return shortcutActionOrder.find(action => shortcutConfig[action] === normalizedKey) || null
}

function showSongPage() {
  if (homePageEl) homePageEl.classList.add('page-hidden')
  if (songPageEl) songPageEl.classList.remove('page-hidden')
}

function showHomePage() {
  if (songPageEl) songPageEl.classList.add('page-hidden')
  if (homePageEl) homePageEl.classList.remove('page-hidden')
}

function setHomeNowCover(dataUrl) {
  if (!homeNowCoverImgEl || !homeNowCoverPlaceholderEl) return
  if (dataUrl) {
    homeNowCoverImgEl.src = dataUrl
    homeNowCoverImgEl.style.display = 'block'
    homeNowCoverPlaceholderEl.style.display = 'none'
    if (homeFeaturedCoverEl) {
      homeFeaturedCoverEl.style.backgroundImage = `url(${dataUrl})`
      homeFeaturedCoverEl.style.backgroundSize = 'cover'
      homeFeaturedCoverEl.style.backgroundPosition = 'center'
    }
  } else {
    homeNowCoverImgEl.src = ''
    homeNowCoverImgEl.style.display = 'none'
    homeNowCoverPlaceholderEl.style.display = 'inline'
    if (homeFeaturedCoverEl) {
      homeFeaturedCoverEl.style.backgroundImage = ''
    }
  }
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

function setPlayButtonState(isPlaying) {
  if (!playBtn) return
  playBtn.textContent = isPlaying ? '⏸' : '▶'
  playBtn.title = isPlaying ? '暂停' : '播放'
}

function reportPlayerState() {
  if (!window.electronAPI || !window.electronAPI.reportPlayerState) return

  const hasQueue = playlist.length > 0
  const currentTrack = currentIndex >= 0 && currentIndex < playlist.length ? playlist[currentIndex] : null
  const title = trackTitle && trackTitle.textContent ? trackTitle.textContent : (currentTrack?.name || '')

  window.electronAPI.reportPlayerState({
    hasQueue,
    isPlaying: hasQueue && !audio.paused,
    title
  })
}

function setBottomNowPlaying(title, artist) {
  if (bottomTrackTitleEl) {
    bottomTrackTitleEl.textContent = title || '\u00a0'
  }
  if (bottomTrackArtistEl) {
    bottomTrackArtistEl.textContent = artist || '\u00a0'
  }
  if (homeNowTitleEl) {
    homeNowTitleEl.textContent = title || 'Little Busters!'
  }
  if (homeNowArtistEl) {
    homeNowArtistEl.textContent = artist || 'Rita / VISUAL ARTS'
  }
  if (homeFeaturedTitleEl && title) {
    homeFeaturedTitleEl.textContent = title
  }
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

  reportPlayerState()
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
  setBottomNowPlaying(track.name, '')
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
      setBottomNowPlaying(meta.title || track.name, meta.artist || '')
      const albumParts = [meta.album, meta.year].filter(Boolean)
      trackAlbum.textContent = albumParts.join(' · ')
      if (meta.coverDataUrl) {
        coverImg.src = meta.coverDataUrl
        coverImg.style.display = 'block'
        coverPlaceholder.style.display = 'none'
        setHomeNowCover(meta.coverDataUrl)
      } else {
        setHomeNowCover(null)
      }

      track.metadataCache = {
        title: meta.title || track.name,
        artist: meta.artist || null,
        album: meta.album || null,
        duration: meta.duration || null
      }
    }
  }

  try {
    await audio.play()
    setPlayButtonState(true)
  } catch (err) {
    console.warn('Failed to play audio:', err)
    setPlayButtonState(false)
  }
  updatePlaylistUI()
  reportPlayerState()
}

// Append newTracks to the current playlist; auto-play if the queue was empty
function appendToPlaylist(newTracks) {
  if (!newTracks.length) return
  const wasEmpty = playlist.length === 0

  const existingKeys = new Set(playlist.map(track => getTrackUniqueKey(track, window.electronAPI)))
  const dedupedTracks = []

  for (const track of newTracks) {
    const key = getTrackUniqueKey(track, window.electronAPI)
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
    setPlayButtonState(false)
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
      setBottomNowPlaying('', '')
      setHomeNowCover(null)
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
  setPlayButtonState(false)
  resetProgress()
  trackTitle.textContent = '未选择歌曲'
  trackArtist.textContent = ''
  trackAlbum.textContent = ''
  setBottomNowPlaying('', '')
  setHomeNowCover(null)
  coverImg.style.display = 'none'
  coverImg.src = ''
  coverPlaceholder.style.display = 'flex'
  updatePlaylistUI()
  reportPlayerState()
}

function playPreviousTrack() {
  if (playlist.length === 0) return
  const newIndex = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1
  loadTrack(newIndex)
}

function playNextTrack() {
  if (playlist.length === 0) return
  const newIndex = currentIndex >= playlist.length - 1 ? 0 : currentIndex + 1
  loadTrack(newIndex)
}

document.addEventListener('keydown', (e) => {
  const pressedShortcut = getShortcutFromKeyboardEvent(e)

  if (waitingShortcutAction) {
    e.preventDefault()
    if (e.key === 'Escape') {
      waitingShortcutAction = null
      renderShortcutPanel()
      return
    }
    if (!pressedShortcut) return
    setShortcutForAction(waitingShortcutAction, pressedShortcut)
    waitingShortcutAction = null
    renderShortcutPanel()
    return
  }

  const isShortcutPanelVisible = !!(shortcutOverlay && shortcutOverlay.classList.contains('visible'))
  if (isShortcutPanelVisible) {
    if (e.key === 'Escape') {
      e.preventDefault()
      hideShortcutPanel()
    }
    return
  }

  if (!pressedShortcut) return
  if (isEditableElement(e.target)) return

  const action = matchShortcutActionByKey(pressedShortcut)
  if (!action) return

  if (e.repeat && (action === 'togglePlay' || action === 'toggleLoop')) {
    return
  }

  e.preventDefault()
  handleShortcutAction(action)
})

function togglePlayback(options = {}) {
  const { silent = false } = options
  if (playlist.length === 0) {
    if (!silent) {
      alert('请先选择音乐文件 🎵')
    }
    return
  }

  if (currentIndex === -1) {
    loadTrack(0)
    return
  }

  if (audio.paused) {
    audio.play().then(() => {
      setPlayButtonState(true)
      reportPlayerState()
    }).catch((err) => {
      console.warn('Failed to resume audio:', err)
    })
  } else {
    audio.pause()
    setPlayButtonState(false)
    reportPlayerState()
  }
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
    const filePath = getCurrentTrackPath(track, window.electronAPI)
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

function collectSelectedSavedPlaylistTracksForQueue() {
  const selected = getSelectedSavedPlaylist()
  if (!selected) {
    return { ok: false, reason: 'NO_PLAYLIST', tracks: [] }
  }

  if (!selected.trackIds.length) {
    return { ok: false, reason: 'EMPTY_PLAYLIST', tracks: [] }
  }

  const tracks = []
  for (const trackId of selected.trackIds) {
    const savedTrack = savedState.trackLibrary[trackId]
    if (!savedTrack || !savedTrack.path) continue
    const title = savedTrack.metadataCache?.title || getFileNameFromPath(savedTrack.path)
    tracks.push({
      name: title,
      path: savedTrack.path,
      file: null,
      metadataCache: savedTrack.metadataCache || { title }
    })
  }

  if (!tracks.length) {
    return { ok: false, reason: 'NO_VALID_TRACKS', tracks: [] }
  }

  return { ok: true, tracks, playlist: selected }
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

function appendSavedPlaylistToCurrentQueue() {
  const result = collectSelectedSavedPlaylistTracksForQueue()
  if (!result.ok) {
    if (result.reason === 'NO_PLAYLIST') {
      alert('请先选择歌单')
    } else {
      alert('该歌单没有可用歌曲')
    }
    return
  }

  appendToPlaylist(result.tracks)
}

function replaceCurrentQueueWithSavedPlaylist() {
  const result = collectSelectedSavedPlaylistTracksForQueue()
  if (!result.ok) {
    if (result.reason === 'NO_PLAYLIST') {
      alert('请先选择歌单')
    } else {
      alert('该歌单没有可用歌曲')
    }
    return
  }

  if (playlist.length > 0) {
    const confirmed = confirm('确认使用所选歌单替换当前播放列表吗？')
    if (!confirmed) return
  }

  clearPlaylist()
  appendToPlaylist(result.tracks)
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
if (savedAppendToQueueBtn) savedAppendToQueueBtn.addEventListener('click', appendSavedPlaylistToCurrentQueue)
if (savedReplaceQueueBtn) savedReplaceQueueBtn.addEventListener('click', replaceCurrentQueueWithSavedPlaylist)
if (savedAddCurrentBtn) savedAddCurrentBtn.addEventListener('click', addCurrentQueueToSavedPlaylist)
if (savedImportBtn) savedImportBtn.addEventListener('click', importSavedPlaylist)
if (savedExportBtn) savedExportBtn.addEventListener('click', exportSavedPlaylist)

if (songBackBtn) {
  songBackBtn.addEventListener('click', () => {
    showHomePage()
  })
}

if (homeGoSongBtn) {
  homeGoSongBtn.addEventListener('click', () => {
    showSongPage()
  })
}

if (shortcutBtn) {
  shortcutBtn.addEventListener('click', () => {
    showShortcutPanel()
  })
}

if (shortcutCloseBtn) {
  shortcutCloseBtn.addEventListener('click', () => {
    hideShortcutPanel()
  })
}

if (shortcutOverlay) {
  shortcutOverlay.addEventListener('click', (e) => {
    if (e.target === shortcutOverlay) {
      hideShortcutPanel()
    }
  })
}

if (shortcutResetBtn) {
  shortcutResetBtn.addEventListener('click', () => {
    const confirmed = confirm('确定要恢复默认快捷键吗？\n当前自定义绑定将被覆盖。')
    if (!confirmed) return
    resetShortcuts()
  })
}

if (shortcutConfirmBtn) {
  shortcutConfirmBtn.addEventListener('click', () => {
    applyShortcutChanges()
    hideShortcutPanel({ force: true })
  })
}

if (windowMinimizeBtn) {
  windowMinimizeBtn.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.minimizeWindow) {
      window.electronAPI.minimizeWindow()
    }
  })
}

document.querySelectorAll('[data-open-song]').forEach((el) => {
  el.addEventListener('click', () => {
    showSongPage()
  })
})

// Play / Pause
playBtn.addEventListener('click', () => {
  togglePlayback({ silent: false })
})

// Previous track
prevBtn.addEventListener('click', () => {
  playPreviousTrack()
})

// Next track
nextBtn.addEventListener('click', () => {
  playNextTrack()
})

// Single-song loop toggle
loopBtn.addEventListener('click', () => {
  toggleLoopState()
})

// Auto-advance to next track when current one ends (only when not looping)
audio.addEventListener('ended', () => {
  if (isLooping) return  // audio.loop already handles repetition
  if (currentIndex < playlist.length - 1) {
    loadTrack(currentIndex + 1)
  } else {
    setPlayButtonState(false)
    reportPlayerState()
  }
})

audio.addEventListener('play', () => {
  setPlayButtonState(true)
  reportPlayerState()
})

audio.addEventListener('pause', () => {
  if (!audio.ended) {
    setPlayButtonState(false)
  }
  reportPlayerState()
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
loadShortcutConfig()
renderShortcutPanel()
updatePlaylistUI()
setPlayButtonState(false)
refreshSavedPlaylists()
showHomePage()
reportPlayerState()
initTheme()

if (window.electronAPI && window.electronAPI.onPlayerControl) {
  window.electronAPI.onPlayerControl((action) => {
    switch (action) {
      case 'toggle-play':
        togglePlayback({ silent: true })
        break
      case 'next-track':
        playNextTrack()
        break
      case 'previous-track':
        playPreviousTrack()
        break
      default:
        break
    }
  })
}
