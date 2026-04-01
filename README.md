# Music Player (Electron)

基于 Electron 的桌面音乐播放器，提供本地播放、歌单管理、网易云登录与下载、桌面壳层控制与日志排查能力。

## 功能核心

- 本地播放
  - 文件/文件夹导入与播放
  - 播放队列管理（追加、移除、清空、切歌）
  - 播放控制（播放/暂停、上一首、下一首、单曲循环、进度拖拽）
  - 最近播放（本地历史记录、快速重播、加入当前队列）
  - 歌词滚动与高亮、封面与元数据显示
- 快捷键与设置
  - 支持单键与组合键绑定
  - 支持播放控制、页面切换、主题切换、最小化等动作
  - 播放淡入淡出时长可配置
- 本地歌单
  - 创建、重命名、删除
  - 歌单内歌曲增删、播放全部、追加到当前队列
  - 歌单导入/导出与持久化
- 网易云能力
  - 邮箱登录、手机验证码登录、二维码登录
  - 云端歌单与本地歌单双轨：云端歌单以引用方式收藏，独立于本地歌单
  - 关键词搜索支持歌曲/歌手/歌单卡片化结果展示（封面、头像、核心元信息）
  - 歌单搜索结果支持详情面板，可查看歌单内歌曲并执行播放/下载
  - 支持将云端歌单下载为本地歌单，并在操作时选择策略
  - 自动检测本地，避免重复下载
  - 单曲/歌单查询与下载任务管理
  - 下载文件写入标签与歌词/封面相关元数据
  - 支持每日推荐拉取与加入播放队列
- 桌面壳层
  - 托盘菜单、thumbar 按钮、媒体键控制
  - 关闭最小化到托盘偏好持久化
- 日志可视化工具
  - 查看 `program.log` 与 `network.log`
  - 支持关键词、方法、状态过滤与详情查看

## 快速开始

1. 安装依赖：`npm install`
2. 构建产物：`npm run build`
3. 启动应用：`npm run start`
4. 启动日志可视化：`npm run logviz`

## 开发与构建

- 源码目录：`src/**`（TypeScript）
- 构建产物：`dist/**`
- 类型检查：`npm run typecheck`
- Windows 打包：`npm run build:win`

## 架构边界

- Main (`src/main/**`)
  - 生命周期、窗口/托盘壳层、IPC 注册、持久化与网络访问
- Preload (`src/preload/preload.ts`)
  - 通过 `contextBridge` 暴露受控 API
- Renderer (`src/renderer/**`)
  - 页面装配、事件编排、交互逻辑
  - 通过 `src/renderer/core/` 统一跨模块事件与服务访问

安全边界：

- `contextIsolation: true`
- `nodeIntegration: false`
- 新增跨进程能力必须同步 main/preload/renderer 三层

## 目录与入口

- 运行时主入口：`dist/main/main.js`
- Main 源码入口：`src/main/main.ts`
- 预加载：`src/preload/preload.ts`
- 渲染层壳：`src/renderer/index.html`
- 渲染层启动：`src/renderer/bootstrap.ts`
- 渲染层编排：`src/renderer/renderer.ts`
- 渲染层核心：`src/renderer/core/*.ts`
- 功能模块：`src/renderer/modules/*.ts`

## 数据与存储

默认位于 Electron userData 目录：

- `playlists.json`：本地歌单与曲库引用
- `netease-cloud-playlists.json`：云端歌单引用收藏与来源索引
- `netease-auth.json`：网易云鉴权状态
- `netease-track-metadata.json`：网易云下载曲目元数据索引
- `shell-preferences.json`：桌面壳层偏好
- `logs/program.log`、`logs/network.log`：程序与网络日志

默认下载目录：`%USERPROFILE%\\Music\\MyPlayerDownloads`

- `Songs/`
- `Temp/`
- `Lists/<playlist-name>/`

## 文档

- 架构与实现细节：`DOCS.md`
- 网易云 API 参考：`ref/netease-cloud-music-api-binaryify/`
- 其他参考：`ref/CloudMusic-Mod/`、`ref/NetMusic/`
