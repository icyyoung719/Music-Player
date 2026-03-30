- [Music Player DOCS](#music-player-docs)
	- [1. 功能核心](#1-功能核心)
		- [1.1 本地播放](#11-本地播放)
		- [1.2 快捷键与设置](#12-快捷键与设置)
		- [1.3 本地歌单](#13-本地歌单)
		- [1.4 网易云鉴权与下载](#14-网易云鉴权与下载)
		- [1.5 每日推荐](#15-每日推荐)
		- [1.6 桌面壳层](#16-桌面壳层)
		- [1.7 日志可视化工具](#17-日志可视化工具)
	- [2. 架构与分层](#2-架构与分层)
		- [2.1 分层职责](#21-分层职责)
		- [2.2 启动流程](#22-启动流程)
		- [2.3 模块组织策略](#23-模块组织策略)
	- [3. 关键实现机制](#3-关键实现机制)
		- [3.1 IPC 约束](#31-ipc-约束)
		- [3.2 网易云鉴权会话](#32-网易云鉴权会话)
		- [3.3 下载队列并发](#33-下载队列并发)
		- [3.4 懒下载播放队列](#34-懒下载播放队列)
		- [3.5 元数据与封面处理](#35-元数据与封面处理)
		- [3.6 歌单 schema 迁移](#36-歌单-schema-迁移)
	- [4. 数据与存储](#4-数据与存储)
	- [5. UI 结构与装配](#5-ui-结构与装配)

# Music Player DOCS

本文档用于说明播放器的稳定能力、架构分层、关键实现机制与维护边界。

## 1. 功能核心

### 1.1 本地播放

- 本地文件/文件夹导入、拖放导入
- 当前播放队列管理（追加、删除、清空、切歌）
- 播放控制（播放/暂停、上一首、下一首、单曲循环、进度拖拽）
- 淡入淡出控制（切歌、暂停、恢复）
- 歌词显示（LRC 解析、滚动、高亮）
- 封面与元数据展示（标题、歌手、专辑）

核心模块：

- `src/renderer/modules/playbackController.js`
- `src/renderer/modules/playbackUIController.js`
- `src/renderer/modules/playbackFadeManager.js`
- `src/renderer/modules/lazyQueueManager.js`
- `src/renderer/modules/lyricManager.js`

### 1.2 快捷键与设置

- 快捷键支持单键与组合键
- 可绑定播放控制、页面切换、主题切换、最小化、清空列表等动作
- 快捷键配置本地持久化
- 设置页统一承载播放参数与快捷键参数

核心模块：

- `src/renderer/modules/shortcutManager.js`
- `src/renderer/renderer.js`

### 1.3 本地歌单

- 歌单创建、重命名、删除
- 歌单内歌曲增删
- 歌单导入/导出
- 歌单播放与队列收纳
- `schemaVersion: 2` 数据结构兼容迁移

核心模块：

- `src/main/modules/playlistHandlers.js`
- `src/renderer/modules/savedPlaylistManager.js`

### 1.4 网易云鉴权与下载

- 登录方式：邮箱、手机验证码、二维码
- 登录在独立授权窗口进行
- 下载支持单曲/歌单任务创建、取消、状态筛选
- 下载目录支持 Songs、Temp、Lists/<歌单名>
- 下载后补全标签、歌词与封面元数据

核心模块：

- `src/main/modules/netease/index.js`
- `src/main/modules/netease/authManager.js`
- `src/main/modules/netease/downloadManager.js`
- `src/main/modules/netease/trackMetadata.js`
- `src/renderer/modules/downloadManager.js`
- `src/renderer/modules/authWindow.js`

### 1.5 每日推荐

- 登录后拉取推荐歌曲
- 可加入当前播放队列
- 支持懒下载播放队列模式

核心模块：

- `src/main/modules/netease/index.js`
- `src/renderer/modules/dailyRecommendationManager.js`
- `src/renderer/modules/playbackController.js`

### 1.6 桌面壳层

- 托盘菜单
- Windows thumbar 按钮
- 系统媒体键
- 关闭最小化到托盘偏好持久化

核心模块：

- `src/main/modules/playerShell.js`

### 1.7 日志可视化工具

- 独立 Node HTTP 服务 + 本地静态页面
- 读取 `program.log` 与 `network.log`
- 过滤维度：关键词、method、status
- 支持日志详情查看

核心位置：

- `tools/log-visualizer/`

## 2. 架构与分层

### 2.1 分层职责

- Main 进程
  - 应用生命周期、系统壳层、IPC 注册、持久化与外部网络访问
- Preload 层
  - 通过 `contextBridge` 暴露最小能力接口
- Renderer 层
  - UI、状态编排、交互逻辑

入口：

- `src/main/main.js`
- `src/preload/preload.js`
- `src/renderer/bootstrap.js`
- `src/renderer/renderer.js`

### 2.2 启动流程

1. Main 初始化日志、播放列表处理器与网易云处理器。
2. 应用就绪后创建主窗口并初始化托盘/媒体键壳层。
3. Renderer 通过 `bootstrap.js` 装配 partials。
4. `renderer.js` 初始化业务模块，通过事件总线连接跨模块交互，并注入共享服务。

### 2.3 模块组织策略

- `renderer.js` 保持编排层职责。
- 功能细节放在 `src/renderer/modules/*.js`。
- 跨模块通信与共享状态访问放在 `src/renderer/core/*.js`。
- main 侧按能力拆分到 `src/main/modules/*`。

渲染层核心模块：

- `src/renderer/core/eventBus.js`：发布/订阅与 request/handle 模式
- `src/renderer/core/viewManager.js`：页面与子视图切换、封面区域同步
- `src/renderer/core/neteaseDatabaseService.js`：网易云查询/搜索/建议/日推数据访问
- `src/renderer/core/downloadService.js`：下载任务状态汇聚与任务操作封装

## 3. 关键实现机制

### 3.1 IPC 约束

跨进程能力必须同步三层：

1. main：`ipcMain.handle/on`
2. preload：受控桥接 API
3. renderer：桥接 API 调用方

安全默认值：

- `contextIsolation: true`
- `nodeIntegration: false`

### 3.2 网易云鉴权会话

- 鉴权状态持久化在 userData
- `postFormWithFallback` 用于接口兼容降级
- 手机验证码流程依赖发送验证码后的 cookie 延续
- 二维码登录通过轮询状态完成授权确认

### 3.3 下载队列并发

- 内存任务队列 + 并发消费
- 最大并发数：2
- 任务状态：pending/downloading/succeeded/failed/skipped/canceled
- 支持取消与跨窗口进度广播
- 创建任务前执行目标路径去重检查

### 3.4 懒下载播放队列

- 队列项允许以 lazyNetease 形态入队
- 播放命中时触发下载并等待可播放文件
- 可预取下一首降低切歌等待
- 下载结果回填队列项 `path`

### 3.5 元数据与封面处理

- 拉取并写入歌词、封面缓存
- MP3 写入 ID3
- FLAC 写入 Vorbis Comment 与 PICTURE
- 维护 `netease-track-metadata` 索引

### 3.6 歌单 schema 迁移

- 启动读取 `playlists.json`
- 自动修正历史数据形状并迁移到 schema v2
- 清理未被歌单引用的 trackLibrary 项

### 3.7 渲染层事件与服务边界

- 业务模块之间优先通过 event bus 通信，避免直接回调耦合
- 下载任务状态由 `downloadService` 汇聚，模块通过订阅获取更新
- 网易云只读数据访问优先经过 `neteaseDatabaseService`
- `renderer.js` 负责装配，不承载具体业务细节

## 4. 数据与存储

所有持久化数据默认位于 Electron userData 目录。

主要文件：

- `playlists.json`
- `netease-auth.json`
- `netease-track-metadata.json`
- `shell-preferences.json`

下载目录默认：`%USERPROFILE%\\Music\\MyPlayerDownloads`

- `Songs/`
- `Temp/`
- `Lists/<歌单名>/`
- `netease-track-covers/`

日志目录：`userData/logs`

- `program.log`
- `network.log`

## 5. UI 结构与装配

- `src/renderer/index.html` 只保留壳层与挂载点
- `src/renderer/bootstrap.js` 负责 partial 装配
- `src/renderer/renderer.js` 负责模块编排与连接
- `src/renderer/auth-window.html` 作为独立授权窗口

相关文件：

- `src/renderer/index.html`
- `src/renderer/bootstrap.js`
- `src/renderer/renderer.js`
- `src/renderer/partials/home-page.html`
- `src/renderer/partials/song-page.html`
- `src/renderer/auth-window.html`
