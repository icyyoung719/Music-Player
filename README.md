# 🎵 Music Player (Electron)

一个基于 Electron 的本地音乐播放器 Demo，当前支持选择本地音频文件并进行播放/暂停控制。

## 项目介绍

本项目是一个桌面端音乐播放器原型，采用主进程 + 预加载脚本 + 渲染进程的结构，重点演示：

- Electron 安全实践（`contextIsolation: true`、`nodeIntegration: false`）
- 通过 preload 暴露受控 API
- 本地音频文件选择与播放

相关文件：

- [src/main/main.js](src/main/main.js)
- [src/preload/preload.js](src/preload/preload.js)
- [src/renderer/index.html](src/renderer/index.html)
- [src/renderer/bootstrap.js](src/renderer/bootstrap.js)
- [src/renderer/renderer.js](src/renderer/renderer.js)
- [src/renderer/partials/](src/renderer/partials)
- [src/renderer/styles/index.css](src/renderer/styles/index.css)

## 当前功能

- 选择本地音频文件（`audio/*`）
- 显示曲目标题、歌手、专辑、封面图片（从 MP3/FLAC 等元数据中解析）
- 播放 / 暂停切换
- 快捷键控制（可自定义并本地记忆）
  - 默认绑定：
    - `Space`：播放 / 暂停
    - `ArrowLeft`：快退 5 秒
    - `ArrowRight`：快进 5 秒
  - 支持单键与组合键（如 `Ctrl+Right`、`Alt+M`）
  - 可在主页面顶部“快捷键”面板中自定义、清空、恢复默认
  - 提供可绑定动作：播放/暂停、快退/快进、上一首/下一首、切换循环、打开主页面/歌曲页、切换主题、打开快捷键面板、最小化窗口、清空当前列表
- 基础 IPC 示例（渲染进程通知主进程播放动作）

## 依赖

主要依赖见 [package.json](package.json)：

- `electron`（开发依赖，用于桌面应用运行）
- `music-metadata`（音频元数据解析，支持 MP3、FLAC、AAC 等格式）

## 快速开始

1. 安装依赖
   - `npm install`
2. 启动项目
   - `npm run start`

## 项目结构（持续演进，不写死）

目录会随着功能拆分持续调整，下面只列“职责边界”和“代表性模块”，而不是固定树形结构。

- 主进程：窗口壳层、托盘、媒体键、IPC 注册
  - 代表模块：`src/main/main.js`、`src/main/modules/playerShell.js`、`src/main/modules/playlistHandlers.js`
- 预加载层：安全桥接（`contextBridge`）
  - 代表模块：`src/preload/preload.js`
- 渲染层：页面编排 + 按职责拆分的功能模块
  - 代表模块：`src/renderer/index.html`、`src/renderer/bootstrap.js`、`src/renderer/renderer.js`、`src/renderer/partials/*.html`、`src/renderer/styles/index.css`、`src/renderer/modules/*.js`
- 静态资源：图标、界面资源等
  - 代表目录：`assets/icons/`

### 模块拆分说明

- `src/main/main.js`
  - 只保留 app 生命周期与模块初始化逻辑，避免继续堆叠业务细节。
- `src/main/modules/playerShell.js`
  - 管理桌面壳层能力：`BrowserWindow`、`Tray`、`setThumbarButtons`、`globalShortcut`。
  - 处理主进程与渲染进程的播放器状态同步（`player:state-changed`）。
- `src/main/modules/playlistHandlers.js`
  - 管理播放列表状态与持久化（`playlists.json`）。
  - 注册歌单、导入导出、元数据解析、文件夹扫描等 IPC。
- `src/renderer/renderer.js`
  - 作为前端交互“编排层”，只负责状态流转与模块装配，不再承载所有细节实现。
- `src/renderer/index.html`
  - 页面壳层入口，仅保留 CSP/meta、挂载点和启动脚本引用。
- `src/renderer/bootstrap.js`
  - 渲染层启动器：先加载 `partials` 页面片段，再动态导入 `renderer.js`，确保 DOM 就绪后再绑定事件。
- `src/renderer/partials/*.html`
  - 页面结构拆分（主页、歌曲页、快捷键面板等），降低单文件维护成本。
- `src/renderer/styles/index.css`
  - 统一承载原内联样式（主题变量、布局、组件、动画、响应式规则）。
- `src/renderer/modules/theme.js`
  - 统一处理主题切换与持久化，避免散落在多个 UI 事件里。
- `src/renderer/modules/trackUtils.js`
  - 沉淀纯工具函数，减少重复实现，提高可测试性。
- `src/renderer/modules/playbackController.js`
  - 负责播放队列、音频生命周期、进度与元数据同步、播放相关 DOM 交互。
- `src/renderer/modules/shortcutManager.js`
  - 管理快捷键配置、面板交互、草稿/确认保存流程与按键分发。
- `src/renderer/modules/savedPlaylistManager.js`
  - 管理“我的歌单”相关 UI、状态同步与导入导出流程。

### 后续可继续拆分建议

- 将 `src/renderer/styles/index.css` 继续拆分为 `base.css`、`home.css`、`song.css`、`components.css`、`responsive.css`。
- `renderer` 侧再拆为：`queueManager`、`savedPlaylistManager`、`audioController`、`viewRenderer`。
- `main` 侧再拆为：`metadataService`、`playlistStore`、`ipc/registerMainHandlers`。
- 为模块补充最小单元测试（工具函数、状态变更函数优先）。

## 前端启动流程（2026-03 更新）

1. `index.html` 加载 `styles/index.css`，提供 `#appRoot` 挂载点。
2. `bootstrap.js` 通过 `fetch` 加载 `partials/*.html` 并注入页面。
3. 注入完成后动态导入 `renderer.js`，再由 `renderer.js` 装配模块和事件。

这样可以避免 `index.html` 过大导致的维护风险，同时保持 `renderer.js` 现有 DOM 绑定逻辑不变。

## TODO

### 已完成 ✅

0. ~~调整项目结构，遵守 Electron 最佳实践，代码不放在根目录~~
1. ~~完整的音频元数据解析与展示（标题/歌手/专辑/封面）~~
2. ~~基础播放列表管理（多首、上一首/下一首、单曲循环）~~
3. ~~进度条与时间显示（含点击跳转）~~
4. **强化“当前播放列表”能力（解耦文件夹）**
   - 目标：允许用户按“文件”逐首添加到当前播放列表，而不仅是按文件夹整体导入。
   - 验收标准：
     - 支持“添加歌曲到当前列表”（多选）
     - 支持从当前列表删除任意歌曲
     - 支持清空当前列表，但不影响已保存歌单
   - 实现建议：
     - 新增 `queue` 数据结构：`[{ id, path, title, artist, duration, coverKey }]`
     - UI 上为列表项增加删除按钮，空状态提示“拖入或添加歌曲”
     - 通过稳定 `id`（建议 `path + mtime` 哈希）避免同名文件冲突


5. **歌单（Playlist）管理与持久化**
   - 目标：引入“用户歌单”概念（区别于当前播放队列），支持长期保存与管理。
   - 验收标准：
     - 可创建/删除/重命名歌单
     - 可向歌单添加或移除歌曲
     - 重启应用后歌单可恢复
     - 支持导出/导入（建议 JSON）
   - 实现建议：
     - 存储层：主进程使用 `app.getPath('userData')` + `playlists.json`
     - IPC 设计：`playlist:list/create/rename/delete/addTracks/removeTrack/import/export`
     - 数据模型：
       - `playlists: [{ id, name, trackIds: [] }]`
       - `trackLibrary: { [trackId]: { path, metadataCache } }`
6. ~~系统托盘 & 媒体键~~
   - 已实现：
     - 托盘菜单：播放/暂停、上一首、下一首、显示主窗口、退出
     - 关闭窗口可最小化到托盘（托盘菜单中可开关）
     - 媒体键控制：`MediaPlayPause`、`MediaPreviousTrack`、`MediaNextTrack`
7. ~~界面美化~~
   - 已实现：
     - 全新视觉主题（渐变背景 + 玻璃质感 + 分层阴影）
     - 页面动效（首屏淡入、卡片错峰出现、封面呼吸光效）
     - 明/暗主题切换（本地持久化）
     - 响应式布局优化（桌面与移动端均可用）
8. ~~快捷键体系~~
   - 已实现：
  - 默认 `Space` 播放/暂停、方向键快进快退（5 秒）
  - 支持组合键自定义（Ctrl/Alt/Shift/Meta）
  - 支持为动作留空（不绑定）与单项清空
  - 主页面快捷键面板查看、修改、恢复默认
  - 提供扩展动作（上一首/下一首/循环/页面切换/最小化等）

### 进行中 / 下一阶段 🚧

<!-- 音频可视化（暂缓） -->

### 可选的后续任务（建议）

- **播放模式扩展**：列表循环、随机播放、随机不重复（一轮内不重复）
- **元数据缓存**：减少重复解析，提高大列表切歌速度
- **异常与降级体验**：损坏文件/无权限文件的可见错误提示与跳过策略
- **打包与发布**：补充 `electron-builder` 配置、图标、版本号策略与自动更新预留
- **歌曲获取途径扩展**：除了本地文件，还可以考虑网络资源（在github上找音乐下载链接，方便下载到本地）
- **网易云歌单、单曲id下载**：通过网易云 API 获取歌单/单曲信息，提供下载链接（仅限学习用途，注意版权问题）

## 说明

当前版本为基础可运行版本，后续可围绕 TODO 逐步演进为完整播放器。

## 网易云接入
**参考**：
https://github.com/TartaricAcid/NetMusic   这是MC的一个网易云播放器mod，可以参考其API如何调用网易云的接口获取歌曲信息和下载链接等
https://github.com/FengLiuFeseliud/CloudMusic-Mod  另一个API参考，包含登录API等

先尝试，如果遇到了权限问题，则考虑是否还需要接入网易云的登陆API等（先不主动考虑，先看看能不能直接获取到公开的歌曲信息和下载链接）

后续会做登录逻辑，由授权账号下载，所以不存在权限问题

参考这个仓库，添加播放器接入网易云
1. 搜索栏： 支持搜索歌曲id ，歌单id
2. 能够获取到指定歌曲，并提供下载保存到本地的功能（默认下载到 %USERPROFILE%\Music\MyPlayerDownloads 目录下）
3. ...

TODO:
1. [已修复] 下载后可获取并展示歌名、歌手、专辑、封面；mp3 下载文件会自动写入 ID3 标签，第三方播放器可直接识别
2. 单曲下载、歌单等
3. [已完成] 登录前端完善
4. 账号管理
5. 下载管理（下载队列，下载状态，失败重试等）
6. 日推、收藏、网易云歌单 获取   （即将用户的歌单、收藏、日推等内容同步到播放器中，提供更便捷的访问和管理）
7. 下载前检测避免重复下载。尤其是 按 ID 下载 和 下载并加入当前列表 两种方式可能会有重复下载的风险，需要在下载前进行检测，避免重复下载同一首歌曲。本地下载的到`%USERPROFILE%\Music\MyPlayerDownloads`下，那么用户直接加入播放列表的，可以先存放在一个另一个目录下，如``%USERPROFILE%\Music\MyPlayerDownloads\Temp``，等到用户确认加入播放列表后再移动到正式目录下，这样可以避免直接下载到正式目录下导致的重复下载问题。这样，每次下载前，都先检测这两个目录下是否已经存在同名文件，如果存在，则提示用户是否覆盖、重命名或跳过下载（当前直接默认全跳过就OK）。注意可能需要的移动、复制操作
8. 歌词信息获取、写入 ID3 标签等 （如果网易云API提供了歌词信息，可以在下载时一并获取并写入 ID3 标签，第三方播放器也能直接显示歌词）