// renderer.js
const fileInput = document.getElementById('fileInput')
const playBtn = document.getElementById('playBtn')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const trackAlbum = document.getElementById('trackAlbum')
const coverImg = document.getElementById('coverImg')
const coverPlaceholder = document.querySelector('.cover-placeholder')

let audio = new Audio()
let currentFile = null

// 选择文件
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return

  currentFile = file

  // 显示文件名作为初始标题
  trackTitle.textContent = file.name
  trackArtist.textContent = ''
  trackAlbum.textContent = ''

  // 重置封面
  coverImg.style.display = 'none'
  coverImg.src = ''
  coverPlaceholder.style.display = 'flex'

  // 创建本地 URL 用于播放
  const fileURL = URL.createObjectURL(file)
  audio.src = fileURL

  // 通过 Electron API 解析元数据
  if (window.electronAPI && file.path) {
    const meta = await window.electronAPI.getMetadata(file.path)
    if (meta) {
      trackTitle.textContent = meta.title || file.name
      trackArtist.textContent = meta.artist || ''
      const albumParts = [meta.album, meta.year].filter(Boolean)
      trackAlbum.textContent = albumParts.join(' · ')

      if (meta.coverDataUrl) {
        coverImg.src = meta.coverDataUrl
        coverImg.style.display = 'block'
        coverPlaceholder.style.display = 'none'
      }
    }

    window.electronAPI.playAudio(file.path)
  }
})

// 播放/暂停控制
playBtn.addEventListener('click', () => {
  if (!currentFile) {
    alert('请先选择一首歌曲 🎵')
    return
  }

  if (audio.paused) {
    audio.play()
    playBtn.textContent = '⏸ 暂停'
  } else {
    audio.pause()
    playBtn.textContent = '▶️ 播放'
  }
})

// 监听播放结束
audio.addEventListener('ended', () => {
  playBtn.textContent = '▶️ 播放'
})
