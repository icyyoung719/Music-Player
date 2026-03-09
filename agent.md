# agent.md

## Project Snapshot
- Name: `music-player`
- Type: Electron desktop app (main + preload + renderer)
- Entry: `src/main/main.js`
- Runtime command: `npm run start`
- Test status: no automated test suite yet (`npm test` is placeholder)

## Architecture
- Main process: app lifecycle, tray, media shortcuts, IPC registration.
- Preload: secure bridge via `contextBridge` and `ipcRenderer`.
- Renderer shell: `src/renderer/index.html` provides CSP/meta and mount root.
- Renderer bootstrap: `src/renderer/bootstrap.js` loads partial DOM before orchestrator runs.
- Renderer orchestrator: `src/renderer/renderer.js` wires modules and DOM.
- Renderer view split: `src/renderer/partials/*.html` + `src/renderer/styles/index.css`.
- Renderer modules:
  - `playbackController.js`: queue, audio lifecycle, progress/seek, metadata sync.
  - `savedPlaylistManager.js`: saved playlists UI + import/export.
  - `shortcutManager.js`: customizable hotkeys and persistence.
  - `theme.js`: light/dark theme state and persistence.
  - `trackUtils.js`: pure utilities.

## Existing Features
- Local audio playback, metadata parsing, cover display.
- Queue management: add/remove/clear, previous/next, loop.
- Saved playlists persisted in user data (`playlists.json`).
- Tray integration, thumbar buttons, media keys.
- Rich UI with home/song pages, theme switch, keyboard shortcuts.

## Critical Guardrails
- Keep Electron security posture:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - add new capabilities through `preload.js` + IPC only
- Do not import Node APIs directly in renderer modules.
- Preserve current module boundaries; avoid moving logic back into one large file.
- Prefer minimal, localized edits.

## Common Change Workflow
1. Read target module and related IPC/preload calls.
2. If UI markup/CSS is involved, decide layer first: `partials`, `styles`, or `renderer` wiring.
3. Implement narrow change in module layer first.
4. Update renderer wiring only if needed.
5. Run app with `npm run start` for manual verification.
6. If UI behavior changes, also sanity-check theme variants and both home/song pages.

## Known Gaps
- No unit/integration test harness yet.
- Heavy dependency tree in `package.json`; avoid adding new dependencies unless required.
