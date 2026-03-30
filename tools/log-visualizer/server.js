const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { URL } = require('url')
const { spawn } = require('child_process')

const APP_NAME = 'music-player'
const LOG_DIR_NAME = 'logs'
const DEFAULT_PORT = Number(process.env.LOGVIZ_PORT || 47831)
const MAX_LIMIT = 10000
const DEFAULT_LIMIT = 2000
const ROOT_DIR = __dirname

function resolveLogDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, APP_NAME, LOG_DIR_NAME)
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, LOG_DIR_NAME)
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdgConfig, APP_NAME, LOG_DIR_NAME)
}

function resolveProgramLogPath() {
  return path.join(resolveLogDir(), 'program.log')
}

function resolveNetworkLogPath() {
  return path.join(resolveLogDir(), 'network.log')
}

function parseLimit(input) {
  const parsed = Number.parseInt(String(input || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

function isHttpErrorEntry(entry) {
  const statusCode = Number(entry?.response?.statusCode || 0)
  return Boolean(entry?.error) || statusCode >= 400
}

function safeJsonParse(line) {
  try {
    return { ok: true, value: JSON.parse(line) }
  } catch {
    return { ok: false, value: null }
  }
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      exists: false,
      entries: [],
      badLines: 0
    }
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const entries = []
  let badLines = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const parsed = safeJsonParse(line)
    if (!parsed.ok) {
      badLines += 1
      continue
    }
    entries.push(parsed.value)
  }

  return {
    filePath,
    exists: true,
    entries,
    badLines
  }
}

function asLowerText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.toLowerCase()
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return String(value).toLowerCase()
  }
}

function filterProgramLogs(entries, keyword) {
  if (!keyword) return entries
  return entries.filter((entry) => {
    const joined = [
      entry?.source,
      entry?.event,
      entry?.message,
      entry?.error?.name,
      entry?.error?.message,
      entry?.error?.stack,
      entry?.data
    ]
      .map(asLowerText)
      .join(' ')
    return joined.includes(keyword)
  })
}

function matchesStatus(statusCode, statusFilter) {
  const code = Number(statusCode || 0)
  if (!statusFilter || statusFilter === 'ALL') return true
  if (statusFilter === '2xx') return code >= 200 && code < 300
  if (statusFilter === '3xx') return code >= 300 && code < 400
  if (statusFilter === '4xx') return code >= 400 && code < 500
  if (statusFilter === '5xx') return code >= 500 && code < 600
  const exact = Number.parseInt(statusFilter, 10)
  if (Number.isFinite(exact)) return code === exact
  return true
}

function filterNetworkLogs(entries, keyword, methodFilter, statusFilter) {
  return entries.filter((entry) => {
    if (methodFilter && methodFilter !== 'ALL') {
      const method = String(entry?.method || '').toUpperCase()
      if (method !== methodFilter) return false
    }

    if (!matchesStatus(entry?.response?.statusCode, statusFilter)) return false

    if (!keyword) return true

    const joined = [
      entry?.method,
      entry?.url,
      entry?.requestId,
      entry?.durationMs,
      entry?.response?.statusCode,
      entry?.error?.message,
      entry?.error?.stack,
      entry?.request,
      entry?.response
    ]
      .map(asLowerText)
      .join(' ')

    return joined.includes(keyword)
  })
}

function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => {
    const ta = new Date(a?.ts || 0).getTime()
    const tb = new Date(b?.ts || 0).getTime()
    return tb - ta
  })
}

function buildProgramResponse({ keyword, limit }) {
  const parsed = readJsonLines(resolveProgramLogPath())
  const allEntries = sortNewestFirst(parsed.entries)
  const filtered = filterProgramLogs(allEntries, keyword)
  const items = filtered.slice(0, limit)
  const errorCount = filtered.filter((entry) => Boolean(entry?.error)).length

  return {
    type: 'program',
    logFile: parsed.filePath,
    exists: parsed.exists,
    badLines: parsed.badLines,
    total: allEntries.length,
    filteredTotal: filtered.length,
    returned: items.length,
    errorCount,
    items
  }
}

function buildNetworkResponse({ keyword, methodFilter, statusFilter, limit }) {
  const parsed = readJsonLines(resolveNetworkLogPath())
  const allEntries = sortNewestFirst(parsed.entries)
  const filtered = filterNetworkLogs(allEntries, keyword, methodFilter, statusFilter)
  const items = filtered.slice(0, limit)
  const errorCount = filtered.filter(isHttpErrorEntry).length

  return {
    type: 'network',
    logFile: parsed.filePath,
    exists: parsed.exists,
    badLines: parsed.badLines,
    total: allEntries.length,
    filteredTotal: filtered.length,
    returned: items.length,
    errorCount,
    items
  }
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'application/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

function serveStatic(res, relativePath) {
  const normalized = relativePath === '/' ? '/index.html' : relativePath
  const absolutePath = path.join(ROOT_DIR, normalized)

  if (!absolutePath.startsWith(ROOT_DIR)) {
    writeJson(res, 403, { error: 'Forbidden' })
    return
  }

  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    writeJson(res, 404, { error: 'Not found' })
    return
  }

  const contentType = getContentType(absolutePath)
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' })
  fs.createReadStream(absolutePath).pipe(res)
}

function openBrowser(url) {
  if (process.env.LOGVIZ_NO_OPEN === '1') return

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }

  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

function createServer() {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

    if (requestUrl.pathname === '/api/meta') {
      const logDir = resolveLogDir()
      writeJson(res, 200, {
        appName: APP_NAME,
        logDir,
        files: {
          program: {
            path: resolveProgramLogPath(),
            exists: fs.existsSync(resolveProgramLogPath())
          },
          network: {
            path: resolveNetworkLogPath(),
            exists: fs.existsSync(resolveNetworkLogPath())
          }
        }
      })
      return
    }

    if (requestUrl.pathname === '/api/logs') {
      const type = String(requestUrl.searchParams.get('type') || 'program').toLowerCase()
      const keyword = String(requestUrl.searchParams.get('q') || '').trim().toLowerCase()
      const methodFilter = String(requestUrl.searchParams.get('method') || 'ALL').toUpperCase()
      const statusFilter = String(requestUrl.searchParams.get('status') || 'ALL')
      const limit = parseLimit(requestUrl.searchParams.get('limit'))

      try {
        if (type === 'program') {
          writeJson(res, 200, buildProgramResponse({ keyword, limit }))
          return
        }

        if (type === 'network') {
          writeJson(res, 200, buildNetworkResponse({ keyword, methodFilter, statusFilter, limit }))
          return
        }

        writeJson(res, 400, { error: 'Invalid log type.' })
      } catch (error) {
        writeJson(res, 500, {
          error: 'Failed to read logs.',
          detail: String(error && error.message ? error.message : error)
        })
      }
      return
    }

    serveStatic(res, requestUrl.pathname)
  })
}

function start() {
  const server = createServer()
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${DEFAULT_PORT}`
    const logDir = resolveLogDir()
    // Keep startup logs concise so this tool can be launched from npm scripts.
    console.log('[logviz] Listening:', url)
    console.log('[logviz] Reading logs from:', logDir)
    openBrowser(url)
  })
}

start()
