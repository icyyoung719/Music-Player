# AGENTS.md

## Purpose
This file helps coding agents work safely and consistently in this TypeScript Electron music player repository.

## Primary References
- `README.md` for user-facing capabilities and command quickstart.
- `DOCS.md` for architecture, data flow, and storage boundaries.
- `docs/MP3.md` for metadata and tagging notes.
- `.github/instructions/electron-music-player.instructions.md` for file-scoped coding rules.

## Quick Start
- Install: `npm install`
- Build: `npm run build`
- Run app: `npm run start`
- Typecheck: `npm run typecheck`
- Package (Windows): `npm run build:win`
- Log visualizer: `npm run logviz`

## Source And Runtime Entry Points
- Runtime main entry: `dist/main/main.js`
- Main source entry: `src/main/main.ts`
- Preload source entry: `src/preload/preload.ts`
- Renderer shell: `src/renderer/index.html`
- Renderer bootstrap: `src/renderer/bootstrap.ts`
- Renderer orchestrator: `src/renderer/renderer.ts`

## Code Map
- `src/main/modules/playerShell.ts`
  - Window shell, tray menu, thumbar buttons, media shortcuts, player state relay.
- `src/main/modules/playlistHandlers.ts`
  - IPC handlers for folder scan, metadata parsing, playlist CRUD, import/export.
- `src/main/modules/netease/**`
  - NetEase auth/search/recommend/playlist/download handlers and normalization.
- `src/preload/preload.ts`
  - Safe API bridge from main to renderer with payload sanitization.
- `src/renderer/core/*.ts`
  - Cross-module contracts (`eventBus`, `eventBridgeManager`) and shared services.
- `src/renderer/modules/*.ts`
  - Feature modules for playback, shortcuts, playlists, NetEase, dialogs, and settings.

## Rules For Agents
- Keep changes ASCII unless file already requires Unicode.
- Avoid broad refactors unless explicitly requested.
- Never bypass preload security by enabling `nodeIntegration`.
- Never expose raw Node or privileged APIs directly to renderer.
- Preserve user-facing Chinese copy style in existing UI text.
- Keep `src/renderer/renderer.ts` as composition/orchestration, not feature logic.
- Prefer cross-module communication via `src/renderer/core/eventBus.ts` and shared service adapters.

## IPC Checklist
For any new main-renderer capability:
1. Add `ipcMain.handle` or `ipcMain.on` in a main module.
2. Add a minimal, sanitized preload bridge wrapper.
3. Call the bridge from a renderer module or a `src/renderer/core/*Service` adapter.
4. Keep response shapes stable and renderer-friendly.

## Quality Checklist
- App starts without runtime errors.
- `npm run typecheck` passes.
- No syntax/lint errors in touched files.
- Playback controls still work: play/pause, next/prev, progress seek.
- Queue operations still work: add/remove/clear.
- Saved playlists still load, persist, and import/export correctly.
- Tray/media key behavior not regressed.

## Documentation Rules
- Treat `README.md` and `DOCS.md` as long-lived reference docs.
- Update `README.md` for user-facing capability/usage changes.
- Update `DOCS.md` for architecture/implementation/data-flow changes.
- Avoid status/process wording such as `已完成`、`此次更新`、`修复`、`优化中`、`计划中`.
- Keep docs concise; remove timeline-style maintenance notes.

## Non-Goals
- Do not rewrite architecture unless requested.
- Do not add large dependencies for minor needs.
- Do not hand-edit `dist/**` or `dist-release/**`; change `src/**` and build.
