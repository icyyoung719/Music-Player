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

0. ~~调整项目结构，遵守electron最佳实践，先不将代码放在根目录下，然后各自放在合适的位置~~ ✅
1. ~~完整的 mp3 解析及显示，包括歌手、封面等等信息  - 使用 `music-metadata` 库解析音频文件元数据~~ ✅
2. 播放列表管理：支持选择文件夹作为播放对象；存储多首歌曲，实现上一首/下一首  
3. 进度条与时间显示  
<!-- 4. 音频可视化  （暂时不需要） -->
5. 系统托盘 & 媒体键

## 说明

当前版本为基础可运行版本，后续可围绕 TODO 逐步演进为完整播放器。