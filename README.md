# 🎵 Music Player (Electron)

一个基于 Electron 的本地音乐播放器 Demo，当前支持选择本地音频文件并进行播放/暂停控制。

## 项目介绍

本项目是一个桌面端音乐播放器原型，采用主进程 + 预加载脚本 + 渲染进程的结构，重点演示：

- Electron 安全实践（`contextIsolation: true`、`nodeIntegration: false`）
- 通过 preload 暴露受控 API
- 本地音频文件选择与播放

相关文件：

- [main.js](main.js)
- [preload.js](preload.js)
- [renderer.js](renderer.js)
- [index.html](index.html)

## 当前功能

- 选择本地音频文件（`audio/*`）
- 显示当前文件名
- 播放 / 暂停切换
- 基础 IPC 示例（渲染进程通知主进程播放动作）

## 依赖

主要依赖见 [package.json](package.json)：

- `electron`（开发依赖，用于桌面应用运行）
- 其余依赖为当前安装结果中的库（可按需后续清理）

## 快速开始

1. 安装依赖
   - `npm install`
2. 启动项目
   - `npm run start`

## 项目结构

- [index.html](index.html)：播放器 UI 与页面结构
- [renderer.js](renderer.js)：前端交互与音频控制逻辑
- [preload.js](preload.js)：安全桥接层（`contextBridge`）
- [main.js](main.js)：Electron 主进程与窗口管理
- [.gitignore](.gitignore)：Git 忽略规则
- [package.json](package.json)：脚本与依赖配置

## TODO

1. 完整的 mp3 解析及显示，包括歌手、封面等等信息  
2. 播放列表管理：用数组存储多首歌曲，实现上一首/下一首  
3. 进度条与时间显示  
4. 音频可视化  
5. 系统托盘 & 媒体键

## 说明

当前版本为基础可运行版本，后续可围绕 TODO 逐步演进为完整播放器。