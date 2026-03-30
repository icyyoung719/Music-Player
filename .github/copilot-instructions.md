# Copilot Instructions For This Repository

## Project Intent
This is an Electron-based local music player prototype. Keep edits pragmatic, modular, and easy to verify manually.

## Technical Constraints
- Keep Electron security defaults:
  - `contextIsolation: true`
  - `nodeIntegration: false`
- Do not expose raw Node or privileged APIs directly to renderer.
- For new cross-process features, update all three layers:
  - `src/main/**` (IPC)
  - `src/preload/preload.js` (bridge)
  - `src/renderer/**` (caller)

## Preferred Patterns
- Put feature logic in `src/renderer/modules/` rather than `renderer.js`.
- Keep `renderer.js` as composition/orchestration.
- Keep utility logic in `trackUtils.js` when reusable.
- Prefer small functions with clear side effects.
- Documentation maintenance is required after significant changes:
  - Update `README.md` for user-facing capability/usage changes.
  - Update `DOCS.md` for current architecture, implementation keys, and maintenance notes.
  - When features are removed/updated or implementation/architecture changes, update both files as needed (do not update only changelog text).

## Documentation Style
- Treat `README.md` and `DOCS.md` as stable reference docs.
- Emphasize capability core, architecture, data flow, and usage boundaries.
- Avoid status/process wording: `已完成`、`此次更新`、`修复`、`优化中`、`计划中`.
- Keep both files concise; do not include bug timeline narratives or temporary progress notes.
- Keep `README.md` high-level and keep implementation depth in `DOCS.md`.

## UI Guidance
- Respect existing visual direction in `index.html`.
- Keep desktop and small-screen behavior usable.
- Avoid introducing heavy CSS frameworks.

## Validation Expectations
When modifying playback or playlists, verify:
- queue operations (add/remove/clear)
- play/pause/next/prev/loop
- progress/time display and seek behavior
- playlist persistence and import/export flows

## Non-Goals
- Do not rewrite architecture unless requested.
- Do not add large dependencies for minor needs.
