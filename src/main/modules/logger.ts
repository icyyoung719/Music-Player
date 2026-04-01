const fs = require('fs') as typeof import('fs')
const path = require('path') as typeof import('path')
const { app } = require('electron') as typeof import('electron')

const LOG_DIR_NAME = 'logs'
const NETWORK_FILE_PREFIX = 'network'
const PROGRAM_FILE_PREFIX = 'program'
const BINARY_HEX_PREVIEW_BYTES = 64

let writeQueue: Promise<void> = Promise.resolve()

type PrimitiveObject = Record<string, unknown>

type ProgramEventPayload = {
  source?: string
  event?: string
  message?: string
  data?: unknown
  error?: unknown
}

type NetworkEventPayload = {
  source?: string
  requestId?: string
  method?: string
  url?: string
  durationMs?: number
  request?: {
    headers?: unknown
    body?: unknown
  }
  response?: {
    statusCode?: number
    headers?: unknown
    body?: unknown
    binary?: unknown
  }
  error?: unknown
}

function resolveLogDirPath(): string {
  try {
    return path.join(app.getPath('userData'), LOG_DIR_NAME)
  } catch {
    return path.join(process.cwd(), LOG_DIR_NAME)
  }
}

function resolveLogFilePath(prefix: string): string {
  return path.join(resolveLogDirPath(), `${prefix}.log`)
}

function enqueueWrite(filePath: string, line: string): Promise<void> {
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

function writeJsonLine(prefix: string, payload: unknown): Promise<void> {
  const line = `${JSON.stringify(payload)}\n`
  const filePath = resolveLogFilePath(prefix)
  return enqueueWrite(filePath, line)
}

function serializeHeaders(headers: unknown): PrimitiveObject {
  if (!headers || typeof headers !== 'object') return {}

  const result: PrimitiveObject = {}
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
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

function serializeError(err: unknown): PrimitiveObject | null {
  if (!err) return null

  if (typeof err === 'object') {
    const typedErr = err as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      name: String(typedErr.name || 'Error'),
      message: String(typedErr.message || ''),
      stack: typeof typedErr.stack === 'string' ? typedErr.stack : ''
    }
  }

  return {
    name: 'Error',
    message: String(err),
    stack: ''
  }
}

function serializeTextOrJson(value: unknown): unknown {
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

function buildBinarySummary(buffer: unknown, headers: unknown): PrimitiveObject {
  const normalizedHeaders = headers as Record<string, unknown> | undefined
  const contentType = String(normalizedHeaders?.['content-type'] || normalizedHeaders?.['Content-Type'] || '').trim()
  const typedBuffer = Buffer.isBuffer(buffer) ? buffer : null

  return {
    bytes: typedBuffer ? typedBuffer.length : 0,
    mimeType: contentType || 'application/octet-stream',
    hexPreview: typedBuffer ? typedBuffer.subarray(0, BINARY_HEX_PREVIEW_BYTES).toString('hex') : ''
  }
}

function logProgramEvent(payload: ProgramEventPayload): void {
  const safePayload = {
    ts: new Date().toISOString(),
    category: 'program',
    source: String(payload?.source || 'main'),
    event: String(payload?.event || 'event'),
    message: String(payload?.message || ''),
    data: serializeTextOrJson(payload?.data),
    error: serializeError(payload?.error)
  }

  void writeJsonLine(PROGRAM_FILE_PREFIX, safePayload)
}

function logNetworkEvent(payload: NetworkEventPayload): void {
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

  void writeJsonLine(NETWORK_FILE_PREFIX, safePayload)
}

function initializeLogger(): void {
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

  void clearLogsTask.finally(() => {
    logProgramEvent({
      source: 'logger',
      event: 'initialized',
      message: 'Logger initialized',
      data: { logDir }
    })
  })
}

export {
  initializeLogger,
  logProgramEvent,
  logNetworkEvent,
  serializeError,
  buildBinarySummary
}
