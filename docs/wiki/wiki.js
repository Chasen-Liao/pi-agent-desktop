import { sanitizeMermaidSource } from "./sanitize-mermaid.mjs";

const CONTENT = "content";
const GITHUB_BLOB = "https://github.com/Chasen-Liao/pi-agent-desktop/blob/main/";
const REPO_PATH =
  /^(app|bin|build|components|docs|electron|hooks|lib|scripts|public)\/|^(\.zread|AGENTS\.md|CLAUDE\.md|CONTRIBUTING\.md|README|package\.json|package-lock\.json|next\.config\.ts|electron-builder\.yml|middleware\.ts|tsconfig\.json)/i;

const navEl = document.getElementById("wiki-nav");
const articleEl = document.getElementById("wiki-article");
const titleEl = document.getElementById("wiki-page-title");
const crumbEl = document.getElementById("wiki-crumb");
const pagerEl = document.getElementById("wiki-pager");
const statusEl = document.getElementById("wiki-status");
const tocEl = document.getElementById("wiki-toc");
const tocSelectEl = document.getElementById("wiki-toc-select");
const progressBarEl = document.getElementById("wiki-progress-bar");

let pages = [];
let slugSet = new Set();
let lastSlug = "";
let headingObserver = null;

function parseHash() {
  const raw = decodeURIComponent((location.hash || "").replace(/^#\/?/, ""));
  const parts = raw.split("/").filter(Boolean);
  const slug = (parts[0] || "").replace(/\.md$/, "");
  return { slug, heading: parts.slice(1).join("/") };
}

function pageHash(slug, heading) {
  return heading ? `#/${slug}/${heading}` : `#/${slug}`;
}

function rewriteHref(href) {
  if (!href) return href;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("#") && !href.startsWith("#/")) return href;
  const [rawPath, rawHash] = href.split("#");
  const path = (rawPath || "").replace(/^\.\//, "");
  const slug = path.replace(/\.md$/, "");
  if (slug && slugSet.has(slug)) return `#/${slug}`;
  if (REPO_PATH.test(path) || path.startsWith("../")) {
    const cleaned = path.replace(/^(\.\.\/)+/, "");
    return rawHash ? `${GITHUB_BLOB}${cleaned}#${rawHash}` : `${GITHUB_BLOB}${cleaned}`;
  }
  return href;
}

function rewriteHtml(html) {
  return html.replace(/href="([^"]+)"/g, (_, href) => `href="${rewriteHref(href)}"`);
}

function groupPages() {
  const groups = [];
  let current = null;
  for (const page of pages) {
    const key = `${page.section || ""}::${page.group || ""}`;
    if (!current || current.key !== key) {
      current = { key, section: page.section || "", group: page.group || "", pages: [] };
      groups.push(current);
    }
    current.pages.push(page);
  }
  return groups;
}

function renderNav(active) {
  navEl.innerHTML = groupPages()
    .map((group) => {
      const heading = group.group || group.section;
      const items = group.pages
        .map((page) => {
          const cls = page.slug === active ? " is-active" : "";
          return `<a class="wiki-link${cls}" href="#/${page.slug}">${escapeHtml(page.title)}</a>`;
        })
        .join("");
      return `<div class="wiki-group"><p class="wiki-group-title">${escapeHtml(heading)}</p>${items}</div>`;
    })
    .join("");
}

function renderPager(page) {
  const index = pages.findIndex((item) => item.slug === page.slug);
  const prev = index > 0 ? pages[index - 1] : null;
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
  pagerEl.innerHTML = `
    ${prev ? `<a class="wiki-page-nav" href="#/${prev.slug}"><span>上一篇</span><strong>${escapeHtml(prev.title)}</strong></a>` : "<span></span>"}
    ${next ? `<a class="wiki-page-nav wiki-page-nav--next" href="#/${next.slug}"><span>下一篇</span><strong>${escapeHtml(next.title)}</strong></a>` : "<span></span>"}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugifyHeading(text) {
  const slug = String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

function decorateHeadings(root, pageSlug) {
  const used = new Set();
  return [...root.querySelectorAll("h2, h3")].map((el, index) => {
    let id = slugifyHeading(el.textContent || "");
    if (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    el.id = id;
    el.classList.add("wiki-heading");
    return { id, text: (el.textContent || "").trim(), level: el.tagName === "H2" ? 2 : 3, slug: pageSlug };
  });
}

function renderToc(headings, activeId) {
  if (!headings.length) {
    tocEl.innerHTML = "";
    tocEl.hidden = true;
    tocSelectEl.hidden = true;
    tocSelectEl.innerHTML = "";
    return;
  }
  tocEl.hidden = false;
  tocSelectEl.hidden = false;
  tocEl.innerHTML = `<p class="wiki-toc-title">本章</p>${headings
    .map((item) => {
      const cls = [
        "wiki-toc-link",
        `is-h${item.level}`,
        item.id === activeId ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<a class="${cls}" href="${pageHash(item.slug, item.id)}">${escapeHtml(item.text)}</a>`;
    })
    .join("")}`;
  tocSelectEl.innerHTML = `<option value="">本章章节</option>${headings
    .map(
      (item) =>
        `<option value="${pageHash(item.slug, item.id)}"${item.id === activeId ? " selected" : ""}>${item.level === 3 ? "·· " : ""}${escapeHtml(item.text)}</option>`,
    )
    .join("")}`;
}

function observeHeadings(headings) {
  headingObserver?.disconnect();
  if (!headings.length || !("IntersectionObserver" in window)) return;
  const visible = new Map();
  headingObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
        else visible.delete(entry.target.id);
      }
      const ordered = headings.filter((item) => visible.has(item.id));
      const active = ordered[0]?.id || headings[0]?.id;
      if (active) renderToc(headings, active);
    },
    { rootMargin: "-80px 0px -55% 0px", threshold: [0, 1] },
  );
  for (const item of headings) {
    const el = document.getElementById(item.id);
    if (el) headingObserver.observe(el);
  }
}

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / max));
  progressBarEl.style.transform = `scaleX(${ratio})`;
}

function hoistMermaid(root) {
  root.querySelectorAll("pre > code.language-mermaid").forEach((code) => {
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.textContent = code.textContent || "";
    code.parentElement.replaceWith(pre);
  });
}

function isMermaidErrorSvg(svg) {
  return /syntax error|parse error|expecting '/i.test(svg);
}

async function renderMermaid(root) {
  if (!window.mermaid) return;
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "neutral";
  window.mermaid.initialize({ startOnLoad: false, theme, securityLevel: "loose" });
  const blocks = [...root.querySelectorAll("pre.mermaid")];
  for (const [index, block] of blocks.entries()) {
    const source = sanitizeMermaidSource(block.textContent || "");
    try {
      const id = `wiki-mmd-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const { svg } = await window.mermaid.render(id, source);
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      if (isMermaidErrorSvg(svg)) throw new Error("mermaid parse");
      const figure = document.createElement("div");
      figure.className = "wiki-diagram";
      figure.innerHTML = svg;
      block.replaceWith(figure);
    } catch {
      const wrap = document.createElement("div");
      wrap.className = "wiki-diagram-failed";
      const note = document.createElement("p");
      note.className = "wiki-diagram-note";
      note.textContent = "示意图未能渲染，已显示源码。";
      const pre = document.createElement("pre");
      pre.textContent = source;
      wrap.append(note, pre);
      block.replaceWith(wrap);
    }
  }
}

async function loadPage() {
  const { slug, heading } = parseHash();
  const page = pages.find((item) => item.slug === slug) || pages[0];
  if (!page) {
    articleEl.innerHTML = "<p>没有可显示的文档。</p>";
    return;
  }
  if (page.slug !== slug) {
    history.replaceState(null, "", pageHash(page.slug, heading));
  }
  lastSlug = page.slug;
  document.title = `${page.title} · 架构解析`;
  titleEl.textContent = page.title;
  crumbEl.textContent = [page.section, page.group].filter(Boolean).join(" / ");
  renderNav(page.slug);
  renderPager(page);
  statusEl.textContent = "加载中…";
  const response = await fetch(`${CONTENT}/${page.file}`);
  if (!response.ok) {
    statusEl.textContent = "加载失败";
    articleEl.innerHTML = `<p>无法读取 <code>${escapeHtml(page.file)}</code>。</p>`;
    return;
  }
  const markdown = await response.text();
  const parse = window.marked && (window.marked.parse || window.marked);
  articleEl.innerHTML = rewriteHtml(parse(markdown));
  hoistMermaid(articleEl);
  statusEl.textContent = "";
  await renderMermaid(articleEl);
  const headings = decorateHeadings(articleEl, page.slug);
  renderToc(headings, heading || headings[0]?.id);
  observeHeadings(headings);
  window.scrollTo(0, 0);
  updateProgress();
  if (heading) {
    requestAnimationFrame(() => scrollToHeading(heading));
  }
}

async function boot() {
  const response = await fetch(`${CONTENT}/wiki.json`);
  if (!response.ok) {
    articleEl.innerHTML =
      "<p>无法读取 wiki.json。请先运行 <code>node scripts/sync-github-pages-wiki.mjs</code>。</p>";
    return;
  }
  const manifest = await response.json();
  pages = manifest.pages || [];
  slugSet = new Set(pages.map((page) => page.slug));
  await loadPage();
}

window.addEventListener("hashchange", () => {
  const { slug, heading } = parseHash();
  if (slug === lastSlug && heading) {
    scrollToHeading(heading);
    return;
  }
  loadPage().catch((error) => {
    statusEl.textContent = String(error.message || error);
  });
});

window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", updateProgress);

tocSelectEl.addEventListener("change", () => {
  if (tocSelectEl.value) location.hash = tocSelectEl.value.replace(/^#/, "");
});

const themeBtn = document.getElementById("themeToggle");
const KEY = "pi-landing-theme";
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}
let saved = null;
try {
  saved = localStorage.getItem(KEY);
} catch {
  /* ignore */
}
if (saved === "light" || saved === "dark") applyTheme(saved);
else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) applyTheme("dark");
else applyTheme("light");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    loadPage().catch(() => {});
  });
}

boot().catch((error) => {
  articleEl.innerHTML = `<p>${escapeHtml(error.message || error)}</p>`;
});
