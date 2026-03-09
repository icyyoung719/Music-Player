const PARTIAL_PATHS = [
  './partials/home-page.html',
  './partials/song-page.html',
  './partials/shortcut-overlay.html'
]

async function loadPartial(path) {
  const url = new URL(path, import.meta.url)
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to load partial: ${path}`)
  }

  return response.text()
}

async function bootstrapRenderer() {
  const root = document.getElementById('appRoot')
  if (!root) {
    throw new Error('Missing #appRoot container in index.html')
  }

  const partialHtml = await Promise.all(PARTIAL_PATHS.map((path) => loadPartial(path)))
  root.innerHTML = partialHtml.join('\n')

  await import('./renderer.js')
}

bootstrapRenderer().catch((error) => {
  console.error('[bootstrap] Renderer bootstrap failed:', error)

  const root = document.getElementById('appRoot')
  if (root) {
    root.innerHTML = '<div style="padding:16px;color:#fff;background:#8f2d2d;">界面加载失败，请检查控制台日志。</div>'
  }
})
