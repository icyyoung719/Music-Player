const { ipcMain, shell } = require('electron')
const fs = require('fs')

const { requestJson, requestJsonWithMeta } = require('./httpClient')
const {
  authState,
  ensureAuthStateLoaded,
  persistAuthState,
  clearAuthState,
  getPublicAuthState,
  getPublicAccountSummary,
  emitAuthStateUpdate,
  buildAuthHeaders,
  postFormWithFallback,
  requestNeteaseApi,
  encodeFormData,
  refreshProfileFromAuth,
  applyProfileToAuthState,
  enrichAuthStateProfileByUserId,
  buildQrCodeDataUrl,
  normalizeCookieHeader,
  extractApiErrorMessage,
  isRiskControlMessage,
  getCandidateApiPaths,
  sanitizeEmail,
  sanitizePhone,
  sanitizeCountryCode,
  sanitizeCaptcha,
  sanitizeQrKey,
  md5
} = require('./authManager')
const {
  sanitizeSongId,
  sanitizeId,
  getSongPageUrl,
  getPlaylistPageUrl,
  resolveSongUrlWithLevelFallback,
  fetchPlaylistTracksById,
  isNeteaseAudioHost
} = require('./neteaseApi')
const {
  createTaskId,
  safeFileName,
  isAllowedDownloadHost,
  emitGlobalToast,
  listDownloadTasks,
  resolveDownloadDir,
  ensureDownloadBaseDirs,
  countFilesRecursive,
  createDownloadTask,
  createSongDownloadTaskFromId,
  cancelDownloadTask
} = require('./downloadManager')

let handlersRegistered = false

function registerNeteaseHandlers() {
  if (handlersRegistered) return
  handlersRegistered = true

  ensureAuthStateLoaded().catch((err) => {
    console.error('Failed to initialize NetEase auth state:', err)
  })

  ipcMain.handle('netease:resolve-id', async (_event, payload) => {
    const id = sanitizeId(payload?.id)
    const type = payload?.type === 'playlist' ? 'playlist' : 'song'

    if (!id) {
      return { ok: false, error: 'INVALID_ID' }
    }

    try {
      if (type === 'song') {
        const url = `https://music.163.com/api/song/detail/?ids=[${id}]`
        const data = await requestJson(url)
        const song = Array.isArray(data?.songs) ? data.songs[0] : null
        if (!song) return { ok: false, error: 'NOT_FOUND' }

        return {
          ok: true,
          type,
          item: {
            id,
            name: song.name || `歌曲 ${id}`,
            artist: Array.isArray(song.artists)
              ? song.artists.map((a) => a?.name).filter(Boolean).join(' / ')
              : '',
            album: song.album?.name || '',
            durationMs: Number(song.duration) || 0,
            pageUrl: getSongPageUrl(id)
          }
        }
      }

      const url = `https://music.163.com/api/v6/playlist/detail?id=${id}`
      const data = await requestJson(url)
      const playlist = data?.playlist
      if (!playlist) return { ok: false, error: 'NOT_FOUND' }

      const tracks = Array.isArray(playlist.tracks)
        ? playlist.tracks.slice(0, 20).map((track) => ({
            id: String(track?.id || ''),
            name: track?.name || '未知歌曲',
            artist: Array.isArray(track?.ar)
              ? track.ar.map((a) => a?.name).filter(Boolean).join(' / ')
              : ''
          }))
        : []

      return {
        ok: true,
        type,
        item: {
          id,
          name: playlist.name || `歌单 ${id}`,
          trackCount: Number(playlist.trackCount) || tracks.length,
          creator: playlist.creator?.nickname || '',
          pageUrl: getPlaylistPageUrl(id),
          tracks
        }
      }
    } catch (err) {
      console.error('Failed to resolve NetEase id:', err)
      return { ok: false, error: 'REQUEST_FAILED' }
    }
  })

  ipcMain.handle('netease:open-page', async (_event, payload) => {
    const id = sanitizeId(payload?.id)
    const type = payload?.type === 'playlist' ? 'playlist' : 'song'
    if (!id) return { ok: false, error: 'INVALID_ID' }

    const pageUrl = type === 'playlist' ? getPlaylistPageUrl(id) : getSongPageUrl(id)
    await shell.openExternal(pageUrl)
    return { ok: true, pageUrl }
  })

  ipcMain.handle('netease:open-external-url', async (_event, payload) => {
    const url = String(payload?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'INVALID_URL' }
    }

    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('netease:get-download-dir', async () => {
    try {
      const dirs = await ensureDownloadBaseDirs()
      return { ok: true, dir: dirs.songs }
    } catch (err) {
      console.error('Failed to prepare download dir:', err)
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  ipcMain.handle('netease:get-download-dirs', async () => {
    try {
      const dirs = await ensureDownloadBaseDirs()
      return { ok: true, dirs }
    } catch (err) {
      console.error('Failed to prepare download dirs:', err)
      return { ok: false, error: 'MKDIR_FAILED' }
    }
  })

  ipcMain.handle('netease:open-download-dir', async (_event, payload) => {
    try {
      const dirResolved = resolveDownloadDir(payload?.dirType || 'songs', payload?.playlistName || '')
      await fs.promises.mkdir(dirResolved.dirPath, { recursive: true })
      const openError = await shell.openPath(dirResolved.dirPath)
      if (openError) {
        return { ok: false, error: 'OPEN_PATH_FAILED', message: openError }
      }
      return { ok: true, dirPath: dirResolved.dirPath, dirType: dirResolved.dirType }
    } catch (err) {
      return { ok: false, error: 'OPEN_PATH_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:clear-temp-downloads', async () => {
    try {
      const tempDir = resolveDownloadDir('temp').dirPath
      await fs.promises.mkdir(tempDir, { recursive: true })
      const beforeCount = await countFilesRecursive(tempDir)
      await fs.promises.rm(tempDir, { recursive: true, force: true })
      await fs.promises.mkdir(tempDir, { recursive: true })

      emitGlobalToast({
        level: 'info',
        message: `已清理缓存歌曲 ${beforeCount} 首`,
        scope: 'temp-cleanup'
      })

      return { ok: true, removedFiles: beforeCount, dirPath: tempDir }
    } catch (err) {
      return { ok: false, error: 'TEMP_CLEAR_FAILED', message: err?.message || '' }
    }
  })

  // Only supports downloading direct, authorized HTTPS links from music.126.net.
  ipcMain.handle('netease:download-direct', async (_event, payload) => {
    const rawUrl = String(payload?.url || '').trim()
    const fileName = safeFileName(payload?.fileName || 'netease-download.mp3')

    if (!isAllowedDownloadHost(rawUrl)) {
      return { ok: false, error: 'URL_NOT_ALLOWED' }
    }

    try {
      return createDownloadTask({
        url: rawUrl,
        fileName,
        source: 'direct-url',
        title: fileName
      })
    } catch (err) {
      console.error('Failed to download direct URL:', err)
      return { ok: false, error: 'DOWNLOAD_FAILED' }
    }
  })

  ipcMain.handle('netease:auth:get-state', async () => {
    await ensureAuthStateLoaded()
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:get-account-summary', async (_event, payload) => {
    await ensureAuthStateLoaded()

    if (payload?.refresh && (authState.cookie || authState.userId)) {
      try {
        await refreshProfileFromAuth()
      } catch {
        // Ignore refresh errors and return cached summary for UI fallback.
      }
    }

    return {
      ok: true,
      account: getPublicAccountSummary(),
      state: getPublicAuthState()
    }
  })

  ipcMain.handle('netease:auth:update', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const nextBase = String(payload?.apiBaseUrl || authState.apiBaseUrl).trim()
    authState.apiBaseUrl = nextBase || 'https://music.163.com'
    authState.cookie = String(payload?.cookie ?? authState.cookie ?? '').trim()
    authState.accessToken = String(payload?.accessToken ?? authState.accessToken ?? '').trim()
    authState.refreshToken = String(payload?.refreshToken ?? authState.refreshToken ?? '').trim()
    authState.userName = String(payload?.userName ?? authState.userName ?? '').trim()
    authState.userId = String(payload?.userId ?? authState.userId ?? '').trim()

    await persistAuthState()
    emitAuthStateUpdate('manual-update')
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:login-email', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const email = sanitizeEmail(payload?.email)
    const password = String(payload?.password || '')
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!email || !password) {
      return { ok: false, error: 'INVALID_CREDENTIALS' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const base = String(authState.apiBaseUrl).replace(/\/+$/, '')
      const url = `${base}/api/login`
      const body = encodeFormData({
        username: email,
        password: md5(password),
        rememberLogin: true
      })

      const result = await requestJsonWithMeta(url, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }),
        body,
        timeout: 12000
      })

      if (result.statusCode !== 200 || !result.data) {
        return { ok: false, error: 'LOGIN_REQUEST_FAILED', statusCode: result.statusCode }
      }

      const code = Number(result.data.code || 0)
      if (code !== 200) {
        return {
          ok: false,
          error: 'LOGIN_FAILED',
          code,
          message: String(result.data.msg || result.data.message || 'LOGIN_FAILED')
        }
      }

      const cookie = normalizeCookieHeader(result.headers['set-cookie'])
      if (cookie) {
        authState.cookie = cookie
      }

      applyProfileToAuthState(result.data?.profile)
      authState.userId = String(result.data?.account?.id || authState.userId || '')
      await enrichAuthStateProfileByUserId(authState.userId)
      await persistAuthState()
      emitAuthStateUpdate('login-email')

      return {
        ok: true,
        state: getPublicAuthState(),
        profile: getPublicAccountSummary()
      }
    } catch (err) {
      console.error('Failed to login with email:', err)
      return { ok: false, error: 'LOGIN_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:send-captcha', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const phone = sanitizePhone(payload?.phone)
    const countryCode = sanitizeCountryCode(payload?.countryCode)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!phone) {
      return { ok: false, error: 'INVALID_PHONE' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const sendResult = await postFormWithFallback(
        getCandidateApiPaths('/api/sms/captcha/sent'),
        {
          ctcode: countryCode,
          cellphone: phone
        }
      )

      if (!sendResult.ok || !sendResult.result?.data) {
        return {
          ok: false,
          error: 'SEND_CAPTCHA_REQUEST_FAILED',
          message: sendResult.error || 'SEND_CAPTCHA_REQUEST_FAILED'
        }
      }

      const data = sendResult.result.data
      const code = Number(data?.code || 0)
      if (code !== 200) {
        const message = extractApiErrorMessage(data)
        if (isRiskControlMessage(message)) {
          return {
            ok: false,
            error: 'LOGIN_RISK_BLOCKED',
            code,
            message: message || '当前登录存在安全风险，请稍后再试'
          }
        }

        return {
          ok: false,
          error: 'SEND_CAPTCHA_FAILED',
          code,
          message: message || 'SEND_CAPTCHA_FAILED'
        }
      }

      return { ok: true, code }
    } catch (err) {
      console.error('Failed to send phone captcha:', err)
      return { ok: false, error: 'SEND_CAPTCHA_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:login-captcha', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const phone = sanitizePhone(payload?.phone)
    const captcha = sanitizeCaptcha(payload?.captcha)
    const countryCode = sanitizeCountryCode(payload?.countryCode)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!phone || !captcha) {
      return { ok: false, error: 'INVALID_PHONE_OR_CAPTCHA' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const payloadData = {
        phone,
        cellphone: phone,
        captcha,
        countrycode: countryCode,
        ctcode: countryCode,
        rememberLogin: true
      }

      // Validate captcha first; this avoids some gateway variants rejecting direct login-captcha flow.
      const verifyResult = await postFormWithFallback(
        getCandidateApiPaths('/api/sms/captcha/verify'),
        {
          cellphone: phone,
          captcha,
          ctcode: countryCode
        }
      )

      if (verifyResult.ok && verifyResult.result?.data) {
        const verifyCode = Number(verifyResult.result.data?.code || 0)
        if (verifyCode !== 200) {
          const verifyMessage = extractApiErrorMessage(verifyResult.result.data)
          if (isRiskControlMessage(verifyMessage)) {
            return {
              ok: false,
              error: 'LOGIN_RISK_BLOCKED',
              code: verifyCode,
              message: verifyMessage || '当前登录存在安全风险，请稍后再试'
            }
          }
        }
      }

      const loginResult = await postFormWithFallback(
        getCandidateApiPaths('/api/login/cellphone'),
        payloadData
      )

      if (!loginResult.ok || !loginResult.result?.data) {
        return {
          ok: false,
          error: 'LOGIN_REQUEST_FAILED',
          message: loginResult.error || 'LOGIN_REQUEST_FAILED'
        }
      }

      const result = loginResult.result

      if (result.statusCode !== 200 || !result.data) {
        return { ok: false, error: 'LOGIN_REQUEST_FAILED', statusCode: result.statusCode }
      }

      const code = Number(result.data.code || 0)
      if (code !== 200) {
        const message = extractApiErrorMessage(result.data)
        if (isRiskControlMessage(message)) {
          return {
            ok: false,
            error: 'LOGIN_RISK_BLOCKED',
            code,
            message: message || '当前登录存在安全风险，请稍后再试'
          }
        }

        return {
          ok: false,
          error: 'LOGIN_FAILED',
          code,
          message: message || 'LOGIN_FAILED'
        }
      }

      const cookie = normalizeCookieHeader(result.headers['set-cookie'])
      if (cookie) {
        authState.cookie = cookie
      }

      applyProfileToAuthState(result.data?.profile)
      authState.userId = String(result.data?.account?.id || authState.userId || '')
      await enrichAuthStateProfileByUserId(authState.userId)
      await persistAuthState()
      emitAuthStateUpdate('login-phone-captcha')

      return {
        ok: true,
        state: getPublicAuthState(),
        profile: getPublicAccountSummary()
      }
    } catch (err) {
      console.error('Failed to login with phone captcha:', err)
      return { ok: false, error: 'LOGIN_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:qr:create', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()
    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const keyResult = await postFormWithFallback(
        getCandidateApiPaths('/api/login/qrcode/unikey'),
        { type: 1 }
      )

      if (!keyResult.ok || !keyResult.result?.data) {
        return {
          ok: false,
          error: 'QR_KEY_REQUEST_FAILED',
          message: keyResult.error || 'QR_KEY_REQUEST_FAILED'
        }
      }

      const data = keyResult.result.data
      const code = Number(data?.code || 0)
      if (code !== 200) {
        return {
          ok: false,
          error: 'QR_KEY_FAILED',
          code,
          message: extractApiErrorMessage(data) || 'QR_KEY_FAILED'
        }
      }

      const qrKey = String(data?.unikey || data?.data?.unikey || '').trim()
      if (!qrKey) {
        return { ok: false, error: 'QR_KEY_EMPTY' }
      }

      const qrLoginUrl = `https://music.163.com/login?codekey=${encodeURIComponent(qrKey)}`
      let qrDataUrl = ''
      try {
        qrDataUrl = await buildQrCodeDataUrl(qrLoginUrl)
      } catch (err) {
        console.warn('Failed to build QR image data URL:', err)
      }

      return {
        ok: true,
        qrKey,
        qrLoginUrl,
        qrDataUrl
      }
    } catch (err) {
      console.error('Failed to create QR login:', err)
      return { ok: false, error: 'QR_CREATE_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:qr:check', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const qrKey = sanitizeQrKey(payload?.qrKey)
    const apiBaseUrl = String(payload?.apiBaseUrl || authState.apiBaseUrl || '').trim()

    if (!qrKey) {
      return { ok: false, error: 'INVALID_QR_KEY' }
    }

    authState.apiBaseUrl = apiBaseUrl || 'https://music.163.com'

    try {
      const checkResult = await postFormWithFallback(
        getCandidateApiPaths('/api/login/qrcode/client/login'),
        {
          key: qrKey,
          type: 1
        }
      )

      if (!checkResult.ok || !checkResult.result?.data) {
        return {
          ok: false,
          error: 'QR_CHECK_REQUEST_FAILED',
          message: checkResult.error || 'QR_CHECK_REQUEST_FAILED'
        }
      }

      const result = checkResult.result
      const data = result.data
      const code = Number(data?.code || 0)
      const message = extractApiErrorMessage(data)

      if (code === 803) {
        const cookie = normalizeCookieHeader(result.headers['set-cookie'])
        const bodyCookie = String(data?.cookie || '').trim()
        if (cookie) {
          authState.cookie = cookie
          await persistAuthState()
        } else if (bodyCookie) {
          authState.cookie = bodyCookie
          await persistAuthState()
        }

        const profile = await refreshProfileFromAuth()
        emitAuthStateUpdate('qr-authorized')
        const verified = Boolean(profile?.userId || authState.userId)
        return {
          ok: true,
          code,
          status: 'AUTHORIZED',
          message: message || '授权成功',
          profile,
          verified,
          state: getPublicAuthState()
        }
      }

      if (code === 801) {
        return { ok: true, code, status: 'WAIT_SCAN', message: message || '等待扫码' }
      }

      if (code === 802) {
        return { ok: true, code, status: 'WAIT_CONFIRM', message: message || '等待确认' }
      }

      if (code === 800) {
        return { ok: true, code, status: 'EXPIRED', message: message || '二维码已过期' }
      }

      return {
        ok: false,
        error: 'QR_CHECK_FAILED',
        code,
        message: message || 'QR_CHECK_FAILED'
      }
    } catch (err) {
      console.error('Failed to check QR login status:', err)
      return { ok: false, error: 'QR_CHECK_EXCEPTION', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:clear', async () => {
    await ensureAuthStateLoaded()
    clearAuthState()
    await persistAuthState()
    emitAuthStateUpdate('clear')
    return { ok: true, state: getPublicAuthState() }
  })

  ipcMain.handle('netease:auth:verify', async () => {
    await ensureAuthStateLoaded()
    try {
      const data = await requestNeteaseApi('/api/w/nuser/account/get', {}, { method: 'POST' })
      const profile = data?.profile || null
      if (profile) {
        applyProfileToAuthState(profile)
        await enrichAuthStateProfileByUserId(authState.userId)
        await persistAuthState()
        emitAuthStateUpdate('verify')
      }
      return {
        ok: true,
        profile: profile
          ? {
              userId: String(profile.userId || ''),
              nickname: profile.nickname || '',
              avatarUrl: profile.avatarUrl || '',
              signature: profile.signature || '',
              follows: Number(profile.follows || 0),
              followeds: Number(profile.followeds || 0),
              vipType: Number(profile.vipType || 0)
            }
          : null,
        code: Number(data?.code || 0)
      }
    } catch (err) {
      console.error('Failed to verify NetEase auth:', err)
      return { ok: false, error: 'VERIFY_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:auth:request', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const pathValue = String(payload?.path || '').trim()
    if (!pathValue) {
      return { ok: false, error: 'INVALID_PATH' }
    }

    try {
      const data = await requestNeteaseApi(pathValue, payload?.data || {}, {
        method: String(payload?.method || 'POST').toUpperCase(),
        timeout: Number(payload?.timeout || 12000)
      })
      return { ok: true, data }
    } catch (err) {
      console.error('Failed to call authenticated NetEase API:', err)
      return { ok: false, error: 'REQUEST_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:resolve-song-download-url', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const songId = sanitizeSongId(payload?.songId)
    if (!songId) {
      return { ok: false, error: 'INVALID_SONG_ID' }
    }

    const level = String(payload?.level || 'exhigh').trim() || 'exhigh'
    try {
      const resolveResult = await resolveSongUrlWithLevelFallback(songId, level)
      if (!resolveResult.ok || !resolveResult.resolved?.url) {
        return {
          ok: false,
          error: 'URL_NOT_FOUND',
          message: resolveResult.message,
          attempts: resolveResult.attempts || []
        }
      }

      const resolved = resolveResult.resolved

      if (!isNeteaseAudioHost(resolved.url)) {
        return {
          ok: false,
          error: 'URL_NOT_ALLOWED',
          message: `音源地址不在白名单域名内: ${resolved.url}`
        }
      }

      return {
        ok: true,
        resolved,
        pickedLevel: resolveResult.pickedLevel,
        attempts: resolveResult.attempts
      }
    } catch (err) {
      console.error('Failed to resolve song download URL:', err)
      return { ok: false, error: 'RESOLVE_URL_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-by-song-id', async (_event, payload) => {
    try {
      return await createSongDownloadTaskFromId({
        ...payload,
        source: 'song-id',
        targetDirType: payload?.targetDirType || 'songs',
        duplicateStrategy: payload?.duplicateStrategy || 'skip',
        downloadMode: payload?.downloadMode || 'song-download-only',
        addToQueue: Boolean(payload?.addToQueue),
        savePlaylistName: payload?.savePlaylistName || ''
      })
    } catch (err) {
      console.error('Failed to create song-id download task:', err)
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-song-task', async (_event, payload) => {
    const mode = String(payload?.mode || 'song-download-only').trim()
    const modeMap = {
      'song-download-only': { targetDirType: 'songs', addToQueue: false },
      'song-temp-queue-only': { targetDirType: 'temp', addToQueue: true },
      'song-download-and-queue': { targetDirType: 'songs', addToQueue: true }
    }

    const resolvedMode = modeMap[mode] || modeMap['song-download-only']

    try {
      return await createSongDownloadTaskFromId({
        ...payload,
        targetDirType: resolvedMode.targetDirType,
        addToQueue: resolvedMode.addToQueue,
        duplicateStrategy: payload?.duplicateStrategy || 'skip',
        downloadMode: mode,
        source: 'song-id'
      })
    } catch (err) {
      return { ok: false, error: 'DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-playlist-by-id', async (_event, payload) => {
    await ensureAuthStateLoaded()

    const playlistId = sanitizeId(payload?.playlistId)
    if (!playlistId) return { ok: false, error: 'INVALID_PLAYLIST_ID' }

    const mode = String(payload?.mode || 'playlist-download-only').trim()
    const level = String(payload?.level || 'exhigh').trim() || 'exhigh'
    const duplicateStrategy = String(payload?.duplicateStrategy || 'skip').trim().toLowerCase() || 'skip'

    try {
      const playlist = await fetchPlaylistTracksById(playlistId)
      if (!playlist || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
        return { ok: false, error: 'PLAYLIST_EMPTY_OR_NOT_FOUND' }
      }

      const optionsByMode = {
        'playlist-download-only': {
          targetDirType: 'lists',
          addToQueue: false,
          savePlaylistName: ''
        },
        'playlist-download-and-queue': {
          targetDirType: 'lists',
          addToQueue: true,
          savePlaylistName: ''
        },
        'playlist-download-and-save': {
          targetDirType: 'lists',
          addToQueue: false,
          savePlaylistName: playlist.name
        }
      }

      const selected = optionsByMode[mode] || optionsByMode['playlist-download-only']
      const savePlaylistBatchKey = selected.savePlaylistName ? createTaskId() : ''

      const createdTasks = []
      const failedItems = []
      for (const track of playlist.tracks) {
        try {
          const created = await createSongDownloadTaskFromId({
            songId: track.songId,
            level,
            title: track.title,
            fileName: `${track.title || `歌曲 ${track.songId}`}-${level}.mp3`,
            targetDirType: selected.targetDirType,
            playlistName: playlist.name,
            duplicateStrategy,
            source: 'playlist-id',
            downloadMode: mode,
            playlistContext: {
              playlistId,
              playlistName: playlist.name,
              creator: playlist.creator || ''
            },
            addToQueue: selected.addToQueue,
            savePlaylistName: selected.savePlaylistName,
            savePlaylistBatchKey
          })

          if (created?.ok && created.task) {
            createdTasks.push(created.task)
          } else {
            failedItems.push({ songId: track.songId, error: created?.error || 'DOWNLOAD_CREATE_FAILED' })
          }
        } catch (err) {
          failedItems.push({ songId: track.songId, error: err?.message || 'DOWNLOAD_CREATE_FAILED' })
        }
      }

      return {
        ok: true,
        playlist: {
          id: playlist.id,
          name: playlist.name,
          creator: playlist.creator,
          trackCount: playlist.trackCount
        },
        createdCount: createdTasks.length,
        failedCount: failedItems.length,
        tasks: createdTasks,
        failedItems
      }
    } catch (err) {
      console.error('Failed to create playlist download tasks:', err)
      return { ok: false, error: 'PLAYLIST_DOWNLOAD_CREATE_FAILED', message: err?.message || '' }
    }
  })

  ipcMain.handle('netease:download-task:list', async () => {
    return { ok: true, tasks: listDownloadTasks() }
  })

  ipcMain.handle('netease:download-task:cancel', async (_event, payload) => {
    const id = String(payload?.id || '').trim()
    if (!id) return { ok: false, error: 'INVALID_TASK_ID' }

    return cancelDownloadTask(id)
  })
}

module.exports = { registerNeteaseHandlers }
