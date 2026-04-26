import type { ElectronAPI } from '../core/electronApi.js'

type AccountPayload = {
  isLoggedIn?: boolean
  userName?: string
  userId?: string | number
  avatarUrl?: string
  signature?: string
}

type AccountDom = {
  userNameEl: HTMLElement
  userDetailEl: HTMLElement
  avatarEl: HTMLElement
  loginBtnEl: HTMLButtonElement
}

type AccountSummaryResponse = {
  ok?: boolean
  account?: AccountPayload
  state?: AccountPayload
}

type AccountManagerOptions = {
  electronAPI?: Pick<ElectronAPI, 'neteaseAuthGetAccountSummary' | 'onNeteaseAuthStateUpdate'>
  dom: AccountDom
  onRequestLoginWindow?: () => void
}

function truncateText(text: unknown, max = 24): string {
  const value = String(text || '').trim()
  if (!value) return ''
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function normalizeAvatarUrl(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^http:\/\//i, 'https://')
}

export function createAccountManager(options: AccountManagerOptions) {
  const { electronAPI, dom, onRequestLoginWindow } = options

  if (!dom || !dom.userNameEl || !dom.userDetailEl || !dom.avatarEl || !dom.loginBtnEl) {
    return { init() {} }
  }

  let unsubscribe: (() => void) | null = null

  function applyAccount(account?: AccountPayload | null, state?: AccountPayload | null): void {
    const isLoggedIn = Boolean(account?.isLoggedIn || state?.isLoggedIn)
    const userName = String(account?.userName || state?.userName || '').trim()
    const userId = String(account?.userId || state?.userId || '').trim()
    const avatarUrl = normalizeAvatarUrl(account?.avatarUrl || state?.avatarUrl || '')
    const signature = truncateText(account?.signature || state?.signature || '', 26)

    if (!isLoggedIn) {
      dom.userNameEl.textContent = '未登录网易云'
      dom.userDetailEl.textContent = '点击登录以同步账号信息'
      dom.avatarEl.textContent = '♪'
      dom.avatarEl.style.backgroundImage = ''
      dom.loginBtnEl.textContent = '登录'
      dom.loginBtnEl.title = '打开网易云登录窗口'
      return
    }

    dom.userNameEl.textContent = userName || `网易云用户 ${userId || ''}`.trim()

    const detailParts: string[] = []

    if (userId) detailParts.push(`UID ${userId}`)
    if (signature) detailParts.push(signature)
    dom.userDetailEl.textContent = detailParts.join(' · ')

    if (avatarUrl) {
      dom.avatarEl.textContent = ''
      dom.avatarEl.style.backgroundImage = `url(${avatarUrl})`
    } else {
      dom.avatarEl.textContent = userName ? userName.slice(0, 1) : '云'
      dom.avatarEl.style.backgroundImage = ''
    }

    dom.loginBtnEl.textContent = '切换账号'
    dom.loginBtnEl.title = '打开网易云登录窗口切换账号'
  }

  async function refreshAccountSummary(forceRefresh = false): Promise<void> {
    if (!electronAPI?.neteaseAuthGetAccountSummary) return

    const res = (await electronAPI.neteaseAuthGetAccountSummary({
      refresh: forceRefresh
    })) as AccountSummaryResponse

    if (!res?.ok) {
      applyAccount(null, null)
      return
    }

    applyAccount(res.account, res.state)
  }

  function bindEvents(): void {
    dom.loginBtnEl.addEventListener('click', () => {
      if (typeof onRequestLoginWindow === 'function') {
        onRequestLoginWindow()
      }
    })

    if (electronAPI?.onNeteaseAuthStateUpdate) {
      const maybeUnsubscribe = electronAPI.onNeteaseAuthStateUpdate((payload) => {
        applyAccount(payload?.account, payload?.state)
      })
      unsubscribe = typeof maybeUnsubscribe === 'function' ? maybeUnsubscribe : null
    }
  }

  async function init(): Promise<void> {
    bindEvents()
    await refreshAccountSummary(true)
  }

  function dispose(): void {
    if (typeof unsubscribe === 'function') {
      unsubscribe()
      unsubscribe = null
    }
  }

  return {
    init,
    refreshAccountSummary,
    dispose
  }
}
