function truncateText(text, max = 24) {
  const value = String(text || '').trim()
  if (!value) return ''
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function normalizeAvatarUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^http:\/\//i, 'https://')
}

export function createAccountManager(options) {
  const { electronAPI, dom, onRequestLoginWindow } = options

  if (!dom || !dom.userNameEl || !dom.userDetailEl || !dom.avatarEl || !dom.loginBtnEl) {
    return { init() {} }
  }

  let unsubscribe = null

  function applyAccount(account, state) {
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

    const detailParts = []

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

  async function refreshAccountSummary(forceRefresh = false) {
    if (!electronAPI?.neteaseAuthGetAccountSummary) return

    const res = await electronAPI.neteaseAuthGetAccountSummary({
      refresh: forceRefresh
    })

    if (!res?.ok) {
      applyAccount(null, null)
      return
    }

    applyAccount(res.account, res.state)
  }

  function bindEvents() {
    dom.loginBtnEl.addEventListener('click', () => {
      if (typeof onRequestLoginWindow === 'function') {
        onRequestLoginWindow()
      }
    })

    if (electronAPI?.onNeteaseAuthStateUpdate) {
      unsubscribe = electronAPI.onNeteaseAuthStateUpdate((payload) => {
        applyAccount(payload?.account, payload?.state)
      })
    }
  }

  async function init() {
    bindEvents()
    await refreshAccountSummary(true)
  }

  function dispose() {
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
