<div align="center">
  <a href="https://github.com/Chasen-Liao/pi-agent-desktop">
    <img src="public/logo.png" alt="Pi Agent Desktop application icon" width="128" height="128" />
  </a>

  # Pi Agent Desktop

  ### **目标：做出个人极简版 Codex**

  [Pi 编程智能体](https://github.com/badlogic/pi-mono) 的原生桌面客户端。基于 Electron 构建，提供比浏览器更原生的使用体验。

  [![Release](https://img.shields.io/github/v/release/Chasen-Liao/pi-agent-desktop?color=orange&logo=github)](https://github.com/Chasen-Liao/pi-agent-desktop/releases)
  [![License](https://img.shields.io/github/license/Chasen-Liao/pi-agent-desktop?color=blue)](LICENSE)
  [![Landing](https://img.shields.io/badge/Landing-GitHub%20Pages-111111?logo=githubpages)](https://chasen-liao.github.io/pi-agent-desktop/)

  ---

  ![Pi Agent Desktop Demo](public/pi.gif)

  ---
</div>

> **上游项目**：本项目衍生自 [pi-web](https://github.com/agegr/pi-web)，侧重于桌面端体验的优化与功能增强。

## 特性

- **原生桌面体验** — 基于 Electron 的独立窗口应用，支持系统托盘、最小化到托盘
- **会话浏览器** — 按工作目录分组展示所有 pi 会话
- **实时对话** — 通过 SSE 流式输出与智能体实时交互
- **运行中消息队列** — Enter 立即 steer，Alt+Enter 排队；支持拖拽与键盘重排 Follow-up
- **原生工作区界面** — Apple 风格桌面布局、液态思考球与更紧凑的消息输入体验
- **Agent 模式** — 支持 Plan / Ask / Full 三种安全模式与 Ask 工具拦截确认
- **Extension UI Bridge** — 原生弹窗支持 Extension `confirm`/`select`/`input`/`editor`/`notify` 交互
- **项目信任机制** — Project Trust 409 握手与授权弹窗
- **MCP 服务器管理** — 支持全局 (`~/.pi/agent/mcp.json`) 与项目 (`<cwd>/.pi/mcp.json`) MCP 配置与 UI 管理
- **扩展与 Skill 管理** — 统一 UI 管理全局和项目扩展、Skill 启用与诊断
- **会话分叉与克隆** — API/UI 支持从任意节点 Branch 及 Clone 会话到新目录
- **会话导出** — 一键导出为 HTML / Markdown 格式
- **AgentMode 持久化** — 自动写入 `.jsonl` 自定义 `desktop_agent_mode` 节点，重载恢复历史模式
- **长期记忆 LTM** — 项目级 SQLite 记忆（`memory_save` / `memory_recall` / `memory_forget`），跨会话检索；`agent_end` 与 compact 前自动观察写入
- **会话内分支** — 回退到任意节点继续对话，在同一文件内创建分支
- **分支导航器** — 可视化切换同一会话内的各个分支
- **模型切换** — 对话中途随时切换模型
- **工具面板** — 控制智能体可使用的工具
- **文件浏览** — 侧边栏内置文件浏览器和查看器
- **快捷键** — `Ctrl+B` 切换左侧边栏，`Ctrl+Alt+B` 切换右侧面板
- **自动更新** — 支持 GitHub Releases 自动检查更新

## 下载安装

前往 [Releases](https://github.com/Chasen-Liao/pi-agent-desktop/releases) 页面下载最新版安装程序。

Windows 用户下载 `Pi-Agent-Desktop-Setup-x.x.x.exe`，运行即可安装。

## 开发

```bash
# 安装依赖
npm install

# 开发模式（浏览器）
npm run dev          # http://localhost:30141

# 开发模式（Electron 桌面窗口）
npm run dev:electron

# 类型检查
npx tsc --noEmit

# 代码检查
npm run lint

# 构建安装包
npm run dist
```

## 项目结构

```
app/
  api/
    sessions/      # 读取会话文件
    agent/         # 发送命令、SSE 事件流
    memory/        # 长期记忆 recall / remember / forget / stats / health
    files/         # 文件内容读取
    models/        # 可用模型列表与默认模型
    models-config/ # 读写 models.json
    skills/        # 技能搜索与安装
    auth/          # 登录与 API Key 管理
    health/        # 健康检查
components/        # UI 组件
electron/          # Electron 主进程
hooks/             # React Hooks（会话管理、面板布局等）
lib/
  ltm/               # 长期记忆（SQLite + MemoryService + hooks）
  session-reader.ts  # 解析 .jsonl 会话文件
  rpc-manager.ts     # 管理 AgentSession 生命周期
  normalize.ts       # 规范化 toolCall 字段名
  types.ts
scripts/
  ensure-standalone-next-runtimes.mjs  # 打包后补齐 Turbopack runtime
```

## 技术栈

- **前端**：Next.js + React + TypeScript
- **桌面**：Electron
- **打包**：electron-builder (NSIS)
- **通信**：SSE (Server-Sent Events) 实时流式传输

## 致谢

- [pi-mono](https://github.com/badlogic/pi-mono) — Pi 编程智能体核心
- [pi-web](https://github.com/agegr/pi-web) — 上游 Web 界面项目

## 许可

MIT License

## Star History

<a href="https://www.star-history.com/?type=date&repos=Chasen-Liao%2Fpi-agent-desktop">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Chasen-Liao/pi-agent-desktop&type=date&theme=dark&legend=top-left&sealed_token=7FZx9tIJY7DZftKRGAxh3hKUgI5IKOodcow7xCxr-XsdPrEV8gzbLinwEWaMH09RIWG-Xk-XyrFLLLE1_dXvCiK94KE18IK3OOpDUrN0NN8IH1kVvdUhWQ" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Chasen-Liao/pi-agent-desktop&type=date&legend=top-left&sealed_token=7FZx9tIJY7DZftKRGAxh3hKUgI5IKOodcow7xCxr-XsdPrEV8gzbLinwEWaMH09RIWG-Xk-XyrFLLLE1_dXvCiK94KE18IK3OOpDUrN0NN8IH1kVvdUhWQ" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Chasen-Liao/pi-agent-desktop&type=date&legend=top-left&sealed_token=7FZx9tIJY7DZftKRGAxh3hKUgI5IKOodcow7xCxr-XsdPrEV8gzbLinwEWaMH09RIWG-Xk-XyrFLLLE1_dXvCiK94KE18IK3OOpDUrN0NN8IH1kVvdUhWQ" />
 </picture>
</a>
