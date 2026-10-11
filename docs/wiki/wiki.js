(() => {
  const CONTENT = "content";
  const GITHUB_BLOB = "https://github.com/Chasen-Liao/pi-agent-desktop/blob/main/";
  const REPO_PATH = /^(app|bin|build|components|docs|electron|hooks|lib|scripts|public)\/|^(\.zread|AGENTS\.md|CLAUDE\.md|CONTRIBUTING\.md|README|package\.json|package-lock\.json|next\.config\.ts|electron-builder\.yml|middleware\.ts|tsconfig\.json)/i;

  const navEl = document.getElementById("wiki-nav");
  const articleEl = document.getElementById("wiki-article");
  const titleEl = document.getElementById("wiki-page-title");
  const crumbEl = document.getElementById("wiki-crumb");
  const pagerEl = document.getElementById("wiki-pager");
  const statusEl = document.getElementById("wiki-status");

  let pages = [];
  let slugSet = new Set();

  function currentSlug() {
    const hash = decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\.md$/, "");
    return hash || (pages[0] && pages[0].slug) || "";
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
        current = {
          key,
          section: page.section || "",
          group: page.group || "",
          pages: [],
        };
        groups.push(current);
      }
      current.pages.push(page);
    }
    return groups;
  }

  function renderNav(active) {
    const groups = groupPages();
    navEl.innerHTML = groups
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

  function hoistMermaid(root) {
    root.querySelectorAll("pre > code.language-mermaid").forEach((code) => {
      const pre = document.createElement("pre");
      pre.className = "mermaid";
      pre.textContent = code.textContent || "";
      code.parentElement.replaceWith(pre);
    });
  }

  async function loadPage() {
    const slug = currentSlug();
    const page = pages.find((item) => item.slug === slug) || pages[0];
    if (!page) {
      articleEl.innerHTML = "<p>没有可显示的文档。</p>";
      return;
    }
    if (page.slug !== slug) {
      history.replaceState(null, "", `#/${page.slug}`);
    }
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
    articleEl.scrollTop = 0;
    window.scrollTo(0, 0);
    if (window.mermaid) {
      const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "neutral";
      window.mermaid.initialize({ startOnLoad: false, theme });
      await window.mermaid.run({ querySelector: ".mermaid" });
    }
  }

  async function boot() {
    const response = await fetch(`${CONTENT}/wiki.json`);
    if (!response.ok) {
      articleEl.innerHTML = "<p>无法读取 wiki.json。请先运行 <code>node scripts/sync-github-pages-wiki.mjs</code>。</p>";
      return;
    }
    const manifest = await response.json();
    pages = manifest.pages || [];
    slugSet = new Set(pages.map((page) => page.slug));
    await loadPage();
  }

  window.addEventListener("hashchange", () => {
    loadPage().catch((error) => {
      statusEl.textContent = String(error.message || error);
    });
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
})();
