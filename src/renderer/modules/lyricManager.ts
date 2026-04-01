const ADVANCE_OFFSET = 0.3

type LyricLine = {
  time: number
  text: string
}

export function createLyricManager(containerId: string, wrapperId: string) {
  const container = document.getElementById(containerId)
  const wrapper = document.getElementById(wrapperId)

  let currentLyrics: LyricLine[] = []
  let activeIndex = -1

  function parseLrc(lrcString: string): LyricLine[] {
    const lines = lrcString.split('\n')
    const parsed: LyricLine[] = []
    const timeReg = /\[(\d{2,}):(\d{2})(?:\.(\d{1,3}))?\]/g

    for (const line of lines) {
      let match: RegExpExecArray | null
      const times: number[] = []
      timeReg.lastIndex = 0
      while ((match = timeReg.exec(line)) !== null) {
        const minutes = parseInt(match[1], 10)
        const seconds = parseInt(match[2], 10)
        let milliseconds = 0
        if (match[3]) {
          milliseconds = parseInt(match[3], 10)
          if (match[3].length === 2) milliseconds *= 10
          if (match[3].length === 1) milliseconds *= 100
        }
        const time = minutes * 60 + seconds + milliseconds / 1000
        times.push(time)
      }
      if (times.length > 0) {
        const text = line.replace(/\[\d{2,}:\d{2}(?:\.\d{1,3})?\]/g, '').trim()
        if (text) {
          times.forEach((t) => parsed.push({ time: t, text }))
        }
      }
    }

    return parsed.sort((a, b) => a.time - b.time)
  }

  function setLyrics(lrcString: string | null | undefined): void {
    if (!lrcString || typeof lrcString !== 'string') {
      currentLyrics = []
      renderLyrics()
      return
    }

    currentLyrics = parseLrc(lrcString)
    renderLyrics()
  }

  function setWrapperTransform(value: string, instant = false): void {
    if (!wrapper) return
    if (instant) {
      wrapper.style.transition = 'none'
      wrapper.style.transform = value
      requestAnimationFrame(() => {
        if (wrapper) wrapper.style.transition = ''
      })
    } else {
      wrapper.style.transform = value
    }
  }

  function renderLyrics(): void {
    if (!wrapper) return
    activeIndex = -1
    setWrapperTransform('translateY(0px)', true)
    wrapper.style.paddingTop = '0px'
    wrapper.style.paddingBottom = '0px'
    wrapper.innerHTML = ''

    if (currentLyrics.length === 0) {
      const noLyricsEl = document.createElement('div')
      noLyricsEl.className = 'lyric-line no-lyrics'
      noLyricsEl.textContent = '暂无歌词'
      wrapper.appendChild(noLyricsEl)
      return
    }

    const containerHeight = container?.clientHeight || 400
    const halfHeight = Math.max(containerHeight / 2, 100)
    wrapper.style.paddingTop = `${halfHeight}px`
    wrapper.style.paddingBottom = `${halfHeight}px`

    currentLyrics.forEach((lyric, index) => {
      const lineEl = document.createElement('div')
      lineEl.className = 'lyric-line'
      lineEl.textContent = lyric.text
      lineEl.dataset.index = String(index)
      wrapper.appendChild(lineEl)
    })
  }

  function refreshScroll(): void {
    if (activeIndex === -1 || !wrapper || !container) return
    const containerHeight = container.clientHeight
    if (containerHeight > 0) {
      const activeEl = wrapper.querySelector(`.lyric-line[data-index="${activeIndex}"]`) as HTMLElement | null
      if (activeEl) {
        const activeOffsetTop = activeEl.offsetTop
        const activeHeight = activeEl.offsetHeight
        const scrollY = activeOffsetTop - containerHeight / 2 + activeHeight / 2
        setWrapperTransform(`translateY(-${scrollY}px)`, true)
      }
    }
  }

  function updateTime(currentTime: number): void {
    if (currentLyrics.length === 0 || !wrapper) return

    const lookupTime = currentTime + ADVANCE_OFFSET
    let nextActiveIndex = currentLyrics.findIndex((l) => l.time > lookupTime)
    if (nextActiveIndex === -1) {
      nextActiveIndex = currentLyrics.length - 1
    } else if (nextActiveIndex === 0) {
      nextActiveIndex = -1
    } else {
      nextActiveIndex = nextActiveIndex - 1
    }

    if (nextActiveIndex !== activeIndex) {
      const oldActive = wrapper.querySelector('.lyric-line.active')
      if (oldActive) oldActive.classList.remove('active')

      if (nextActiveIndex !== -1) {
        const newActive = wrapper.querySelector(`.lyric-line[data-index="${nextActiveIndex}"]`) as HTMLElement | null
        if (newActive) {
          newActive.classList.add('active')

          const containerHeight = container?.clientHeight || 0
          if (containerHeight > 0) {
            const activeOffsetTop = newActive.offsetTop
            const activeHeight = newActive.offsetHeight
            const scrollY = activeOffsetTop - containerHeight / 2 + activeHeight / 2
            setWrapperTransform(`translateY(-${scrollY}px)`)
          }
        }
      } else {
        setWrapperTransform('translateY(0px)')
      }

      activeIndex = nextActiveIndex
    }
  }

  return {
    setLyrics,
    updateTime,
    refreshScroll
  }
}
