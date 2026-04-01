const https = require('https') as typeof import('https')
const http = require('http') as typeof import('http')
const crypto = require('crypto') as typeof import('crypto')
import type { IncomingHttpHeaders } from 'http'
const { logNetworkEvent, buildBinarySummary } = require('../logger') as {
  logNetworkEvent: (payload: {
    requestId?: string
    method?: string
    url?: string
    durationMs?: number
    request?: { headers?: unknown; body?: unknown }
    response?: { statusCode?: number; headers?: unknown; body?: unknown; binary?: unknown }
    error?: unknown
  }) => void
  buildBinarySummary: (buffer: Buffer, headers: IncomingHttpHeaders) => unknown
}

type RequestOptions = {
  method?: string
  body?: string | Buffer | null
  timeout?: number
  headers?: Record<string, string>
}

type ExecuteResponse = {
  requestId: string
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | Buffer | null
  durationMs: number
  statusCode: number
  responseHeaders: IncomingHttpHeaders
  rawBuffer: Buffer
  rawText: string
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function buildHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Referer: 'https://music.163.com/',
    ...headers
  }
}

function executeRequest(url: string, options: RequestOptions = {}): Promise<ExecuteResponse> {
  const method = String(options.method || 'GET').toUpperCase()
  const body = options.body || null
  const timeout = Number(options.timeout || 12000)
  const requestHeaders = buildHeaders(options.headers || {})
  const client = url.startsWith('https:') ? https : http
  const requestId = createRequestId()
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: requestHeaders
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks)
          const durationMs = Date.now() - startedAt
          resolve({
            requestId,
            method,
            url,
            requestHeaders,
            requestBody: body,
            durationMs,
            statusCode: Number(res.statusCode || 0),
            responseHeaders: res.headers || {},
            rawBuffer,
            rawText: rawBuffer.toString('utf8')
          })
        })
      }
    )

    req.on('error', (err: Error) => {
      const durationMs = Date.now() - startedAt
      logNetworkEvent({
        requestId,
        method,
        url,
        durationMs,
        request: {
          headers: requestHeaders,
          body
        },
        response: {
          statusCode: 0,
          headers: {},
          body: '',
          binary: null
        },
        error: err
      })
      reject(err)
    })

    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function requestJson(url: string, options: RequestOptions = {}): Promise<unknown> {
  return executeRequest(url, options).then((response) => {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(response.rawText)
    } catch (err) {
      logNetworkEvent({
        requestId: response.requestId,
        method: response.method,
        url: response.url,
        durationMs: response.durationMs,
        request: {
          headers: response.requestHeaders,
          body: response.requestBody
        },
        response: {
          statusCode: response.statusCode,
          headers: response.responseHeaders,
          body: response.rawText,
          binary: null
        },
        error: err
      })
      throw err
    }

    if (response.statusCode !== 200) {
      const err = new Error(`HTTP_${response.statusCode || 'UNKNOWN'}`)
      logNetworkEvent({
        requestId: response.requestId,
        method: response.method,
        url: response.url,
        durationMs: response.durationMs,
        request: {
          headers: response.requestHeaders,
          body: response.requestBody
        },
        response: {
          statusCode: response.statusCode,
          headers: response.responseHeaders,
          body: response.rawText,
          binary: null
        },
        error: err
      })
      throw err
    }

    logNetworkEvent({
      requestId: response.requestId,
      method: response.method,
      url: response.url,
      durationMs: response.durationMs,
      request: {
        headers: response.requestHeaders,
        body: response.requestBody
      },
      response: {
        statusCode: response.statusCode,
        headers: response.responseHeaders,
        body: response.rawText,
        binary: null
      }
    })
    return parsed
  })
}

function requestJsonWithMeta(
  url: string,
  options: RequestOptions = {}
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; data: unknown; rawText: string }> {
  return executeRequest(url, options).then((response) => {
    let data: unknown = null
    try {
      data = JSON.parse(response.rawText)
    } catch {
      data = null
    }

    logNetworkEvent({
      requestId: response.requestId,
      method: response.method,
      url: response.url,
      durationMs: response.durationMs,
      request: {
        headers: response.requestHeaders,
        body: response.requestBody
      },
      response: {
        statusCode: response.statusCode,
        headers: response.responseHeaders,
        body: response.rawText,
        binary: null
      }
    })

    return {
      statusCode: response.statusCode,
      headers: response.responseHeaders,
      data,
      rawText: response.rawText
    }
  })
}

function requestBuffer(url: string, options: RequestOptions = {}): Promise<Buffer> {
  return executeRequest(url, options).then((response) => {
    const binary = buildBinarySummary(response.rawBuffer, response.responseHeaders)

    if (response.statusCode !== 200) {
      const err = new Error(`HTTP_${response.statusCode || 'UNKNOWN'}`)
      logNetworkEvent({
        requestId: response.requestId,
        method: response.method,
        url: response.url,
        durationMs: response.durationMs,
        request: {
          headers: response.requestHeaders,
          body: response.requestBody
        },
        response: {
          statusCode: response.statusCode,
          headers: response.responseHeaders,
          body: '',
          binary
        },
        error: err
      })
      throw err
    }

    logNetworkEvent({
      requestId: response.requestId,
      method: response.method,
      url: response.url,
      durationMs: response.durationMs,
      request: {
        headers: response.requestHeaders,
        body: response.requestBody
      },
      response: {
        statusCode: response.statusCode,
        headers: response.responseHeaders,
        body: '',
        binary
      }
    })

    return response.rawBuffer
  })
}

module.exports = { requestJson, requestJsonWithMeta, requestBuffer }

export {}
