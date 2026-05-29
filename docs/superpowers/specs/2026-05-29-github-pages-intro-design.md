# GitHub Pages 项目介绍页设计

## 背景

当前仓库是 Pi Agent Desktop：一个复用 Next.js/React UI、同时支持浏览器开发模式和 Electron 桌面应用模式的 Pi 编程智能体桌面端。用户希望在当前 GitHub 仓库中创建 GitHub Pages，用一个精美但简约的介绍页展示项目。

## 目标

- 在仓库 `main` 分支的 `/docs` 目录中提供 GitHub Pages 静态介绍页。
- 面向 GitHub 开发者访客，突出项目定位、核心能力、技术栈和源码入口。
- 使用中英混合文案：中文为主，关键产品词和行动按钮保留英文。
- 采用终端 / Codex 风视觉，保持现代、精美、简约。
- 不影响现有 Next.js、Electron、打包或开发命令。

## 非目标

- 不把介绍页并入现有 Next.js 应用。
- 不新增 Vite、React landing page 或其他构建链。
- 不在首版加入真实截图；先用 CSS mockup 预留截图/预览区域。
- 不提供下载 Release 按钮；首版主要行动按钮指向 GitHub 仓库源码。

## 推荐方案

使用 `/docs` 下的纯静态 HTML/CSS/少量 JavaScript：

- `docs/index.html`：页面结构、SEO meta、内容文案、资源引用。
- `docs/styles.css`：终端风视觉、响应式布局、卡片、按钮和 mockup。
- `docs/script.js`：提供复制命令反馈和页脚年份填充；页面核心内容不依赖 JavaScript。
- `docs/assets/`：首版不强依赖图片资源；未来替换真实截图时再加入。

该方案部署最简单，只需在 GitHub Pages 设置中选择 `main` 分支 `/docs`。它不会触碰现有应用目录、Next.js 配置或 Electron 主进程代码。

## 页面结构

1. **Hero**
   - 展示项目名 `Pi Agent Desktop`。
   - 一句话定位：面向 Pi coding agent 的极简 Codex-style desktop client。
   - 主按钮：`View on GitHub`。
   - 终端风状态标签，用于强化 agent、desktop、session 等关键词。

2. **Terminal Mockup**
   - 使用 CSS 绘制仿桌面窗口和终端界面。
   - 展示 session tree、prompt、tool call、文件标签或分支导航等项目特色。
   - 标注为 preview/mockup，避免被误解为真实截图。

3. **Features**
   - 3-4 个核心功能卡片。
   - 4 个核心功能卡片：会话树、分支导航、文件查看、Electron 桌面体验。

4. **Architecture / Tech Stack**
   - 简短说明 Next.js、React、Electron、Pi Agent 的关系。
   - 强调同一套 UI 同时服务浏览器开发模式和桌面应用模式。

5. **Getting Started**
   - 展示最小命令入口：`npm install`、`npm run dev`、`npm run dev:electron`。
   - 命令来自仓库已有 `package.json` scripts。

6. **Footer**
   - 显示项目名、作者/许可证信息和 GitHub 入口。

## 视觉设计

- 背景使用深色编辑器底色，并叠加轻量网格或光晕。
- 主视觉采用终端 / Codex 风：等宽字体、深色窗口、状态栏、命令行和 tool call 片段。
- 配色以黑灰为主，使用 cyan、violet、green 作为少量强调色。
- 字体使用系统 sans-serif 与等宽字体组合。
- 动效保持克制：按钮 hover、卡片轻微抬升、复制命令成功状态。
- 响应式布局：桌面端 Hero 与 mockup 左右分栏，移动端单列展示。

## 数据与依赖

- 页面不调用任何 API。
- 页面不读取本地文件或用户数据。
- 页面不依赖构建步骤。
- 页面内容手写在静态 HTML 中，命令和项目说明以当前仓库配置为依据。

## 错误处理与边界

- GitHub 链接使用相对仓库入口或从 Git remote 读取到的当前仓库 URL，避免猜错。
- 如果 `script.js` 只用于增强交互，页面在 JavaScript 禁用时仍应可读可用。
- 真实截图暂不提供，mockup 文案需明确是预览示意。
- 不承诺尚未实现或无法从仓库确认的功能。

## 验证计划

- 检查 `/docs` 下文件能被静态方式访问。
- 本地预览 `docs/index.html`，确认布局、链接和响应式表现正常。
- 验证主按钮链接正确。
- 验证命令文案与 `package.json` scripts 一致。
- 运行静态文件验证：检查 HTML 文件存在、资源路径为相对路径，并用本地静态服务器预览页面。

## 后续维护

- GitHub Pages 发布设置：仓库 Settings → Pages → Source 选择 `main` / `/docs`。
- 后续若要使用真实截图，可新增 `docs/assets/` 并替换 Terminal Mockup 区域。
- 若项目命令或定位变化，只需维护 `/docs` 下的静态内容。
