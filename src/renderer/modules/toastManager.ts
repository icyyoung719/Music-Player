type ToastPayload = {
  message?: string
  level?: string
  durationMs?: number
}

type ToastApi = {
  onAppToast?: (listener: (payload: ToastPayload) => void) => void
}

type ToastOptions = {
  electronAPI?: ToastApi
  container?: HTMLElement | null
}

export function createToastManager(options: ToastOptions) {
  const { electronAPI, container } = options || {}
  const MAX_TOASTS = 6
  const TOAST_DURATION_MS = 3200

  function removeToast(node: HTMLElement | null): void {
    if (!node) return
    node.classList.add('is-leaving')
    window.setTimeout(() => {
      if (node.parentElement) {
        node.parentElement.removeChild(node)
      }
    }, 260)
  }

  function pushToast(payload: ToastPayload): void {
    if (!container) return
    const message = String(payload?.message || '').trim()
    if (!message) return

    const level = String(payload?.level || 'info')
    const toast = document.createElement('div')
    toast.className = `app-toast app-toast-${level}`

    const title = document.createElement('div')
    title.className = 'app-toast-title'
    title.textContent = level === 'success' ? '下载完成' : level === 'error' ? '下载失败' : '下载提醒'

    const body = document.createElement('div')
    body.className = 'app-toast-body'
    body.textContent = message

    toast.appendChild(title)
    toast.appendChild(body)
    container.appendChild(toast)

    while (container.children.length > MAX_TOASTS) {
      const first = container.firstElementChild
      if (!first) break
      first.remove()
    }

    window.setTimeout(() => removeToast(toast), Number(payload?.durationMs || TOAST_DURATION_MS))
  }

  function init(): void {
    if (!electronAPI?.onAppToast) return
    electronAPI.onAppToast((payload) => {
      pushToast(payload)
    })
  }

  return {
    init,
    pushToast
  }
}
