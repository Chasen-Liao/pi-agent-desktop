# GitHub Pages Intro Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished, minimal GitHub Pages introduction page for Pi Agent Desktop under `/docs`.

**Architecture:** The page is a standalone static site served directly by GitHub Pages from `main` branch `/docs`. It uses one HTML file for semantic content, one CSS file for terminal/Codex-style presentation, and one optional JavaScript file for progressive enhancement only. No existing Next.js, Electron, or build configuration files are modified.

**Tech Stack:** Static HTML5, CSS3, vanilla JavaScript, GitHub Pages `/docs` publishing.

---

## File Structure

- Create `docs/index.html`: semantic landing page, SEO metadata, project content, terminal mockup, feature cards, tech stack, getting started commands, footer.
- Create `docs/styles.css`: all visual styling, responsive layout, terminal/Codex theme, hover states, reduced-motion handling.
- Create `docs/script.js`: copy-command feedback and current-year footer enhancement; page remains usable without JavaScript.
- Do not modify `app/`, `components/`, `next.config.ts`, `electron/`, or project package scripts.

## Task 1: Add Static HTML Content

**Files:**
- Create: `docs/index.html`

- [ ] **Step 1: Create the landing page HTML**

Write `docs/index.html` with this exact content:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      name="description"
      content="Pi Agent Desktop 是面向 Pi coding agent 的极简 Codex-style desktop client，复用 Next.js/React UI 并支持 Electron 桌面体验。"
    />
    <meta name="theme-color" content="#070a12" />
    <meta property="og:title" content="Pi Agent Desktop" />
    <meta
      property="og:description"
      content="A minimal Codex-style desktop client for the Pi coding agent."
    />
    <meta property="og:type" content="website" />
    <title>Pi Agent Desktop</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="site-header" aria-label="Project navigation">
        <a class="brand" href="#top" aria-label="Pi Agent Desktop home">
          <span class="brand-mark">π</span>
          <span>Pi Agent Desktop</span>
        </a>
        <nav class="nav-links" aria-label="Page sections">
          <a href="#features">Features</a>
          <a href="#stack">Stack</a>
          <a href="#start">Start</a>
        </nav>
      </header>

      <main id="top">
        <section class="hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <p class="eyebrow">Codex-style desktop for Pi coding agent</p>
            <h1 id="hero-title">把 Pi 编程智能体带进一个极简桌面工作台。</h1>
            <p class="hero-text">
              Pi Agent Desktop 复用同一套 Next.js / React UI，同时支持浏览器开发模式与 Electron 桌面应用模式，专注于会话、分支、文件与工具调用的清晰呈现。
            </p>
            <div class="hero-actions" aria-label="Primary actions">
              <a class="button primary" href="https://github.com/Chasen-Liao/pi-agent-desktop">View on GitHub</a>
              <a class="button secondary" href="#start">Quick Start</a>
            </div>
            <div class="status-strip" aria-label="Project highlights">
              <span>agent sessions</span>
              <span>branch navigation</span>
              <span>electron desktop</span>
            </div>
          </div>

          <div class="terminal-card" aria-label="Preview mockup of the desktop interface">
            <div class="window-bar">
              <span class="dot red"></span>
              <span class="dot yellow"></span>
              <span class="dot green"></span>
              <span class="window-title">preview · not a real screenshot</span>
            </div>
            <div class="terminal-body">
              <aside class="mock-sidebar" aria-label="Session tree preview">
                <p class="panel-label">sessions</p>
                <div class="tree-item active">main · build landing page</div>
                <div class="tree-item child">fork · refine copy</div>
                <div class="tree-item child">fork · inspect files</div>
              </aside>
              <section class="mock-chat" aria-label="Agent conversation preview">
                <div class="message user-message">Create a focused GitHub Pages intro.</div>
                <div class="message agent-message">
                  <span class="prompt">pi-agent</span>
                  <span>Plan: static /docs page, terminal mockup, no build step.</span>
                </div>
                <div class="tool-call">
                  <span>tool</span>
                  <code>Read docs/index.html</code>
                </div>
                <div class="file-tabs">
                  <span class="tab active">index.html</span>
                  <span class="tab">styles.css</span>
                  <span class="tab">script.js</span>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section id="features" class="section" aria-labelledby="features-title">
          <div class="section-heading">
            <p class="eyebrow">Features</p>
            <h2 id="features-title">为 agent 工作流保留最重要的上下文。</h2>
          </div>
          <div class="feature-grid">
            <article class="feature-card">
              <span class="card-index">01</span>
              <h3>Session Tree</h3>
              <p>按工作目录组织历史会话，让浏览、恢复和理解上下文更直接。</p>
            </article>
            <article class="feature-card">
              <span class="card-index">02</span>
              <h3>Branch Navigation</h3>
              <p>支持会话内分支与 fork 关系展示，方便比较不同探索路径。</p>
            </article>
            <article class="feature-card">
              <span class="card-index">03</span>
              <h3>File Viewer</h3>
              <p>内置文件查看与标签页区域，把对话和代码上下文放在同一个界面。</p>
            </article>
            <article class="feature-card">
              <span class="card-index">04</span>
              <h3>Electron Desktop</h3>
              <p>同一套 UI 可在浏览器开发模式与 Electron 桌面模式中运行。</p>
            </article>
          </div>
        </section>

        <section id="stack" class="section split-section" aria-labelledby="stack-title">
          <div>
            <p class="eyebrow">Architecture</p>
            <h2 id="stack-title">Next.js UI，Electron shell，Pi agent runtime。</h2>
          </div>
          <div class="stack-panel">
            <div class="stack-row">
              <span>Next.js / React</span>
              <p>提供浏览器开发体验和共享 UI。</p>
            </div>
            <div class="stack-row">
              <span>Electron</span>
              <p>封装桌面窗口、托盘和更新相关能力。</p>
            </div>
            <div class="stack-row">
              <span>Pi Agent</span>
              <p>驱动会话、SSE 事件流、工具调用和分支上下文。</p>
            </div>
          </div>
        </section>

        <section id="start" class="section start-section" aria-labelledby="start-title">
          <div class="section-heading">
            <p class="eyebrow">Getting Started</p>
            <h2 id="start-title">从源码启动项目。</h2>
            <p>以下命令来自当前仓库脚本，适合开发者快速进入项目。</p>
          </div>
          <div class="command-list" aria-label="Setup commands">
            <button class="command" type="button" data-copy="npm install">
              <span>$ npm install</span>
              <small>copy</small>
            </button>
            <button class="command" type="button" data-copy="npm run dev">
              <span>$ npm run dev</span>
              <small>copy</small>
            </button>
            <button class="command" type="button" data-copy="npm run dev:electron">
              <span>$ npm run dev:electron</span>
              <small>copy</small>
            </button>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <span>Pi Agent Desktop · MIT · Chasen</span>
        <span>© <span id="year">2026</span></span>
      </footer>
    </div>
    <script src="./script.js" defer></script>
  </body>
</html>
```

- [ ] **Step 2: Verify the HTML file exists**

Run:

```bash
test -f docs/index.html
```

Expected: command exits successfully with no output.

- [ ] **Step 3: Commit the HTML skeleton**

```bash
git add docs/index.html
git commit -m "$(cat <<'EOF'
docs: 添加 GitHub Pages 页面结构

为项目介绍页建立静态 HTML 内容，覆盖 Hero、功能、架构和启动命令区域。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Task 2: Add Terminal/Codex Visual Styling

**Files:**
- Create: `docs/styles.css`

- [ ] **Step 1: Create the stylesheet**

Write `docs/styles.css` with this exact content:

```css
:root {
  color-scheme: dark;
  --bg: #070a12;
  --bg-soft: #0d1320;
  --panel: rgba(14, 21, 34, 0.82);
  --panel-strong: rgba(16, 24, 39, 0.96);
  --line: rgba(148, 163, 184, 0.18);
  --text: #e5edf7;
  --muted: #94a3b8;
  --cyan: #38d5ff;
  --violet: #a78bfa;
  --green: #7ddc8a;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 20% 0%, rgba(56, 213, 255, 0.16), transparent 32rem),
    radial-gradient(circle at 82% 14%, rgba(167, 139, 250, 0.16), transparent 28rem),
    linear-gradient(180deg, #070a12 0%, #090d16 46%, #06080e 100%);
}

body::before {
  position: fixed;
  inset: 0;
  z-index: -1;
  content: "";
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.055) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, black, transparent 86%);
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font: inherit;
}

.page-shell {
  width: min(1120px, calc(100% - 40px));
  margin: 0 auto;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 0;
}

.brand,
.nav-links,
.status-strip,
.hero-actions,
.file-tabs,
.site-footer {
  display: flex;
  align-items: center;
}

.brand {
  gap: 10px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: #061018;
  background: linear-gradient(135deg, var(--cyan), var(--green));
  border-radius: 10px;
  box-shadow: 0 0 28px rgba(56, 213, 255, 0.28);
}

.nav-links {
  gap: 18px;
  color: var(--muted);
  font-size: 14px;
}

.nav-links a:hover {
  color: var(--text);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(460px, 1.1fr);
  gap: 48px;
  align-items: center;
  padding: 70px 0 86px;
}

.eyebrow {
  margin: 0 0 14px;
  color: var(--cyan);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  max-width: 680px;
  margin-bottom: 22px;
  font-size: clamp(42px, 7vw, 76px);
  line-height: 0.94;
  letter-spacing: -0.065em;
}

h2 {
  margin-bottom: 16px;
  font-size: clamp(30px, 4vw, 48px);
  line-height: 1;
  letter-spacing: -0.045em;
}

h3 {
  margin-bottom: 10px;
  font-size: 20px;
}

.hero-text,
.section-heading p,
.feature-card p,
.stack-row p {
  color: var(--muted);
  line-height: 1.75;
}

.hero-text {
  max-width: 620px;
  margin-bottom: 28px;
  font-size: 18px;
}

.hero-actions {
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 26px;
}

.button {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-weight: 700;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.button:hover,
.feature-card:hover,
.command:hover {
  transform: translateY(-2px);
}

.button.primary {
  color: #041016;
  background: linear-gradient(135deg, var(--cyan), var(--green));
  border-color: transparent;
}

.button.secondary {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.status-strip {
  flex-wrap: wrap;
  gap: 8px;
}

.status-strip span {
  padding: 7px 10px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.03);
}

.terminal-card,
.feature-card,
.stack-panel,
.command {
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: var(--shadow);
  backdrop-filter: blur(20px);
}

.terminal-card {
  overflow: hidden;
  border-radius: 26px;
}

.window-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
}

.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}

.dot.red { background: #ff6b6b; }
.dot.yellow { background: #ffd166; }
.dot.green { background: #7ddc8a; }

.window-title {
  margin-left: auto;
  color: var(--muted);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.terminal-body {
  display: grid;
  grid-template-columns: 170px 1fr;
  min-height: 380px;
}

.mock-sidebar {
  padding: 18px;
  border-right: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.16);
}

.panel-label,
.prompt,
.tool-call,
.tab,
.command {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.panel-label {
  margin-bottom: 14px;
  color: var(--violet);
  font-size: 12px;
  text-transform: uppercase;
}

.tree-item {
  margin-bottom: 8px;
  padding: 9px 10px;
  color: var(--muted);
  border-radius: 10px;
  font-size: 12px;
}

.tree-item.active {
  color: var(--text);
  background: rgba(56, 213, 255, 0.12);
}

.tree-item.child {
  margin-left: 14px;
}

.mock-chat {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px;
}

.message,
.tool-call,
.file-tabs {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.035);
}

.message {
  padding: 15px;
  line-height: 1.6;
}

.user-message {
  align-self: flex-end;
  max-width: 78%;
}

.agent-message {
  max-width: 86%;
}

.prompt {
  display: block;
  margin-bottom: 8px;
  color: var(--green);
}

.tool-call {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
  color: var(--muted);
  font-size: 13px;
}

.tool-call span {
  color: var(--cyan);
}

.tool-call code {
  color: var(--text);
}

.file-tabs {
  margin-top: auto;
  gap: 8px;
  padding: 10px;
}

.tab {
  padding: 8px 10px;
  color: var(--muted);
  border-radius: 10px;
  font-size: 12px;
}

.tab.active {
  color: var(--text);
  background: rgba(167, 139, 250, 0.16);
}

.section {
  padding: 74px 0;
  border-top: 1px solid var(--line);
}

.section-heading {
  max-width: 720px;
  margin-bottom: 28px;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.feature-card {
  min-height: 230px;
  padding: 22px;
  border-radius: 22px;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.feature-card:hover {
  border-color: rgba(56, 213, 255, 0.42);
  background: rgba(20, 31, 49, 0.9);
}

.card-index {
  display: inline-block;
  margin-bottom: 34px;
  color: var(--cyan);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
}

.split-section {
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  gap: 36px;
  align-items: start;
}

.stack-panel {
  padding: 8px;
  border-radius: 24px;
}

.stack-row {
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 16px;
  padding: 18px;
  border-bottom: 1px solid var(--line);
}

.stack-row:last-child {
  border-bottom: 0;
}

.stack-row span {
  color: var(--green);
  font-weight: 700;
}

.stack-row p {
  margin-bottom: 0;
}

.start-section {
  padding-bottom: 56px;
}

.command-list {
  display: grid;
  gap: 12px;
  max-width: 720px;
}

.command {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  color: var(--text);
  border-radius: 16px;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.command:hover {
  border-color: rgba(125, 220, 138, 0.36);
}

.command small {
  color: var(--muted);
}

.command.copied small {
  color: var(--green);
}

.site-footer {
  justify-content: space-between;
  gap: 16px;
  padding: 28px 0 42px;
  color: var(--muted);
  border-top: 1px solid var(--line);
  font-size: 14px;
}

@media (max-width: 920px) {
  .hero,
  .split-section {
    grid-template-columns: 1fr;
  }

  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .page-shell {
    width: min(100% - 28px, 1120px);
  }

  .site-header,
  .site-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .nav-links {
    width: 100%;
    justify-content: space-between;
  }

  .hero {
    padding: 42px 0 62px;
  }

  .terminal-body,
  .feature-grid,
  .stack-row {
    grid-template-columns: 1fr;
  }

  .mock-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .feature-card {
    min-height: 190px;
  }

  .window-title {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition: none !important;
  }
}
```

- [ ] **Step 2: Verify the stylesheet path is relative**

Run:

```bash
grep -n 'href="./styles.css"' docs/index.html
```

Expected output contains:

```text
<link rel="stylesheet" href="./styles.css" />
```

- [ ] **Step 3: Verify the CSS file exists**

Run:

```bash
test -f docs/styles.css
```

Expected: command exits successfully with no output.

- [ ] **Step 4: Commit the visual styling**

```bash
git add docs/styles.css docs/index.html
git commit -m "$(cat <<'EOF'
docs: 添加介绍页终端风样式

为 GitHub Pages 页面提供深色 Codex 风视觉、响应式布局和轻量交互动效。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Task 3: Add Progressive Enhancement Script

**Files:**
- Create: `docs/script.js`

- [ ] **Step 1: Create the JavaScript enhancement file**

Write `docs/script.js` with this exact content:

```js
const year = document.querySelector("#year");
if (year) {
  year.textContent = String(new Date().getFullYear());
}

const commands = document.querySelectorAll("[data-copy]");
for (const command of commands) {
  command.addEventListener("click", async () => {
    const value = command.getAttribute("data-copy");
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      command.classList.add("copied");
      const label = command.querySelector("small");
      if (label) label.textContent = "copied";

      window.setTimeout(() => {
        command.classList.remove("copied");
        if (label) label.textContent = "copy";
      }, 1400);
    } catch {
      const label = command.querySelector("small");
      if (label) label.textContent = "select";
    }
  });
}
```

- [ ] **Step 2: Verify the script path is relative**

Run:

```bash
grep -n 'src="./script.js"' docs/index.html
```

Expected output contains:

```text
<script src="./script.js" defer></script>
```

- [ ] **Step 3: Verify JavaScript is progressive enhancement**

Run:

```bash
grep -n 'data-copy="npm install"\|id="year"' docs/index.html
```

Expected output contains lines for both `data-copy="npm install"` and `id="year"`.

- [ ] **Step 4: Commit the enhancement script**

```bash
git add docs/script.js docs/index.html
git commit -m "$(cat <<'EOF'
docs: 添加介绍页复制命令交互

用渐进增强脚本提供命令复制反馈和页脚年份更新，不影响静态内容可读性。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Task 4: Verify Static Page Quality

**Files:**
- Verify: `docs/index.html`
- Verify: `docs/styles.css`
- Verify: `docs/script.js`

- [ ] **Step 1: Verify all expected files exist**

Run:

```bash
test -f docs/index.html && test -f docs/styles.css && test -f docs/script.js
```

Expected: command exits successfully with no output.

- [ ] **Step 2: Verify the page uses only relative local assets for CSS and JS**

Run:

```bash
grep -n 'href="\./styles.css"\|src="\./script.js"' docs/index.html
```

Expected output contains both:

```text
<link rel="stylesheet" href="./styles.css" />
<script src="./script.js" defer></script>
```

- [ ] **Step 3: Verify commands match `package.json` scripts**

Run:

```bash
grep -n 'npm install\|npm run dev\|npm run dev:electron' docs/index.html package.json
```

Expected output contains `npm install`, `npm run dev`, and `npm run dev:electron`; `package.json` contains `"dev"` and `"dev:electron"` scripts.

- [ ] **Step 4: Start a local static server**

Run:

```bash
python -m http.server 4173 --directory docs
```

Expected output contains:

```text
Serving HTTP on
```

Keep the server running for the browser preview step. If port `4173` is already in use, stop the conflicting local process or rerun with another unused local port and use that port in the next step.

- [ ] **Step 5: Preview the page in a browser**

Open:

```text
http://127.0.0.1:4173/
```

Expected:
- Hero section is visible with `Pi Agent Desktop` branding.
- The mock terminal card is visible and marked as preview, not a real screenshot.
- Feature cards appear in a grid on desktop width and collapse on narrow width.
- `View on GitHub` points to `https://github.com/Chasen-Liao/pi-agent-desktop`.
- Command buttons show copy feedback when clicked in a secure browser context; if clipboard is unavailable on the local preview, the fallback label changes to `select`.

- [ ] **Step 6: Stop the local static server**

Stop the `python -m http.server` process with `Ctrl+C` in its terminal.

Expected: the server exits cleanly.

- [ ] **Step 7: Check git status before completion**

Run:

```bash
git status --short
```

Expected: no uncommitted changes for `docs/index.html`, `docs/styles.css`, or `docs/script.js`. The pre-existing untracked `.claude/` directory may still appear and must not be committed unless explicitly requested.

## Self-Review

- Spec coverage: Task 1 implements `/docs/index.html`, SEO, content, GitHub source CTA, mockup, features, architecture, getting started, and footer. Task 2 implements the terminal/Codex visual style, responsive layout, and restrained hover states. Task 3 implements copy feedback and dynamic year while keeping the page usable without JavaScript. Task 4 covers static access, relative assets, command consistency, link verification, and local preview.
- Placeholder scan: The plan contains no TBD, TODO, undefined future work, or unspecified implementation steps.
- Type consistency: CSS class names used by `docs/index.html`, `docs/styles.css`, and `docs/script.js` match: `command`, `copied`, `data-copy`, and `year`.
