type AuthState = {
  apiBaseUrl?: string
  userName?: string
  userId?: string
  hasCookie?: boolean
  hasAccessToken?: boolean
}

type ElectronApiLike = {
  neteaseAuthGetState?: () => Promise<any>
  neteaseAuthLoginEmail?: (payload: {
    email: string
    password: string
    apiBaseUrl: string
  }) => Promise<any>
  neteaseAuthSendCaptcha?: (payload: {
    countryCode: string
    phone: string
    apiBaseUrl: string
  }) => Promise<any>
  neteaseAuthLoginCaptcha?: (payload: {
    countryCode: string
    phone: string
    captcha: string
    apiBaseUrl: string
  }) => Promise<any>
  neteaseAuthQrCreate?: (payload: { apiBaseUrl: string }) => Promise<any>
  neteaseAuthQrCheck?: (payload: { qrKey: string; apiBaseUrl: string }) => Promise<any>
  neteaseAuthUpdate?: (payload: {
    apiBaseUrl: string
    accessToken?: string
    refreshToken?: string
    userName?: string
    userId?: string
  }) => Promise<any>
  neteaseAuthVerify?: () => Promise<any>
  neteaseAuthClear?: () => Promise<any>
  neteaseOpenExternalUrl?: (payload: { url: string }) => void
  neteaseAuthCloseWindow?: () => void
  onNeteaseAuthWindowSetPage?: (handler: (page?: unknown) => void) => void
  onNeteaseAuthStateUpdate?: (handler: (payload?: { state?: AuthState }) => void) => void
}

const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null
const queryAll = <T extends Element>(selector: string): T[] => Array.from(document.querySelectorAll<T>(selector))
const electronAPI = (window as Window & { electronAPI?: ElectronApiLike }).electronAPI

const dom = {
  status: byId<HTMLElement>('authStatus'),
  closeBtn: byId<HTMLButtonElement>('authWindowCloseBtn'),
  tabs: queryAll<HTMLElement>('.auth-tab'),
  pages: queryAll<HTMLElement>('.auth-page'),

  apiBase: byId<HTMLInputElement>('authApiBase'),
  apiBasePhone: byId<HTMLInputElement>('authApiBasePhone'),
  apiBaseQr: byId<HTMLInputElement>('authApiBaseQr'),
  email: byId<HTMLInputElement>('authEmail'),
  password: byId<HTMLInputElement>('authPassword'),
  emailLoginBtn: byId<HTMLButtonElement>('authEmailLoginBtn'),

  countryCode: byId<HTMLInputElement>('authCountryCode'),
  phone: byId<HTMLInputElement>('authPhone'),
  captcha: byId<HTMLInputElement>('authCaptcha'),
  sendCaptchaBtn: byId<HTMLButtonElement>('authSendCaptchaBtn'),
  phoneLoginBtn: byId<HTMLButtonElement>('authPhoneCaptchaLoginBtn'),

  qrImg: byId<HTMLImageElement>('authQrImg'),
  qrPlaceholder: byId<HTMLElement>('authQrPlaceholder'),
  qrLink: byId<HTMLElement>('authQrLink'),
  qrCreateBtn: byId<HTMLButtonElement>('authQrCreateBtn'),
  qrOpenBtn: byId<HTMLButtonElement>('authQrOpenBtn'),
  qrStartPollBtn: byId<HTMLButtonElement>('authQrStartPollBtn'),
  qrStopPollBtn: byId<HTMLButtonElement>('authQrStopPollBtn'),

  userName: byId<HTMLInputElement>('authUserName'),
  userId: byId<HTMLInputElement>('authUserId'),
  accessToken: byId<HTMLInputElement>('authAccessToken'),
  refreshToken: byId<HTMLInputElement>('authRefreshToken'),
  saveBtn: byId<HTMLButtonElement>('authSaveBtn'),
  verifyBtn: byId<HTMLButtonElement>('authVerifyBtn'),
  clearBtn: byId<HTMLButtonElement>('authClearBtn')
}

const SUPPORTED_PAGES = new Set(['email', 'phone', 'qr', 'token'])
let authState: AuthState | null = null
let qrKey = ''
let qrLoginUrl = ''
let qrPollTimer: ReturnType<typeof setInterval> | null = null

function setStatus(text: string, isError = false): void {
  if (!dom.status) return
  dom.status.textContent = text
  dom.status.style.color = isError ? '#b93a2d' : ''
}

function activePage(page: string): void {
  const nextPage = SUPPORTED_PAGES.has(page) ? page : 'email'

  dom.tabs.forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.page === nextPage)
  })

  dom.pages.forEach((section) => {
    section.classList.toggle('is-active', section.dataset.page === nextPage)
  })
}

function getApiBaseFromPage(page: string): string {
  if (page === 'phone') return String(dom.apiBasePhone?.value || '').trim()
  if (page === 'qr') return String(dom.apiBaseQr?.value || '').trim()
  return String(dom.apiBase?.value || '').trim()
}

function setApiBaseAll(apiBaseUrl: string): void {
  const text = String(apiBaseUrl || '').trim() || 'https://music.163.com'
  if (dom.apiBase) dom.apiBase.value = text
  if (dom.apiBasePhone) dom.apiBasePhone.value = text
  if (dom.apiBaseQr) dom.apiBaseQr.value = text
}

function applyState(state: AuthState | null | undefined): void {
  if (!state) return
  authState = state

  setApiBaseAll(state.apiBaseUrl || '')
  if (dom.userName) dom.userName.value = state.userName || ''
  if (dom.userId) dom.userId.value = state.userId || ''

  const loginHint = state.userName ? `已登录: ${state.userName}` : '未登录'
  const cookieHint = state.hasCookie ? 'Cookie 已就绪' : 'Cookie 未就绪'
  const tokenHint = state.hasAccessToken ? 'Token 已保存' : 'Token 未保存'
  setStatus(`授权状态: ${loginHint} / ${cookieHint} / ${tokenHint}`)
}

async function refreshState() {
  if (!electronAPI?.neteaseAuthGetState) return
  const res = await electronAPI.neteaseAuthGetState()
  if (!res?.ok || !res.state) {
    setStatus('读取授权状态失败，请重试。', true)
    return
  }
  applyState(res.state)
}

async function loginByEmail() {
  if (!electronAPI?.neteaseAuthLoginEmail) return

  const email = String(dom.email?.value || '').trim()
  const password = String(dom.password?.value || '')
  const apiBaseUrl = getApiBaseFromPage('email')

  if (!email || !password) {
    setStatus('请输入邮箱和密码后再登录。', true)
    return
  }

  setStatus('正在登录...')
  const res = await electronAPI.neteaseAuthLoginEmail({
    email,
    password,
    apiBaseUrl
  })

  if (!res?.ok) {
    setStatus(`邮箱登录失败: ${res?.message || res?.error || 'LOGIN_FAILED'}`, true)
    return
  }

  if (dom.password) dom.password.value = ''
  applyState(res.state)
  setStatus(`登录成功: ${res.profile?.userName || res.state?.userName || email}`)
}

async function sendPhoneCaptcha() {
  if (!electronAPI?.neteaseAuthSendCaptcha) return

  const countryCode = String(dom.countryCode?.value || '86').trim()
  const phone = String(dom.phone?.value || '').trim()
  const apiBaseUrl = getApiBaseFromPage('phone')

  if (!phone) {
    setStatus('请输入手机号后再发送验证码。', true)
    return
  }

  setStatus('正在发送验证码...')
  const res = await electronAPI.neteaseAuthSendCaptcha({
    countryCode,
    phone,
    apiBaseUrl
  })

  if (!res?.ok) {
    setStatus(`发送验证码失败: ${res?.message || res?.error || 'SEND_CAPTCHA_FAILED'}`, true)
    return
  }

  setStatus('验证码已发送，请查看手机短信。')
}

async function loginByPhoneCaptcha() {
  if (!electronAPI?.neteaseAuthLoginCaptcha) return

  const countryCode = String(dom.countryCode?.value || '86').trim()
  const phone = String(dom.phone?.value || '').trim()
  const captcha = String(dom.captcha?.value || '').trim()
  const apiBaseUrl = getApiBaseFromPage('phone')

  if (!phone || !captcha) {
    setStatus('请输入手机号和验证码后再登录。', true)
    return
  }

  setStatus('正在登录...')
  const res = await electronAPI.neteaseAuthLoginCaptcha({
    countryCode,
    phone,
    captcha,
    apiBaseUrl
  })

  if (!res?.ok) {
    setStatus(`验证码登录失败: ${res?.message || res?.error || 'LOGIN_FAILED'}`, true)
    return
  }

  if (dom.captcha) dom.captcha.value = ''
  applyState(res.state)
  setStatus(`登录成功: ${res.profile?.userName || res.state?.userName || phone}`)
}

function renderQrPreview(dataUrl: string, link: string): void {
  if (dom.qrLink) {
    dom.qrLink.textContent = link || '二维码登录链接将在这里显示'
  }

  if (!dom.qrImg || !dom.qrPlaceholder) return
  if (dataUrl) {
    dom.qrImg.src = dataUrl
    dom.qrImg.style.display = 'block'
    dom.qrPlaceholder.style.display = 'none'
    return
  }

  dom.qrImg.src = ''
  dom.qrImg.style.display = 'none'
  dom.qrPlaceholder.style.display = 'inline'
}

async function createQrLogin() {
  if (!electronAPI?.neteaseAuthQrCreate) return

  setStatus('正在生成二维码...')
  const res = await electronAPI.neteaseAuthQrCreate({
    apiBaseUrl: getApiBaseFromPage('qr')
  })

  if (!res?.ok) {
    setStatus(`生成二维码失败: ${res?.message || res?.error || 'QR_CREATE_FAILED'}`, true)
    return
  }

  qrKey = String(res.qrKey || '')
  qrLoginUrl = String(res.qrLoginUrl || '')
  renderQrPreview(res.qrDataUrl || '', qrLoginUrl)
  setStatus('二维码已生成，已自动开始轮询。')
  startQrPolling()
}

async function checkQrStatusOnce() {
  if (!electronAPI?.neteaseAuthQrCheck || !qrKey) return

  const res = await electronAPI.neteaseAuthQrCheck({
    qrKey,
    apiBaseUrl: getApiBaseFromPage('qr')
  })

  if (!res?.ok) {
    setStatus(`二维码状态检查失败: ${res?.message || res?.error || 'QR_CHECK_FAILED'}`, true)
    return
  }

  if (res.status === 'WAIT_SCAN') {
    setStatus('二维码状态: 等待扫码')
    return
  }

  if (res.status === 'WAIT_CONFIRM') {
    setStatus('二维码状态: 已扫码，等待手机确认')
    return
  }

  if (res.status === 'EXPIRED') {
    stopQrPolling()
    setStatus('二维码已过期，请重新生成。', true)
    return
  }

  if (res.status === 'AUTHORIZED') {
    stopQrPolling()
    if (res.state) applyState(res.state)
    setStatus(`二维码登录成功: ${res.profile?.userName || res.state?.userName || '已登录用户'}`)
  }
}

function startQrPolling(): void {
  if (qrPollTimer || !qrKey) return
  qrPollTimer = setInterval(() => {
    checkQrStatusOnce()
  }, 2000)
  checkQrStatusOnce()
}

function stopQrPolling(): void {
  if (!qrPollTimer) return
  clearInterval(qrPollTimer)
  qrPollTimer = null
}

async function saveAuthState() {
  if (!electronAPI?.neteaseAuthUpdate) return

  const res = await electronAPI.neteaseAuthUpdate({
    apiBaseUrl: getApiBaseFromPage('email'),
    accessToken: dom.accessToken?.value,
    refreshToken: dom.refreshToken?.value,
    userName: dom.userName?.value,
    userId: dom.userId?.value
  })

  if (!res?.ok) {
    setStatus('保存授权信息失败。', true)
    return
  }

  if (dom.accessToken) dom.accessToken.value = ''
  if (dom.refreshToken) dom.refreshToken.value = ''
  applyState(res.state)
  setStatus('授权信息已保存。')
}

async function verifyAuthState() {
  if (!electronAPI?.neteaseAuthVerify) return

  setStatus('正在验证授权...')
  const res = await electronAPI.neteaseAuthVerify()
  if (!res?.ok) {
    setStatus('授权校验失败，请先登录或检查配置。', true)
    return
  }

  if (res.profile) {
    if (dom.userName) dom.userName.value = res.profile.nickname || ''
    if (dom.userId) dom.userId.value = res.profile.userId || ''
    setStatus(`授权有效: ${res.profile.nickname || '未知用户'} (${res.profile.userId || '-'})`)
    await saveAuthState()
    return
  }

  setStatus('校验完成，但未获取到用户信息。')
}

async function clearAuthState() {
  if (!electronAPI?.neteaseAuthClear) return

  const res = await electronAPI.neteaseAuthClear()
  if (!res?.ok) {
    setStatus('清空授权失败。', true)
    return
  }

  if (dom.userName) dom.userName.value = ''
  if (dom.userId) dom.userId.value = ''
  if (dom.accessToken) dom.accessToken.value = ''
  if (dom.refreshToken) dom.refreshToken.value = ''

  applyState(res.state)
  setStatus('授权信息已清空。')
}

function openQrLink(): void {
  if (!qrLoginUrl || !electronAPI?.neteaseOpenExternalUrl) {
    setStatus('请先生成二维码。', true)
    return
  }
  electronAPI.neteaseOpenExternalUrl({ url: qrLoginUrl })
}

function closeWindow(): void {
  if (electronAPI?.neteaseAuthCloseWindow) {
    electronAPI.neteaseAuthCloseWindow()
    return
  }
  window.close()
}

function getInitialPage(): string {
  const params = new URLSearchParams(window.location.search)
  const queryPage = String(params.get('page') || '').trim().toLowerCase()
  if (SUPPORTED_PAGES.has(queryPage)) return queryPage

  const hashPage = window.location.hash.replace(/^#/, '').toLowerCase()
  if (SUPPORTED_PAGES.has(hashPage)) return hashPage

  return 'email'
}

function registerEvents(): void {
  dom.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activePage(tab.dataset.page || 'email')
    })
  })

  dom.closeBtn?.addEventListener('click', closeWindow)
  dom.emailLoginBtn?.addEventListener('click', loginByEmail)
  dom.sendCaptchaBtn?.addEventListener('click', sendPhoneCaptcha)
  dom.phoneLoginBtn?.addEventListener('click', loginByPhoneCaptcha)
  dom.qrCreateBtn?.addEventListener('click', createQrLogin)
  dom.qrOpenBtn?.addEventListener('click', openQrLink)
  dom.qrStartPollBtn?.addEventListener('click', startQrPolling)
  dom.qrStopPollBtn?.addEventListener('click', stopQrPolling)
  dom.saveBtn?.addEventListener('click', saveAuthState)
  dom.verifyBtn?.addEventListener('click', verifyAuthState)
  dom.clearBtn?.addEventListener('click', clearAuthState)

  dom.password?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    loginByEmail()
  })

  dom.captcha?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    loginByPhoneCaptcha()
  })

  dom.qrLink?.addEventListener('dblclick', () => {
    if (!qrLoginUrl || !navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(qrLoginUrl).then(() => {
      setStatus('二维码链接已复制到剪贴板。')
    }).catch(() => {
      setStatus('复制二维码链接失败，请手动复制。', true)
    })
  })

  if (electronAPI?.onNeteaseAuthWindowSetPage) {
    electronAPI.onNeteaseAuthWindowSetPage((page) => {
      activePage(String(page || '').toLowerCase())
    })
  }

  if (electronAPI?.onNeteaseAuthStateUpdate) {
    electronAPI.onNeteaseAuthStateUpdate((payload) => {
      if (payload?.state) {
        applyState(payload.state)
      }
    })
  }

  window.addEventListener('beforeunload', () => {
    stopQrPolling()
  })
}

async function init() {
  activePage(getInitialPage())
  registerEvents()
  await refreshState()
}

init().catch((err) => {
  console.error('Failed to initialize auth window:', err)
  setStatus('初始化登录窗口失败，请重试。', true)
})
