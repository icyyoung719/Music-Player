type ShortcutActionDefinition = {
  label: string
  defaultKey?: string
}

type ShortcutDom = {
  shortcutList?: HTMLElement | null
  shortcutOverlay?: HTMLElement | null
  shortcutBtn?: HTMLElement | null
  shortcutCloseBtn?: HTMLElement | null
  shortcutResetBtn?: HTMLElement | null
  shortcutConfirmBtn?: HTMLElement | null
}

type ShortcutEventBus = {
  emit: (eventName: string, payload?: unknown) => void
}

type ShortcutManagerOptions = {
  dom: ShortcutDom
  storageKey: string
  actionDefinitions: Record<string, ShortcutActionDefinition>
  onAction?: (action: string) => void
  eventBus?: ShortcutEventBus
  isEditableElement?: (target: EventTarget | null) => boolean
  confirmDialog?: (message: string) => boolean
  closeOnConfirm?: boolean
}

type ShortcutConfig = Record<string, string>

export function createShortcutManager(options: ShortcutManagerOptions) {
  const {
    dom,
    storageKey,
    actionDefinitions,
    onAction,
    eventBus,
    isEditableElement = defaultIsEditableElement,
    confirmDialog = (message) => window.confirm(message),
    closeOnConfirm = true
  } = options

  const actionOrder = Object.keys(actionDefinitions)
  const defaultShortcuts = Object.fromEntries(
    actionOrder.map((action) => [action, actionDefinitions[action].defaultKey || ''])
  )

  const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta'])

  let shortcutConfig = { ...defaultShortcuts }
  let draftShortcutConfig: ShortcutConfig | null = null
  let waitingShortcutAction: string | null = null
  let panelOpen = false

  function cloneShortcutConfig(config: ShortcutConfig): ShortcutConfig {
    return Object.fromEntries(actionOrder.map((action) => [action, config[action] || '']))
  }

  function getShortcutEditingConfig(): ShortcutConfig {
    return draftShortcutConfig || shortcutConfig
  }

  function hasUnsavedShortcutChanges(): boolean {
    if (!draftShortcutConfig) return false
    const draft = draftShortcutConfig
    return actionOrder.some((action) => (draft[action] || '') !== (shortcutConfig[action] || ''))
  }

  function normalizeKeyName(key: unknown): string | null {
    if (typeof key !== 'string') return null
    if (key === ' ') return 'Space'
    const value = key.trim()
    if (!value) return null
    if (value.length === 1) return value.toUpperCase()
    return value
  }

  function normalizeShortcutString(shortcut: unknown): string | null {
    if (typeof shortcut !== 'string') return null
    const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean)
    if (!parts.length) return ''

    const modifiers: string[] = []
    let baseKey: string | null = null

    for (const part of parts) {
      const lower = part.toLowerCase()
      if (lower === 'ctrl' || lower === 'control') {
        if (!modifiers.includes('Ctrl')) modifiers.push('Ctrl')
        continue
      }
      if (lower === 'alt') {
        if (!modifiers.includes('Alt')) modifiers.push('Alt')
        continue
      }
      if (lower === 'shift') {
        if (!modifiers.includes('Shift')) modifiers.push('Shift')
        continue
      }
      if (lower === 'meta' || lower === 'cmd' || lower === 'win' || lower === 'super') {
        if (!modifiers.includes('Meta')) modifiers.push('Meta')
        continue
      }

      const normalized = normalizeKeyName(part)
      if (!normalized) continue
      baseKey = normalized
    }

    if (!baseKey) {
      return modifiers.length ? null : ''
    }

    const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta']
    modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b))
    return modifiers.length ? `${modifiers.join('+')}+${baseKey}` : baseKey
  }

  function getShortcutFromKeyboardEvent(e: KeyboardEvent): string | null {
    const key = normalizeKeyName(e.key)
    if (!key) return null
    if (modifierKeys.has(key)) return null

    const modifiers: string[] = []
    if (e.ctrlKey) modifiers.push('Ctrl')
    if (e.altKey) modifiers.push('Alt')
    if (e.shiftKey) modifiers.push('Shift')
    if (e.metaKey) modifiers.push('Meta')

    return modifiers.length ? `${modifiers.join('+')}+${key}` : key
  }

  function formatShortcutKey(shortcut: string): string {
    const normalized = normalizeShortcutString(shortcut)
    if (!normalized) return '未设置'
    return normalized.replace(/Arrow/g, 'Arrow ')
  }

  function saveShortcutConfig(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(shortcutConfig))
    } catch (err) {
      console.warn('Failed to persist shortcuts:', err)
    }
  }

  function loadShortcutConfig(): void {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return

      for (const action of actionOrder) {
        const key = normalizeShortcutString((parsed as Record<string, unknown>)[action])
        if (typeof key === 'string') {
          shortcutConfig[action] = key
        }
      }
    } catch (err) {
      console.warn('Failed to load shortcuts:', err)
    }
  }

  function setShortcutForAction(action: string, key: string): void {
    if (!draftShortcutConfig) return

    const normalizedKey = normalizeShortcutString(key)
    if (!normalizedKey) return

    for (const actionName of actionOrder) {
      if (draftShortcutConfig[actionName] === normalizedKey) {
        draftShortcutConfig[actionName] = ''
      }
    }

    draftShortcutConfig[action] = normalizedKey
    renderShortcutPanel()
  }

  function resetShortcuts(): void {
    if (!draftShortcutConfig) return
    draftShortcutConfig = { ...defaultShortcuts }
    waitingShortcutAction = null
    renderShortcutPanel()
  }

  function clearShortcutForAction(action: string): void {
    if (!draftShortcutConfig) return
    draftShortcutConfig[action] = ''
    renderShortcutPanel()
  }

  function applyShortcutChanges(): void {
    if (!draftShortcutConfig) return
    shortcutConfig = cloneShortcutConfig(draftShortcutConfig)
    saveShortcutConfig()
  }

  function renderShortcutPanel(): void {
    const listEl = dom.shortcutList
    if (!listEl) return
    listEl.innerHTML = ''
    const currentConfig = getShortcutEditingConfig()

    actionOrder.forEach((action) => {
      const row = document.createElement('div')
      row.className = 'shortcut-row'

      const nameEl = document.createElement('div')
      nameEl.className = 'shortcut-name'
      nameEl.textContent = actionDefinitions[action].label

      const keyEl = document.createElement('div')
      keyEl.className = 'shortcut-key'
      keyEl.textContent = waitingShortcutAction === action ? '请按键...' : formatShortcutKey(currentConfig[action])

      const editBtn = document.createElement('button')
      editBtn.textContent = waitingShortcutAction === action ? '取消' : '修改'
      editBtn.addEventListener('click', () => {
        waitingShortcutAction = waitingShortcutAction === action ? null : action
        renderShortcutPanel()
      })

      const clearBtn = document.createElement('button')
      clearBtn.textContent = '清空'
      clearBtn.title = '清空该动作的快捷键绑定'
      clearBtn.disabled = !currentConfig[action]
      clearBtn.addEventListener('click', () => {
        clearShortcutForAction(action)
      })

      row.appendChild(nameEl)
      row.appendChild(keyEl)
      row.appendChild(editBtn)
      row.appendChild(clearBtn)
      listEl.appendChild(row)
    })
  }

  function openPanel(): void {
    draftShortcutConfig = cloneShortcutConfig(shortcutConfig)
    waitingShortcutAction = null
    panelOpen = true
    renderShortcutPanel()
    if (dom.shortcutOverlay) {
      dom.shortcutOverlay.classList.add('visible')
      dom.shortcutOverlay.setAttribute('aria-hidden', 'false')
    }
  }

  function closePanel(options: { force?: boolean } = {}): boolean {
    if (!panelOpen) return true
    const { force = false } = options

    if (!force && hasUnsavedShortcutChanges()) {
      const confirmed = confirmDialog('快捷键修改尚未保存，确认放弃本次修改并退出吗？')
      if (!confirmed) {
        return false
      }
    }

    waitingShortcutAction = null
    draftShortcutConfig = null
    panelOpen = false
    if (dom.shortcutOverlay) {
      dom.shortcutOverlay.classList.remove('visible')
      dom.shortcutOverlay.setAttribute('aria-hidden', 'true')
    }
    return true
  }

  function isPanelVisible(): boolean {
    return panelOpen
  }

  function matchShortcutActionByKey(shortcut: string): string | null {
    const normalized = normalizeShortcutString(shortcut)
    if (!normalized) return null
    return actionOrder.find((action) => shortcutConfig[action] === normalized) || null
  }

  function handleGlobalKeydown(e: KeyboardEvent): void {
    const pressedShortcut = getShortcutFromKeyboardEvent(e)

    if (waitingShortcutAction) {
      e.preventDefault()
      if (e.key === 'Escape') {
        waitingShortcutAction = null
        renderShortcutPanel()
        return
      }
      if (!pressedShortcut) return
      setShortcutForAction(waitingShortcutAction, pressedShortcut)
      waitingShortcutAction = null
      renderShortcutPanel()
      return
    }

    if (isPanelVisible()) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePanel()
      }
      return
    }

    if (!pressedShortcut) return
    if (isEditableElement(e.target)) return

    const action = matchShortcutActionByKey(pressedShortcut)
    if (!action) return

    if (e.repeat && (action === 'togglePlay' || action === 'toggleLoop')) {
      return
    }

    e.preventDefault()
    if (eventBus) {
      eventBus.emit('shortcut:action', { action })
      return
    }

    if (typeof onAction === 'function') {
      onAction(action)
    }
  }

  function bindDomEvents(): void {
    if (dom.shortcutBtn) {
      dom.shortcutBtn.addEventListener('click', () => {
        openPanel()
      })
    }

    if (dom.shortcutCloseBtn) {
      dom.shortcutCloseBtn.addEventListener('click', () => {
        closePanel()
      })
    }

    if (dom.shortcutOverlay) {
      dom.shortcutOverlay.addEventListener('click', (e: MouseEvent) => {
        if (e.target === dom.shortcutOverlay) {
          closePanel()
        }
      })
    }

    if (dom.shortcutResetBtn) {
      dom.shortcutResetBtn.addEventListener('click', () => {
        const confirmed = confirmDialog('确定要恢复默认快捷键吗？\n当前自定义绑定将被覆盖。')
        if (!confirmed) return
        resetShortcuts()
      })
    }

    if (dom.shortcutConfirmBtn) {
      dom.shortcutConfirmBtn.addEventListener('click', () => {
        applyShortcutChanges()
        if (closeOnConfirm) {
          closePanel({ force: true })
        }
      })
    }

    document.addEventListener('keydown', handleGlobalKeydown)
  }

  function init(): void {
    loadShortcutConfig()
    renderShortcutPanel()
    bindDomEvents()
  }

  return {
    init,
    openPanel,
    closePanel
  }
}

function defaultIsEditableElement(target: EventTarget | null): boolean {
  if (!target) return false
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
