const https = require('https')
const http = require('http')

function requestJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers || {}
  const body = options.body || null
  const timeout = Number(options.timeout || 12000)
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
          ...headers
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP_${res.statusCode || 'UNKNOWN'}`))
          res.resume()
          return
        }

        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve(data)
          } catch (err) {
            reject(err)
          }
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function requestJsonWithMeta(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers || {}
  const body = options.body || null
  const timeout = Number(options.timeout || 12000)
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data = null
          try {
            data = JSON.parse(text)
          } catch {
            data = null
          }

          resolve({
            statusCode: Number(res.statusCode || 0),
            headers: res.headers || {},
            data,
            rawText: text
          })
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function requestBuffer(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers || {}
  const timeout = Number(options.timeout || 12000)
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
          ...headers
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP_${res.statusCode || 'UNKNOWN'}`))
          res.resume()
          return
        }

        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve(Buffer.concat(chunks))
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('REQUEST_TIMEOUT'))
    })
    req.end()
  })
}

module.exports = { requestJson, requestJsonWithMeta, requestBuffer }
