export function collectRendererDom(doc = document) {
  const homePageEl = doc.getElementById('homePage')
  const songPageEl = doc.getElementById('songPage')
  const homeNowCoverImgEl = doc.getElementById('homeNowCoverImg')
  const homeNowCoverPlaceholderEl = doc.getElementById('homeNowCoverPlaceholder')
  const homeFeaturedCoverEl = doc.getElementById('homeFeaturedCover')
  const homeMenuRecommendEl = doc.getElementById('homeMenuRecommend')
  const homeMenuDownloadEl = doc.getElementById('homeMenuDownload')
  const homeMenuRecentlyPlayedEl = doc.getElementById('homeMenuRecentlyPlayed')
  const homeCreatedPlaylistListEl = doc.getElementById('homeCreatedPlaylistList')
  const homeCloudPlaylistListEl = doc.getElementById('homeCloudPlaylistList')
  const homeRefreshCloudPlaylistBtn = doc.getElementById('homeRefreshCloudPlaylistBtn')
  const homeRecommendViewEl = doc.getElementById('homeRecommendView')
  const homeDownloadViewEl = doc.getElementById('homeDownloadView')
  const homeRecentlyPlayedViewEl = doc.getElementById('homeRecentlyPlayedView')
  const homePlaylistDetailViewEl = doc.getElementById('homePlaylistDetailView')
  const homeRecentlyPlayedMetaEl = doc.getElementById('homeRecentlyPlayedMeta')
  const homeRecentlyPlayedListEl = doc.getElementById('homeRecentlyPlayedList')
  const homeRecentlyPlayedClearBtn = doc.getElementById('homeRecentlyPlayedClearBtn')
  const globalPlayerBarEl = doc.getElementById('globalPlayerBar')
  const windowMinimizeBtn = doc.getElementById('windowMinimizeBtn')
  const homeLoginBtn = doc.getElementById('homeLoginBtn')
  const homeUserNameEl = doc.getElementById('homeUserName')
  const homeUserDetailEl = doc.getElementById('homeUserDetail')
  const homeUserAvatarEl = doc.getElementById('homeUserAvatar')
  const appToastContainerEl = doc.getElementById('appToastContainer')

  const shortcutDom = {
    shortcutOverlay: null,
    shortcutList: doc.getElementById('shortcutList'),
    shortcutCloseBtn: null,
    shortcutResetBtn: doc.getElementById('shortcutResetBtn'),
    shortcutConfirmBtn: doc.getElementById('shortcutConfirmBtn')
  }

  const settingsDom = {
    settingsBtn: doc.getElementById('settingsBtn'),
    settingsOverlay: doc.getElementById('settingsOverlay'),
    settingsCloseBtn: doc.getElementById('settingsCloseBtn'),
    settingsTabs: doc.querySelectorAll('[data-settings-tab]'),
    settingsPanels: doc.querySelectorAll('[data-settings-panel]'),
    fadeInDurationInput: doc.getElementById('fadeInDurationInput'),
    fadeOutDurationInput: doc.getElementById('fadeOutDurationInput'),
    fadeSaveBtn: doc.getElementById('fadeSaveBtn')
  }

  const savedPlaylistDom = {
    sidebarListEl: homeCreatedPlaylistListEl,
    sidebarCreateBtn: doc.getElementById('homeCreatePlaylistBtn'),
    detailViewEl: homePlaylistDetailViewEl,
    detailTitleEl: doc.getElementById('homePlaylistDetailTitle'),
    detailSubtitleEl: doc.getElementById('homePlaylistDetailSubtitle'),
    detailMetaEl: doc.getElementById('homePlaylistDetailMeta'),
    detailCoverEl: doc.getElementById('homePlaylistDetailCover'),
    detailCoverTextEl: doc.getElementById('homePlaylistDetailCoverText'),
    detailTitleEditBtn: doc.getElementById('homePlaylistTitleEditBtn'),
    detailTrackListEl: doc.getElementById('homePlaylistTrackList'),
    detailDeleteBtn: doc.getElementById('homePlaylistDeleteBtn'),
    detailPlayAllBtn: doc.getElementById('homePlaylistPlayAllBtn'),
    detailAppendBtn: doc.getElementById('homePlaylistAppendBtn'),
    detailAddCurrentBtn: doc.getElementById('homePlaylistAddCurrentBtn')
  }

  const playbackDom = {
    songPageEl: doc.getElementById('songPage'),
    songAddFileBtn: doc.getElementById('songAddFileBtn'),
    songAddFolderBtn: doc.getElementById('songAddFolderBtn'),
    songOpenQueueBtn: doc.getElementById('songOpenQueueBtn'),
    fileInput: doc.getElementById('fileInput'),
    folderBtn: doc.getElementById('folderBtn'),
    clearBtn: doc.getElementById('clearBtn'),
    queueSaveBtn: doc.getElementById('queueSaveBtn'),
    queueToggleBtn: doc.getElementById('queueToggleBtn'),
    queueCloseBtn: doc.getElementById('queueCloseBtn'),
    queueOverlayEl: doc.getElementById('queueOverlay'),
    queueOverlayBackdropEl: doc.getElementById('queueOverlayBackdrop'),
    playBtn: doc.getElementById('playBtn'),
    prevBtn: doc.getElementById('prevBtn'),
    nextBtn: doc.getElementById('nextBtn'),
    loopBtn: doc.getElementById('loopBtn'),
    trackTitle: doc.getElementById('trackTitle'),
    trackArtist: doc.getElementById('trackArtist'),
    trackAlbum: doc.getElementById('trackAlbum'),
    coverImg: doc.getElementById('coverImg'),
    coverPlaceholder: doc.querySelector('.cover-placeholder'),
    playlistEl: doc.getElementById('playlist'),
    progressContainer: doc.getElementById('progressContainer'),
    progressBar: doc.getElementById('progressBar'),
    currentTimeEl: doc.getElementById('currentTime'),
    totalTimeEl: doc.getElementById('totalTime'),
    bottomTrackTitleEl: doc.getElementById('bottomTrackTitle'),
    bottomTrackArtistEl: doc.getElementById('bottomTrackArtist'),
    bottomTrackCoverImgEl: doc.getElementById('bottomTrackCoverImg'),
    bottomTrackCoverPlaceholderEl: doc.getElementById('bottomTrackCoverPlaceholder'),
    homeNowTitleEl: doc.getElementById('homeNowTitle'),
    homeNowArtistEl: doc.getElementById('homeNowArtist'),
    homeFeaturedTitleEl: doc.getElementById('homeFeaturedTitle'),
    songBackBtn: doc.getElementById('songBackBtn'),
    homeGoSongBtn: doc.getElementById('homeGoSongBtn')
  }

  const neteaseDom = {
    input: doc.getElementById('neteaseIdInput'),
    type: doc.getElementById('neteaseTypeSelect'),
    searchBtn: doc.getElementById('neteaseSearchBtn'),
    openBtn: doc.getElementById('neteaseOpenBtn'),
    result: doc.getElementById('neteaseResult'),
    authApiBaseInput: doc.getElementById('neteaseAuthApiBase'),
    authEmailInput: doc.getElementById('neteaseAuthEmail'),
    authPasswordInput: doc.getElementById('neteaseAuthPassword'),
    authEmailLoginBtn: doc.getElementById('neteaseAuthEmailLoginBtn'),
    authCountryCodeInput: doc.getElementById('neteaseAuthCountryCode'),
    authPhoneInput: doc.getElementById('neteaseAuthPhone'),
    authCaptchaInput: doc.getElementById('neteaseAuthCaptcha'),
    authSendCaptchaBtn: doc.getElementById('neteaseAuthSendCaptchaBtn'),
    authPhoneCaptchaLoginBtn: doc.getElementById('neteaseAuthPhoneCaptchaLoginBtn'),
    authQrView: doc.getElementById('neteaseQrView'),
    authQrImg: doc.getElementById('neteaseQrImg'),
    authQrPlaceholder: doc.getElementById('neteaseQrPlaceholder'),
    authQrLink: doc.getElementById('neteaseQrLink'),
    authQrCreateBtn: doc.getElementById('neteaseAuthQrCreateBtn'),
    authQrOpenBtn: doc.getElementById('neteaseAuthQrOpenBtn'),
    authQrStartPollBtn: doc.getElementById('neteaseAuthQrStartPollBtn'),
    authQrStopPollBtn: doc.getElementById('neteaseAuthQrStopPollBtn'),
    authAccessTokenInput: doc.getElementById('neteaseAuthAccessToken'),
    authRefreshTokenInput: doc.getElementById('neteaseAuthRefreshToken'),
    authUserNameInput: doc.getElementById('neteaseAuthUserName'),
    authUserIdInput: doc.getElementById('neteaseAuthUserId'),
    authSaveBtn: doc.getElementById('neteaseAuthSaveBtn'),
    authVerifyBtn: doc.getElementById('neteaseAuthVerifyBtn'),
    authClearBtn: doc.getElementById('neteaseAuthClearBtn'),
    authStatus: doc.getElementById('neteaseAuthStatus'),
    songIdDownloadInput: doc.getElementById('neteaseSongIdDownloadInput'),
    downloadLevelSelect: doc.getElementById('neteaseDownloadLevelSelect'),
    downloadSongBtn: doc.getElementById('neteaseDownloadSongBtn'),
    downloadSongAndQueueBtn: doc.getElementById('neteaseDownloadSongAndQueueBtn'),
    downloadDirBtn: doc.getElementById('neteaseDownloadDirBtn'),
    directUrlInput: doc.getElementById('neteaseDirectUrlInput'),
    directDownloadBtn: doc.getElementById('neteaseDirectDownloadBtn'),
    taskList: doc.getElementById('neteaseTaskList')
  }

  const neteaseSearchDom = {
    keywordType: doc.getElementById('neteaseKeywordTypeSelect'),
    keywordInput: doc.getElementById('neteaseKeywordInput'),
    searchBtn: doc.getElementById('neteaseKeywordSearchBtn'),
    suggestList: doc.getElementById('neteaseSuggestList'),
    searchStatus: doc.getElementById('neteaseKeywordStatus'),
    resultList: doc.getElementById('neteaseKeywordResultList'),
    prevBtn: doc.getElementById('neteaseKeywordPrevBtn'),
    nextBtn: doc.getElementById('neteaseKeywordNextBtn'),
    pageInfo: doc.getElementById('neteaseKeywordPageInfo')
  }

  const neteasePlaylistDetailDom = {
    overlay: doc.getElementById('neteasePlaylistOverlay'),
    closeBtn: doc.getElementById('neteasePlaylistOverlayCloseBtn'),
    cover: doc.getElementById('neteasePlaylistOverlayCover'),
    coverText: doc.getElementById('neteasePlaylistOverlayCoverText'),
    name: doc.getElementById('neteasePlaylistOverlayName'),
    sub: doc.getElementById('neteasePlaylistOverlaySub'),
    playBtn: doc.getElementById('neteasePlaylistOverlayPlayBtn'),
    downloadBtn: doc.getElementById('neteasePlaylistOverlayDownloadBtn'),
    saveLocalBtn: doc.getElementById('neteasePlaylistOverlaySaveLocalBtn'),
    collectBtn: doc.getElementById('neteasePlaylistOverlayCollectBtn'),
    status: doc.getElementById('neteasePlaylistOverlayStatus'),
    trackList: doc.getElementById('neteasePlaylistOverlayTrackList')
  }

  const cloudPlaylistDom = {
    listEl: homeCloudPlaylistListEl,
    refreshBtn: homeRefreshCloudPlaylistBtn
  }

  const downloadDom = {
    songIdInput: doc.getElementById('downloadSongIdInput'),
    songResolveBtn: doc.getElementById('downloadSongResolveBtn'),
    songPreview: doc.getElementById('downloadSongPreview'),
    qualitySelect: doc.getElementById('downloadQualitySelect'),
    songOnlyBtn: doc.getElementById('downloadSongOnlyBtn'),
    songTempQueueBtn: doc.getElementById('downloadSongTempQueueBtn'),
    songAndQueueBtn: doc.getElementById('downloadSongAndQueueBtn'),
    playlistIdInput: doc.getElementById('downloadPlaylistIdInput'),
    playlistResolveBtn: doc.getElementById('downloadPlaylistResolveBtn'),
    playlistPreview: doc.getElementById('downloadPlaylistPreview'),
    playlistOnlyBtn: doc.getElementById('downloadPlaylistOnlyBtn'),
    playlistAndQueueBtn: doc.getElementById('downloadPlaylistAndQueueBtn'),
    playlistAndSaveBtn: doc.getElementById('downloadPlaylistAndSaveBtn'),
    openSongsDirBtn: doc.getElementById('downloadOpenSongsDirBtn'),
    openTempDirBtn: doc.getElementById('downloadOpenTempDirBtn'),
    openListsDirBtn: doc.getElementById('downloadOpenListsDirBtn'),
    clearTempBtn: doc.getElementById('downloadClearTempBtn'),
    taskFilterSelect: doc.getElementById('downloadTaskFilterSelect'),
    taskList: doc.getElementById('downloadTaskList')
  }

  const dailyRecommendationDom = {
    coverEl: doc.getElementById('dailyRecommendCover'),
    metaEl: doc.getElementById('dailyRecommendMeta')
  }

  return {
    homePageEl,
    songPageEl,
    homeMenuRecommendEl,
    homeMenuDownloadEl,
    homeMenuRecentlyPlayedEl,
    homeCreatedPlaylistListEl,
    homeNowCoverImgEl,
    homeNowCoverPlaceholderEl,
    homeFeaturedCoverEl,
    homeRecommendViewEl,
    homeDownloadViewEl,
    homeRecentlyPlayedViewEl,
    homePlaylistDetailViewEl,
    homeRecentlyPlayedMetaEl,
    homeRecentlyPlayedListEl,
    homeRecentlyPlayedClearBtn,
    globalPlayerBarEl,
    windowMinimizeBtn,
    homeLoginBtn,
    homeUserNameEl,
    homeUserDetailEl,
    homeUserAvatarEl,
    appToastContainerEl,
    shortcutDom,
    settingsDom,
    savedPlaylistDom,
    playbackDom,
    neteaseDom,
    neteaseSearchDom,
    neteasePlaylistDetailDom,
    cloudPlaylistDom,
    downloadDom,
    dailyRecommendationDom
  }
}
