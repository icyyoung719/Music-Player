import { initTheme } from './modules/theme.js'
import { createShortcutManager } from './modules/shortcutManager.js'
import { createSavedPlaylistManager } from './modules/savedPlaylistManager.js'
import { createPlaybackController } from './modules/playbackController.js'
import { createNeteaseManager } from './modules/neteaseManager.js'
import { createAccountManager } from './modules/accountManager.js'

const homePageEl = document.getElementById('homePage')
const songPageEl = document.getElementById('songPage')
const homeNowCoverImgEl = document.getElementById('homeNowCoverImg')
const homeNowCoverPlaceholderEl = document.getElementById('homeNowCoverPlaceholder')
const homeFeaturedCoverEl = document.getElementById('homeFeaturedCover')
const windowMinimizeBtn = document.getElementById('windowMinimizeBtn')
const homeLoginBtn = document.getElementById('homeLoginBtn')
const neteaseAuthOpenWindowBtn = document.getElementById('neteaseAuthOpenWindowBtn')
const homeUserNameEl = document.getElementById('homeUserName')
const homeUserDetailEl = document.getElementById('homeUserDetail')
const homeUserAvatarEl = document.getElementById('homeUserAvatar')

const shortcutDom = {
  shortcutBtn: document.getElementById('shortcutBtn'),
  shortcutOverlay: document.getElementById('shortcutOverlay'),
  shortcutList: document.getElementById('shortcutList'),
  shortcutCloseBtn: document.getElementById('shortcutCloseBtn'),
  shortcutResetBtn: document.getElementById('shortcutResetBtn'),
  shortcutConfirmBtn: document.getElementById('shortcutConfirmBtn')
}

const savedPlaylistDom = {
  savedPlaylistSelect: document.getElementById('savedPlaylistSelect'),
  savedCreateBtn: document.getElementById('savedCreateBtn'),
  savedRenameBtn: document.getElementById('savedRenameBtn'),
  savedDeleteBtn: document.getElementById('savedDeleteBtn'),
  savedAppendToQueueBtn: document.getElementById('savedAppendToQueueBtn'),
  savedReplaceQueueBtn: document.getElementById('savedReplaceQueueBtn'),
  savedAddCurrentBtn: document.getElementById('savedAddCurrentBtn'),
  savedImportBtn: document.getElementById('savedImportBtn'),
  savedExportBtn: document.getElementById('savedExportBtn'),
  savedTracksEl: document.getElementById('savedTracks')
}

const playbackDom = {
  fileInput: document.getElementById('fileInput'),
  folderBtn: document.getElementById('folderBtn'),
  clearBtn: document.getElementById('clearBtn'),
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
  openShortcuts: { label: '打开快捷键面板', defaultKey: '' },
  minimizeWindow: { label: '最小化窗口', defaultKey: '' },
  clearPlaylist: { label: '清空当前列表', defaultKey: '' }
}

let shortcutManager = null
let playbackController = null
let accountManager = null

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
    return
  }

  homeNowCoverImgEl.src = ''
  homeNowCoverImgEl.style.display = 'none'
  homeNowCoverPlaceholderEl.style.display = 'inline'
  if (homeFeaturedCoverEl) {
    homeFeaturedCoverEl.style.backgroundImage = ''
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
}

function openNeteaseAuthWindow(page = 'email') {
  if (!window.electronAPI || !window.electronAPI.neteaseAuthOpenWindow) return
  window.electronAPI.neteaseAuthOpenWindow({ page })
}

function setupNeteaseAuthWindowEntrances() {
  if (neteaseAuthOpenWindowBtn) {
    neteaseAuthOpenWindowBtn.addEventListener('click', () => openNeteaseAuthWindow('email'))
  }
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
    onSetHomeNowCover: setHomeNowCover
  })

  playbackController.init()
}

function setupSavedPlaylistManager() {
  const manager = createSavedPlaylistManager({
    electronAPI: window.electronAPI,
    dom: savedPlaylistDom,
    promptForPlaylistName: requestPlaylistName,
    getCurrentQueueTrackInputs: () => playbackController.collectCurrentQueueAsTrackInputs(),
    appendTracksToQueue: (tracks) => playbackController.appendToPlaylist(tracks),
    replaceQueueWithTracks: (tracks) => playbackController.replaceCurrentQueueWithTracks(tracks)
  })

  manager.init()
}

function setupShortcutManager() {
  shortcutManager = createShortcutManager({
    dom: shortcutDom,
    storageKey: SHORTCUT_STORAGE_KEY,
    actionDefinitions: shortcutActions,
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
          shortcutManager.openPanel()
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

function setupPlayerControlListener() {
  if (!window.electronAPI || !window.electronAPI.onPlayerControl) return

  window.electronAPI.onPlayerControl((action) => {
    playbackController.handleExternalPlayerControl(action)
  })
}

function initRenderer() {
  setupWindowEvents()
  setupNeteaseAuthWindowEntrances()
  setupPlaybackController()
  setupSavedPlaylistManager()
  setupNeteaseManager()
  setupAccountManager()
  setupShortcutManager()
  setupPlayerControlListener()

  showHomePage()
  initTheme()
}

initRenderer()
