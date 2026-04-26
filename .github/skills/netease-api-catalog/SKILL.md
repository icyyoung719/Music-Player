---
name: netease-api-catalog
description: '梳理并查询本仓库可用的网易云 API。用于查看有哪些 API 可用、每个接口的参数与返回字段、是否需要登录、以及在本项目中如何接入。Use for Netease API discovery, endpoint lookup, parameter/response mapping, and implementation guidance.'
argument-hint: '输入功能意图或关键词，例如: 搜索歌曲, 获取歌单详情, 签到, 推荐, 下载相关接口'
user-invocable: true
---

# Netease API Catalog

## Purpose

This skill helps the agent quickly answer:
- Which Netease APIs are available in this repository
- What each API endpoint does
- Required and optional request parameters
- Key response fields and common caveats
- How to map an endpoint into this Electron project

Primary API reference source:
- `ref/netease-cloud-music-api-binaryify/`

## When To Use

Use this skill when you need to:
- Find available endpoints for a feature idea
- Compare similar endpoints (for example `search` vs `cloudsearch`)
- Confirm parameter names, defaults, or auth requirements
- Extract a compact endpoint list by domain (account, playlist, song, lyric, recommend)
- Decide where to connect an API in main, preload, and renderer layers

## Inputs

Provide one of the following:
- A feature intent: "我想做每日推荐"
- An endpoint keyword: "top_list", "lyric", "playlist/detail"
- A domain scope: "登录与账号", "歌单", "搜索", "下载前置查询"

Optional constraints:
- Need auth-only endpoints or public endpoints only
- Need stable endpoints with lower break risk
- Need result in short list or full table

## Procedure

1. Understand the target
- Normalize user intent into one of: account/auth, search, track, playlist, artist, album, recommend, social/comment, utility.

2. Locate candidate endpoints
- First check upstream docs and examples under:
  - `ref/netease-cloud-music-api-binaryify/README.MD`
  - `ref/netease-cloud-music-api-binaryify/docs/`
  - `ref/netease-cloud-music-api-binaryify/module/`
- Match endpoint intent to module filename (for example `lyric.js`, `playlist_detail.js`, `cloudsearch.js`).

3. Extract contract details
- For each candidate endpoint, collect:
  - Endpoint path
  - HTTP method and required params
  - Optional params and defaults
  - Auth/cookie requirement
  - Core response fields used by UI
  - Error codes or common failure patterns (if documented)

4. Prioritize for project usage
- Prefer endpoints already aligned with this project's existing usage pattern.
- If multiple endpoints can satisfy the same need, rank by:
  - Simpler params
  - More stable response shape
  - Better fit to current renderer data model

5. Return a developer-ready summary
- Output as a concise table with columns:
  - useCase, endpoint, method, requiredParams, optionalParams, authRequired, keyFields, notes
- Include 1 to 3 "recommended first choice" endpoints.

6. Integration guidance for this repo
- If user asks implementation next, propose wiring path:
  - main handler location under `src/main/modules/`
  - preload bridge addition in `src/preload/preload.ts`
  - renderer caller module under `src/renderer/modules/`
- Keep Electron security boundary intact (`contextIsolation: true`, `nodeIntegration: false`).

## Output Modes

- Quick mode:
  - Return top 3 to 5 endpoints for the intent, with short notes.
- Full mode:
  - Return full endpoint matrix and explicit param mapping.
- Integration mode:
  - Return endpoint choice plus minimal IPC integration plan for this codebase.

## Quality Checklist

Before final answer, verify:
- Endpoint names/paths are consistent with reference files
- Required params are explicitly listed
- Auth requirement is clearly labeled
- Response field examples are tied to actual docs/module behavior
- Recommendation explains why it is preferred

## Completion Criteria

This skill is complete when the output lets a developer:
- Pick an endpoint confidently
- Build request payload correctly
- Understand auth preconditions
- Start integration in this Electron project without re-reading all upstream docs
