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
- 播放淡入淡出（切歌、暂停、恢复播放均支持渐变）
- 快捷键控制（可自定义并本地记忆）
  - 默认绑定：
    - `Space`：播放 / 暂停
    - `ArrowLeft`：快退 5 秒
    - `ArrowRight`：快进 5 秒
  - 支持单键与组合键（如 `Ctrl+Right`、`Alt+M`）
  - 可在主页面顶部“设置”面板中的“快捷键”子页自定义、清空、恢复默认
  - 提供可绑定动作：播放/暂停、快退/快进、上一首/下一首、切换循环、打开主页面/歌曲页、切换主题、打开设置页面、最小化窗口、清空当前列表
- 设置页面（主页面顶部“设置”按钮）
  - 播放子页：设置“淡入时长 / 淡出时长”（ms）
  - 快捷键子页：统一管理快捷键绑定
- 下载管理页面（主页左侧“下载管理”）
  - 支持单曲 ID 查询后确认下载
  - 支持歌单 ID 查询后批量下载
  - 单曲 / 歌单查询会展示更完整的信息，如歌曲名、歌手、专辑、封面、歌单简介与曲目预览，便于下载前确认
  - 单曲支持三种动作：下载、仅添加到播放列表（Temp 缓存）、下载并添加到播放列表
  - 歌单支持三种动作：下载到 Lists、下载并添加到播放列表、下载并添加到本地歌单（自动新建同名）
  - 歌单下载会按全量曲目创建任务，不再只处理前几首预览数据
  - 下载队列支持状态展示、筛选与取消
  - 下载完成/失败支持跨页面堆叠 Toast 提醒
- 下载目录组织（默认在 `%USERPROFILE%\\Music\\MyPlayerDownloads`）
  - `Songs/`：单曲正式下载
  - `Temp/`：仅“添加到播放列表”的缓存歌曲
  - `Lists/<歌单名>/`：按歌单下载的文件
  - 提供打开目录与清理 Temp 缓存功能
- 独立本地歌单页面（主页左侧“创建的歌单”）
  - 左侧会根据持久化歌单真实渲染歌单名称与曲目数
  - 点击歌单可进入独立详情页，查看曲目列表并直接播放指定歌曲
  - 详情页支持播放全部、追加到当前播放列表、收纳当前播放列表、重命名、删除、移除单曲
- 每日推荐（日推）MVP（主页首个 Hero 卡片）
  - 登录网易云后可拉取今日推荐歌曲并展示封面与状态
  - 支持“播放首曲”（使用 Temp 缓存下载后自动播放）
  - 支持“一键加入当前播放列表”（批量创建 Temp 下载任务并在完成后追加）
- 本地歌单持久化结构中度对齐
  - `playlists.json` 升级到 `schemaVersion: 2`
  - 在保留 `id/name/trackIds` 的同时，增加可选字段：`source/platform/platformPlaylistId/creator/coverUrl/updateTime/description/tags`
  - 启动时自动兼容迁移旧版本数据
- 基础 IPC 示例（渲染进程通知主进程播放动作）
- 独立日志可视化工具（program.log / network.log）
  - 运行 `npm run logviz` 启动本地页面
  - 支持关键词过滤、network 的 method/status 过滤、错误高亮与详情查看

## 依赖

主要依赖见 [package.json](package.json)：

- `electron`（开发依赖，用于桌面应用运行）
- `music-metadata`（音频元数据解析，支持 MP3、FLAC、AAC 等格式）

## 快速开始

1. 安装依赖
   - `npm install`
2. 启动项目
   - `npm run start`

## 日志系统（主进程）

为了便于排查网易云接口通信与程序关键行为，主进程已接入文件日志（不依赖终端输出）。

- 日志目录：`app.getPath('userData')/logs`
- 文件命名：固定文件
  - `program.log`：程序日志
  - `network.log`：网络日志
- 日志格式：每行一条 JSON（JSON Lines）

### 日志可视化工具（独立）

- 启动命令：`npm run logviz`
- 启动后会自动打开本地页面（默认 `http://127.0.0.1:47831`）
- 数据来源：默认读取 `app.getPath('userData')/logs` 下的 `program.log` 与 `network.log`

### 网络日志内容

网络日志会记录每次请求与响应，包含：

- 请求：URL、Method、Headers、Body
- 响应：状态码、Headers、Body
- 耗时：`durationMs`
- 异常：错误名、错误消息、堆栈

### 二进制响应记录策略

二进制响应不会直接写入日志正文，而是写摘要信息：

- 响应体字节长度（`bytes`）
- MIME 类型（`mimeType`）
- 前 64 字节十六进制摘要（`hexPreview`）

这样可以在不污染日志文件的情况下快速定位音频、图片等二进制请求问题。

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
  - 页面结构拆分（主页、歌曲页、设置面板等），降低单文件维护成本。
- `src/renderer/styles/index.css`
  - 统一承载原内联样式（主题变量、布局、组件、动画、响应式规则）。
- `src/renderer/modules/theme.js`
  - 统一处理主题切换与持久化，避免散落在多个 UI 事件里。
- `src/renderer/modules/trackUtils.js`
  - 沉淀纯工具函数，减少重复实现，提高可测试性。
- `src/renderer/modules/playbackController.js`
  - 负责播放队列、音频生命周期、进度与元数据同步、播放相关 DOM 交互。
- `src/renderer/modules/shortcutManager.js`
  - 管理快捷键配置、编辑草稿/确认保存流程与按键分发（作为设置页子模块）。
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

## 路线图 / TODO（2026-03）

### 当前优先
0. **修复登录问题**
  - 目标：手机登录功能正常。

1. **修复“下载并加入播放列表”场景下偶发显示歌曲 ID 的问题**
  - 目标：下载完成后优先展示真实歌曲名/歌手/专辑，而不是 ID。
  - 验收：加入列表后的条目标题与元数据一致，刷新页面后仍正确。
2. **本地歌单数据结构与网易云歌单结构对齐**
  - 目标：为后续歌单同步能力做准备，尽量保持字段含义一致。
  - 验收：本地持久化结构可映射网易云歌单核心字段，并有兼容迁移策略。（已完成中度对齐）
3. **补齐“日推 / 收藏 / 云端歌单”拉取与展示**
  - 目标：将用户常用云端内容同步到播放器内，减少来回切换。
  - 验收：可拉取、可展示、可一键加入下载队列或当前播放列表。（当前已完成“日推歌曲”MVP）

### 未来

1. **播放模式扩展**：列表循环、随机播放、随机不重复（一轮内不重复）。
2. **元数据缓存优化**：减少重复解析，提升大列表切歌速度。
3. **异常与降级体验**：损坏文件/无权限文件的可见提示与跳过策略。
4. **打包与发布**：补充 `electron-builder` 配置、图标、版本号策略与自动更新预留。
5. **歌曲搜索等功能**：完善搜索功能，要能真正根据关键词找到对应歌曲，而不是仅支持 ID 搜索。

### 更遥远的未来

1. **双向API**：允许播放器本地操作（添加/删除歌曲、创建歌单等）同步到服务端。
2. **更多播放器支持**：除了网易云，还可以接入其他音乐播放器的API。

### 已完成（摘要）

- 项目结构完成主进程 / preload / 渲染进程分层，入口迁移到 `src/`。
- 本地音频播放能力完善：播放/暂停、上一首/下一首、循环、进度跳转。
- 元数据解析完善：标题、歌手、专辑、封面展示。
- 当前播放列表作为弹层管理，支持逐首添加、删除、清空、收藏，并支持在歌曲页拖放文件/文件夹快速追加。
- 本地歌单支持创建、重命名、删除、导入导出、持久化。
- 系统托盘与媒体键控制已接入。
- 主题与动效、响应式布局、快捷键自定义已完成。
- 下载能力完善：单曲/歌单查询、下载队列、失败重试、去重检测、Temp 缓存策略。
- 歌词获取与嵌入标签写入已支持（MP3: ID3；FLAC: Vorbis Comment + PICTURE），下载文件可被第三方播放器识别。
- 歌单下载全量化问题已修复（不再只下载前几首）。

## 说明

当前版本为基础可运行版本，后续可围绕 TODO 逐步演进为完整播放器。

## 网易云接入
API 参考：`ref\netease-cloud-music-api-binaryify\module`，下有各种可用接口。

**参考**：
https://github.com/TartaricAcid/NetMusic   这是MC的一个网易云播放器mod，可以参考其API如何调用网易云的接口获取歌曲信息和下载链接等
https://github.com/FengLiuFeseliud/CloudMusic-Mod  另一个API参考，包含登录API等
https://github.com/Kathy2233/netease-cloud-music-api-binaryify 又一个API参考，非常详细，位于`PROJECT_ROOT\ref\netease-cloud-music-api-binaryify`

当前策略：先覆盖公开能力（歌曲/歌单查询与下载），若遇权限限制再补齐登录态接口。

已具备：
1. 搜索栏支持按歌曲 ID、歌单 ID 查询。
2. 支持单曲下载、歌单下载与下载队列管理。
3. 支持下载前去重检测与 Temp 缓存目录策略（默认 `%USERPROFILE%\Music\MyPlayerDownloads`）。
4. 支持歌词与嵌入标签写入（MP3: ID3；FLAC: Vorbis Comment + PICTURE），下载后可直接在第三方播放器识别。

后续重点：以“路线图 / TODO（2026-03）”章节为唯一任务来源，避免重复维护多套清单。