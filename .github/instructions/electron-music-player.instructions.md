---
applyTo: "src/**/*.js,src/**/*.html"
description: "Use when editing Electron music player code, including main/preload/renderer IPC flows, playback logic, playlist persistence, and UI behaviors."
---

# Electron Music Player File Instructions

## Layer Responsibilities
- Main process (`src/main/**`): app lifecycle, shell integrations, IPC handlers, persistence orchestration.
- Preload (`src/preload/preload.js`): strict API bridge only.
- Renderer (`src/renderer/**`): UI and interaction logic using exposed bridge methods.

## Required IPC Flow
When adding a new capability involving privileged APIs:
1. Add `ipcMain.handle` or `ipcMain.on` in main module.
2. Expose a minimal wrapper in preload.
3. Consume wrapper in renderer module.

## Playback Safety
- Be conservative with frequent writes to `audio.currentTime`.
- During drag/seek interactions, prefer preview UI updates and commit seek at stable points.
- Avoid patterns that can cause audible artifacts or decode thrashing.

## Persistence Notes
- Playlist data is persisted under user data path.
- Keep compatibility with current shape:
  - `playlists: [{ id, name, trackIds }]`
  - `trackLibrary: { [trackId]: { path, metadataCache } }`

## Editing Style
- Keep changes localized and readable.
- Reuse existing helper functions before introducing new abstractions.
- Maintain current Chinese UI copy conventions.
