import {
  formatTime,
  filePathToURL,
  getFileNameFromPath,
  normalizePath,
  getTrackUniqueKey,
  getCurrentTrackPath
} from './trackUtils.js'
import { createLyricManager } from './lyricManager.js'
import { createPlaybackFadeManager } from './playbackFadeManager.js'
import { createLazyQueueManager } from './lazyQueueManager.js'
import { createPlaybackUIController } from './playbackUIController.js'

const PREFETCH_BEFORE_SECONDS = 20
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.aac', '.ogg', '.wav', '.m4a', '.opus', '.wma'])

type TrackLike = Record<string, any>

type PlaybackControllerOptions = {
  electronAPI?: any
  dom: any
  eventBus?: {
    emit: (eventName: string, payload?: unknown) => void
  }
  promptForPlaylistName?: (message: string, defaultValue: string) => Promise<string | null>
  promptForPlaylistSelection?: (payload: {
    title?: string
    playlists: Array<{ id: string; name: string; trackCount?: number; coverUrl?: string }>
    defaultNewPlaylistName?: string
  }) => Promise<{ selectedPlaylistIds: string[]; newPlaylistName: string } | null>
}

export function createPlaybackController(options: PlaybackControllerOptions): any {
  const {
    electronAPI,
    dom,
    eventBus,
    promptForPlaylistName,
    promptForPlaylistSelection
  } = options

  function emit(eventName: string, payload?: unknown): void {
    if (!eventBus) return
    eventBus.emit(eventName, payload)
  }

  async function requestPlaylistName(message: string, defaultValue: string): Promise<string | null> {
    if (typeof promptForPlaylistName === 'function') {
      return promptForPlaylistName(message, defaultValue)
    }

    const input = prompt(message, defaultValue)
    return input === null ? null : input
  }

  const audio = new Audio()
  let playlist: TrackLike[] = []
  let currentIndex = -1
  let isLooping = false
  let isSeeking = false
  let previewSeekRatio: number | null = null
  let lyricManager: any = null
  const fadeManager = createPlaybackFadeManager({ audio })
  let fadeSettings: any = fadeManager.getSettings()
  let loadRequestId = 0
  const metadataHydrationKeys = new Set<string>()
  const lazyQueueManager = createLazyQueueManager({
    electronAPI,
    getPlaylist: () => playlist,
    getCurrentIndex: () => currentIndex,
    onTrackReady: (index: number) => {
      if (index === currentIndex) {
        updatePlaylistUI()
      }
    }
  })
  const uiController = createPlaybackUIController({
    dom,
    electronAPI,
    audio,
    getPlaylist: () => playlist,
    getCurrentIndex: () => currentIndex,
    getTrackArtistText,
    getTrackDurationText,
    getTrackCoverDataUrl,
    onHydrateTrack: (index: number, track: any) => {
      hydrateTrackDisplayMetadata(index, track)
    },
    onSaveTrack: (index: number) => saveTrackToSavedPlaylist(index),
    onRemoveTrack: (index: number) => removeTrack(index),
    onLoadTrack: (index: number) => loadTrack(index),
    onResetLyrics: () => {
      if (lyricManager) lyricManager.setLyrics(null)
    },
    onHomeCoverChanged: (dataUrl: string) => {
      emit('playback:home-cover.changed', dataUrl)
    }
  })

  function setPlayButtonState(isPlaying: boolean): void {
    uiController.setPlayButtonState(isPlaying)
  }

  function setBottomNowPlaying(title: string, artist: string): void {
    uiController.setBottomNowPlaying(title, artist)
  }

  function setBottomNowPlayingCover(dataUrl: string): void {
    uiController.setBottomNowPlayingCover(dataUrl)
  }

  function openQueueOverlay(): void {
    uiController.openQueueOverlay()
  }

  function closeQueueOverlay(): void {
    uiController.closeQueueOverlay()
  }

  function toggleQueueOverlay(): void {
    uiController.toggleQueueOverlay()
  }

  function reportPlayerState(): void {
    uiController.reportPlayerState()
  }

  function resetProgress(): void {
    uiController.resetProgress()
  }

  function updateProgressUIByRatio(ratio: number, currentTime: number): void {
    uiController.updateProgressUIByRatio(ratio, currentTime)
  }

  function resetTrackMeta(): void {
    uiController.resetTrackMeta()
  }

  function updatePlaylistUI(): void {
    uiController.updatePlaylistUI()
    reportPlayerState()
  }

  function getAudioExtFromPath(filePath: unknown): string {
    const source = String(filePath || '')
    const match = source.match(/\.([a-z0-9]+)$/i)
    if (!match) return ''
    return `.${match[1].toLowerCase()}`
  }

  function isSupportedAudioPath(filePath: unknown): boolean {
    return SUPPORTED_AUDIO_EXTENSIONS.has(getAudioExtFromPath(filePath))
  }

  function isSupportedAudioFile(file: any): boolean {
    if (!file) return false
    if (typeof file.type === 'string' && file.type.startsWith('audio/')) return true
    return isSupportedAudioPath(file.name)
  }

  function tryGetFilePath(file: any): string {
    if (!file || !electronAPI?.getPathForFile) return ''
    try {
      return electronAPI.getPathForFile(file) || ''
    } catch {
      return ''
    }
  }

  function createTrackInputByPath(filePath: string): TrackLike | null {
    if (!isSupportedAudioPath(filePath)) return null
    return {
      name: getFileNameFromPath(filePath),
      path: filePath,
      file: null
    }
  }

  function createTrackInputByFile(file: File): TrackLike | null {
    if (!isSupportedAudioFile(file)) return null
    return {
      name: file.name || '未知歌曲',
      file,
      path: null
    }
  }

  async function readDirectoryEntries(directoryEntry: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = directoryEntry.createReader()
      const allEntries: any[] = []

      const readNext = () => {
        reader.readEntries((entries: any[]) => {
          if (!entries || entries.length === 0) {
            resolve(allEntries)
            return
          }

          allEntries.push(...entries)
          readNext()
        }, reject)
      }

      readNext()
    })
  }

  async function readFileEntry(fileEntry: any): Promise<File> {
    return new Promise((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
  }

  function getDroppedFileIdentity(file: any): string {
    if (!file) return ''
    const fileName = String(file.name || '').toLowerCase()
    const fileSize = Number(file.size) || 0
    const lastModified = Number(file.lastModified) || 0
    if (fileName || fileSize || lastModified) {
      return `file:${fileName}|size:${fileSize}|mtime:${lastModified}`
    }

    const filePath = normalizePath(tryGetFilePath(file))
    if (filePath) return `path:${filePath}`

    return ''
  }

  async function collectFilesFromDropEntry(entry: any, pushFile: (file: any) => void): Promise<void> {
    if (!entry) return

    if (entry.isFile) {
      const file = await readFileEntry(entry)
      pushFile(file)
      return
    }

    if (!entry.isDirectory) return
    const children = await readDirectoryEntries(entry)
    for (const childEntry of children) {
      await collectFilesFromDropEntry(childEntry, pushFile)
    }
  }

  async function collectDropTrackInputs(dataTransfer: DataTransfer | any): Promise<TrackLike[]> {
    const items: any[] = Array.from(dataTransfer?.items || [])
    const tracks: TrackLike[] = []
    const looseFiles: any[] = []
    const seenFiles = new Set<string>()

    const pushLooseFile = (file: any): void => {
      const identity = getDroppedFileIdentity(file)
      if (!identity || seenFiles.has(identity)) return
      seenFiles.add(identity)
      looseFiles.push(file)
    }

    // Windows Explorer multi-select is most reliable via dataTransfer.files.
    if (dataTransfer?.files?.length) {
      for (const file of Array.from(dataTransfer.files)) {
        pushLooseFile(file)
      }
    } else {
      for (const item of items as any[]) {
        if (item.kind !== 'file') continue

        try {
          const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
          await collectFilesFromDropEntry(entry, pushLooseFile)
        } catch (err: any) {
          console.warn('Failed to collect dropped item:', err)
        }
      }
    }

    for (const file of looseFiles) {
      const track = createTrackInputByFile(file)
      if (track) tracks.push(track)
    }

    return tracks
  }

  function stopFade(options: any = {}): void {
    fadeManager.stopFade(options)
  }

  function runFadeTo(targetVolume: number, durationMs: number = 0): Promise<any> {
    return fadeManager.runFadeTo(targetVolume, durationMs)
  }


  function getTrackArtistText(track: any): string {
    const artist = track?.metadataCache?.artist
      || track?.lazyNetease?.artist
      || track?.lazyNetease?.artists
      || ''

    return String(artist || '').trim() || '未知歌手'
  }

  function getTrackDurationText(track: any): string {
    const durationSeconds = Number(track?.metadataCache?.duration)
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return formatTime(durationSeconds)
    }

    const durationMs = Number(track?.lazyNetease?.durationMs)
    if (Number.isFinite(durationMs) && durationMs > 0) {
      return formatTime(durationMs / 1000)
    }

    return '--:--'
  }

  function getTrackCoverDataUrl(track: any): string {
    return track?.metadataCache?.coverDataUrl
      || track?.lazyNetease?.coverDataUrl
      || track?.lazyNetease?.coverUrl
      || ''
  }

  async function saveTrackToSavedPlaylist(index: number): Promise<void> {
    const track = playlist[index]
    const filePath = getCurrentTrackPath(track, electronAPI)
    if (!filePath) {
      alert('该歌曲暂无本地文件，暂不支持收藏到本地歌单')
      return
    }

    if (!electronAPI?.playlistList || !electronAPI?.playlistCreate || !electronAPI?.playlistAddTracks) {
      return
    }

    const listResult = await electronAPI.playlistList()
    const existing = Array.isArray(listResult?.playlists) ? listResult.playlists : []

    const targetPlaylistIds = new Set<string>()
    if (typeof promptForPlaylistSelection === 'function') {
      const selection = await promptForPlaylistSelection({
        title: '选择要添加到的歌单',
        playlists: existing.map((item: any) => {
          const trackCount = Array.isArray(item?.trackIds)
            ? item.trackIds.length
            : Number(item?.trackCount) || 0
          const coverUrl = String(item?.coverUrl || '').trim()
          return {
            id: String(item?.id || ''),
            name: String(item?.name || '未命名歌单'),
            trackCount,
            coverUrl
          }
        }),
        defaultNewPlaylistName: track.name || '收藏歌曲'
      })
      if (!selection) return

      for (const playlistId of selection.selectedPlaylistIds) {
        const id = String(playlistId || '').trim()
        if (!id) continue
        targetPlaylistIds.add(id)
      }

      const newPlaylistName = String(selection.newPlaylistName || '').trim()
      if (newPlaylistName) {
        const created = await electronAPI.playlistCreate(newPlaylistName)
        const createdId = created?.ok ? String(created.playlist?.id || '') : ''
        if (!createdId) {
          alert('新建歌单失败')
          return
        }
        targetPlaylistIds.add(createdId)
      }
    } else if (existing.length) {
      const tips = existing.map((item: any, idx: number) => `${idx + 1}. ${item.name}`).join('\n')
      const input = await requestPlaylistName(`选择歌单序号，或输入新歌单名称：\n${tips}`, '1')
      if (input === null) return

      const trimmed = String(input || '').trim()
      const choice = Number.parseInt(trimmed, 10)
      if (Number.isFinite(choice) && choice >= 1 && choice <= existing.length) {
        const selectedId = String(existing[choice - 1]?.id || '').trim()
        if (selectedId) targetPlaylistIds.add(selectedId)
      } else {
        const created = await electronAPI.playlistCreate(trimmed || (track.name || '收藏歌曲'))
        const createdId = created?.ok ? String(created.playlist?.id || '') : ''
        if (createdId) targetPlaylistIds.add(createdId)
      }
    } else {
      const name = await requestPlaylistName('输入新歌单名称：', track.name || '收藏歌曲')
      if (name === null) return
      const created = await electronAPI.playlistCreate(String(name || '').trim() || '收藏歌曲')
      const createdId = created?.ok ? String(created.playlist?.id || '') : ''
      if (createdId) targetPlaylistIds.add(createdId)
    }

    if (!targetPlaylistIds.size) {
      alert('请选择至少一个目标歌单')
      return
    }

    const metadataCache = {
      title: track?.metadataCache?.title || track?.name || getFileNameFromPath(filePath),
      artist: track?.metadataCache?.artist || null,
      album: track?.metadataCache?.album || null,
      duration: track?.metadataCache?.duration || null
    }

    let addedOkCount = 0
    for (const playlistId of targetPlaylistIds) {
      const addResult = await electronAPI.playlistAddTracks(playlistId, [{ path: filePath, metadataCache }])
      if (!addResult?.ok) continue
      addedOkCount += 1
      emit('playlist:saved.changed', { playlistId })
    }

    if (!addedOkCount) {
      alert('收藏失败，添加歌曲时出错')
      return
    }

    alert(addedOkCount > 1 ? `已添加到 ${addedOkCount} 个歌单` : '已添加到歌单')
  }

  async function saveCurrentQueueAsSavedPlaylist(): Promise<void> {
    const tracks = collectCurrentQueueAsTrackInputs()
    if (!tracks.length) {
      alert('当前播放列表没有可收藏的本地歌曲')
      return
    }

    if (!electronAPI?.playlistCreate || !electronAPI?.playlistAddTracks) {
      return
    }

    const name = await requestPlaylistName('输入要收藏成的歌单名称：', `播放列表 ${new Date().toLocaleDateString()}`)
    if (name === null) return
    const created = await electronAPI.playlistCreate(String(name || '').trim() || `播放列表 ${Date.now()}`)
    const playlistId = created?.ok ? created.playlist?.id || '' : ''
    if (!playlistId) {
      alert('创建歌单失败')
      return
    }

    const result = await electronAPI.playlistAddTracks(playlistId, tracks)
    if (!result?.ok) {
      alert('歌单收藏失败')
      return
    }

    emit('playlist:saved.changed', { playlistId })

    alert(`已收藏到歌单：${created.playlist?.name || '未命名歌单'}`)
  }

  async function hydrateTrackDisplayMetadata(index: number, track: any): Promise<void> {
    const filePath = getCurrentTrackPath(track, electronAPI)
    if (!filePath || !electronAPI?.getMetadata) return

    const key = `${index}:${normalizePath(filePath)}`
    if (metadataHydrationKeys.has(key)) return
    if (track?.metadataCache?.duration && track?.metadataCache?.artist && track?.metadataCache?.coverDataUrl) return

    metadataHydrationKeys.add(key)
    try {
      const meta = await electronAPI.getMetadata(filePath)
      if (!meta) return

      const targetTrack = playlist[index]
      if (!targetTrack) return
      targetTrack.metadataCache = {
        ...targetTrack.metadataCache,
        title: meta.title || targetTrack.metadataCache?.title || targetTrack.name,
        artist: meta.artist || targetTrack.metadataCache?.artist || null,
        album: meta.album || targetTrack.metadataCache?.album || null,
        duration: Number.isFinite(meta.duration) ? meta.duration : targetTrack.metadataCache?.duration || null,
        coverDataUrl: meta.coverDataUrl || targetTrack.metadataCache?.coverDataUrl || ''
      }

      updatePlaylistUI()
    } catch {
      // Ignore metadata hydration errors for queue preview cards.
    }
  }


  async function ensureTrackReadyForPlayback(index: number, options: any = {}): Promise<any> {
    return lazyQueueManager.ensureTrackReadyForPlayback(index, options)
  }

  function maybePrefetchNextLazyTrack(): void {
    lazyQueueManager.maybePrefetchNextLazyTrack()
  }

  function handleLazyDownloadTaskUpdate(task: any): void {
    lazyQueueManager.handleLazyDownloadTaskUpdate(task)
  }

  async function loadTrack(index: number): Promise<void> {
    if (index < 0 || index >= playlist.length) return
    const requestId = ++loadRequestId
    currentIndex = index
    let track = playlist[index]

    dom.trackTitle.textContent = track.name
    dom.trackArtist.textContent = track.metadataCache?.artist || ''
    dom.trackAlbum.textContent = track.metadataCache?.album || ''
    setBottomNowPlaying(track.name, track.metadataCache?.artist || '')
    const nextCover = getTrackCoverDataUrl(track)
    if (nextCover) {
      dom.coverImg.src = nextCover
      dom.coverImg.style.display = 'block'
      dom.coverPlaceholder.style.display = 'none'
      setBottomNowPlayingCover(nextCover)
      emit('playback:home-cover.changed', nextCover)
    } else {
      dom.coverImg.style.display = 'none'
      dom.coverImg.src = ''
      dom.coverPlaceholder.style.display = 'flex'
      setBottomNowPlayingCover('')
      emit('playback:home-cover.changed', null)
    }
    resetProgress()
    updatePlaylistUI()
    reportPlayerState()

    if (lyricManager) {
      lyricManager.setLyrics(null)
    }

    const shouldFadeOutCurrent = !audio.paused && audio.src && fadeSettings.fadeOutMs > 0
    if (shouldFadeOutCurrent) {
      await runFadeTo(0, fadeSettings.fadeOutMs)
      if (requestId !== loadRequestId) return
    } else {
      stopFade()
    }

    audio.pause()

    const ready = await ensureTrackReadyForPlayback(index, { waitForReady: true })
    if (requestId !== loadRequestId) return
    if (!ready) {
      setPlayButtonState(false)
      updatePlaylistUI()
      reportPlayerState()
      return
    }

    track = playlist[index]

    if (track.file) {
      audio.src = URL.createObjectURL(track.file)
    } else if (track.path) {
      audio.src = filePathToURL(track.path)
    } else {
      setPlayButtonState(false)
      updatePlaylistUI()
      reportPlayerState()
      return
    }

    let filePath = track.path
    if (track.file && electronAPI && electronAPI.getPathForFile) {
      filePath = electronAPI.getPathForFile(track.file)
    }

    if (filePath && electronAPI) {
      electronAPI.playAudio(filePath)
      const meta = await electronAPI.getMetadata(filePath)
      if (requestId !== loadRequestId) return
      if (meta) {
        dom.trackTitle.textContent = meta.title || track.name
        dom.trackArtist.textContent = meta.artist || ''
        setBottomNowPlaying(meta.title || track.name, meta.artist || '')
        const albumParts = [meta.album, meta.year].filter(Boolean)
        dom.trackAlbum.textContent = albumParts.join(' · ')

        if (meta.coverDataUrl) {
          dom.coverImg.src = meta.coverDataUrl
          dom.coverImg.style.display = 'block'
          dom.coverPlaceholder.style.display = 'none'
          setBottomNowPlayingCover(meta.coverDataUrl)
          emit('playback:home-cover.changed', meta.coverDataUrl)
        } else {
          setBottomNowPlayingCover('')
          emit('playback:home-cover.changed', null)
        }

        // Set Lyrics
        if (lyricManager) {
          let lyricData = ''
          if (Array.isArray(meta.lyrics) && meta.lyrics.length > 0) {
            const first = meta.lyrics[0]
            lyricData = (first && typeof first === 'object' && typeof first.text === 'string')
              ? first.text
              : (typeof first === 'string' ? first : '')
          } else if (typeof meta.lyrics === 'string') {
            lyricData = meta.lyrics
          } else if (meta.lyrics) {
            lyricData = String(meta.lyrics)
          }
          lyricManager.setLyrics(lyricData)
        }

        track.metadataCache = {
          title: meta.title || track.name,
          artist: meta.artist || null,
          album: meta.album || null,
          duration: meta.duration || null,
          coverDataUrl: meta.coverDataUrl || ''
        }
      }
    }

    try {
      audio.volume = fadeSettings.fadeInMs > 0 ? 0 : 1
      await audio.play()
      if (requestId !== loadRequestId) return
      if (fadeSettings.fadeInMs > 0) {
        await runFadeTo(1, fadeSettings.fadeInMs)
        if (requestId !== loadRequestId) return
      }
      setPlayButtonState(true)

      const trackKey = getTrackUniqueKey(track, electronAPI)
      const filePath = getCurrentTrackPath(track, electronAPI)
      emit('playback:track.started', {
        track,
        trackKey,
        filePath,
        playedAt: Date.now(),
        metadata: {
          title: track?.metadataCache?.title || track?.name || '',
          artist: track?.metadataCache?.artist || '',
          album: track?.metadataCache?.album || '',
          duration: Number(track?.metadataCache?.duration) || null,
          coverDataUrl: track?.metadataCache?.coverDataUrl || ''
        }
      })
    } catch (err: any) {
      console.warn('Failed to play audio:', err)
      setPlayButtonState(false)
    }

    updatePlaylistUI()
    reportPlayerState()
  }

  function appendToPlaylist(newTracks: TrackLike[]): void {
    if (!newTracks.length) return
    const wasEmpty = playlist.length === 0

    const existingKeys = new Set<string>(playlist.map((track: any) => getTrackUniqueKey(track, electronAPI)))
    const dedupedTracks: TrackLike[] = []

    for (const track of newTracks) {
      const key = getTrackUniqueKey(track, electronAPI)
      if (existingKeys.has(key)) continue
      existingKeys.add(key)
      dedupedTracks.push(track)
    }

    if (!dedupedTracks.length) return

    playlist = playlist.concat(dedupedTracks)
    updatePlaylistUI()
    if (wasEmpty) loadTrack(0)
  }

  function setQueueTracks(nextTracks: TrackLike[], startIndex: number = 0): void {
    loadRequestId += 1
    playlist = Array.isArray(nextTracks) ? nextTracks.slice() : []
    lazyQueueManager.reset()
    currentIndex = -1
    stopFade({ resetVolume: true })
    audio.pause()
    audio.src = ''
    setPlayButtonState(false)
    resetProgress()
    resetTrackMeta()
    updatePlaylistUI()
    reportPlayerState()

    if (!playlist.length) {
      return
    }

    const safeIndex = Math.max(0, Math.min(startIndex, playlist.length - 1))
    loadTrack(safeIndex)
  }

  function removeTrack(index: number): void {
    lazyQueueManager.removeTrack(index)

    if (index === currentIndex) {
      loadRequestId += 1
      stopFade({ resetVolume: true })
      audio.pause()
      audio.src = ''
      setPlayButtonState(false)

      if (playlist.length > 1) {
        const nextIndex = index < playlist.length - 1 ? index : index - 1
        playlist.splice(index, 1)
        currentIndex = -1
        loadTrack(nextIndex)
        return
      }

      playlist.splice(index, 1)
      currentIndex = -1
      resetProgress()
      resetTrackMeta()
    } else {
      playlist.splice(index, 1)
      if (index < currentIndex) currentIndex--
    }

    updatePlaylistUI()
  }

  function clearPlaylist(): void {
    loadRequestId += 1
    lazyQueueManager.reset()
    playlist = []
    currentIndex = -1
    stopFade({ resetVolume: true })
    audio.pause()
    audio.src = ''
    setPlayButtonState(false)
    resetProgress()
    resetTrackMeta()
    updatePlaylistUI()
    reportPlayerState()
  }

  function playPreviousTrack(): void {
    if (playlist.length === 0) return
    const newIndex = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1
    loadTrack(newIndex)
  }

  function playNextTrack(): void {
    if (playlist.length === 0) return
    const newIndex = currentIndex >= playlist.length - 1 ? 0 : currentIndex + 1
    loadTrack(newIndex)
  }

  function togglePlayback(options: any = {}): void {
    const { silent = false } = options
    if (playlist.length === 0) {
      if (!silent) alert('请先选择音乐文件 🎵')
      return
    }

    if (currentIndex === -1) {
      loadTrack(0)
      return
    }

    if (audio.paused) {
      stopFade()
      audio.volume = fadeSettings.fadeInMs > 0 ? 0 : 1
      audio.play().then(() => {
        if (fadeSettings.fadeInMs > 0) {
          runFadeTo(1, fadeSettings.fadeInMs)
        }
        setPlayButtonState(true)
        reportPlayerState()
      }).catch((err: any) => {
        console.warn('Failed to resume audio:', err)
      })
    } else {
      runFadeTo(0, fadeSettings.fadeOutMs).then((completed) => {
        if (!completed) return
        if (audio.paused) return
        audio.pause()
        setPlayButtonState(false)
        reportPlayerState()
      })
    }
  }

  function toggleLoopState(): void {
    isLooping = !isLooping
    audio.loop = isLooping
    dom.loopBtn.classList.toggle('btn-active', isLooping)
    dom.loopBtn.title = isLooping ? '单曲循环: 开' : '单曲循环: 关'
  }

  function seekBy(seconds: number): void {
    if (!audio.duration) return
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
  }

  function collectCurrentQueueAsTrackInputs(): any[] {
    const trackInputs: any[] = []
    const usedPaths = new Set<string>()

    for (const track of playlist) {
      const filePath = getCurrentTrackPath(track, electronAPI)
      if (!filePath) continue

      const normalizedPath = normalizePath(filePath)
      if (usedPaths.has(normalizedPath)) continue
      usedPaths.add(normalizedPath)

      trackInputs.push({
        path: filePath,
        metadataCache: track.metadataCache || { title: track.name || getFileNameFromPath(filePath) }
      })
    }

    return trackInputs
  }

  function replaceCurrentQueueWithTracks(tracks: TrackLike[], startIndex: number = 0, _options: any = {}): void {
    setQueueTracks(tracks, startIndex)
  }

  function handleExternalPlayerControl(action: string): void {
    switch (action) {
      case 'toggle-play':
        togglePlayback({ silent: true })
        break
      case 'next-track':
        playNextTrack()
        break
      case 'previous-track':
        playPreviousTrack()
        break
      default:
        break
    }
  }

  function bindControlEvents(): void {
    const appendTracks = (tracks: TrackLike[], options: any = {}) => {
      const { openQueue = false } = options
      if (!tracks.length) return
      appendToPlaylist(tracks)
      if (openQueue) {
        openQueueOverlay()
      }
    }

    dom.fileInput.addEventListener('change', async (e: Event) => {
      const target = e.target as HTMLInputElement
      const files = Array.from(target?.files || [])
      if (!files.length) return
      appendTracks(files.map((file: File) => ({ name: file.name, file, path: null })), { openQueue: true })
      dom.fileInput.value = ''
    })

    const handleAddFolder = async (): Promise<void> => {
      if (!electronAPI || !electronAPI.selectFolder) return
      const paths = await electronAPI.selectFolder()
      if (!paths || !paths.length) return
      appendTracks(paths.map((p: string) => ({ name: p.split(/[/\\]/).pop(), path: p, file: null })), { openQueue: true })
    }

    dom.folderBtn.addEventListener('click', handleAddFolder)

    if (dom.songPageEl) {
      let dragDepth = 0

      const hasFilePayload = (event: DragEvent | any): boolean => {
        const types = Array.from(event.dataTransfer?.types || [])
        return types.includes('Files')
      }

      const clearDragState = (): void => {
        dragDepth = 0
        dom.songPageEl.classList.remove('drag-over')
      }

      dom.songPageEl.addEventListener('dragenter', (event: DragEvent) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        dragDepth += 1
        dom.songPageEl.classList.add('drag-over')
      })

      dom.songPageEl.addEventListener('dragover', (event: DragEvent) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        if (!event.dataTransfer) return
        event.dataTransfer.dropEffect = 'copy'
      })

      dom.songPageEl.addEventListener('dragleave', (event: DragEvent) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        dragDepth = Math.max(0, dragDepth - 1)
        if (dragDepth === 0) {
          dom.songPageEl.classList.remove('drag-over')
        }
      })

      dom.songPageEl.addEventListener('drop', async (event: DragEvent) => {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        clearDragState()
        if (!event.dataTransfer) return

        let tracks: TrackLike[] = []
        try {
          tracks = await collectDropTrackInputs(event.dataTransfer)
        } catch (err: any) {
          console.warn('Failed to parse drop payload:', err)
          return
        }
        if (!tracks.length) return
        appendTracks(tracks, { openQueue: false })
      })
    }

    if (dom.songAddFileBtn) {
      dom.songAddFileBtn.addEventListener('click', () => {
        openQueueOverlay()
        dom.fileInput.click()
      })
    }

    if (dom.songAddFolderBtn) {
      dom.songAddFolderBtn.addEventListener('click', async () => {
        openQueueOverlay()
        await handleAddFolder()
      })
    }

    if (dom.songOpenQueueBtn) {
      dom.songOpenQueueBtn.addEventListener('click', openQueueOverlay)
    }

    if (dom.queueToggleBtn) {
      dom.queueToggleBtn.addEventListener('click', toggleQueueOverlay)
    }

    if (dom.queueCloseBtn) {
      dom.queueCloseBtn.addEventListener('click', closeQueueOverlay)
    }

    if (dom.queueOverlayBackdropEl) {
      dom.queueOverlayBackdropEl.addEventListener('click', closeQueueOverlay)
    }

    if (dom.queueSaveBtn) {
      dom.queueSaveBtn.addEventListener('click', saveCurrentQueueAsSavedPlaylist)
    }

    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!uiController.getQueueOverlayOpenState()) return
      event.preventDefault()
      closeQueueOverlay()
    })

    dom.clearBtn.addEventListener('click', () => {
      if (playlist.length === 0) return
      clearPlaylist()
    })

    dom.playBtn.addEventListener('click', () => togglePlayback({ silent: false }))
    dom.prevBtn.addEventListener('click', playPreviousTrack)
    dom.nextBtn.addEventListener('click', playNextTrack)
    dom.loopBtn.addEventListener('click', toggleLoopState)

    if (dom.songBackBtn) {
      dom.songBackBtn.addEventListener('click', () => {
        emit('view:home.open')
      })
    }
    if (dom.homeGoSongBtn) {
      dom.homeGoSongBtn.addEventListener('click', () => {
        emit('view:song.open')
      })
    }
  }

  function bindAudioEvents(): void {
    const getSeekRatioFromClientX = (clientX: number): number => {
      const rect = dom.progressContainer.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      return Math.max(0, Math.min(1, ratio))
    }

    const updateSeekPreview = (ratio: number): void => {
      if (!audio.duration) return
      previewSeekRatio = Math.max(0, Math.min(1, ratio))
      updateProgressUIByRatio(previewSeekRatio, previewSeekRatio * audio.duration)
    }

    const commitSeekPreview = (): void => {
      if (!audio.duration || previewSeekRatio === null) return
      audio.currentTime = previewSeekRatio * audio.duration
      previewSeekRatio = null
    }

    const endSeeking = (pointerId?: number, shouldCommit: boolean = true): void => {
      if (!isSeeking) return
      if (shouldCommit) {
        commitSeekPreview()
      } else {
        previewSeekRatio = null
      }
      isSeeking = false
      dom.progressContainer.classList.remove('seeking')
      if (pointerId !== undefined && dom.progressContainer.hasPointerCapture(pointerId)) {
        dom.progressContainer.releasePointerCapture(pointerId)
      }
    }

    audio.addEventListener('ended', () => {
      if (isLooping) return
      if (currentIndex < playlist.length - 1) {
        loadTrack(currentIndex + 1)
      } else {
        setPlayButtonState(false)
        reportPlayerState()
      }
    })

    audio.addEventListener('play', () => {
      setPlayButtonState(true)
      reportPlayerState()
    })

    audio.addEventListener('pause', () => {
      if (!audio.ended) setPlayButtonState(false)
      reportPlayerState()
    })

    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || isSeeking) return
      updateProgressUIByRatio(audio.currentTime / audio.duration, audio.currentTime)

      if (audio.duration - audio.currentTime <= PREFETCH_BEFORE_SECONDS) {
        maybePrefetchNextLazyTrack()
      }

      if (lyricManager) {
        lyricManager.updateTime(audio.currentTime)
      }
    })

    audio.addEventListener('loadedmetadata', () => {
      dom.totalTimeEl.textContent = formatTime(audio.duration)
      updateProgressUIByRatio(audio.duration ? audio.currentTime / audio.duration : 0, audio.currentTime)
    })

    dom.progressContainer.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!audio.duration) return
      isSeeking = true
      dom.progressContainer.classList.add('seeking')
      dom.progressContainer.setPointerCapture(e.pointerId)
      updateSeekPreview(getSeekRatioFromClientX(e.clientX))
    })

    dom.progressContainer.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isSeeking) return
      updateSeekPreview(getSeekRatioFromClientX(e.clientX))
    })

    dom.progressContainer.addEventListener('pointerup', (e: PointerEvent) => {
      if (!isSeeking) return
      updateSeekPreview(getSeekRatioFromClientX(e.clientX))
      endSeeking(e.pointerId)
    })

    dom.progressContainer.addEventListener('pointercancel', (e: PointerEvent) => {
      endSeeking(e.pointerId, false)
    })
  }

  function init(): void {
    lyricManager = createLyricManager('lyricsContainer', 'lyricsWrapper')

    if (electronAPI?.onNeteaseDownloadTaskUpdate) {
      electronAPI.onNeteaseDownloadTaskUpdate((task: any) => {
        handleLazyDownloadTaskUpdate(task)
      })
    }
    
    bindControlEvents()
    bindAudioEvents()
    updatePlaylistUI()
    setPlayButtonState(false)
    audio.volume = 1
    reportPlayerState()
  }

  function updateFadeSettings(nextSettings: any = {}): any {
    fadeSettings = fadeManager.updateSettings(nextSettings)
    return { ...fadeSettings }
  }

  function getFadeSettings(): any {
    return { ...fadeSettings }
  }

  return {
    init,
    togglePlayback,
    playPreviousTrack,
    playNextTrack,
    toggleLoopState,
    seekBy,
    clearPlaylist,
    appendToPlaylist,
    collectCurrentQueueAsTrackInputs,
    replaceCurrentQueueWithTracks,
    handleExternalPlayerControl,
    updateFadeSettings,
    getFadeSettings,
    hasQueue: () => playlist.length > 0,
    refreshLyricsScroll: () => {
      if (lyricManager) lyricManager.refreshScroll()
    }
  }
}
