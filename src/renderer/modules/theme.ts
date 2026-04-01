const THEME_STORAGE_KEY = 'music-player-theme'

type ThemeName = 'light' | 'dark'

type ThemeOptions = {
  target?: HTMLElement
  toggleSelector?: string
}

export function initTheme(options: ThemeOptions = {}): void {
  const { target = document.body, toggleSelector = '[data-theme-toggle]' } = options

  const themeToggleBtns = document.querySelectorAll(toggleSelector)

  function applyTheme(theme: string): void {
    const normalized: ThemeName = theme === 'dark' ? 'dark' : 'light'
    target.setAttribute('data-theme', normalized)

    themeToggleBtns.forEach((btn) => {
      btn.textContent = normalized === 'dark' ? '☀ 亮色' : '🌙 暗色'
    })
  }

  let initialTheme: ThemeName = 'light'
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') {
      initialTheme = saved
    }
  } catch {
    initialTheme = 'light'
  }

  applyTheme(initialTheme)

  themeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const current: ThemeName = target.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
      const next: ThemeName = current === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // Ignore storage failure and keep runtime theme.
      }
    })
  })
}
