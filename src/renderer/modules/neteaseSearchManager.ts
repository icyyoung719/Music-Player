// @ts-nocheck
function mapSearchUiTypeToApi(uiType) {
  if (uiType === 'artist') return '100'
  if (uiType === 'playlist') return '1000'
  return '1'
}

function createDebounce(fn, delayMs) {
  let timer = null
  return (...args) => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delayMs)
  }
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min}:${String(rem).padStart(2, '0')}`
}

function formatPlayCount(value) {
  const count = Number(value || 0)
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)} 亿`
  if (count >= 10000) return `${(count / 10000).toFixed(1)} 万`
  return String(Math.floor(count))
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function coverStyle(url) {
  const clean = String(url || '').trim()
  if (!clean) return ''
  return `background-image:url('${clean.replace(/'/g, "\\'")}')`
}

export function createNeteaseSearchManager(options) {
  const {
    electronAPI,
    neteaseDatabaseService,
    downloadService,
    dom,
    eventBus,
    onAppendDownloadedTrack,
    onOpenPlaylistDetail
  } = options

  if (!electronAPI || !dom?.keywordInput || !dom?.searchBtn || !dom?.resultList) {
    return { init() {} }
  }

  const state = {
    keywords: '',
    type: '1',
    limit: 20,
    offset: 0,
    total: 0,
    hasMore: false,
    requestToken: 0
  }

  const autoQueueTaskIds = new Set()

  function setSearchStatus(text, isError = false) {
    if (!dom.searchStatus) return
    dom.searchStatus.textContent = text
    dom.searchStatus.classList.toggle('is-error', Boolean(isError))
  }

  function readSearchForm() {
    state.keywords = String(dom.keywordInput.value || '').trim()
    state.type = mapSearchUiTypeToApi(dom.keywordType?.value)
  }

  function togglePager() {
    if (dom.prevBtn) {
      dom.prevBtn.disabled = state.offset <= 0
    }

    if (dom.nextBtn) {
      dom.nextBtn.disabled = !state.hasMore
    }

    if (dom.pageInfo) {
      const currentPage = Math.floor(state.offset / state.limit) + 1
      const totalPages = state.total > 0 ? Math.ceil(state.total / state.limit) : currentPage
      dom.pageInfo.textContent = `第 ${currentPage} / ${Math.max(1, totalPages)} 页，共 ${state.total || 0} 条`
    }
  }

  function renderSuggestions(data) {
    if (!dom.suggestList) return

    const list = Array.isArray(data?.keywords) ? data.keywords : []
    if (!list.length) {
      dom.suggestList.innerHTML = ''
      dom.suggestList.classList.add('page-hidden')
      return
    }

    const html = list
      .map(
        (keyword) =>
          `<button type="button" class="netease-suggest-item" data-suggest="${keyword.replace(/"/g, '&quot;')}">${keyword}</button>`
      )
      .join('')

    dom.suggestList.innerHTML = html
    dom.suggestList.classList.remove('page-hidden')
  }

  function renderResults(items) {
    if (!Array.isArray(items) || !items.length) {
      dom.resultList.innerHTML = '<div class="netease-search-empty">没有找到匹配结果</div>'
      return
    }

    const html = items
      .map((item) => {
        if (state.type === '100') {
          const style = coverStyle(item.picUrl)
          const name = escapeHtml(item.name)
          const alias = Array.isArray(item.alias) && item.alias.length ? ` · ${escapeHtml(item.alias.join(' / '))}` : ''
          const coverClass = style ? 'netease-result-cover has-image' : 'netease-result-cover'
          return `
            <article class="netease-result-card netease-result-card-artist">
              <div class="${coverClass}" ${style ? `style="${style}"` : ''}>${style ? '' : '♪'}</div>
              <div class="netease-result-content">
                <div class="netease-result-title">${name}${alias}</div>
                <div class="netease-result-meta">专辑 ${item.albumSize || 0} · MV ${item.mvSize || 0}</div>
                <div class="netease-result-foot">
                  <span class="netease-result-duration">歌手</span>
                </div>
              </div>
            </article>
          `
        }

        if (state.type === '1000') {
          const style = coverStyle(item.coverUrl)
          const name = escapeHtml(item.name)
          const creator = escapeHtml(item.creator || '未知')
          const itemId = escapeHtml(item.id)
          const coverClass = style ? 'netease-result-cover has-image' : 'netease-result-cover'
          return `
            <article class="netease-result-card netease-result-card-playlist">
              <div class="${coverClass}" ${style ? `style="${style}"` : ''}>${style ? '' : '♫'}</div>
              <div class="netease-result-content">
                <div class="netease-result-title">${name}</div>
                <div class="netease-result-meta">创建者 ${creator} · ${item.trackCount || 0} 首 · 播放 ${formatPlayCount(item.playCount)}</div>
                <div class="netease-result-foot">
                  <span class="netease-result-duration">歌单</span>
                  <div class="netease-result-actions">
                    <button type="button" data-action="play-playlist" data-item-id="${itemId}">播放</button>
                    <button type="button" data-action="view-playlist-detail" data-item-id="${itemId}" data-item-name="${name}">详情</button>
                  </div>
                </div>
              </div>
            </article>
          `
        }

        const style = coverStyle(item.coverUrl)
        const itemId = escapeHtml(item.id)
        const name = escapeHtml(item.name)
        const artist = escapeHtml(item.artist || '未知歌手')
        const album = escapeHtml(item.album || '未知专辑')
        const coverClass = style ? 'netease-result-cover has-image' : 'netease-result-cover'

        return `
          <article class="netease-result-card netease-result-card-song">
            <div class="${coverClass}" ${style ? `style="${style}"` : ''}>${style ? '' : '♪'}</div>
            <div class="netease-result-content">
              <div class="netease-result-title">${name}</div>
              <div class="netease-result-meta">${artist} · ${album}</div>
              <div class="netease-result-foot">
                <span class="netease-result-duration">${formatDuration(item.durationMs)}</span>
                <div class="netease-result-actions">
                  <button type="button" data-action="play-song" data-item-id="${itemId}">播放</button>
                </div>
              </div>
            </div>
          </article>
        `
      })
      .join('')

    dom.resultList.innerHTML = html
  }

  async function runSearch(resetOffset = false) {
    readSearchForm()

    if (!state.keywords) {
      setSearchStatus('请输入关键词后再搜索。', true)
      return
    }

    if (resetOffset) {
      state.offset = 0
    }

    setSearchStatus('正在搜索...')
    const token = ++state.requestToken

    const payload = {
      keywords: state.keywords,
      type: state.type,
      limit: state.limit,
      offset: state.offset
    }

    const response = neteaseDatabaseService
      ? await neteaseDatabaseService.search(payload)
      : await electronAPI.neteaseSearch(payload)

    if (token !== state.requestToken) {
      return
    }

    if (!response?.ok || !response?.data) {
      const message = response?.message || response?.error || 'REQUEST_FAILED'
      setSearchStatus(`搜索失败: ${message}`, true)
      dom.resultList.innerHTML = '<div class="netease-search-empty">搜索失败，请稍后重试</div>'
      return
    }

    const data = response.data
    state.total = Number(data.total || 0)
    state.hasMore = Boolean(data.hasMore)
    renderResults(Array.isArray(data.items) ? data.items : [])
    togglePager()
    setSearchStatus(`搜索完成，共 ${state.total || 0} 条结果。`)
  }

  async function runSuggest() {
    const keywords = String(dom.keywordInput.value || '').trim()
    if (!keywords) {
      renderSuggestions({ keywords: [] })
      return
    }

    const token = ++state.requestToken
    const response = neteaseDatabaseService
      ? await neteaseDatabaseService.suggest({ keywords })
      : await electronAPI.neteaseSearchSuggest({ keywords })
    if (token !== state.requestToken) {
      return
    }

    if (!response?.ok || !response?.data) {
      renderSuggestions({ keywords: [] })
      return
    }

    renderSuggestions(response.data)
  }

  function updateTask(task) {
    if (!task?.id) return
    if (task.status !== 'succeeded') return
    if (!autoQueueTaskIds.has(task.id)) return

    autoQueueTaskIds.delete(task.id)
    if (task.filePath && eventBus) {
      eventBus.emit('playback:queue.append', {
        tracks: [{
          path: task.filePath,
          name: task.title || task.songId || '网易云下载',
          file: null
        }]
      })
      return
    }

    if (typeof onAppendDownloadedTrack === 'function' && task.filePath) {
      onAppendDownloadedTrack({
        path: task.filePath,
        name: task.title || task.songId || '网易云下载'
      })
    }
  }

  async function playSongById(songId) {
    const id = String(songId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setSearchStatus('无法播放：歌曲 ID 无效。', true)
      return
    }

    setSearchStatus('正在创建歌曲播放任务...')
    const payload = {
      songId: id,
      level: 'exhigh',
      mode: 'song-temp-queue-only'
    }

    const res = downloadService
      ? await downloadService.createSongTask(payload)
      : await electronAPI.neteaseDownloadSongTask(payload)

    if (!res?.ok || !res?.task?.id) {
      const msg = res?.message || res?.error || 'REQUEST_FAILED'
      setSearchStatus(`创建播放任务失败: ${msg}`, true)
      return
    }

    autoQueueTaskIds.add(res.task.id)
    setSearchStatus('歌曲已加入待播队列，下载完成后会自动加入播放列表。')
  }

  async function playPlaylistById(playlistId) {
    const id = String(playlistId || '').trim()
    if (!/^\d{1,20}$/.test(id)) {
      setSearchStatus('无法播放：歌单 ID 无效。', true)
      return
    }

    setSearchStatus('正在创建歌单播放任务...')
    const payload = {
      playlistId: id,
      level: 'exhigh',
      mode: 'playlist-download-and-queue',
      duplicateStrategy: 'skip'
    }

    const res = downloadService
      ? await downloadService.createPlaylistTasks(payload)
      : await electronAPI.neteaseDownloadPlaylistById(payload)

    if (!res?.ok) {
      const msg = res?.message || res?.error || 'REQUEST_FAILED'
      setSearchStatus(`创建歌单播放任务失败: ${msg}`, true)
      return
    }

    const tasks = Array.isArray(res.tasks) ? res.tasks : []
    for (const task of tasks) {
      if (task?.id) autoQueueTaskIds.add(task.id)
    }

    setSearchStatus(`歌单任务已创建：${res.createdCount || 0} 首入队，完成后会自动加入播放列表。`)
  }

  function bindEvents() {
    const debouncedSuggest = createDebounce(runSuggest, 260)

    dom.searchBtn.addEventListener('click', () => {
      runSearch(true)
    })

    dom.keywordInput.addEventListener('input', () => {
      debouncedSuggest()
    })

    dom.keywordInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      runSearch(true)
    })

    if (dom.suggestList) {
      dom.suggestList.addEventListener('click', (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const keyword = String(target.dataset.suggest || '').trim()
        if (!keyword) return
        dom.keywordInput.value = keyword
        dom.suggestList.classList.add('page-hidden')
        runSearch(true)
      })
    }

    if (dom.prevBtn) {
      dom.prevBtn.addEventListener('click', () => {
        if (state.offset <= 0) return
        state.offset = Math.max(0, state.offset - state.limit)
        runSearch(false)
      })
    }

    if (dom.nextBtn) {
      dom.nextBtn.addEventListener('click', () => {
        if (!state.hasMore) return
        state.offset += state.limit
        runSearch(false)
      })
    }

    dom.resultList.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const actionButton = target.closest('button[data-action]')
      if (!(actionButton instanceof HTMLElement)) return

      const action = String(actionButton.dataset.action || '').trim()
      const itemId = String(actionButton.dataset.itemId || '').trim()
      if (!itemId) return

      if (action === 'play-song') {
        playSongById(itemId)
      }

      if (action === 'play-playlist') {
        playPlaylistById(itemId)
      }

      if (action === 'view-playlist-detail' && typeof onOpenPlaylistDetail === 'function') {
        onOpenPlaylistDetail(itemId, String(actionButton.dataset.itemName || '').trim())
      }
    })

    if (downloadService) {
      downloadService.onTaskUpdate((task) => {
        updateTask(task)
      })
    } else if (electronAPI.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task) => {
        updateTask(task)
      })
    }
  }

  function init() {
    bindEvents()
    togglePager()
    setSearchStatus('输入关键词可搜索歌曲、歌手、歌单。')
  }

  return { init }
}
