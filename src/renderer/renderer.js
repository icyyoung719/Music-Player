import { initTheme } from './modules/theme.js'
import { createShortcutManager } from './modules/shortcutManager.js'
import { createSavedPlaylistManager } from './modules/savedPlaylistManager.js'
import { createPlaybackController } from './modules/playbackController.js'
import { createNeteaseManager } from './modules/neteaseManager.js'
import { createNeteaseSearchManager } from './modules/neteaseSearchManager.js'
import { createAccountManager } from './modules/accountManager.js'
import { createDownloadManager } from './modules/downloadManager.js'
import { createToastManager } from './modules/toastManager.js'
import { createDailyRecommendationManager } from './modules/dailyRecommendationManager.js'

const homePageEl = document.getElementById('homePage')
const songPageEl = document.getElementById('songPage')
const homeNowCoverImgEl = document.getElementById('homeNowCoverImg')
const homeNowCoverPlaceholderEl = document.getElementById('homeNowCoverPlaceholder')
const homeFeaturedCoverEl = document.getElementById('homeFeaturedCover')
const homeMenuRecommendEl = document.getElementById('homeMenuRecommend')
const homeMenuDownloadEl = document.getElementById('homeMenuDownload')
const homeCreatedPlaylistListEl = document.getElementById('homeCreatedPlaylistList')
const homeRecommendViewEl = document.getElementById('homeRecommendView')
const homeDownloadViewEl = document.getElementById('homeDownloadView')
const homePlaylistDetailViewEl = document.getElementById('homePlaylistDetailView')
const globalPlayerBarEl = document.getElementById('globalPlayerBar')
const windowMinimizeBtn = document.getElementById('windowMinimizeBtn')
const homeLoginBtn = document.getElementById('homeLoginBtn')
const homeUserNameEl = document.getElementById('homeUserName')
const homeUserDetailEl = document.getElementById('homeUserDetail')
const homeUserAvatarEl = document.getElementById('homeUserAvatar')
const appToastContainerEl = document.getElementById('appToastContainer')

const shortcutDom = {
  shortcutOverlay: null,
  shortcutList: document.getElementById('shortcutList'),
  shortcutCloseBtn: null,
  shortcutResetBtn: document.getElementById('shortcutResetBtn'),
  shortcutConfirmBtn: document.getElementById('shortcutConfirmBtn')
}

const settingsDom = {
  settingsBtn: document.getElementById('settingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  settingsTabs: document.querySelectorAll('[data-settings-tab]'),
  settingsPanels: document.querySelectorAll('[data-settings-panel]'),
  fadeInDurationInput: document.getElementById('fadeInDurationInput'),
  fadeOutDurationInput: document.getElementById('fadeOutDurationInput'),
  fadeSaveBtn: document.getElementById('fadeSaveBtn')
}

const savedPlaylistDom = {
  sidebarListEl: homeCreatedPlaylistListEl,
  sidebarCreateBtn: document.getElementById('homeCreatePlaylistBtn'),
  detailViewEl: homePlaylistDetailViewEl,
  detailTitleEl: document.getElementById('homePlaylistDetailTitle'),
  detailSubtitleEl: document.getElementById('homePlaylistDetailSubtitle'),
  detailMetaEl: document.getElementById('homePlaylistDetailMeta'),
  detailCoverEl: document.getElementById('homePlaylistDetailCover'),
  detailCoverTextEl: document.getElementById('homePlaylistDetailCoverText'),
  detailTitleEditBtn: document.getElementById('homePlaylistTitleEditBtn'),
  detailTrackListEl: document.getElementById('homePlaylistTrackList'),
  detailDeleteBtn: document.getElementById('homePlaylistDeleteBtn'),
  detailPlayAllBtn: document.getElementById('homePlaylistPlayAllBtn'),
  detailAppendBtn: document.getElementById('homePlaylistAppendBtn'),
  detailAddCurrentBtn: document.getElementById('homePlaylistAddCurrentBtn')
}

const playbackDom = {
  songPageEl: document.getElementById('songPage'),
  songAddFileBtn: document.getElementById('songAddFileBtn'),
  songAddFolderBtn: document.getElementById('songAddFolderBtn'),
  songOpenQueueBtn: document.getElementById('songOpenQueueBtn'),
  fileInput: document.getElementById('fileInput'),
  folderBtn: document.getElementById('folderBtn'),
  clearBtn: document.getElementById('clearBtn'),
  queueSaveBtn: document.getElementById('queueSaveBtn'),
  queueToggleBtn: document.getElementById('queueToggleBtn'),
  queueCloseBtn: document.getElementById('queueCloseBtn'),
  queueOverlayEl: document.getElementById('queueOverlay'),
  queueOverlayBackdropEl: document.getElementById('queueOverlayBackdrop'),
  playBtn: document.getElementById('playBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  loopBtn: document.getElementById('loopBtn'),
  trackTitle: document.getElementById('trackTitle'),
  trackArtist: document.getElementById('trackArtist'),
  trackAlbum: document.getElementById('trackAlbum'),
  coverImg: document.getElementById('coverImg'),
  coverPlaceholder: document.querySelector('.cover-placeholder'),
  playlistEl: document.getElementById('playlist'),
  progressContainer: document.getElementById('progressContainer'),
  progressBar: document.getElementById('progressBar'),
  currentTimeEl: document.getElementById('currentTime'),
  totalTimeEl: document.getElementById('totalTime'),
  bottomTrackTitleEl: document.getElementById('bottomTrackTitle'),
  bottomTrackArtistEl: document.getElementById('bottomTrackArtist'),
  bottomTrackCoverImgEl: document.getElementById('bottomTrackCoverImg'),
  bottomTrackCoverPlaceholderEl: document.getElementById('bottomTrackCoverPlaceholder'),
  homeNowTitleEl: document.getElementById('homeNowTitle'),
  homeNowArtistEl: document.getElementById('homeNowArtist'),
  homeFeaturedTitleEl: document.getElementById('homeFeaturedTitle'),
  songBackBtn: document.getElementById('songBackBtn'),
  homeGoSongBtn: document.getElementById('homeGoSongBtn')
}

const neteaseDom = {
  input: document.getElementById('neteaseIdInput'),
  type: document.getElementById('neteaseTypeSelect'),
  searchBtn: document.getElementById('neteaseSearchBtn'),
  openBtn: document.getElementById('neteaseOpenBtn'),
  result: document.getElementById('neteaseResult'),
  authApiBaseInput: document.getElementById('neteaseAuthApiBase'),
  authEmailInput: document.getElementById('neteaseAuthEmail'),
  authPasswordInput: document.getElementById('neteaseAuthPassword'),
  authEmailLoginBtn: document.getElementById('neteaseAuthEmailLoginBtn'),
  authCountryCodeInput: document.getElementById('neteaseAuthCountryCode'),
  authPhoneInput: document.getElementById('neteaseAuthPhone'),
  authCaptchaInput: document.getElementById('neteaseAuthCaptcha'),
  authSendCaptchaBtn: document.getElementById('neteaseAuthSendCaptchaBtn'),
  authPhoneCaptchaLoginBtn: document.getElementById('neteaseAuthPhoneCaptchaLoginBtn'),
  authQrView: document.getElementById('neteaseQrView'),
  authQrImg: document.getElementById('neteaseQrImg'),
  authQrPlaceholder: document.getElementById('neteaseQrPlaceholder'),
  authQrLink: document.getElementById('neteaseQrLink'),
  authQrCreateBtn: document.getElementById('neteaseAuthQrCreateBtn'),
  authQrOpenBtn: document.getElementById('neteaseAuthQrOpenBtn'),
  authQrStartPollBtn: document.getElementById('neteaseAuthQrStartPollBtn'),
  authQrStopPollBtn: document.getElementById('neteaseAuthQrStopPollBtn'),
  authAccessTokenInput: document.getElementById('neteaseAuthAccessToken'),
  authRefreshTokenInput: document.getElementById('neteaseAuthRefreshToken'),
  authUserNameInput: document.getElementById('neteaseAuthUserName'),
  authUserIdInput: document.getElementById('neteaseAuthUserId'),
  authSaveBtn: document.getElementById('neteaseAuthSaveBtn'),
  authVerifyBtn: document.getElementById('neteaseAuthVerifyBtn'),
  authClearBtn: document.getElementById('neteaseAuthClearBtn'),
  authStatus: document.getElementById('neteaseAuthStatus'),
  songIdDownloadInput: document.getElementById('neteaseSongIdDownloadInput'),
  downloadLevelSelect: document.getElementById('neteaseDownloadLevelSelect'),
  downloadSongBtn: document.getElementById('neteaseDownloadSongBtn'),
  downloadSongAndQueueBtn: document.getElementById('neteaseDownloadSongAndQueueBtn'),
  downloadDirBtn: document.getElementById('neteaseDownloadDirBtn'),
  directUrlInput: document.getElementById('neteaseDirectUrlInput'),
  directDownloadBtn: document.getElementById('neteaseDirectDownloadBtn'),
  taskList: document.getElementById('neteaseTaskList')
}

const neteaseSearchDom = {
  keywordType: document.getElementById('neteaseKeywordTypeSelect'),
  keywordInput: document.getElementById('neteaseKeywordInput'),
  searchBtn: document.getElementById('neteaseKeywordSearchBtn'),
  suggestList: document.getElementById('neteaseSuggestList'),
  searchStatus: document.getElementById('neteaseKeywordStatus'),
  resultList: document.getElementById('neteaseKeywordResultList'),
  prevBtn: document.getElementById('neteaseKeywordPrevBtn'),
  nextBtn: document.getElementById('neteaseKeywordNextBtn'),
  pageInfo: document.getElementById('neteaseKeywordPageInfo')
}

const downloadDom = {
  songIdInput: document.getElementById('downloadSongIdInput'),
  songResolveBtn: document.getElementById('downloadSongResolveBtn'),
  songPreview: document.getElementById('downloadSongPreview'),
  qualitySelect: document.getElementById('downloadQualitySelect'),
  songOnlyBtn: document.getElementById('downloadSongOnlyBtn'),
  songTempQueueBtn: document.getElementById('downloadSongTempQueueBtn'),
  songAndQueueBtn: document.getElementById('downloadSongAndQueueBtn'),
  playlistIdInput: document.getElementById('downloadPlaylistIdInput'),
  playlistResolveBtn: document.getElementById('downloadPlaylistResolveBtn'),
  playlistPreview: document.getElementById('downloadPlaylistPreview'),
  playlistOnlyBtn: document.getElementById('downloadPlaylistOnlyBtn'),
  playlistAndQueueBtn: document.getElementById('downloadPlaylistAndQueueBtn'),
  playlistAndSaveBtn: document.getElementById('downloadPlaylistAndSaveBtn'),
  openSongsDirBtn: document.getElementById('downloadOpenSongsDirBtn'),
  openTempDirBtn: document.getElementById('downloadOpenTempDirBtn'),
  openListsDirBtn: document.getElementById('downloadOpenListsDirBtn'),
  clearTempBtn: document.getElementById('downloadClearTempBtn'),
  taskFilterSelect: document.getElementById('downloadTaskFilterSelect'),
  taskList: document.getElementById('downloadTaskList')
}

const dailyRecommendationDom = {
  coverEl: document.getElementById('dailyRecommendCover'),
  metaEl: document.getElementById('dailyRecommendMeta')
}

const SHORTCUT_STORAGE_KEY = 'musicPlayer.shortcuts.v1'
const SEEK_SECONDS = 5
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
  openShortcuts: { label: '打开设置页面', defaultKey: '' },
  minimizeWindow: { label: '最小化窗口', defaultKey: '' },
  clearPlaylist: { label: '清空当前列表', defaultKey: '' }
}

let shortcutManager = null
let playbackController = null
let accountManager = null
let savedPlaylistManager = null
let toastManager = null
let dailyRecommendationManager = null
let currentHomeView = 'recommend'
let currentSettingsTab = 'playback'
const createdSavedPlaylistIdsByName = new Map()
const pendingSavedPlaylistPromises = new Map()

function showHomeView(view) {
  currentHomeView = ['recommend', 'download', 'playlist-detail'].includes(view)
    ? view
    : 'recommend'

  if (homeRecommendViewEl) {
    homeRecommendViewEl.classList.toggle('page-hidden', currentHomeView !== 'recommend')
  }

  if (homeDownloadViewEl) {
    homeDownloadViewEl.classList.toggle('page-hidden', currentHomeView !== 'download')
  }

  if (homePlaylistDetailViewEl) {
    homePlaylistDetailViewEl.classList.toggle('page-hidden', currentHomeView !== 'playlist-detail')
  }

  if (homeMenuRecommendEl) {
    homeMenuRecommendEl.classList.toggle('active', currentHomeView === 'recommend')
  }

  if (homeMenuDownloadEl) {
    homeMenuDownloadEl.classList.toggle('active', currentHomeView === 'download')
  }

  if (savedPlaylistManager && savedPlaylistManager.setActiveView) {
    savedPlaylistManager.setActiveView(currentHomeView)
  }
}

function showHomeShell() {
  if (songPageEl) songPageEl.classList.add('page-hidden')
  if (homePageEl) homePageEl.classList.remove('page-hidden')
}

function openSavedPlaylistDetail(playlistId) {
  showHomeShell()

  if (savedPlaylistManager && savedPlaylistManager.openPlaylist) {
    savedPlaylistManager.openPlaylist(playlistId)
  }

  showHomeView('playlist-detail')
}

function showSongPage() {
  if (homePageEl) homePageEl.classList.add('page-hidden')
  if (songPageEl) songPageEl.classList.remove('page-hidden')
  if (playbackController) {
    // Wait for display block to take effect
    requestAnimationFrame(() => {
      playbackController.refreshLyricsScroll()
    })
  }
}

function showHomePage() {
  showHomeShell()
  showHomeView(currentHomeView)
}

function setHomeNowCover(dataUrl) {
  if (homeNowCoverImgEl && homeNowCoverPlaceholderEl) {
    if (dataUrl) {
      homeNowCoverImgEl.src = dataUrl
      homeNowCoverImgEl.style.display = 'block'
      homeNowCoverPlaceholderEl.style.display = 'none'
    } else {
      homeNowCoverImgEl.src = ''
      homeNowCoverImgEl.style.display = 'none'
      homeNowCoverPlaceholderEl.style.display = 'inline'
    }
  }

  if (homeFeaturedCoverEl) {
    if (dataUrl) {
      homeFeaturedCoverEl.style.backgroundImage = `url(${dataUrl})`
      homeFeaturedCoverEl.style.backgroundSize = 'cover'
      homeFeaturedCoverEl.style.backgroundPosition = 'center'
    } else {
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

function setupWindowEvents() {
  document.querySelectorAll('[data-open-song]').forEach((el) => {
    el.addEventListener('click', showSongPage)
  })

  if (windowMinimizeBtn) {
    windowMinimizeBtn.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.minimizeWindow) {
        window.electronAPI.minimizeWindow()
      }
    })
  }

  if (homeMenuRecommendEl) {
    homeMenuRecommendEl.addEventListener('click', () => {
      showHomePage()
      showHomeView('recommend')
    })
  }

  if (homeMenuDownloadEl) {
    homeMenuDownloadEl.addEventListener('click', () => {
      showHomePage()
      showHomeView('download')
    })
  }

  if (homeCreatedPlaylistListEl) {
    homeCreatedPlaylistListEl.addEventListener('click', (event) => {
      const playlistItem = event.target.closest('[data-playlist-id]')
      if (!playlistItem) return
      openSavedPlaylistDetail(playlistItem.dataset.playlistId || '')
    })
  }

  if (globalPlayerBarEl) {
    globalPlayerBarEl.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      // Preserve native behavior for actionable controls.
      if (target.closest('button, .progress-container, input, label, select, a')) return

      showSongPage()
    })
  }
}

function openNeteaseAuthWindow(page = 'email') {
  if (!window.electronAPI || !window.electronAPI.neteaseAuthOpenWindow) return
  window.electronAPI.neteaseAuthOpenWindow({ page })
}

function setupAccountManager() {
  accountManager = createAccountManager({
    electronAPI: window.electronAPI,
    dom: {
      userNameEl: homeUserNameEl,
      userDetailEl: homeUserDetailEl,
      avatarEl: homeUserAvatarEl,
      loginBtnEl: homeLoginBtn
    },
    onRequestLoginWindow: () => openNeteaseAuthWindow('email')
  })

  accountManager.init()
}

function setupPlaybackController() {
  playbackController = createPlaybackController({
    electronAPI: window.electronAPI,
    dom: playbackDom,
    onShowHomePage: showHomePage,
    onShowSongPage: showSongPage,
    onSetHomeNowCover: setHomeNowCover,
    onSavedPlaylistChanged: (playlistId) => {
      if (savedPlaylistManager && savedPlaylistManager.refreshSavedPlaylists) {
        savedPlaylistManager.refreshSavedPlaylists(playlistId)
      }
    }
  })

  playbackController.init()
}

function setupSavedPlaylistManager() {
  savedPlaylistManager = createSavedPlaylistManager({
    electronAPI: window.electronAPI,
    dom: savedPlaylistDom,
    promptForPlaylistName: requestPlaylistName,
    getCurrentQueueTrackInputs: () => playbackController.collectCurrentQueueAsTrackInputs(),
    appendTracksToQueue: (tracks) => playbackController.appendToPlaylist(tracks),
    replaceQueueWithTracks: (tracks, startIndex = 0, options = {}) =>
      playbackController.replaceCurrentQueueWithTracks(tracks, startIndex, options),
    onRequestOpenPlaylist: (playlistId) => openSavedPlaylistDetail(playlistId)
  })

  savedPlaylistManager.init()
}

async function ensureSavedPlaylistByName(name, playlistKey = '') {
  const cleanName = String(name || '').trim()
  const cacheKey = String(playlistKey || cleanName).trim()
  if (!cleanName || !window.electronAPI || !window.electronAPI.playlistCreate) return ''
  if (cacheKey && createdSavedPlaylistIdsByName.has(cacheKey)) {
    return createdSavedPlaylistIdsByName.get(cacheKey)
  }

  if (cacheKey && pendingSavedPlaylistPromises.has(cacheKey)) {
    return pendingSavedPlaylistPromises.get(cacheKey)
  }

  const createPromise = (async () => {
    const created = await window.electronAPI.playlistCreate(cleanName)
    if (!created?.ok || !created?.playlist?.id) return ''
    const playlistId = created.playlist.id
    if (cacheKey) {
      createdSavedPlaylistIdsByName.set(cacheKey, playlistId)
    }
    return playlistId
  })()

  if (cacheKey) {
    pendingSavedPlaylistPromises.set(cacheKey, createPromise)
  }

  const playlistId = await createPromise
  if (cacheKey) {
    pendingSavedPlaylistPromises.delete(cacheKey)
  }
  return playlistId
}

async function appendDownloadedTrackToSavedPlaylist(playlistId, track) {
  if (!playlistId || !track?.path || !window.electronAPI || !window.electronAPI.playlistAddTracks) return
  await window.electronAPI.playlistAddTracks(playlistId, [
    {
      path: track.path,
      metadataCache: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration
      }
    }
  ])

  if (savedPlaylistManager && savedPlaylistManager.refreshSavedPlaylists) {
    savedPlaylistManager.refreshSavedPlaylists(playlistId)
  }
}

function setupShortcutManager() {
  shortcutManager = createShortcutManager({
    dom: shortcutDom,
    storageKey: SHORTCUT_STORAGE_KEY,
    actionDefinitions: shortcutActions,
    closeOnConfirm: false,
    onAction: (action) => {
      switch (action) {
        case 'togglePlay':
          playbackController.togglePlayback({ silent: true })
          break
        case 'seekBackward':
          playbackController.seekBy(-SEEK_SECONDS)
          break
        case 'seekForward':
          playbackController.seekBy(SEEK_SECONDS)
          break
        case 'previousTrack':
          playbackController.playPreviousTrack()
          break
        case 'nextTrack':
          playbackController.playNextTrack()
          break
        case 'toggleLoop':
          playbackController.toggleLoopState()
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
          openSettingsPanel('shortcuts')
          break
        case 'minimizeWindow':
          if (window.electronAPI && window.electronAPI.minimizeWindow) {
            window.electronAPI.minimizeWindow()
          }
          break
        case 'clearPlaylist':
          if (playbackController.hasQueue()) {
            playbackController.clearPlaylist()
          }
          break
        default:
          break
      }
    }
  })

  shortcutManager.init()
}

function sanitizeFadeDurationInput(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallbackValue
  return Math.max(0, Math.min(5000, parsed))
}

function switchSettingsTab(tab) {
  currentSettingsTab = tab === 'shortcuts' ? 'shortcuts' : 'playback'

  settingsDom.settingsTabs.forEach((tabEl) => {
    const tabName = tabEl.getAttribute('data-settings-tab')
    const active = tabName === currentSettingsTab
    tabEl.classList.toggle('active', active)
    tabEl.setAttribute('aria-selected', active ? 'true' : 'false')
  })

  settingsDom.settingsPanels.forEach((panelEl) => {
    const panelName = panelEl.getAttribute('data-settings-panel')
    panelEl.classList.toggle('page-hidden', panelName !== currentSettingsTab)
  })
}

function syncFadeSettingsInputs() {
  if (!playbackController) return
  const settings = playbackController.getFadeSettings()
  if (settingsDom.fadeInDurationInput) {
    settingsDom.fadeInDurationInput.value = settings.fadeInMs
  }
  if (settingsDom.fadeOutDurationInput) {
    settingsDom.fadeOutDurationInput.value = settings.fadeOutMs
  }
}

function applyFadeSettingsFromInputs() {
  if (!playbackController) return
  const current = playbackController.getFadeSettings()
  const fadeInMs = sanitizeFadeDurationInput(settingsDom.fadeInDurationInput?.value, current.fadeInMs)
  const fadeOutMs = sanitizeFadeDurationInput(settingsDom.fadeOutDurationInput?.value, current.fadeOutMs)
  const next = playbackController.updateFadeSettings({ fadeInMs, fadeOutMs })
  if (settingsDom.fadeInDurationInput) settingsDom.fadeInDurationInput.value = next.fadeInMs
  if (settingsDom.fadeOutDurationInput) settingsDom.fadeOutDurationInput.value = next.fadeOutMs
}

function openSettingsPanel(tab = 'playback') {
  if (!settingsDom.settingsOverlay) return
  settingsDom.settingsOverlay.classList.add('visible')
  settingsDom.settingsOverlay.setAttribute('aria-hidden', 'false')
  switchSettingsTab(tab)
  if (shortcutManager) {
    shortcutManager.openPanel()
  }
  syncFadeSettingsInputs()
}

function closeSettingsPanel() {
  if (!settingsDom.settingsOverlay) return false
  if (shortcutManager && !shortcutManager.closePanel()) {
    return false
  }
  settingsDom.settingsOverlay.classList.remove('visible')
  settingsDom.settingsOverlay.setAttribute('aria-hidden', 'true')
  return true
}

function setupSettingsPanel() {
  if (settingsDom.settingsBtn) {
    settingsDom.settingsBtn.addEventListener('click', () => {
      openSettingsPanel('playback')
    })
  }

  if (settingsDom.settingsCloseBtn) {
    settingsDom.settingsCloseBtn.addEventListener('click', () => {
      closeSettingsPanel()
    })
  }

  if (settingsDom.settingsOverlay) {
    settingsDom.settingsOverlay.addEventListener('click', (event) => {
      if (event.target === settingsDom.settingsOverlay) {
        closeSettingsPanel()
      }
    })
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (!settingsDom.settingsOverlay?.classList.contains('visible')) return
    event.preventDefault()
    closeSettingsPanel()
  })

  settingsDom.settingsTabs.forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
      switchSettingsTab(tabEl.getAttribute('data-settings-tab') || 'playback')
    })
  })

  if (settingsDom.fadeSaveBtn) {
    settingsDom.fadeSaveBtn.addEventListener('click', () => {
      applyFadeSettingsFromInputs()
    })
  }

  if (settingsDom.fadeInDurationInput) {
    settingsDom.fadeInDurationInput.addEventListener('change', applyFadeSettingsFromInputs)
  }
  if (settingsDom.fadeOutDurationInput) {
    settingsDom.fadeOutDurationInput.addEventListener('change', applyFadeSettingsFromInputs)
  }
}

function setupNeteaseManager() {
  const manager = createNeteaseManager({
    electronAPI: window.electronAPI,
    dom: neteaseDom,
    onAppendDownloadedTrack: (track) => {
      if (!playbackController || !track?.path) return
      playbackController.appendToPlaylist([
        {
          name: track.name || track.path.split(/[/\\]/).pop(),
          path: track.path,
          file: null
        }
      ])
    }
  })
  manager.init()
}

function setupNeteaseSearchManager() {
  const manager = createNeteaseSearchManager({
    electronAPI: window.electronAPI,
    dom: neteaseSearchDom,
    onAppendDownloadedTrack: (track) => {
      if (!playbackController || !track?.path) return
      playbackController.appendToPlaylist([
        {
          name: track.name || track.path.split(/[/\\]/).pop(),
          path: track.path,
          file: null
        }
      ])
    }
  })
  manager.init()
}

function setupToastManager() {
  toastManager = createToastManager({
    electronAPI: window.electronAPI,
    container: appToastContainerEl
  })
  toastManager.init()
}

function setupDownloadManager() {
  const manager = createDownloadManager({
    electronAPI: window.electronAPI,
    dom: downloadDom,
    onAppendTrack: (track) => {
      if (!playbackController || !track?.path) return
      playbackController.appendToPlaylist([{ name: track.name, path: track.path, file: null }])
    },
    onPushToast: (payload) => {
      if (toastManager) {
        toastManager.pushToast(payload)
      }
    },
    onEnsureSavedPlaylist: ensureSavedPlaylistByName,
    onAppendTrackToSavedPlaylist: appendDownloadedTrackToSavedPlaylist
  })

  manager.init()
}

function setupDailyRecommendationManager() {
  dailyRecommendationManager = createDailyRecommendationManager({
    electronAPI: window.electronAPI,
    dom: dailyRecommendationDom,
    onReplaceQueueWithTracks: (tracks, startIndex = 0, options = {}) =>
      playbackController.replaceCurrentQueueWithTracks(tracks, startIndex, options),
    onAppendTracksToQueue: (tracks) => playbackController.appendToPlaylist(tracks),
    onShowSongPage: showSongPage
  })

  dailyRecommendationManager.init()
}

function setupPlayerControlListener() {
  if (!window.electronAPI || !window.electronAPI.onPlayerControl) return

  window.electronAPI.onPlayerControl((action) => {
    playbackController.handleExternalPlayerControl(action)
  })
}

function initRenderer() {
  setupWindowEvents()
  setupToastManager()
  setupPlaybackController()
  setupSavedPlaylistManager()
  setupDailyRecommendationManager()
  setupNeteaseManager()
  setupNeteaseSearchManager()
  setupDownloadManager()
  setupAccountManager()
  setupShortcutManager()
  setupSettingsPanel()
  setupPlayerControlListener()

  showHomePage()
  showHomeView('recommend')
  initTheme()
}

initRenderer()
