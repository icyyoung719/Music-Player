type DialogManagerOptions = {
  doc?: Document
}

type DownloadStrategy = 'full-download' | 'lazy-play' | 'cancel'

type PlaylistSelectionItem = {
  id: string
  name: string
  trackCount?: number
  coverUrl?: string
}

type PlaylistSelectionResult = {
  selectedPlaylistIds: string[]
  newPlaylistName: string
}

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
      titleEl.style.whiteSpace = 'pre-wrap'

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

  function requestPlaylistSelection(payload: {
    title?: string
    playlists: PlaylistSelectionItem[]
    defaultNewPlaylistName?: string
  }): Promise<PlaylistSelectionResult | null> {
    return new Promise((resolve) => {
      const title = String(payload?.title || '选择要添加到的歌单')
      const playlists = Array.isArray(payload?.playlists) ? payload.playlists : []
      const defaultNewPlaylistName = String(payload?.defaultNewPlaylistName || '').trim()

      const overlay = doc.createElement('div')
      overlay.className = 'playlist-picker-overlay'

      const panel = doc.createElement('div')
      panel.className = 'playlist-picker-panel'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-label', '选择歌单')

      const head = doc.createElement('div')
      head.className = 'playlist-picker-head'

      const titleEl = doc.createElement('div')
      titleEl.className = 'playlist-picker-title'
      titleEl.textContent = title

      const subtitleEl = doc.createElement('div')
      subtitleEl.className = 'playlist-picker-subtitle'
      subtitleEl.textContent = playlists.length
        ? '可勾选多个歌单，也可以直接新建歌单。'
        : '当前还没有歌单，请先输入新歌单名称。'

      head.appendChild(titleEl)
      head.appendChild(subtitleEl)

      const list = doc.createElement('div')
      list.className = 'playlist-picker-list'

      const selectedIds = new Set<string>()
      if (playlists.length) {
        playlists.forEach((item) => {
          const rowLabel = doc.createElement('label')
          rowLabel.className = 'playlist-picker-item'

          const checkbox = doc.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.className = 'playlist-picker-checkbox'
          checkbox.value = String(item.id || '')

          const cover = doc.createElement('span')
          cover.className = 'playlist-picker-cover'
          const coverUrl = String(item.coverUrl || '').trim()
          if (coverUrl) {
            const img = doc.createElement('img')
            img.src = coverUrl
            img.alt = `${item.name || '歌单'}封面`
            cover.appendChild(img)
          } else {
            cover.textContent = '♪'
          }

          const meta = doc.createElement('span')
          meta.className = 'playlist-picker-meta'

          const name = doc.createElement('span')
          name.className = 'playlist-picker-name'
          name.textContent = String(item.name || '未命名歌单')

          const count = doc.createElement('span')
          count.className = 'playlist-picker-count'
          const trackCount = Number.isFinite(Number(item.trackCount)) ? Math.max(0, Number(item.trackCount)) : 0
          count.textContent = `${trackCount} 首歌曲`

          checkbox.addEventListener('change', () => {
            if (!checkbox.value) return
            if (checkbox.checked) selectedIds.add(checkbox.value)
            else selectedIds.delete(checkbox.value)
          })

          meta.appendChild(name)
          meta.appendChild(count)
          rowLabel.appendChild(checkbox)
          rowLabel.appendChild(cover)
          rowLabel.appendChild(meta)
          list.appendChild(rowLabel)
        })
      } else {
        const empty = doc.createElement('div')
        empty.className = 'playlist-picker-empty'
        empty.textContent = '暂无可选歌单'
        list.appendChild(empty)
      }

      const createBlock = doc.createElement('div')
      createBlock.className = 'playlist-picker-create'

      const createLabel = doc.createElement('label')
      createLabel.className = 'playlist-picker-create-label'
      createLabel.textContent = '新建歌单（可选）'

      const createInput = doc.createElement('input')
      createInput.type = 'text'
      createInput.className = 'playlist-picker-create-input'
      createInput.placeholder = playlists.length ? '输入新歌单名称（可留空）' : '输入新歌单名称'
      createInput.value = defaultNewPlaylistName

      createBlock.appendChild(createLabel)
      createBlock.appendChild(createInput)

      const actions = doc.createElement('div')
      actions.className = 'playlist-picker-actions'

      const cancelBtn = doc.createElement('button')
      cancelBtn.textContent = '取消'
      cancelBtn.className = 'playlist-picker-cancel'

      const confirmBtn = doc.createElement('button')
      confirmBtn.textContent = '确认添加'
      confirmBtn.className = 'playlist-picker-confirm'

      const close = (value: PlaylistSelectionResult | null): void => {
        overlay.remove()
        resolve(value)
      }

      const handleConfirm = (): void => {
        const newPlaylistName = String(createInput.value || '').trim()
        close({
          selectedPlaylistIds: Array.from(selectedIds),
          newPlaylistName
        })
      }

      cancelBtn.addEventListener('click', () => close(null))
      confirmBtn.addEventListener('click', handleConfirm)
      overlay.addEventListener('click', (event: Event) => {
        if (event.target === overlay) close(null)
      })
      createInput.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') handleConfirm()
        if (event.key === 'Escape') close(null)
      })

      actions.appendChild(cancelBtn)
      actions.appendChild(confirmBtn)

      panel.appendChild(head)
      panel.appendChild(list)
      panel.appendChild(createBlock)
      panel.appendChild(actions)
      overlay.appendChild(panel)
      doc.body.appendChild(overlay)

      createInput.focus()
      createInput.select()
    })
  }

  return {
    requestPlaylistName,
    requestCloudDownloadStrategy,
    requestPlaylistSelection
  }
}
