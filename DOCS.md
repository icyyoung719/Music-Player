- [Music Player DOCS](#music-player-docs)
	- [1. 当前功能总览](#1-当前功能总览)
		- [1.1 本地播放能力](#11-本地播放能力)
		- [1.2 快捷键与界面交互](#12-快捷键与界面交互)
		- [1.3 本地歌单能力](#13-本地歌单能力)
		- [1.4 网易云账号与鉴权](#14-网易云账号与鉴权)
		- [1.5 网易云下载与任务系统](#15-网易云下载与任务系统)
		- [1.6 每日推荐](#16-每日推荐)
		- [1.7 桌面壳层能力](#17-桌面壳层能力)
	- [2. 主体架构](#2-主体架构)
		- [2.1 分层与职责](#21-分层与职责)
		- [2.2 启动流程](#22-启动流程)
		- [2.3 模块组织策略](#23-模块组织策略)
	- [3. 关键实现机制](#3-关键实现机制)
		- [3.1 IPC 设计约束](#31-ipc-设计约束)
		- [3.2 网易云鉴权与会话维持](#32-网易云鉴权与会话维持)
		- [3.3 下载队列与并发执行](#33-下载队列与并发执行)
		- [3.4 懒下载播放（Lazy NetEase Queue）](#34-懒下载播放lazy-netease-queue)
		- [3.5 元数据、歌词、封面写入](#35-元数据歌词封面写入)
		- [3.6 歌单 schema 兼容迁移](#36-歌单-schema-兼容迁移)
	- [4. 数据与存储](#4-数据与存储)
	- [5. UI 结构与页面装配](#5-ui-结构与页面装配)
	- [6. 维护约定（以后改功能时必须同步）](#6-维护约定以后改功能时必须同步)
	- [7. 当前已知边界与风险（维护者视角）](#7-当前已知边界与风险维护者视角)



# Music Player DOCS

本文档是项目当前状态的工程文档，目标是回答三类问题：

1. 播放器现在到底能做什么。
2. 关键能力由哪些模块实现，跨进程如何串起来。
3. 后续改功能时，哪些地方必须同步改，避免回归。

## 1. 当前功能总览

### 1.1 本地播放能力

- 本地文件添加与播放（单文件、文件夹导入）。
- 当前播放列表管理：追加、删除单项、清空、切歌。
- 播放控制：播放/暂停、上一首、下一首、单曲循环、进度条拖拽与快退/快进。
- 歌词显示：支持 LRC 解析、随播放时间滚动、高亮当前行。
- 封面/元数据展示：标题、歌手、专辑、封面图。

核心实现位置：

- [src/renderer/modules/playbackController.js](src/renderer/modules/playbackController.js)
- [src/renderer/modules/lyricManager.js](src/renderer/modules/lyricManager.js)

### 1.2 快捷键与界面交互

- 可配置快捷键，支持单键与组合键。
- 可绑定动作包括播放控制、页面切换、主题切换、最小化、清空列表等。
- 快捷键配置保存在本地存储，重启后可恢复。

核心实现位置：

- [src/renderer/modules/shortcutManager.js](src/renderer/modules/shortcutManager.js)
- [src/renderer/renderer.js](src/renderer/renderer.js)

### 1.3 本地歌单能力

- 本地歌单创建、重命名、删除。
- 歌单内歌曲增删，支持“播放全部/追加到当前播放列表/收纳当前队列”。
- 支持导入/导出。
- 存储结构已升级到 schemaVersion 2，保留本地能力同时兼容网易云字段语义。

核心实现位置：

- [src/main/modules/playlistHandlers.js](src/main/modules/playlistHandlers.js)
- [src/renderer/modules/savedPlaylistManager.js](src/renderer/modules/savedPlaylistManager.js)

### 1.4 网易云账号与鉴权

- 支持邮箱登录。
- 支持手机号 + 短信验证码登录。
- 支持二维码登录（生成、轮询状态、授权确认）。
- 支持手动维护 token/cookie 并执行登录态校验。
- 登录在独立授权窗口进行，不阻塞主界面操作。

核心实现位置：

- [src/main/modules/netease/index.js](src/main/modules/netease/index.js)
- [src/main/modules/netease/authManager.js](src/main/modules/netease/authManager.js)
- [src/main/modules/playerShell.js](src/main/modules/playerShell.js)
- [src/renderer/modules/authWindow.js](src/renderer/modules/authWindow.js)

### 1.5 网易云下载与任务系统

- 单曲 ID 查询后下载。
- 歌单 ID 解析后批量创建下载任务。
- 支持三类下载目的：Songs、Temp、Lists/<歌单名>。
- 下载任务状态机：pending/downloading/succeeded/failed/skipped/canceled。
- 任务支持取消、状态过滤、跨页面 Toast 通知。
- 去重策略支持“目标文件已存在即跳过”。
- 下载成功后写入歌词与 ID3 信息，并缓存歌曲元数据索引。

核心实现位置：

- [src/main/modules/netease/downloadManager.js](src/main/modules/netease/downloadManager.js)
- [src/main/modules/netease/trackMetadata.js](src/main/modules/netease/trackMetadata.js)
- [src/renderer/modules/downloadManager.js](src/renderer/modules/downloadManager.js)

### 1.6 每日推荐

- 登录后可拉取当日推荐歌曲。
- 可通过“懒加载队列”立即开播：先入队，再按需触发后台下载。
- 支持将日推歌曲批量加入当前播放队列。

核心实现位置：

- [src/main/modules/netease/index.js](src/main/modules/netease/index.js)
- [src/renderer/modules/dailyRecommendationManager.js](src/renderer/modules/dailyRecommendationManager.js)
- [src/renderer/modules/playbackController.js](src/renderer/modules/playbackController.js)

### 1.7 桌面壳层能力

- 托盘菜单（播放控制、显示窗口、退出、关闭行为偏好）。
- Windows thumbar 按钮（上一首/播放暂停/下一首）。
- 系统媒体键注册（MediaPlayPause/Next/Previous）。
- 窗口最小化能力、关闭最小化到托盘偏好持久化。

核心实现位置：

- [src/main/modules/playerShell.js](src/main/modules/playerShell.js)

## 2. 主体架构

### 2.1 分层与职责

- Main 进程: 生命周期、系统壳层、IPC 注册、持久化与外部网络访问。
- Preload 层: 通过 contextBridge 暴露受控 API，不向 renderer 暴露 Node 原生能力。
- Renderer 层: UI、状态编排、交互逻辑，调用 preload API 完成功能。

入口文件：

- [src/main/main.js](src/main/main.js)
- [src/preload/preload.js](src/preload/preload.js)
- [src/renderer/bootstrap.js](src/renderer/bootstrap.js)
- [src/renderer/renderer.js](src/renderer/renderer.js)

### 2.2 启动流程

1. main 进程初始化 logger、playlist handlers、netease handlers。
2. app ready 后初始化播放列表状态，创建主窗口，初始化托盘/快捷键壳层。
3. renderer 通过 bootstrap 加载 partials，再导入 renderer orchestrator。
4. renderer 初始化各业务模块（播放、歌单、下载、账号、日推、快捷键、toast）。

参考：

- [src/main/main.js](src/main/main.js)
- [src/renderer/bootstrap.js](src/renderer/bootstrap.js)

### 2.3 模块组织策略

- renderer.js 作为编排层，只做模块装配与模块间桥接。
- 细节逻辑按职责拆分在 src/renderer/modules。
- main 侧按能力拆模块: playerShell、playlistHandlers、netease 子模块。

## 3. 关键实现机制

### 3.1 IPC 设计约束

本项目默认遵循安全边界：

- contextIsolation: true
- nodeIntegration: false

跨进程新增能力必须三层同步：

1. main: ipcMain.handle/on。
2. preload: 暴露最小能力接口。
3. renderer: 调用桥接 API。

当前桥接 API 总入口：

- [src/preload/preload.js](src/preload/preload.js)

### 3.2 网易云鉴权与会话维持

当前鉴权核心点：

- 统一 authState 持久化在 userData 下，重启可恢复登录状态基础信息。
- 通过 postFormWithFallback 对多个路径做降级尝试，增强兼容性。
- 短信验证码流程依赖 cookie 延续：发送验证码后的 Set-Cookie 必须保留用于登录请求。
- 二维码登录轮询支持状态切换与异常重试策略。

关键代码：

- [src/main/modules/netease/authManager.js](src/main/modules/netease/authManager.js)
- [src/main/modules/netease/index.js](src/main/modules/netease/index.js)

### 3.3 下载队列与并发执行

下载引擎是内存任务队列 + 并发消费模型：

- 最大并发固定为 2。
- 任务从 pending -> downloading -> succeeded/failed/canceled/skipped。
- 下载进度通过事件广播给所有窗口。
- 任务支持中途取消（销毁 request/stream）。
- 去重策略在创建任务前判断目标路径是否存在。

关键代码：

- [src/main/modules/netease/downloadManager.js](src/main/modules/netease/downloadManager.js)

### 3.4 懒下载播放（Lazy NetEase Queue）

这是当前播放器和普通“先下载后播放”不同的关键实现：

- 队列项可先以 lazyNetease 形态入队（无本地文件）。
- 真正播放该项时再触发下载任务并等待可播放文件。
- 可预取下一首，减少切歌等待。
- 下载事件回流后把任务结果回填到队列项 path，转为常规本地播放轨道。

关键代码：

- [src/renderer/modules/playbackController.js](src/renderer/modules/playbackController.js)

### 3.5 元数据、歌词、封面写入

下载成功后会补全本地资产：

- 拉取歌词并写入歌曲元数据记录。
- 拉取封面并缓存到本地 cover 目录。
- 对 mp3 写入 ID3 标签，提升第三方播放器可识别度。
- 将 songId/title/artist/album/coverPath 等持久化到 netease-track-metadata 索引。

关键代码：

- [src/main/modules/netease/trackMetadata.js](src/main/modules/netease/trackMetadata.js)
- [src/main/modules/netease/id3Writer.js](src/main/modules/netease/id3Writer.js)

### 3.6 歌单 schema 兼容迁移

playlistHandlers 负责：

- 启动时读取 playlists.json。
- 自动修正状态形状，迁移历史版本到 schemaVersion 2。
- 清理未被任何歌单引用的 trackLibrary 项。

关键代码：

- [src/main/modules/playlistHandlers.js](src/main/modules/playlistHandlers.js)

## 4. 数据与存储

所有持久化默认位于 Electron userData 目录。

主要数据文件：

- playlists.json: 本地歌单与 trackLibrary。
- netease-auth.json: 网易云鉴权状态。
- netease-track-metadata.json: 下载歌曲扩展元数据索引。
- shell-preferences.json: 壳层偏好（如关闭最小化到托盘）。

主要目录：

- 下载根目录默认: %USERPROFILE%/Music/MyPlayerDownloads。
- Songs: 常规单曲下载。
- Temp: 仅用于“加入播放列表”的缓存歌曲。
- Lists/<歌单名>: 按歌单组织下载结果。
- netease-track-covers: 歌曲封面缓存。

日志文件：

- 程序日志和网络日志写入 userData/logs。
- 网络日志支持二进制响应摘要，避免日志污染。

参考：

- [src/main/modules/logger.js](src/main/modules/logger.js)

## 5. UI 结构与页面装配

- index.html 只保留壳层挂载点和基础引用。
- bootstrap.js 负责按 partial 切分加载页面骨架。
- renderer.js 统一装配功能模块并连接模块回调。
- auth-window.html 作为独立登录窗口，使用独立样式与模块脚本。

关键文件：

- [src/renderer/index.html](src/renderer/index.html)
- [src/renderer/bootstrap.js](src/renderer/bootstrap.js)
- [src/renderer/partials/home-page.html](src/renderer/partials/home-page.html)
- [src/renderer/partials/song-page.html](src/renderer/partials/song-page.html)
- [src/renderer/auth-window.html](src/renderer/auth-window.html)

## 6. 维护约定（以后改功能时必须同步）

本文件是“当前实现真相文档”，后续提交涉及以下变化时必须更新：

- 功能新增、下线、交互变化。
- 关键实现改造（登录流、下载流、播放流、队列策略）。
- 架构调整（模块拆分、跨进程边界、数据结构升级）。
- 持久化字段/目录/协议变化。

最低更新要求：

1. 更新“功能总览”对应条目。
2. 更新“关键实现机制”中受影响章节。
3. 若有数据结构变化，更新“数据与存储”。
4. 仅添加必要代码引用，避免把本文变成逐行注释。

## 7. 当前已知边界与风险（维护者视角）

- 网易云相关接口存在风控与路径兼容差异，登录/鉴权属于高回归区。
- 下载任务状态目前以进程内内存为核心，不是跨重启恢复型任务系统。
- 日推目前为 MVP，核心能力是拉取与懒入队，不等同于完整云歌单同步。
- 渲染层模块较多，新增跨模块动作时要注意 renderer orchestrator 回调链路。

---

建议把本文件作为每次中大型改动的必改项，和 README、CHANGELOG 一起维护，但三者职责保持分离。