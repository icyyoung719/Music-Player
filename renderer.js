// renderer.js
const fileInput = document.getElementById('fileInput')
const playBtn = document.getElementById('playBtn')
const trackInfo = document.getElementById('trackInfo')

let audio = new Audio()
let currentFile = null

// 选择文件
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (file) {
    currentFile = file
    trackInfo.textContent = `🎧 ${file.name}`
    
    // 创建本地 URL 用于播放
    const fileURL = URL.createObjectURL(file)
    audio.src = fileURL
    
    // 可选：通过 Electron API 通知主进程
    if (window.electronAPI) {
      window.electronAPI.playAudio(file.path)
    }
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

// 可选：监听播放结束
audio.addEventListener('ended', () => {
  playBtn.textContent = '▶️ 播放'
})