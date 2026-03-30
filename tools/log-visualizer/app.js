const state = {
  activeTab: 'program',
  keyword: '',
  method: 'ALL',
  status: 'ALL',
  selectedIndex: -1,
  payload: null,
  meta: null
}

const dom = {
  sourceInfo: document.getElementById('sourceInfo'),
  refreshButton: document.getElementById('refreshButton'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  keywordInput: document.getElementById('keywordInput'),
  methodField: document.getElementById('methodField'),
  statusField: document.getElementById('statusField'),
  methodSelect: document.getElementById('methodSelect'),
  statusSelect: document.getElementById('statusSelect'),
  statsBar: document.getElementById('statsBar'),
  listHeader: document.getElementById('listHeader'),
  logList: document.getElementById('logList'),
  detailSummary: document.getElementById('detailSummary'),
  detailJson: document.getElementById('detailJson'),
  errorBanner: document.getElementById('errorBanner')
}

function setError(message) {
  if (!message) {
    dom.errorBanner.classList.add('hidden')
    dom.errorBanner.textContent = ''
    return
  }
  dom.errorBanner.textContent = message
  dom.errorBanner.classList.remove('hidden')
}

function formatTs(ts) {
  const date = new Date(ts || Date.now())
  if (Number.isNaN(date.getTime())) return 'Invalid Time'
  return date.toLocaleString()
}

function normalizeMethodOptions(items) {
  const methods = new Set(['ALL'])
  for (const item of items) {
    const method = String(item?.method || '').toUpperCase()
    if (method) methods.add(method)
  }
  return Array.from(methods)
}

function renderMethodOptions(items) {
  const options = normalizeMethodOptions(items)
  const previous = state.method
  dom.methodSelect.innerHTML = ''

  for (const method of options) {
    const option = document.createElement('option')
    option.value = method
    option.textContent = method
    dom.methodSelect.appendChild(option)
  }

  if (options.includes(previous)) {
    dom.methodSelect.value = previous
  } else {
    state.method = 'ALL'
    dom.methodSelect.value = 'ALL'
  }
}

function renderHeader() {
  if (state.activeTab === 'program') {
    dom.listHeader.textContent = '时间 | source/event | message'
    return
  }
  dom.listHeader.textContent = '时间 | method/status/duration | url'
}

function renderStats() {
  if (!state.payload) {
    dom.statsBar.textContent = '等待加载...'
    return
  }

  const parts = [
    `文件: ${state.payload.logFile}`,
    `总条数: ${state.payload.total}`,
    `过滤后: ${state.payload.filteredTotal}`,
    `当前显示: ${state.payload.returned}`,
    `错误数: ${state.payload.errorCount}`
  ]

  if (state.payload.badLines > 0) {
    parts.push(`坏行: ${state.payload.badLines}`)
  }

  dom.statsBar.textContent = parts.join(' | ')
}

function summarizeItem(item) {
  if (state.activeTab === 'program') {
    return `${item?.source || '-'} / ${item?.event || '-'} / ${item?.message || ''}`
  }
  const method = String(item?.method || '-').toUpperCase()
  const status = Number(item?.response?.statusCode || 0)
  const duration = Number(item?.durationMs || 0)
  return `${method} ${status || '-'} ${duration}ms`
}

function isNetworkError(item) {
  const statusCode = Number(item?.response?.statusCode || 0)
  return Boolean(item?.error) || statusCode >= 400
}

function isNetworkSlow(item) {
  const duration = Number(item?.durationMs || 0)
  return duration >= 1000
}

function renderRowProgram(item, index) {
  const row = document.createElement('div')
  row.className = 'row'
  if (item?.error) row.classList.add('error')
  if (index === state.selectedIndex) row.classList.add('selected')

  const main = document.createElement('div')
  main.className = 'row-main'

  const left = document.createElement('span')
  left.textContent = formatTs(item?.ts)

  const right = document.createElement('span')
  right.className = item?.error ? 'badge error' : 'badge'
  right.textContent = item?.error ? 'ERROR' : (item?.event || '-')

  main.append(left, right)

  const sub = document.createElement('div')
  sub.className = 'row-sub'
  sub.textContent = `${item?.source || '-'} | ${item?.message || ''}`

  row.append(main, sub)
  row.addEventListener('click', () => {
    state.selectedIndex = index
    renderList()
    renderDetail()
  })

  return row
}

function renderRowNetwork(item, index) {
  const row = document.createElement('div')
  row.className = 'row'
  const hasError = isNetworkError(item)
  const isSlow = isNetworkSlow(item)
  if (hasError) row.classList.add('error')
  if (!hasError && isSlow) row.classList.add('slow')
  if (index === state.selectedIndex) row.classList.add('selected')

  const main = document.createElement('div')
  main.className = 'row-main'

  const left = document.createElement('span')
  left.textContent = formatTs(item?.ts)

  const right = document.createElement('span')
  const statusCode = Number(item?.response?.statusCode || 0)
  right.className = hasError ? 'badge error' : (isSlow ? 'badge warn' : 'badge')
  right.textContent = `${String(item?.method || '-').toUpperCase()} ${statusCode || '-'} ${Number(item?.durationMs || 0)}ms`

  main.append(left, right)

  const sub = document.createElement('div')
  sub.className = 'row-sub'
  sub.textContent = item?.url || '-'

  row.append(main, sub)
  row.addEventListener('click', () => {
    state.selectedIndex = index
    renderList()
    renderDetail()
  })

  return row
}

function renderList() {
  dom.logList.innerHTML = ''

  const items = state.payload?.items || []
  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'row'
    empty.textContent = '没有符合条件的日志。'
    dom.logList.appendChild(empty)
    return
  }

  items.forEach((item, index) => {
    const row = state.activeTab === 'program'
      ? renderRowProgram(item, index)
      : renderRowNetwork(item, index)
    dom.logList.appendChild(row)
  })
}

function renderDetail() {
  const item = state.payload?.items?.[state.selectedIndex]
  if (!item) {
    dom.detailSummary.textContent = '点击左侧日志查看详情'
    dom.detailJson.textContent = '{}'
    return
  }

  dom.detailSummary.textContent = summarizeItem(item)
  dom.detailJson.textContent = JSON.stringify(item, null, 2)
}

function renderNetworkFiltersVisible() {
  const visible = state.activeTab === 'network'
  dom.methodField.classList.toggle('hidden', !visible)
  dom.statusField.classList.toggle('hidden', !visible)
}

async function fetchMeta() {
  const response = await fetch('/api/meta', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Meta request failed: ${response.status}`)
  const payload = await response.json()
  state.meta = payload

  dom.sourceInfo.textContent = `日志目录: ${payload.logDir}`
}

function buildQueryString() {
  const params = new URLSearchParams()
  params.set('type', state.activeTab)
  params.set('q', state.keyword)
  params.set('limit', '2000')

  if (state.activeTab === 'network') {
    params.set('method', state.method)
    params.set('status', state.status)
  }

  return params.toString()
}

async function fetchLogs() {
  const response = await fetch(`/api/logs?${buildQueryString()}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Logs request failed: ${response.status}`)
  }

  const payload = await response.json()
  state.payload = payload

  if (!payload.exists) {
    setError(`日志文件不存在: ${payload.logFile}`)
  } else if (payload.badLines > 0) {
    setError(`日志中有 ${payload.badLines} 行 JSON 无法解析，已自动跳过。`)
  } else {
    setError('')
  }

  if (state.activeTab === 'network') {
    renderMethodOptions(payload.items || [])
  }

  state.selectedIndex = payload.items && payload.items.length ? 0 : -1
}

async function refreshAll() {
  try {
    dom.refreshButton.disabled = true
    dom.refreshButton.textContent = '加载中...'
    await fetchMeta()
    await fetchLogs()
    renderHeader()
    renderStats()
    renderList()
    renderDetail()
  } catch (error) {
    setError(`加载失败: ${String(error && error.message ? error.message : error)}`)
  } finally {
    dom.refreshButton.disabled = false
    dom.refreshButton.textContent = '刷新'
  }
}

function bindEvents() {
  dom.tabs.forEach((button) => {
    button.addEventListener('click', async () => {
      const tab = button.dataset.tab || 'program'
      if (tab === state.activeTab) return
      state.activeTab = tab
      state.selectedIndex = -1

      dom.tabs.forEach((item) => item.classList.toggle('active', item === button))
      renderNetworkFiltersVisible()
      await refreshAll()
    })
  })

  dom.refreshButton.addEventListener('click', refreshAll)

  dom.keywordInput.addEventListener('input', async (event) => {
    state.keyword = String(event.target.value || '').trim()
    await refreshAll()
  })

  dom.methodSelect.addEventListener('change', async (event) => {
    state.method = String(event.target.value || 'ALL').toUpperCase()
    await refreshAll()
  })

  dom.statusSelect.addEventListener('change', async (event) => {
    state.status = String(event.target.value || 'ALL')
    await refreshAll()
  })
}

async function init() {
  bindEvents()
  renderNetworkFiltersVisible()
  await refreshAll()
}

init()
