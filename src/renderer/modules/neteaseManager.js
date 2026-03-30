export function createNeteaseManager(options) {
  const {
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    dom,
    eventBus,
    onAppendDownloadedTrack
  } = options

  if (!dom || !dom.input || !dom.result || !dom.searchBtn || !dom.openBtn) {
    return { init() {} }
  }

  let lastResolved = null
  let authState = null
  let qrKey = ''
  let qrLoginUrl = ''
  let qrPollTimer = null
  const taskStateMap = new Map()
  const autoQueueTaskIds = new Set()

  function setResult(text, isError = false) {
    dom.result.textContent = text
    dom.result.style.color = isError ? '#cf3f3f' : ''
  }

  function setAuthStatus(text, isError = false) {
    if (!dom.authStatus) return
    dom.authStatus.textContent = text
    dom.authStatus.style.color = isError ? '#cf3f3f' : ''
  }

  function normalizeId(raw) {
    const text = String(raw || '').trim()
    if (!/^\d{1,20}$/.test(text)) return null
    return text
  }

  function getType() {
    return dom.type && dom.type.value === 'playlist' ? 'playlist' : 'song'
  }

  function renderSong(item) {
    const durationSec = Math.floor((item.durationMs || 0) / 1000)
    const min = Math.floor(durationSec / 60)
    const sec = durationSec % 60
    const duration = durationSec > 0 ? `${min}:${String(sec).padStart(2, '0')}` : '--:--'

    setResult(
      `歌曲: ${item.name} | 歌手: ${item.artist || '未知'} | 专辑: ${item.album || '未知'} | 时长: ${duration}`
    )
  }

  function renderPlaylist(item) {
    const preview = Array.isArray(item.tracks)
      ? item.tracks.slice(0, 5).map((track, index) => `${index + 1}. ${track.name} - ${track.artist || '未知'}`).join('  |  ')
      : ''

    setResult(
      `歌单: ${item.name} | 创建者: ${item.creator || '未知'} | 歌曲数: ${item.trackCount || 0}${preview ? ` | 预览: ${preview}` : ''}`
    )
  }

  function formatTaskStatus(task) {
    if (!task) return '未知'
    switch (task.status) {
      case 'pending':
        return '排队中'
      case 'downloading':
        return '下载中'
      case 'succeeded':
        return '已完成'
      case 'failed':
        return '失败'
      case 'canceled':
        return '已取消'
      default:
        return task.status || '未知'
    }
  }

  function renderTasks() {
    if (!dom.taskList) return

    const tasks = Array.from(taskStateMap.values()).sort((a, b) => b.createdAt - a.createdAt)
    if (!tasks.length) {
      dom.taskList.innerHTML = '<div class="netease-task-empty">暂无下载任务</div>'
      return
    }

    const html = tasks
      .map((task) => {
        const progress = task.totalBytes > 0
          ? `${Math.round((task.receivedBytes / task.totalBytes) * 100)}%`
          : `${Math.round((task.progress || 0) * 100)}%`
        const canCancel = task.status === 'pending' || task.status === 'downloading'
        const tail = task.error ? ` | ${task.error}` : ''

        return `
          <div class="netease-task-item" data-task-id="${task.id}">
            <div class="netease-task-line"><strong>${task.title || task.songId || task.id}</strong></div>
            <div class="netease-task-line">状态: ${formatTaskStatus(task)} | 进度: ${progress}${tail}</div>
            <div class="netease-task-line netease-task-path">${task.filePath || ''}</div>
            ${canCancel ? '<button class="netease-task-cancel" data-action="cancel-task">取消</button>' : ''}
          </div>
        `
      })
      .join('')

    dom.taskList.innerHTML = html
  }

  function applyAuthStateToForm(state) {
    if (!state) return
    authState = state

    if (dom.authApiBaseInput) dom.authApiBaseInput.value = state.apiBaseUrl || 'https://music.163.com'
    if (dom.authUserNameInput) dom.authUserNameInput.value = state.userName || ''
    if (dom.authUserIdInput) dom.authUserIdInput.value = state.userId || ''

    const tokenHint = state.hasAccessToken ? 'Token 已保存' : '未保存 Token'
    const cookieHint = state.hasCookie ? 'Cookie 已就绪' : 'Cookie 未就绪'
    const loginHint = state.userName ? `已登录: ${state.userName}` : '未登录'
    setAuthStatus(`授权状态: ${loginHint} / ${cookieHint} / ${tokenHint}`)
  }

  function renderQrPreview(dataUrl, link) {
    if (dom.authQrLink) {
      dom.authQrLink.textContent = link || '二维码登录链接将在这里显示'
    }

    if (!dom.authQrImg || !dom.authQrPlaceholder) return
    if (dataUrl) {
      dom.authQrImg.src = dataUrl
      dom.authQrImg.style.display = 'block'
      dom.authQrPlaceholder.style.display = 'none'
      return
    }

    dom.authQrImg.src = ''
    dom.authQrImg.style.display = 'none'
    dom.authQrPlaceholder.style.display = 'inline'
  }

  async function createQrLogin() {
    if (!electronAPI || !electronAPI.neteaseAuthQrCreate) return

    const apiBaseUrl = dom.authApiBaseInput ? String(dom.authApiBaseInput.value || '').trim() : ''
    setAuthStatus('正在生成二维码...')

    const res = await electronAPI.neteaseAuthQrCreate({ apiBaseUrl })
    if (!res || !res.ok) {
      const msg = res?.message || res?.error || 'QR_CREATE_FAILED'
      setAuthStatus(`生成二维码失败: ${msg}`, true)
      return
    }

    qrKey = String(res.qrKey || '')
    qrLoginUrl = String(res.qrLoginUrl || '')
    renderQrPreview(res.qrDataUrl || '', qrLoginUrl)
    setAuthStatus('二维码已生成，已自动开始轮询。请使用网易云 App 扫码并确认。')
    startQrPolling()
  }

  async function checkQrStatusOnce() {
    if (!electronAPI || !electronAPI.neteaseAuthQrCheck) return
    if (!qrKey) {
      setAuthStatus('请先生成二维码。', true)
      return
    }

    const apiBaseUrl = dom.authApiBaseInput ? String(dom.authApiBaseInput.value || '').trim() : ''
    const res = await electronAPI.neteaseAuthQrCheck({
      qrKey,
      apiBaseUrl
    })

    if (!res || !res.ok) {
      const msg = res?.message || res?.error || 'QR_CHECK_FAILED'
      setAuthStatus(`二维码状态检查失败: ${msg}`, true)
      return
    }

    switch (res.status) {
      case 'WAIT_SCAN':
        setAuthStatus('二维码状态: 等待扫码')
        break
      case 'WAIT_CONFIRM':
        setAuthStatus('二维码状态: 已扫码，等待手机确认')
        break
      case 'EXPIRED':
        stopQrPolling()
        setAuthStatus('二维码已过期，请重新生成。', true)
        break
      case 'AUTHORIZED':
        stopQrPolling()
        if (res.state) applyAuthStateToForm(res.state)
        if (res.verified) {
          setAuthStatus(`二维码登录成功并已校验: ${res.profile?.userName || authState?.userName || '已登录用户'}`)
        } else {
          setAuthStatus('二维码已授权，但登录态校验未通过，请点击“验证授权”。', true)
        }
        break
      default:
        setAuthStatus(`二维码状态: ${res.message || res.status || '未知'}`)
        break
    }
  }

  function startQrPolling() {
    if (qrPollTimer) return
    if (!qrKey) {
      setAuthStatus('请先生成二维码。', true)
      return
    }

    setAuthStatus('已开始轮询二维码状态...')
    qrPollTimer = setInterval(() => {
      checkQrStatusOnce()
    }, 2000)
    checkQrStatusOnce()
  }

  function stopQrPolling() {
    if (!qrPollTimer) return
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }

  function openQrLink() {
    if (!qrLoginUrl) {
      setAuthStatus('请先生成二维码链接。', true)
      return
    }

    if (electronAPI && electronAPI.neteaseOpenExternalUrl) {
      electronAPI.neteaseOpenExternalUrl({ url: qrLoginUrl })
    }
  }

  async function loginByEmail() {
    if (!electronAPI || !electronAPI.neteaseAuthLoginEmail) return

    const email = dom.authEmailInput ? String(dom.authEmailInput.value || '').trim() : ''
    const password = dom.authPasswordInput ? String(dom.authPasswordInput.value || '') : ''
    const apiBaseUrl = dom.authApiBaseInput ? String(dom.authApiBaseInput.value || '').trim() : ''

    if (!email || !password) {
      setAuthStatus('请输入邮箱和密码后再登录。', true)
      return
    }

    setAuthStatus('正在登录...')
    const res = await electronAPI.neteaseAuthLoginEmail({
      email,
      password,
      apiBaseUrl
    })

    if (!res || !res.ok) {
      const msg = res?.message || res?.error || 'LOGIN_FAILED'
      setAuthStatus(`邮箱登录失败: ${msg}`, true)
      return
    }

    if (dom.authPasswordInput) dom.authPasswordInput.value = ''
    applyAuthStateToForm(res.state)
    const showName = res.profile?.userName || res.state?.userName || email
    setAuthStatus(`登录成功: ${showName}`)
  }

  async function sendPhoneCaptcha() {
    if (!electronAPI || !electronAPI.neteaseAuthSendCaptcha) return

    const countryCode = dom.authCountryCodeInput ? String(dom.authCountryCodeInput.value || '86').trim() : '86'
    const phone = dom.authPhoneInput ? String(dom.authPhoneInput.value || '').trim() : ''
    const apiBaseUrl = dom.authApiBaseInput ? String(dom.authApiBaseInput.value || '').trim() : ''

    if (!phone) {
      setAuthStatus('请输入手机号后再发送验证码。', true)
      return
    }

    setAuthStatus('正在发送验证码...')
    const res = await electronAPI.neteaseAuthSendCaptcha({
      countryCode,
      phone,
      apiBaseUrl
    })

    if (!res || !res.ok) {
      const msg = res?.message || res?.error || 'SEND_CAPTCHA_FAILED'
      if (res?.error === 'LOGIN_RISK_BLOCKED') {
        setAuthStatus('发送验证码被风控拦截，请稍后重试，或改用邮箱登录。', true)
      } else {
        setAuthStatus(`发送验证码失败: ${msg}`, true)
      }
      return
    }

    setAuthStatus('验证码已发送，请查看手机短信。')
  }

  async function loginByPhoneCaptcha() {
    if (!electronAPI || !electronAPI.neteaseAuthLoginCaptcha) return

    const countryCode = dom.authCountryCodeInput ? String(dom.authCountryCodeInput.value || '86').trim() : '86'
    const phone = dom.authPhoneInput ? String(dom.authPhoneInput.value || '').trim() : ''
    const captcha = dom.authCaptchaInput ? String(dom.authCaptchaInput.value || '').trim() : ''
    const apiBaseUrl = dom.authApiBaseInput ? String(dom.authApiBaseInput.value || '').trim() : ''

    if (!phone || !captcha) {
      setAuthStatus('请输入手机号和验证码后再登录。', true)
      return
    }

    setAuthStatus('正在使用验证码登录...')
    const res = await electronAPI.neteaseAuthLoginCaptcha({
      countryCode,
      phone,
      captcha,
      apiBaseUrl
    })

    if (!res || !res.ok) {
      const msg = res?.message || res?.error || 'LOGIN_FAILED'
      if (res?.error === 'LOGIN_RISK_BLOCKED') {
        setAuthStatus('验证码登录被风控拦截，请稍后重试，或改用邮箱登录。', true)
      } else {
        setAuthStatus(`验证码登录失败: ${msg}`, true)
      }
      return
    }

    if (dom.authCaptchaInput) dom.authCaptchaInput.value = ''
    applyAuthStateToForm(res.state)
    const showName = res.profile?.userName || res.state?.userName || phone
    setAuthStatus(`登录成功: ${showName}`)
  }

  async function refreshAuthState() {
    if (!electronAPI || !electronAPI.neteaseAuthGetState) return
    const res = await electronAPI.neteaseAuthGetState()
    if (res?.ok && res.state) {
      applyAuthStateToForm(res.state)
    }
  }

  async function saveAuthState() {
    if (!electronAPI || !electronAPI.neteaseAuthUpdate) return

    const payload = {
      apiBaseUrl: dom.authApiBaseInput ? dom.authApiBaseInput.value : undefined,
      accessToken: dom.authAccessTokenInput ? dom.authAccessTokenInput.value : undefined,
      refreshToken: dom.authRefreshTokenInput ? dom.authRefreshTokenInput.value : undefined,
      userName: dom.authUserNameInput ? dom.authUserNameInput.value : undefined,
      userId: dom.authUserIdInput ? dom.authUserIdInput.value : undefined
    }

    const res = await electronAPI.neteaseAuthUpdate(payload)
    if (!res || !res.ok) {
      setAuthStatus('保存授权信息失败。', true)
      return
    }

    if (dom.authAccessTokenInput) dom.authAccessTokenInput.value = ''
    if (dom.authRefreshTokenInput) dom.authRefreshTokenInput.value = ''

    applyAuthStateToForm(res.state)
    setAuthStatus('授权信息已保存。')
  }

  async function verifyAuthState() {
    if (!electronAPI || !electronAPI.neteaseAuthVerify) return
    setAuthStatus('正在验证授权...')

    const res = await electronAPI.neteaseAuthVerify()
    if (!res || !res.ok) {
      setAuthStatus('授权校验失败，请先登录或检查授权配置。', true)
      return
    }

    if (res.profile) {
      if (dom.authUserNameInput) dom.authUserNameInput.value = res.profile.nickname || ''
      if (dom.authUserIdInput) dom.authUserIdInput.value = res.profile.userId || ''
      setAuthStatus(`授权有效: ${res.profile.nickname || '未知用户'} (${res.profile.userId || '-'})`)
      await saveAuthState()
      return
    }

    setAuthStatus('校验完成，但未获取到用户信息。')
  }

  async function clearAuthState() {
    if (!electronAPI || !electronAPI.neteaseAuthClear) return
    const res = await electronAPI.neteaseAuthClear()
    if (!res || !res.ok) {
      setAuthStatus('清空授权信息失败。', true)
      return
    }

    if (dom.authAccessTokenInput) dom.authAccessTokenInput.value = ''
    if (dom.authRefreshTokenInput) dom.authRefreshTokenInput.value = ''
    if (dom.authUserNameInput) dom.authUserNameInput.value = ''
    if (dom.authUserIdInput) dom.authUserIdInput.value = ''

    applyAuthStateToForm(res.state)
    setAuthStatus('授权信息已清空。')
  }

  function updateTask(task) {
    if (!task || !task.id) return
    taskStateMap.set(task.id, task)
    renderTasks()

    if (
      task.status === 'succeeded' &&
      autoQueueTaskIds.has(task.id) &&
      task.filePath
    ) {
      autoQueueTaskIds.delete(task.id)
      if (eventBus) {
        eventBus.emit('playback:queue.append', {
          tracks: [{
            path: task.filePath,
            name: task.title || task.songId || '网易云下载',
            file: null
          }]
        })
      } else if (typeof onAppendDownloadedTrack === 'function') {
        onAppendDownloadedTrack({
          path: task.filePath,
          name: task.title || task.songId || '网易云下载'
        })
      }

      setResult(`下载并已加入当前列表: ${task.filePath}`)
    }
  }

  async function loadTasks() {
    const res = downloadService
      ? await downloadService.loadTasks()
      : (electronAPI?.neteaseDownloadTaskList ? await electronAPI.neteaseDownloadTaskList() : null)
    if (!res || !res.ok || !Array.isArray(res.tasks)) return

    taskStateMap.clear()
    for (const task of res.tasks) {
      taskStateMap.set(task.id, task)
    }
    renderTasks()
  }

  async function createSongIdDownloadTask(autoQueue) {
    if (!dom.songIdDownloadInput) return

    const songId = normalizeId(dom.songIdDownloadInput.value)
    const level = dom.downloadLevelSelect ? dom.downloadLevelSelect.value : 'exhigh'
    if (!songId) {
      setResult('请输入有效歌曲 ID 后再下载。', true)
      return
    }

    setResult('正在创建下载任务...')
    const payload = {
      songId,
      level,
      title: lastResolved?.item?.name || `歌曲 ${songId}`,
      fileName: `${songId}-${level}`
    }

    const res = downloadService
      ? await downloadService.createSongTaskById(payload)
      : await electronAPI.neteaseDownloadBySongId(payload)

    if (!res || !res.ok || !res.task) {
      const msg = res?.message || res?.error || 'DOWNLOAD_CREATE_FAILED'
      if (res?.error === 'URL_NOT_FOUND') {
        setResult(`创建下载任务失败: ${msg}（可能受版权或账号权限限制）`, true)
      } else if (res?.error === 'URL_NOT_ALLOWED') {
        setResult(`创建下载任务失败: ${msg}`, true)
      } else {
        setResult(`创建下载任务失败: ${msg}`, true)
      }
      return
    }

    if (autoQueue) {
      autoQueueTaskIds.add(res.task.id)
    }

    updateTask(res.task)
    const levelInfo = res.pickedLevel ? `，使用音质: ${res.pickedLevel}` : ''
    setResult(`任务已创建: ${res.task.id}${levelInfo}`)
  }

  async function resolve() {
    if (!neteaseDatabaseService && (!electronAPI || !electronAPI.neteaseResolveId)) {
      setResult('当前环境不支持网易云查询。', true)
      return
    }

    const id = normalizeId(dom.input.value)
    const type = getType()
    if (!id) {
      setResult('请输入纯数字歌曲 ID 或歌单 ID。', true)
      return
    }

    setResult('正在查询...')
    const res = neteaseDatabaseService
      ? await neteaseDatabaseService.resolveById(type, id)
      : await electronAPI.neteaseResolveId({ type, id })
    if (!res || !res.ok) {
      setResult('查询失败：可能是 ID 不存在、接口不可用或请求受限。', true)
      lastResolved = null
      return
    }

    lastResolved = { type, id, item: res.item }
    if (type === 'song') {
      renderSong(res.item)
    } else {
      renderPlaylist(res.item)
    }
  }

  async function openPage() {
    const type = getType()
    const id = normalizeId(dom.input.value)
    if (!id) {
      setResult('请输入有效 ID 后再打开官方页面。', true)
      return
    }

    if (!electronAPI || !electronAPI.neteaseOpenPage) return
    await electronAPI.neteaseOpenPage({ type, id })
  }

  async function showDownloadDir() {
    if (!electronAPI || !electronAPI.neteaseGetDownloadDir || !dom.downloadDirBtn) return

    const res = await electronAPI.neteaseGetDownloadDir()
    if (!res || !res.ok) {
      setResult('下载目录创建失败。', true)
      return
    }
    setResult(`下载目录: ${res.dir}`)
  }

  async function directDownload() {
    if (!electronAPI || !electronAPI.neteaseDownloadDirect || !dom.directUrlInput) return

    const url = String(dom.directUrlInput.value || '').trim()
    if (!url) {
      setResult('请输入官方直链后再下载。', true)
      return
    }

    const suggestedName = lastResolved?.item?.name
      ? `${lastResolved.item.name}`
      : 'netease-download'

    setResult('正在下载...')
    const res = await electronAPI.neteaseDownloadDirect({
      url,
      fileName: suggestedName
    })

    if (!res || !res.ok || !res.task) {
      setResult('下载失败：仅允许 music.126.net 的 HTTPS 官方直链。', true)
      return
    }

    updateTask(res.task)
    setResult(`任务已创建: ${res.task.id}`)
  }

  async function cancelTask(taskId) {
    if (!taskId) return
    const res = downloadService
      ? await downloadService.cancelTask(taskId)
      : (electronAPI?.neteaseDownloadTaskCancel ? await electronAPI.neteaseDownloadTaskCancel({ id: taskId }) : null)
    if (!res || !res.ok || !res.task) {
      setResult('取消任务失败。', true)
      return
    }
    updateTask(res.task)
  }

  function init() {
    dom.searchBtn.addEventListener('click', resolve)
    dom.openBtn.addEventListener('click', openPage)

    if (dom.authSaveBtn) {
      dom.authSaveBtn.addEventListener('click', saveAuthState)
    }
    if (dom.authEmailLoginBtn) {
      dom.authEmailLoginBtn.addEventListener('click', loginByEmail)
    }
    if (dom.authSendCaptchaBtn) {
      dom.authSendCaptchaBtn.addEventListener('click', sendPhoneCaptcha)
    }
    if (dom.authPhoneCaptchaLoginBtn) {
      dom.authPhoneCaptchaLoginBtn.addEventListener('click', loginByPhoneCaptcha)
    }
    if (dom.authQrCreateBtn) {
      dom.authQrCreateBtn.addEventListener('click', createQrLogin)
    }
    if (dom.authQrOpenBtn) {
      dom.authQrOpenBtn.addEventListener('click', openQrLink)
    }
    if (dom.authQrStartPollBtn) {
      dom.authQrStartPollBtn.addEventListener('click', startQrPolling)
    }
    if (dom.authQrStopPollBtn) {
      dom.authQrStopPollBtn.addEventListener('click', stopQrPolling)
    }
    if (dom.authVerifyBtn) {
      dom.authVerifyBtn.addEventListener('click', verifyAuthState)
    }
    if (dom.authClearBtn) {
      dom.authClearBtn.addEventListener('click', clearAuthState)
    }

    if (dom.downloadSongBtn) {
      dom.downloadSongBtn.addEventListener('click', () => createSongIdDownloadTask(false))
    }
    if (dom.downloadSongAndQueueBtn) {
      dom.downloadSongAndQueueBtn.addEventListener('click', () => createSongIdDownloadTask(true))
    }

    if (dom.downloadDirBtn) {
      dom.downloadDirBtn.addEventListener('click', showDownloadDir)
    }

    if (dom.directDownloadBtn) {
      dom.directDownloadBtn.addEventListener('click', directDownload)
    }

    dom.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        resolve()
      }
    })

    if (dom.authPasswordInput) {
      dom.authPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          loginByEmail()
        }
      })
    }

    if (dom.authCaptchaInput) {
      dom.authCaptchaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          loginByPhoneCaptcha()
        }
      })
    }

    if (dom.authQrLink) {
      dom.authQrLink.addEventListener('dblclick', () => {
        if (!qrLoginUrl) return
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(qrLoginUrl).then(() => {
            setAuthStatus('二维码链接已复制到剪贴板。')
          }).catch(() => {
            setAuthStatus('复制二维码链接失败，请手动复制。', true)
          })
        }
      })
    }

    if (dom.taskList) {
      dom.taskList.addEventListener('click', (e) => {
        const target = e.target
        if (!(target instanceof HTMLElement)) return
        if (target.dataset.action !== 'cancel-task') return

        const parent = target.closest('[data-task-id]')
        const taskId = parent ? parent.getAttribute('data-task-id') : ''
        if (taskId) cancelTask(taskId)
      })
    }

    if (downloadService) {
      downloadService.onTaskUpdate((task) => {
        updateTask(task)
      })
    } else if (electronAPI && electronAPI.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        updateTask(task)
      })
    }

    if (electronAPI && electronAPI.onNeteaseAuthStateUpdate) {
      electronAPI.onNeteaseAuthStateUpdate((payload) => {
        if (payload?.state) {
          applyAuthStateToForm(payload.state)
        }
      })
    }

    refreshAuthState()
    loadTasks()
  }

  return { init }
}
