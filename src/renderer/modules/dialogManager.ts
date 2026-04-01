type DialogManagerOptions = {
  doc?: Document
}

type DownloadStrategy = 'full-download' | 'lazy-play' | 'cancel'

export function createDialogManager(options: DialogManagerOptions = {}) {
  const { doc = document } = options

  function requestPlaylistName(title: string, defaultValue?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = doc.createElement('div')
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

      const panel = doc.createElement('div')
      panel.style.width = 'min(420px, 92vw)'
      panel.style.background = '#1f2b4a'
      panel.style.border = '1px solid rgba(255,255,255,0.15)'
      panel.style.borderRadius = '10px'
      panel.style.padding = '14px'
      panel.style.color = '#fff'

      const titleEl = doc.createElement('div')
      titleEl.textContent = title
      titleEl.style.fontSize = '14px'
      titleEl.style.marginBottom = '10px'

      const input = doc.createElement('input')
      input.type = 'text'
      input.value = defaultValue || ''
      input.style.width = '100%'
      input.style.padding = '8px 10px'
      input.style.borderRadius = '6px'
      input.style.border = '1px solid rgba(255,255,255,0.25)'
      input.style.background = 'rgba(255,255,255,0.1)'
      input.style.color = '#fff'
      input.style.outline = 'none'

      const actions = doc.createElement('div')
      actions.style.display = 'flex'
      actions.style.justifyContent = 'flex-end'
      actions.style.gap = '8px'
      actions.style.marginTop = '12px'

      const cancelBtn = doc.createElement('button')
      cancelBtn.textContent = '取消'
      cancelBtn.style.padding = '6px 12px'
      cancelBtn.style.borderRadius = '6px'
      cancelBtn.style.background = 'rgba(255,255,255,0.2)'
      cancelBtn.style.color = '#fff'

      const okBtn = doc.createElement('button')
      okBtn.textContent = '确定'
      okBtn.style.padding = '6px 12px'
      okBtn.style.borderRadius = '6px'

      const close = (value: string | null): void => {
        overlay.remove()
        resolve(value)
      }

      cancelBtn.addEventListener('click', () => close(null))
      okBtn.addEventListener('click', () => close(input.value))
      overlay.addEventListener('click', (event: Event) => {
        if (event.target === overlay) close(null)
      })

      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') close(input.value)
        if (event.key === 'Escape') close(null)
      })

      actions.appendChild(cancelBtn)
      actions.appendChild(okBtn)
      panel.appendChild(titleEl)
      panel.appendChild(input)
      panel.appendChild(actions)
      overlay.appendChild(panel)
      doc.body.appendChild(overlay)

      input.focus()
      input.select()
    })
  }

  function requestCloudDownloadStrategy(): Promise<DownloadStrategy> {
    return new Promise((resolve) => {
      const overlay = doc.createElement('div')
      overlay.style.position = 'fixed'
      overlay.style.left = '0'
      overlay.style.top = '0'
      overlay.style.width = '100vw'
      overlay.style.height = '100vh'
      overlay.style.background = 'rgba(0, 0, 0, 0.45)'
      overlay.style.display = 'flex'
      overlay.style.alignItems = 'center'
      overlay.style.justifyContent = 'center'
      overlay.style.zIndex = '10000'

      const panel = doc.createElement('div')
      panel.style.width = 'min(460px, 92vw)'
      panel.style.background = '#1f2b4a'
      panel.style.border = '1px solid rgba(255,255,255,0.15)'
      panel.style.borderRadius = '12px'
      panel.style.padding = '16px'
      panel.style.color = '#fff'

      const titleEl = doc.createElement('div')
      titleEl.textContent = '下载为本地歌单'
      titleEl.style.fontSize = '15px'
      titleEl.style.fontWeight = '700'
      titleEl.style.marginBottom = '8px'

      const descEl = doc.createElement('div')
      descEl.textContent = '选择本次处理方式：'
      descEl.style.fontSize = '12px'
      descEl.style.opacity = '0.9'
      descEl.style.marginBottom = '12px'

      const actions = doc.createElement('div')
      actions.style.display = 'grid'
      actions.style.gap = '8px'

      const fullBtn = doc.createElement('button')
      fullBtn.textContent = '全量下载并创建本地歌单'
      fullBtn.style.padding = '10px 12px'
      fullBtn.style.borderRadius = '8px'
      fullBtn.style.border = '1px solid rgba(255,255,255,0.24)'
      fullBtn.style.background = 'rgba(255,255,255,0.14)'
      fullBtn.style.color = '#fff'
      fullBtn.style.cursor = 'pointer'

      const lazyBtn = doc.createElement('button')
      lazyBtn.textContent = '仅按需播放（不立即全量下载）'
      lazyBtn.style.padding = '10px 12px'
      lazyBtn.style.borderRadius = '8px'
      lazyBtn.style.border = '1px solid rgba(255,255,255,0.24)'
      lazyBtn.style.background = 'rgba(255,255,255,0.08)'
      lazyBtn.style.color = '#fff'
      lazyBtn.style.cursor = 'pointer'

      const cancelBtn = doc.createElement('button')
      cancelBtn.textContent = '取消'
      cancelBtn.style.padding = '8px 12px'
      cancelBtn.style.borderRadius = '8px'
      cancelBtn.style.border = '1px solid rgba(255,255,255,0.2)'
      cancelBtn.style.background = 'transparent'
      cancelBtn.style.color = '#fff'
      cancelBtn.style.cursor = 'pointer'

      const close = (value: DownloadStrategy): void => {
        overlay.remove()
        resolve(value)
      }

      fullBtn.addEventListener('click', () => close('full-download'))
      lazyBtn.addEventListener('click', () => close('lazy-play'))
      cancelBtn.addEventListener('click', () => close('cancel'))
      overlay.addEventListener('click', (event: Event) => {
        if (event.target === overlay) {
          close('cancel')
        }
      })

      actions.appendChild(fullBtn)
      actions.appendChild(lazyBtn)
      actions.appendChild(cancelBtn)
      panel.appendChild(titleEl)
      panel.appendChild(descEl)
      panel.appendChild(actions)
      overlay.appendChild(panel)
      doc.body.appendChild(overlay)
    })
  }

  return {
    requestPlaylistName,
    requestCloudDownloadStrategy
  }
}
