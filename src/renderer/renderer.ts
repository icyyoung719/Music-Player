import { initTheme } from './modules/theme.js'
import { createShortcutManager } from './modules/shortcutManager.js'
import { createSavedPlaylistManager } from './modules/savedPlaylistManager.js'
import { createPlaybackController } from './modules/playbackController.js'
import { createNeteaseManager } from './modules/neteaseManager.js'
import { createNeteaseSearchManager } from './modules/neteaseSearchManager.js'
import { createNeteasePlaylistDetailManager } from './modules/neteasePlaylistDetailManager.js'
import { createAccountManager } from './modules/accountManager.js'
import { createDownloadManager } from './modules/downloadManager.js'
import { createToastManager } from './modules/toastManager.js'
import { createDailyRecommendationManager } from './modules/dailyRecommendationManager.js'
import { createRecommendedPlaylistManager } from './modules/recommendedPlaylistManager.js'
import { createCloudPlaylistManager } from './modules/cloudPlaylistManager.js'
import { createRecentlyPlayedManager } from './modules/recentlyPlayedManager.js'
import { collectRendererDom } from './modules/rendererDom.js'
import { createDialogManager } from './modules/dialogManager.js'
import { createNavigationBridge } from './modules/navigationBridge.js'
import { createSettingsManager } from './modules/settingsManager.js'
import { createPlaylistCacheService } from './modules/playlistCacheService.js'
import { createEventBus } from './core/eventBus.js'
import { createViewManager } from './core/viewManager.js'
import { createNeteaseDatabaseService } from './core/neteaseDatabaseService.js'
import { createDownloadService } from './core/downloadService.js'
import { createEventBridgeManager } from './core/eventBridgeManager.js'
import { getElectronAPI } from './core/electronApi.js'

const SHORTCUT_STORAGE_KEY = 'musicPlayer.shortcuts.v1'
const SEEK_SECONDS = 5
interface ShortcutAction {
  readonly label: string
  readonly defaultKey: string
}
const shortcutActions: Record<string, ShortcutAction> = {
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

const eventBus = createEventBus()

function showHomeView(viewManager: any, view: string): void {
  viewManager.showHomeView(view)
  if (view === 'recently-played') {
    eventBus.emit('view:recently-played.render')
  }
}

function createServices(electronAPI: any) {
  const neteaseDatabaseService = createNeteaseDatabaseService({ electronAPI })
  const downloadService = createDownloadService({ electronAPI, eventBus })
  downloadService.init()

  return {
    neteaseDatabaseService,
    downloadService
  }
}

function setupRenderer(): void {
  const electronAPI: any = getElectronAPI()
  const dom: any = collectRendererDom(document)
  const dialogManager = createDialogManager({ doc: document })

  let playbackController: any = null
  let savedPlaylistManager: any = null
  let cloudPlaylistManager: any = null
  let neteasePlaylistDetailManager: any = null

  const viewManager: any = createViewManager({
    dom: {
      homePageEl: dom.homePageEl,
      songPageEl: dom.songPageEl,
      homeRecommendViewEl: dom.homeRecommendViewEl,
      homeDownloadViewEl: dom.homeDownloadViewEl,
      homeRecentlyPlayedViewEl: dom.homeRecentlyPlayedViewEl,
      homePlaylistDetailViewEl: dom.homePlaylistDetailViewEl,
      homeMenuRecommendEl: dom.homeMenuRecommendEl,
      homeMenuDownloadEl: dom.homeMenuDownloadEl,
      homeMenuRecentlyPlayedEl: dom.homeMenuRecentlyPlayedEl,
      homeNowCoverImgEl: dom.homeNowCoverImgEl,
      homeNowCoverPlaceholderEl: dom.homeNowCoverPlaceholderEl
    },
    onSongPageShown: () => {
      playbackController?.refreshLyricsScroll()
    }
  })

  const navigationBridge = createNavigationBridge({
    doc: document,
    electronAPI,
    dom: {
      windowMinimizeBtn: dom.windowMinimizeBtn,
      homeMenuRecommendEl: dom.homeMenuRecommendEl,
      homeMenuDownloadEl: dom.homeMenuDownloadEl,
      homeMenuRecentlyPlayedEl: dom.homeMenuRecentlyPlayedEl,
      homeCreatedPlaylistListEl: dom.homeCreatedPlaylistListEl,
      globalPlayerBarEl: dom.globalPlayerBarEl
    },
    onShowSongPage: () => viewManager.showSongPage(),
    onShowHomePage: () => viewManager.showHomePage(),
    onShowHomeView: (view) => showHomeView(viewManager, view),
    onOpenSavedPlaylistDetail: (playlistId) => viewManager.openSavedPlaylistDetail(playlistId)
  })

  navigationBridge.init()

  const { neteaseDatabaseService, downloadService } = createServices(electronAPI)

  const toastManager = createToastManager({
    electronAPI,
    container: dom.appToastContainerEl
  })
  toastManager.init()

  playbackController = createPlaybackController({
    electronAPI,
    dom: dom.playbackDom,
    eventBus,
    promptForPlaylistName: dialogManager.requestPlaylistName,
    promptForPlaylistSelection: dialogManager.requestPlaylistSelection
  })
  playbackController.init()

  savedPlaylistManager = createSavedPlaylistManager({
    electronAPI,
    dom: dom.savedPlaylistDom,
    promptForPlaylistName: dialogManager.requestPlaylistName,
    eventBus
  })
  savedPlaylistManager.init()
  viewManager.bindSavedPlaylistManager(savedPlaylistManager)

  const playlistCacheService = createPlaylistCacheService({
    electronAPI,
    getSavedPlaylistManager: () => savedPlaylistManager
  })

  const recentlyPlayedManager = createRecentlyPlayedManager({
    dom: {
      listEl: dom.homeRecentlyPlayedListEl,
      countEl: dom.homeRecentlyPlayedMetaEl,
      clearBtn: dom.homeRecentlyPlayedClearBtn
    },
    eventBus
  })
  recentlyPlayedManager.init()

  const dailyRecommendationManager = createDailyRecommendationManager({
    electronAPI,
    neteaseDatabaseService,
    dom: dom.dailyRecommendationDom,
    eventBus
  })
  dailyRecommendationManager.init()

  const neteaseManager = createNeteaseManager({
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    dom: dom.neteaseDom,
    eventBus
  })
  neteaseManager.init()

  neteasePlaylistDetailManager = createNeteasePlaylistDetailManager({
    electronAPI,
    neteaseDatabaseService: neteaseDatabaseService as any,
    downloadService,
    eventBus,
    dom: dom.neteasePlaylistDetailDom,
    requestDownloadStrategy: dialogManager.requestCloudDownloadStrategy,
    getCloudPlaylistManager: () => cloudPlaylistManager
  })
  neteasePlaylistDetailManager.init()

  createRecommendedPlaylistManager({
    electronAPI,
    neteaseDatabaseService,
    eventBus,
    dom: dom.recommendedPlaylistDom,
    onOpenPlaylistDetail: (playlistId, playlistName, options: any = {}) => {
      neteasePlaylistDetailManager?.openByPlaylistId(playlistId, playlistName, options)
    }
  }).init()

  cloudPlaylistManager = createCloudPlaylistManager({
    electronAPI,
    neteaseDatabaseService: neteaseDatabaseService as any,
    eventBus,
    dom: dom.cloudPlaylistDom,
    onOpenPlaylistDetail: (playlistId, playlistName, options: any = {}) => {
      neteasePlaylistDetailManager?.openByPlaylistId(playlistId, playlistName, options)
    }
  })
  cloudPlaylistManager.init()

  const neteaseSearchManager = createNeteaseSearchManager({
    electronAPI,
    neteaseDatabaseService: neteaseDatabaseService as any,
    downloadService,
    dom: dom.neteaseSearchDom,
    eventBus,
    onOpenPlaylistDetail: (playlistId, playlistName) => {
      neteasePlaylistDetailManager?.openByPlaylistId(playlistId, playlistName)
    }
  })
  neteaseSearchManager.init()

  const downloadManager = createDownloadManager({
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    dom: dom.downloadDom,
    eventBus
  })
  downloadManager.init()

  const accountManager = createAccountManager({
    electronAPI,
    dom: {
      userNameEl: dom.homeUserNameEl,
      userDetailEl: dom.homeUserDetailEl,
      avatarEl: dom.homeUserAvatarEl,
      loginBtnEl: dom.homeLoginBtn
    } as any,
    onRequestLoginWindow: () => {
      electronAPI?.neteaseAuthOpenWindow?.({ page: 'email' })
    }
  })
  accountManager.init()

  const shortcutManager = createShortcutManager({
    dom: dom.shortcutDom,
    storageKey: SHORTCUT_STORAGE_KEY,
    actionDefinitions: shortcutActions,
    closeOnConfirm: false,
    eventBus
  })
  shortcutManager.init()

  const settingsManager = createSettingsManager({
    dom: dom.settingsDom,
    doc: document,
    shortcutManager,
    getPlaybackController: () => playbackController
  })
  settingsManager.init()

  const eventBridgeManager = createEventBridgeManager({
    eventBus,
    electronAPI,
    playbackController,
    savedPlaylistManager,
    recentlyPlayedManager,
    toastManager: toastManager as any,
    viewManager,
    settingsManager,
    playlistCacheService: playlistCacheService as any,
    seekSeconds: SEEK_SECONDS,
    doc: document
  })
  eventBridgeManager.init()

  viewManager.showHomePage()
  showHomeView(viewManager, 'recommend')
  initTheme()
}

setupRenderer()
