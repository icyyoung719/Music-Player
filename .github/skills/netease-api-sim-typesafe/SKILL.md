---
name: netease-api-sim-typesafe
description: 'Use netease-api-sim snapshots to reduce unknown/any in NetEase code paths. Use when refining API contracts, normalizing response fields, replacing fallback unknown text, and writing safer TypeScript across main/preload/renderer.'
argument-hint: 'Feature or module scope, for example: search results, playlist detail, download preview, auth profile'
user-invocable: true
---

# NetEase API Sim Type-Safe Workflow

## Purpose

Use this workflow to turn real API snapshots into safer and clearer TypeScript contracts, so code no longer depends on broad unknown/any and renderer fallback labels.

Primary data source:
- [tools/netease-api-sim/index.js](tools/netease-api-sim/index.js)
- [tools/netease-api-sim/runs](tools/netease-api-sim/runs)

## When To Use

Use this skill when:
- NetEase-related modules contain unknown/any-heavy mapping logic.
- Renderer shows fallback text such as 未知歌手, 未知专辑, 未知用户, 未知歌曲.
- API response fields are inconsistent and need stable normalization.
- You need evidence-based interface updates instead of guessing response shape.

## Inputs

Provide:
- Target scope: search, playlist detail, recommendation, download, auth, or message.
- Goal: reduce unknown/any, remove fallback unknown labels, strengthen type safety, or all.
- Risk preference:
1. Report only
2. Main normalization only
3. Main + preload + renderer full contract alignment

Optional:
- Sample keyword
- Fixed songId
- Fixed playlistId
- Existing run folder to reuse

## Procedure

1. Generate or reuse snapshots
- Run api simulator to produce a run folder.
- Prefer targeted params for the scope under change.
- Use latest run unless stale or missing required endpoints.

2. Build field contract map from snapshots
- For each endpoint in scope, extract required fields used by UI/business logic.
- Track optional fields, nullability, and alternate source paths.
- Mark unstable fields that frequently disappear.

3. Correlate unknown fallback points
- Locate renderer fallback labels and map each label to required upstream field paths.
- Decide fix layer using this order:
1. Main normalization (preferred)
2. Shared service adapter
3. Renderer fallback handling

4. Refactor types and normalizers
- Replace broad unknown/any on hot paths with explicit interfaces.
- Add small, focused converters from raw payload to normalized domain models.
- Keep preload bridge payloads minimal and stable.

5. Safety gates and checks
- Do not expose privileged Node APIs in renderer.
- Preserve contextIsolation true and nodeIntegration false boundaries.
- Keep renderer orchestrator as composition only.

6. Validate
- Run typecheck.
- Re-run api simulator and compare unknown audit.
- Confirm fallback unknown labels in target scope are reduced or justified.

7. Output summary
- List contract changes by endpoint.
- List eliminated unknown/any usages.
- List residual risks and remaining fallback labels.

## Decision Points

1. Snapshot sufficiency
- If target endpoint data is missing, generate a focused run with explicit ids/keywords.

2. Fix location
- If multiple renderers need the same field, fix in main normalization.
- If field is optional by design, keep renderer fallback but narrow types.

3. Change scope
- If risk is high, ship report-only first and stage refactor in smaller patches.

## Completion Criteria

All are true:
1. Target scope no longer relies on avoidable unknown/any in key mapping paths.
2. Snapshot-backed types exist for touched endpoints.
3. Fallback unknown labels are either removed or explicitly justified.
4. Typecheck passes.
5. New behavior remains aligned with existing IPC and security boundaries.

## Suggested Outputs

- Contract matrix per endpoint: required, optional, fallback source.
- Unknown audit delta: before and after.
- Patch list by layer: main, preload, renderer.

## References

- [tools/netease-api-sim/README.md](tools/netease-api-sim/README.md)
- [src/main/modules/netease/index.ts](src/main/modules/netease/index.ts)
- [src/main/modules/netease/neteaseApi.ts](src/main/modules/netease/neteaseApi.ts)
- [src/preload/preload.ts](src/preload/preload.ts)
- [src/renderer/modules/neteaseSearchManager.ts](src/renderer/modules/neteaseSearchManager.ts)
- [src/renderer/modules/neteasePlaylistDetailManager.ts](src/renderer/modules/neteasePlaylistDetailManager.ts)
- [src/renderer/modules/downloadManager.ts](src/renderer/modules/downloadManager.ts)
- [src/renderer/modules/authWindow.ts](src/renderer/modules/authWindow.ts)
