export function createLyricManager(containerId, wrapperId) {
  const container = document.getElementById(containerId)
  const wrapper = document.getElementById(wrapperId)
  
  let currentLyrics = [] // Array of { time, text }
  let activeIndex = -1

  function parseLrc(lrcString) {
    const lines = lrcString.split('\n')
    const parsed = []
    const timeReg = /\[(\d{2,}):(\d{2})(?:\.(\d{1,3}))?\]/g

    for (const line of lines) {
      let match
      const times = []
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
        const time = minutes * 60 + seconds + (milliseconds / 1000)
        times.push(time)
      }
      if (times.length > 0) {
        const text = line.replace(/\[\d{2,}:\d{2}(?:\.\d{1,3})?\]/g, '').trim()
        if (text) {
          times.forEach(t => parsed.push({ time: t, text }))
        }
      }
    }
    
    return parsed.sort((a, b) => a.time - b.time)
  }

  function setLyrics(lrcString) {
    if (!lrcString || typeof lrcString !== 'string') {
      currentLyrics = []
      renderLyrics()
      return
    }

    currentLyrics = parseLrc(lrcString)
    renderLyrics()
  }
  
  function renderLyrics() {
    if (!wrapper) return
    activeIndex = -1
    wrapper.style.transform = `translateY(0px)`
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

    // Add empty space to allow first item to be centered
    const containerHeight = container.clientHeight || 400
    const halfHeight = Math.max(containerHeight / 2, 100)
    wrapper.style.paddingTop = `${halfHeight}px`
    wrapper.style.paddingBottom = `${halfHeight}px`

    currentLyrics.forEach((lyric, index) => {
      const lineEl = document.createElement('div')
      lineEl.className = 'lyric-line'
      lineEl.textContent = lyric.text
      lineEl.dataset.index = index
      wrapper.appendChild(lineEl)
    })
  }

  function refreshScroll() {
    if (activeIndex === -1 || !wrapper || !container) return
    const containerHeight = container.clientHeight
    if (containerHeight > 0) {
      const activeEl = wrapper.querySelector(`.lyric-line[data-index="${activeIndex}"]`)
      if (activeEl) {
        const activeOffsetTop = activeEl.offsetTop
        const activeHeight = activeEl.offsetHeight
        const scrollY = activeOffsetTop - (containerHeight / 2) + (activeHeight / 2)
        wrapper.style.transform = `translateY(-${scrollY}px)`
      }
    }
  }

  function updateTime(currentTime) {
    if (currentLyrics.length === 0 || !wrapper) return

    let nextActiveIndex = currentLyrics.findIndex(l => l.time > currentTime)
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
        const newActive = wrapper.querySelector(`.lyric-line[data-index="${nextActiveIndex}"]`)
        if (newActive) {
          newActive.classList.add('active')
          
          // Calculate scroll
          const containerHeight = container.clientHeight
          if (containerHeight > 0) {
            const activeOffsetTop = newActive.offsetTop
            const activeHeight = newActive.offsetHeight
            
            const scrollY = activeOffsetTop - (containerHeight / 2) + (activeHeight / 2)
            wrapper.style.transform = `translateY(-${scrollY}px)`
          }
        }
      } else {
        wrapper.style.transform = `translateY(0px)`
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
