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
- [src/renderer/renderer.js](src/renderer/renderer.js)
- [src/renderer/index.html](src/renderer/index.html)

## 当前功能

- 选择本地音频文件（`audio/*`）
- 显示曲目标题、歌手、专辑、封面图片（从 MP3/FLAC 等元数据中解析）
- 播放 / 暂停切换
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

## 项目结构

```
src/
  main/
    main.js       # Electron 主进程与窗口管理、IPC 处理（含元数据解析）
  preload/
    preload.js    # 安全桥接层（contextBridge）
  renderer/
    index.html    # 播放器 UI 与页面结构
    renderer.js   # 前端交互与音频控制逻辑
```

- [src/main/main.js](src/main/main.js)：Electron 主进程与窗口管理
- [src/preload/preload.js](src/preload/preload.js)：安全桥接层（`contextBridge`）
- [src/renderer/index.html](src/renderer/index.html)：播放器 UI 与页面结构
- [src/renderer/renderer.js](src/renderer/renderer.js)：前端交互与音频控制逻辑
- [.gitignore](.gitignore)：Git 忽略规则
- [package.json](package.json)：脚本与依赖配置

## TODO

### 已完成 ✅

0. ~~调整项目结构，遵守 Electron 最佳实践，代码不放在根目录~~
1. ~~完整的音频元数据解析与展示（标题/歌手/专辑/封面）~~
2. ~~基础播放列表管理（多首、上一首/下一首、单曲循环）~~
3. ~~进度条与时间显示（含点击跳转）~~

### 进行中 / 下一阶段 🚧

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

6. **系统托盘 & 媒体键**
   - 目标：后台可控播放，支持系统级媒体控制。
   - 验收标准：
     - 托盘菜单包含：播放/暂停、上一首、下一首、退出
     - 关闭窗口可最小化到托盘（可配置）
     - 媒体键可触发播放控制
   - 实现建议：
     - 托盘：`Tray` + `Menu.buildFromTemplate`
     - 媒体键：`globalShortcut`（最小方案）或系统媒体会话集成（进阶）
     - 注意在 `will-quit` 中统一注销快捷键
7. **界面美化**
    - 目标：提升用户体验，打造更具吸引力的界面。
    - 验收标准：
      - 界面更加现代化，布局合理，配色协调，响应尽量要流畅
      - 使用现代 UI 设计（布局、配色、字体）
      - 支持暗色模式（可选）
      - 响应式设计，适配不同屏幕尺寸
    - 实现建议：
      - CSS 框架：Tailwind CSS（实用类）或 Material-UI（组件库）
      - 图标：Font Awesome 或自定义 SVG
      - 主题切换：CSS 变量 + JavaScript 切换类

<!-- 音频可视化（暂缓） -->

### 可选的后续任务（建议）

- **播放模式扩展**：列表循环、随机播放、随机不重复（一轮内不重复）
- **元数据缓存**：减少重复解析，提高大列表切歌速度
- **异常与降级体验**：损坏文件/无权限文件的可见错误提示与跳过策略
- **快捷键体系**：空格播放暂停、方向键快进快退、自定义快捷键
- **打包与发布**：补充 `electron-builder` 配置、图标、版本号策略与自动更新预留
- **歌曲获取途径扩展**：除了本地文件，还可以考虑网络资源（在github上找音乐下载链接，方便下载到本地）

## 说明

当前版本为基础可运行版本，后续可围绕 TODO 逐步演进为完整播放器。