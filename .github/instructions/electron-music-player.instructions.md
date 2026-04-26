---
applyTo: "src/**/*.{ts,html,css}"
description: "Use when editing Electron music player code, including main/preload/renderer IPC flows, playback logic, playlist persistence, and UI behaviors."
---

# Electron Music Player File Instructions

## Layer Responsibilities
- Main process (`src/main/**`): app lifecycle, shell integrations, IPC handlers, persistence and network orchestration.
- Preload (`src/preload/preload.ts`): strict API bridge with payload validation/sanitization.
- Renderer (`src/renderer/**`): UI and interaction logic through bridge methods.
- Renderer orchestrator (`src/renderer/renderer.ts`): composition/init only.
- Renderer modules/core (`src/renderer/modules/**`, `src/renderer/core/**`): feature logic and cross-module contracts.

## Required IPC Flow
When adding a new capability involving privileged APIs:
1. Add `ipcMain.handle` or `ipcMain.on` in main module.
2. Expose a minimal wrapper in preload.
3. Consume wrapper in renderer module or renderer core service.

## Playback Safety
- Be conservative with frequent writes to `audio.currentTime`.
- During drag/seek interactions, prefer preview UI updates and commit seek at stable points.
- Avoid patterns that can cause audible artifacts or decode thrashing.

## Persistence Notes
- Netease API references: `ref/netease-cloud-music-api-binaryify/`
- Playlist persistence and migration are owned by `src/main/modules/playlistHandlers.ts`.
- Keep backward compatibility for persisted userData files.

## Editing Style
- Keep changes localized and readable.
- Reuse existing helper functions before introducing new abstractions.
- Maintain current Chinese UI copy conventions.

## Documentation Maintenance
- For user-visible capability or usage changes, update `README.md`.
- For architecture/data-flow/storage changes, update `DOCS.md`.
- Keep docs concise and centered on capability and boundaries.
- Avoid process/status wording in docs, including `已完成`、`此次更新`、`修复`、`优化中`、`计划中`.
