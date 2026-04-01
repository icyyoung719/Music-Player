const PARTIAL_PATHS: string[] = [
  './partials/home-page.html',
  './partials/song-page.html',
  './partials/settings-overlay.html',
  './partials/playlist-detail-overlay.html'
]

async function loadPartial(partialPath: string): Promise<string> {
  const url = new URL(partialPath, import.meta.url)
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to load partial: ${partialPath}`)
  }

  return response.text()
}

async function bootstrapRenderer(): Promise<void> {
  const root = document.getElementById('appRoot')
  if (!root) {
    throw new Error('Missing #appRoot container in index.html')
  }

  const partialHtml = await Promise.all(PARTIAL_PATHS.map((partialPath) => loadPartial(partialPath)))
  root.innerHTML = partialHtml.join('\n')

  await import('./renderer.js')
}

bootstrapRenderer().catch((error: unknown) => {
  console.error('[bootstrap] Renderer bootstrap failed:', error)

  const root = document.getElementById('appRoot')
  if (root) {
    root.innerHTML = '<div style="padding:16px;color:#fff;background:#8f2d2d;">界面加载失败，请检查控制台日志。</div>'
  }
})

export {}
