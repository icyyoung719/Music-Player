# Copilot Instructions For This Repository

## Project Intent
This is a TypeScript Electron desktop music player. Keep edits pragmatic, modular, and easy to verify manually.

## First Read
- `AGENTS.md` for workflow and repository guardrails.
- `README.md` for capability overview and commands.
- `DOCS.md` for architecture, data flow, and storage details.

## Technical Constraints
- Keep Electron security defaults:
  - `contextIsolation: true`
  - `nodeIntegration: false`
- Do not expose raw Node or privileged APIs directly to renderer.
- For new cross-process features, update all three layers:
  - `src/main/**` (IPC)
  - `src/preload/preload.ts` (bridge)
  - `src/renderer/**` (caller)

## Preferred Patterns
- Put feature logic in `src/renderer/modules/*.ts` rather than `src/renderer/renderer.ts`.
- Keep `src/renderer/renderer.ts` as composition/orchestration.
- Use `src/renderer/core/*.ts` for cross-module services and contracts.
- Keep reusable utility logic in `trackUtils.ts`.
- Prefer small functions with clear side effects.

## Validation Expectations
When modifying playback or playlists, verify:
- queue operations (add/remove/clear)
- play/pause/next/prev/loop
- progress/time display and seek behavior
- playlist persistence and import/export flows

Run `npm run typecheck` before considering a TypeScript change complete.

## Documentation Maintenance
When behavior, architecture, or user-visible usage changes:
- Update `README.md` for capability/usage
- Update `DOCS.md` for architecture/implementation/data flow

Documentation style:
- Keep docs concise and stable.
- Avoid status/process wording: `已完成`、`此次更新`、`修复`、`优化中`、`计划中`.
- Avoid timeline-style troubleshooting narratives.

## Non-Goals
- Do not rewrite architecture unless requested.
- Do not add large dependencies for minor needs.
