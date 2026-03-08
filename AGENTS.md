# AGENTS.md

## Purpose
This file helps coding agents work safely and consistently in this Electron music player repository.

## Quick Start
- Install: `npm install`
- Run app: `npm run start`
- Main entry: `src/main/main.js`
- Renderer entry: `src/renderer/renderer.js`

## Code Map
- `src/main/modules/playerShell.js`
  - Window shell, tray menu, thumbar buttons, media shortcuts, player state relay.
- `src/main/modules/playlistHandlers.js`
  - IPC handlers for folder scan, metadata parsing, playlist CRUD, import/export.
- `src/preload/preload.js`
  - Safe API exposure from main to renderer.
- `src/renderer/index.html`
  - UI structure and style.
- `src/renderer/modules/*.js`
  - Feature modules for playback, shortcuts, theme, playlists.

## Rules For Agents
- Keep changes ASCII unless file already requires Unicode.
- Avoid broad refactors unless explicitly requested.
- Never bypass preload security by enabling `nodeIntegration`.
- New main-renderer interactions must go through:
  1. `ipcMain` handler/listener in main
  2. preload bridge API
  3. renderer usage
- Preserve user-facing Chinese copy style in existing UI text.

## Quality Checklist
- App starts without runtime errors.
- No syntax/lint errors in touched files.
- Playback controls still work: play/pause, next/prev, progress seek.
- Saved playlists still load and persist.
- Tray/media key behavior not regressed.

## Suggested Task Decomposition
1. Identify layer: main, preload, renderer orchestrator, renderer module.
2. Make smallest viable code change.
3. Validate impacted behavior manually.
4. Document notable behavior changes in PR/commit notes.
