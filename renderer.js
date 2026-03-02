// renderer.js
const fileInput = document.getElementById('fileInput')
const playBtn = document.getElementById('playBtn')
const trackInfo = document.getElementById('trackInfo')
const coverArt = document.getElementById('coverArt')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const trackAlbum = document.getElementById('trackAlbum')
const trackMeta = document.getElementById('trackMeta')

let audio = new Audio()
let currentFile = null

// --- Lightweight ID3v2 parser ---

function readSynchsafeInt(b0, b1, b2, b3) {
  return ((b0 & 0x7F) << 21) | ((b1 & 0x7F) << 14) | ((b2 & 0x7F) << 7) | (b3 & 0x7F)
}

function decodeText(encoding, bytes) {
  if (encoding === 0) {
    const chars = []
    for (let i = 0; i < bytes.length; i++) chars.push(bytes[i])
    return String.fromCharCode(...chars).replace(/\x00+$/, '')
  } else if (encoding === 1) {
    // UTF-16 with BOM: 0xFF 0xFE = LE, 0xFE 0xFF = BE
    const hasLeBom = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE
    const hasBeBom = bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF
    const isLe = hasLeBom || (!hasBeBom)
    const start = (hasLeBom || hasBeBom) ? 2 : 0
    let s = ''
    for (let i = start; i + 1 < bytes.length; i += 2) {
      const cp = isLe ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1])
      if (cp === 0) break
      s += String.fromCodePoint(cp)
    }
    return s
  } else if (encoding === 2) {
    let s = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const cp = (bytes[i] << 8) | bytes[i + 1]
      if (cp === 0) break
      s += String.fromCodePoint(cp)
    }
    return s
  } else {
    return new TextDecoder('utf-8').decode(bytes).replace(/\x00+$/, '')
  }
}

function skipNullTerminator(bytes, offset, encoding) {
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < bytes.length && !(bytes[offset] === 0 && bytes[offset + 1] === 0)) offset += 2
    return Math.min(offset + 2, bytes.length)
  }
  while (offset < bytes.length && bytes[offset] !== 0) offset++
  return Math.min(offset + 1, bytes.length)
}

function parseID3v2(buffer) {
  const b = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {}

  const major = b[3]
  const flags = b[5]
  const tagSize = readSynchsafeInt(b[6], b[7], b[8], b[9]) + 10

  const result = {}
  let pos = 10

  if (flags & 0x40) {
    // v2.3: extended header size excludes the 4-byte size field itself
    // v2.4: extended header size (synchsafe) includes the 4-byte size field
    const extSize = major === 4
      ? readSynchsafeInt(b[10], b[11], b[12], b[13])
      : view.getUint32(10, false) + 4
    pos += extSize
  }

  while (pos + 10 < tagSize) {
    const frameId = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3])
    if (b[pos] === 0) break

    const frameSize = major === 4
      ? readSynchsafeInt(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7])
      : view.getUint32(pos + 4, false)

    pos += 10
    if (frameSize <= 0 || pos + frameSize > tagSize) break

    const data = b.slice(pos, pos + frameSize)
    pos += frameSize

    if (frameId[0] === 'T' && frameId !== 'TXXX' && data.length > 1) {
      const text = decodeText(data[0], data.slice(1)).trim()
      if (frameId === 'TIT2') result.title = text
      else if (frameId === 'TPE1') result.artist = text
      else if (frameId === 'TALB') result.album = text
      else if (frameId === 'TRCK') result.track = text
      else if (frameId === 'TYER' || frameId === 'TDRC') result.year = text
      else if (frameId === 'TCON') result.genre = cleanGenre(text)
    } else if (frameId === 'APIC' && data.length > 4) {
      const enc = data[0]
      let off = 1
      while (off < data.length && data[off] !== 0) off++
      const mime = String.fromCharCode(...data.slice(1, off)) || 'image/jpeg'
      off++ // skip mime null terminator
      off++ // skip picture type byte
      off = skipNullTerminator(data, off, enc) // skip description
      if (off < data.length) {
        const imgBytes = data.slice(off)
        const chunks = []
        const CHUNK = 8192
        for (let i = 0; i < imgBytes.length; i += CHUNK) {
          chunks.push(String.fromCharCode(...imgBytes.subarray(i, i + CHUNK)))
        }
        result.cover = `data:${mime};base64,${btoa(chunks.join(''))}`
      }
    }
  }

  return result
}

function cleanGenre(genre) {
  // ID3v1 numeric genre references like "(17)" → extract name
  const match = genre.match(/^\((\d+)\)(.*)/)
  if (match) {
    const id3v1Genres = [
      'Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop',
      'Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock',
      'Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack',
      'Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance',
      'Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise',
      'AlternRock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop',
      'Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic',
      'Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta','Top 40',
      'Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave',
      'Psychadelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk',
      'Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock'
    ]
    const idx = parseInt(match[1], 10)
    const suffix = match[2].trim()
    return (id3v1Genres[idx] || genre) + (suffix ? ` ${suffix}` : '')
  }
  return genre
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    // Only read first 512 KB to keep things fast (covers most ID3 tags including large covers)
    reader.readAsArrayBuffer(file.slice(0, 512 * 1024))
  })
}

// --- UI helpers ---

function updateMetadataDisplay(meta, fileName) {
  // Cover art
  const existingImg = coverArt.querySelector('img')
  if (existingImg) existingImg.remove()
  if (meta.cover) {
    const img = document.createElement('img')
    img.src = meta.cover
    img.alt = meta.album ? `${meta.album} 封面` : (meta.artist ? `${meta.artist} 专辑封面` : '专辑封面')
    coverArt.textContent = ''
    coverArt.appendChild(img)
  } else {
    coverArt.textContent = '🎵'
  }

  // Title
  trackTitle.textContent = meta.title || fileName

  // Artist
  trackArtist.textContent = meta.artist || ''

  // Album
  trackAlbum.textContent = meta.album || ''

  // Year + Genre
  const parts = []
  if (meta.year) parts.push(meta.year.substring(0, 4))
  if (meta.genre) parts.push(meta.genre)
  if (meta.track) parts.push(`第 ${meta.track} 曲`)
  trackMeta.textContent = parts.join('  ·  ')
}

// --- File selection ---

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return

  currentFile = file
  trackTitle.textContent = `🎧 ${file.name}`
  trackArtist.textContent = ''
  trackAlbum.textContent = ''
  trackMeta.textContent = ''
  coverArt.textContent = '🎵'

  // Parse ID3 tags
  try {
    const buffer = await readFileAsArrayBuffer(file)
    const meta = parseID3v2(buffer)
    updateMetadataDisplay(meta, file.name.replace(/\.[^.]+$/, ''))
  } catch (err) {
    console.warn('ID3 解析失败:', err)
    trackTitle.textContent = file.name.replace(/\.[^.]+$/, '')
  }

  const fileURL = URL.createObjectURL(file)
  audio.src = fileURL

  if (window.electronAPI) {
    window.electronAPI.playAudio(file.path)
  }
})

// --- Playback control ---

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

audio.addEventListener('ended', () => {
  playBtn.textContent = '▶️ 播放'
})