import type {
  AuthStateUpdatePayload,
  NeteaseAuthStateResult,
  NeteaseRecommendedPlaylistResult
} from '../core/electronApi.js'

type RecommendedPlaylist = {
  id: string
  platform: string
  source: string
  platformPlaylistId: string
  name: string
  creator: {
    userId: string
    nickname: string
  }
  coverUrl: string
  description: string
  trackCount: number
  playCount: number
  tags: string[]
  collected: boolean
  sourceKinds: string[]
  updatedAt: string
}

type RecommendedPlaylistManagerOptions = {
  electronAPI?: {
    neteaseAuthGetAccountSummary?: (payload: { refresh: boolean }) => Promise<NeteaseAuthStateResult>
    neteaseGetRecommendedPlaylists?: () => Promise<NeteaseRecommendedPlaylistResult>
    onNeteaseAuthStateUpdate?: (handler: (payload?: AuthStateUpdatePayload) => void) => void
  }
  neteaseDatabaseService?: {
    getRecommendedPlaylists?: () => Promise<NeteaseRecommendedPlaylistResult>
  }
  eventBus?: {
    emit?: (eventName: string, payload?: unknown) => void
  }
  dom?: {
    gridEl?: HTMLElement | null
    statusEl?: HTMLElement | null
    privateRadarCardEl?: HTMLElement | null
    privateRadarCoverEl?: HTMLElement | null
    privateRadarMetaEl?: HTMLElement | null
    heroCardEls?: Array<Element | null>
    heroCoverEls?: Array<Element | null>
    heroMetaEls?: Array<Element | null>
  }
  onOpenPlaylistDetail?: (playlistId: string, name: string, options: { source: string; cloudPlaylist: RecommendedPlaylist | null }) => void
}

type HeroSlot = {
  cardEl: HTMLElement
  coverEl: HTMLElement
  metaEl: HTMLElement
}

type AnyRecord = Record<string, unknown>

function safeText(value: unknown): string {
  return String(value || '').trim()
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeCoverUrl(value: unknown): string {
  const text = safeText(value)
  if (!text) return ''
  return text.replace(/^http:\/\//i, 'https://')
}

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== 'object') return {}
  return value as AnyRecord
}

function normalizeRecommendedPlaylist(raw: unknown): RecommendedPlaylist | null {
  const payload = asRecord(raw)
  if (Object.keys(payload).length === 0) return null
  const playlistId = safeText(payload.platformPlaylistId || payload.id)
  if (!/^\d{1,20}$/.test(playlistId)) return null

  const sourceKinds = Array.isArray(payload.sourceKinds)
    ? payload.sourceKinds.map((item: unknown) => safeText(item)).filter(Boolean)
    : []

  return {
    id: safeText(payload.id) || `netease-cloud-${playlistId}`,
    platform: safeText(payload.platform) || 'netease',
    source: safeText(payload.source) || 'cloud',
    platformPlaylistId: playlistId,
    name: safeText(payload.name) || `歌单 ${playlistId}`,
    creator: {
      userId: safeText(asRecord(payload.creator).userId),
      nickname: safeText(asRecord(payload.creator).nickname) || '网易云音乐'
    },
    coverUrl: normalizeCoverUrl(payload.coverUrl),
    description: safeText(payload.description),
    trackCount: Math.max(0, Math.trunc(toSafeNumber(payload.trackCount, 0))),
    playCount: Math.max(0, Math.trunc(toSafeNumber(payload.playCount, 0))),
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag: unknown) => safeText(tag)).filter(Boolean) : [],
    collected: Boolean(payload.collected),
    sourceKinds,
    updatedAt: safeText(payload.updatedAt)
  }
}

function setCover(coverEl: HTMLElement, coverUrl: string): void {
  if (!coverUrl) {
    coverEl.style.backgroundImage = ''
    coverEl.style.backgroundSize = ''
    coverEl.style.backgroundPosition = ''
    coverEl.style.backgroundRepeat = ''
    return
  }

  coverEl.style.backgroundImage = `url("${coverUrl}"), radial-gradient(circle at 72% 18%, rgba(255,255,255,0.58), transparent 42%), linear-gradient(140deg, #ef6d57, #f8c95e)`
  coverEl.style.backgroundSize = 'cover, auto, auto'
  coverEl.style.backgroundPosition = 'center, center, center'
  coverEl.style.backgroundRepeat = 'no-repeat, no-repeat, no-repeat'
}

function setClickablePlaylist(cardEl: HTMLElement, playlistId: string): void {
  if (/^\d{1,20}$/.test(playlistId)) {
    cardEl.dataset.recommendPlaylistId = playlistId
  } else {
    delete cardEl.dataset.recommendPlaylistId
  }
}

function collectHeroSlots(input?: {
  heroCardEls?: Array<Element | null>
  heroCoverEls?: Array<Element | null>
  heroMetaEls?: Array<Element | null>
}): HeroSlot[] {
  const cards = Array.isArray(input?.heroCardEls) ? input!.heroCardEls : []
  const covers = Array.isArray(input?.heroCoverEls) ? input!.heroCoverEls : []
  const metas = Array.isArray(input?.heroMetaEls) ? input!.heroMetaEls : []
  const slotCount = Math.min(cards.length, covers.length, metas.length)
  const slots: HeroSlot[] = []

  for (let i = 0; i < slotCount; i += 1) {
    const card = cards[i]
    const cover = covers[i]
    const meta = metas[i]
    if (!(card instanceof HTMLElement) || !(cover instanceof HTMLElement) || !(meta instanceof HTMLElement)) {
      continue
    }
    slots.push({
      cardEl: card,
      coverEl: cover,
      metaEl: meta
    })
  }

  return slots
}

export function createRecommendedPlaylistManager(options: RecommendedPlaylistManagerOptions = {}) {
  const {
    electronAPI,
    neteaseDatabaseService,
    eventBus,
    dom,
    onOpenPlaylistDetail
  } = options

  if (
    !(dom?.gridEl instanceof HTMLElement)
    || !(dom?.statusEl instanceof HTMLElement)
    || !(dom?.privateRadarCardEl instanceof HTMLElement)
    || !(dom?.privateRadarCoverEl instanceof HTMLElement)
    || !(dom?.privateRadarMetaEl instanceof HTMLElement)
  ) {
    return { init() {} }
  }

  const gridEl = dom.gridEl
  const statusEl = dom.statusEl
  const privateRadarCardEl = dom.privateRadarCardEl
  const privateRadarCoverEl = dom.privateRadarCoverEl
  const privateRadarMetaEl = dom.privateRadarMetaEl
  const heroSlots = collectHeroSlots({
    heroCardEls: dom.heroCardEls,
    heroCoverEls: dom.heroCoverEls,
    heroMetaEls: dom.heroMetaEls
  })

  const state = {
    loading: false,
    isLoggedIn: false,
    playlists: [] as RecommendedPlaylist[],
    lastError: ''
  }

  function setStatus(text: string): void {
    statusEl.textContent = text
    statusEl.classList.remove('page-hidden')
  }

  function hideStatus(): void {
    statusEl.textContent = ''
    statusEl.classList.add('page-hidden')
  }

  function renderCards(): void {
    gridEl.innerHTML = ''

    const privateRadar = state.playlists[0] || null
    const heroPlaylists = state.playlists.slice(1, 1 + heroSlots.length)
    const gridPlaylists = state.playlists.slice(1 + heroSlots.length)

    if (!state.isLoggedIn) {
      setStatus('登录后可查看个性化推荐歌单')
      privateRadarMetaEl.textContent = '私人雷达 | 登录后可查看推荐'
      setCover(privateRadarCoverEl, '')
      setClickablePlaylist(privateRadarCardEl, '')

      heroSlots.forEach((slot) => {
        slot.metaEl.textContent = '推荐歌单 | 登录后加载'
        setCover(slot.coverEl, '')
        setClickablePlaylist(slot.cardEl, '')
      })
      return
    }

    if (state.loading) {
      setStatus('推荐歌单加载中...')
      privateRadarMetaEl.textContent = '私人雷达 | 正在加载推荐'
      return
    }

    if (state.lastError) {
      setStatus('推荐歌单加载失败，请稍后重试')
      privateRadarMetaEl.textContent = '私人雷达 | 加载失败'
      return
    }

    if (!state.playlists.length) {
      setStatus('暂无推荐歌单')
      privateRadarMetaEl.textContent = '私人雷达 | 暂无内容'
      setCover(privateRadarCoverEl, '')
      setClickablePlaylist(privateRadarCardEl, '')

      heroSlots.forEach((slot) => {
        slot.metaEl.textContent = '推荐歌单 | 暂无内容'
        setCover(slot.coverEl, '')
        setClickablePlaylist(slot.cardEl, '')
      })
      return
    }

    hideStatus()

    if (privateRadar) {
      privateRadarMetaEl.textContent = `私人雷达 | ${privateRadar.name}`
      setCover(privateRadarCoverEl, privateRadar.coverUrl)
      setClickablePlaylist(privateRadarCardEl, privateRadar.platformPlaylistId)
    } else {
      privateRadarMetaEl.textContent = '私人雷达 | 暂无内容'
      setCover(privateRadarCoverEl, '')
      setClickablePlaylist(privateRadarCardEl, '')
    }

    heroSlots.forEach((slot, index) => {
      const playlist = heroPlaylists[index]
      if (!playlist) {
        slot.metaEl.textContent = '推荐歌单 | 暂无内容'
        setCover(slot.coverEl, '')
        setClickablePlaylist(slot.cardEl, '')
        return
      }

      slot.metaEl.textContent = `推荐歌单 | ${playlist.name}`
      setCover(slot.coverEl, playlist.coverUrl)
      setClickablePlaylist(slot.cardEl, playlist.platformPlaylistId)
    })

    const fragment = document.createDocumentFragment()

    for (const playlist of gridPlaylists) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hero-card hero-card-action recommend-grid-hero-card'
      button.dataset.recommendPlaylistId = playlist.platformPlaylistId
      button.title = playlist.name

      const cover = document.createElement('div')
      cover.className = 'hero-cover'
      setCover(cover, playlist.coverUrl)

      const title = document.createElement('div')
      title.className = 'hero-meta'
      title.textContent = playlist.name

      button.appendChild(cover)
      button.appendChild(title)
      fragment.appendChild(button)
    }

    gridEl.appendChild(fragment)
  }

  async function refreshLoginState(): Promise<void> {
    if (!electronAPI?.neteaseAuthGetAccountSummary) {
      state.isLoggedIn = false
      return
    }

    const summary = await electronAPI.neteaseAuthGetAccountSummary({ refresh: false })
    state.isLoggedIn = Boolean(summary?.ok && (summary?.state?.isLoggedIn || summary?.account?.isLoggedIn))
  }

  async function refreshRecommendedPlaylists(): Promise<void> {
    state.loading = true
    state.lastError = ''
    renderCards()

    await refreshLoginState()
    if (!state.isLoggedIn) {
      state.loading = false
      state.playlists = []
      renderCards()
      return
    }

    const result = neteaseDatabaseService?.getRecommendedPlaylists
      ? await neteaseDatabaseService.getRecommendedPlaylists()
      : await electronAPI?.neteaseGetRecommendedPlaylists?.()

    state.loading = false
    if (!result?.ok) {
      if (result?.error === 'NOT_LOGGED_IN') {
        state.isLoggedIn = false
        state.playlists = []
      }
      state.lastError = safeText(result?.message || result?.error || 'REQUEST_FAILED')
      renderCards()
      return
    }

    const playlists = Array.isArray(result?.data)
      ? result.data
          .map((item) => normalizeRecommendedPlaylist(item))
          .filter((item): item is RecommendedPlaylist => item !== null)
      : []

    state.playlists = playlists.slice(0, 30)
    state.lastError = ''
    renderCards()
  }

  function bindEvents(): void {
    const openByPlaylistId = (playlistId: string): void => {
      if (!/^\d{1,20}$/.test(playlistId)) return
      const playlist = state.playlists.find((item) => item.platformPlaylistId === playlistId) || null
      if (!playlist) return

      eventBus?.emit?.('cloud-playlist:encountered', {
        sourceKind: 'recommend',
        playlist: {
          ...playlist,
          collected: true,
          sourceKinds: Array.from(new Set([...(playlist.sourceKinds || []), 'recommend']))
        }
      })

      if (typeof onOpenPlaylistDetail === 'function') {
        onOpenPlaylistDetail(playlistId, playlist.name, {
          source: 'recommend-playlist',
          cloudPlaylist: playlist
        })
      }
    }

    privateRadarCardEl.addEventListener('click', () => {
      openByPlaylistId(safeText(privateRadarCardEl.dataset.recommendPlaylistId))
    })

    heroSlots.forEach((slot) => {
      slot.cardEl.addEventListener('click', () => {
        openByPlaylistId(safeText(slot.cardEl.dataset.recommendPlaylistId))
      })
    })

    gridEl.addEventListener('click', (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const button = target.closest('[data-recommend-playlist-id]')
      if (!(button instanceof HTMLElement)) return
      openByPlaylistId(safeText(button.dataset.recommendPlaylistId))
    })

    if (electronAPI?.onNeteaseAuthStateUpdate) {
      electronAPI.onNeteaseAuthStateUpdate((payload) => {
        state.isLoggedIn = Boolean(payload?.state?.isLoggedIn || payload?.account?.isLoggedIn)
        void refreshRecommendedPlaylists()
      })
    }
  }

  async function init(): Promise<void> {
    bindEvents()
    renderCards()
    await refreshRecommendedPlaylists()
  }

  return {
    init,
    refreshRecommendedPlaylists
  }
}