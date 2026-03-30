const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const LOG_DIR_NAME = 'logs'
const NETWORK_FILE_PREFIX = 'network'
const PROGRAM_FILE_PREFIX = 'program'
const BINARY_HEX_PREVIEW_BYTES = 64

let writeQueue = Promise.resolve()

function resolveLogDirPath() {
  try {
    return path.join(app.getPath('userData'), LOG_DIR_NAME)
  } catch {
    return path.join(process.cwd(), LOG_DIR_NAME)
  }
}

function resolveLogFilePath(prefix) {
  return path.join(resolveLogDirPath(), `${prefix}.log`)
}

function enqueueWrite(filePath, line) {
  writeQueue = writeQueue
    .then(async () => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.appendFile(filePath, line, 'utf8')
    })
    .catch(() => {
      // Keep logging failures isolated from business flow.
    })

  return writeQueue
}

function writeJsonLine(prefix, payload) {
  const line = `${JSON.stringify(payload)}\n`
  const filePath = resolveLogFilePath(prefix)
  return enqueueWrite(filePath, line)
}

function serializeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {}
  const result = {}
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.map((item) => String(item))
      continue
    }
    if (value == null) {
      result[key] = ''
      continue
    }
    result[key] = String(value)
  }
  return result
}

function serializeError(err) {
  if (!err) return null
  return {
    name: String(err.name || 'Error'),
    message: String(err.message || ''),
    stack: typeof err.stack === 'string' ? err.stack : ''
  }
}

function serializeTextOrJson(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) {
    return {
      type: 'buffer',
      bytes: value.length,
      hexPreview: value.subarray(0, BINARY_HEX_PREVIEW_BYTES).toString('hex')
    }
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function buildBinarySummary(buffer, headers) {
  const contentType = String(headers?.['content-type'] || headers?.['Content-Type'] || '').trim()
  return {
    bytes: Buffer.isBuffer(buffer) ? buffer.length : 0,
    mimeType: contentType || 'application/octet-stream',
    hexPreview: Buffer.isBuffer(buffer)
      ? buffer.subarray(0, BINARY_HEX_PREVIEW_BYTES).toString('hex')
      : ''
  }
}

function logProgramEvent(payload) {
  const safePayload = {
    ts: new Date().toISOString(),
    category: 'program',
    source: String(payload?.source || 'main'),
    event: String(payload?.event || 'event'),
    message: String(payload?.message || ''),
    data: serializeTextOrJson(payload?.data),
    error: serializeError(payload?.error)
  }

  writeJsonLine(PROGRAM_FILE_PREFIX, safePayload)
}

function logNetworkEvent(payload) {
  const safePayload = {
    ts: new Date().toISOString(),
    category: 'network',
    source: String(payload?.source || 'httpClient'),
    requestId: String(payload?.requestId || ''),
    method: String(payload?.method || ''),
    url: String(payload?.url || ''),
    durationMs: Number(payload?.durationMs || 0),
    request: {
      headers: serializeHeaders(payload?.request?.headers),
      body: serializeTextOrJson(payload?.request?.body)
    },
    response: {
      statusCode: Number(payload?.response?.statusCode || 0),
      headers: serializeHeaders(payload?.response?.headers),
      body: serializeTextOrJson(payload?.response?.body),
      binary: payload?.response?.binary || null
    },
    error: serializeError(payload?.error)
  }

  writeJsonLine(NETWORK_FILE_PREFIX, safePayload)
}

function initializeLogger() {
  const logDir = resolveLogDirPath()
  const clearLogsTask = fs.promises
    .mkdir(logDir, { recursive: true })
    .then(async () => {
      await Promise.all([
        fs.promises.writeFile(resolveLogFilePath(PROGRAM_FILE_PREFIX), '', 'utf8'),
        fs.promises.writeFile(resolveLogFilePath(NETWORK_FILE_PREFIX), '', 'utf8')
      ])
    })
    .catch(() => {
      // Do not block app startup when log directory cannot be created.
    })

  clearLogsTask.finally(() => {
    logProgramEvent({
      source: 'logger',
      event: 'initialized',
      message: 'Logger initialized',
      data: { logDir }
    })
  })
}

module.exports = {
  initializeLogger,
  logProgramEvent,
  logNetworkEvent,
  serializeError,
  buildBinarySummary
}
