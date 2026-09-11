// 新标签页书签面板：搜索全部书签 + 快捷书签（拖拽合并分组 / 编辑）+ 全部文件夹（默认收起）
// 插在打开标签仪表盘（app.js，来自 Tab Out）上方。模块脚本，DOM 已就绪。
// 快捷书签与弹窗共用 chrome.storage.sync.quickLinks，搜索共用 shared/fuzzy.js。
import { faviconUrl, shortTitle } from '../shared/util.js';
import { searchBookmarks } from '../shared/fuzzy.js';

(function () {
  const CHIP_LIMIT = 8;                        // 文件夹卡片默认露出的链接数
  const RESULT_LIMIT = 50;
  const LS_COLLAPSED = 'bk.collapsed';         // 折叠的文件夹 id
  const LS_FOLDERS = 'bk.showFolders';         // 是否展开「全部文件夹」

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const favicon = (url, size = 16) => faviconUrl(url, size);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 忽略 */ } };
  const isGroup = (it) => it?.type === 'group' && Array.isArray(it.items); // 与 popup.js 一致

  // ---------- 样式：沿用 Tab Out 变量；卡片自成一类，避开 app.js 的全局 .mission-card 选择器 ----------
  const style = document.createElement('style');
  style.textContent = `
    .bk-section { margin-bottom: 8px; }
    .bk-tools { display: inline-flex; gap: 12px; font-size: 12px; }
    .bk-tools a { color: var(--muted); text-decoration: none; }
    .bk-tools a:hover { color: var(--accent-amber); }
    .bk-search {
      display: block; width: 100%; box-sizing: border-box; outline: none;
      font: inherit; font-size: 15px; padding: 11px 14px; margin-bottom: 14px;
      border: 1px solid var(--warm-gray); border-radius: 10px;
      background: var(--card-bg); color: var(--ink);
      transition: border-color .15s, box-shadow .15s;
    }
    .bk-search:focus { border-color: var(--accent-amber); box-shadow: 0 0 0 3px rgba(200,113,58,0.12); }
    .bk-results {
      background: var(--card-bg); border: 1px solid var(--warm-gray); border-radius: 10px;
      margin-bottom: 20px; max-height: 60vh; overflow-y: auto; padding: 4px 0;
    }
    .bk-result {
      display: flex; align-items: center; gap: 10px; padding: 8px 14px;
      text-decoration: none; color: var(--ink); cursor: pointer;
    }
    .bk-result:hover, .bk-result.is-selected { background: rgba(154,145,138,0.12); }
    .bk-result img { width: 18px; height: 18px; border-radius: 4px; flex-shrink: 0; }
    .bk-result .bk-r-text { min-width: 0; flex: 1; }
    .bk-result .bk-r-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bk-result .bk-r-sub { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
    .bk-result .bk-r-sub b { font-weight: 500; color: var(--accent-sage); }
    .bk-noresult { padding: 18px 14px; font-size: 13px; color: var(--muted); font-style: italic; text-align: center; }
    .bk-quick-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
      gap: 4px; margin-bottom: 8px;
    }
    .bk-tile {
      position: relative; min-width: 0; display: flex; flex-direction: column; align-items: center;
      gap: 8px; padding: 14px 6px 10px; border-radius: 12px; cursor: pointer; text-align: center;
      text-decoration: none; color: var(--ink); transition: background .15s, transform .15s;
    }
    .bk-tile:hover { background: var(--card-bg); box-shadow: 0 2px 12px var(--shadow); }
    .bk-tile img { width: 36px; height: 36px; border-radius: 8px; }
    .bk-tile .bk-t-title { font-size: 12px; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bk-tile.is-group .bk-collage {
      width: 36px; height: 36px; border-radius: 8px; background: var(--card-bg); border: 1px solid var(--warm-gray);
      display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 3px; box-sizing: border-box;
    }
    .bk-tile.is-group .bk-collage img { width: 100%; height: 100%; border-radius: 3px; }
    .bk-tile.is-group.is-open { background: var(--card-bg); }
    .bk-group-row {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 4px;
      margin: 0 0 12px; padding: 8px; border-radius: 12px;
      background: rgba(154,145,138,0.08); border: 1px dashed var(--warm-gray);
    }
    .bk-group-row .bk-tile img { width: 28px; height: 28px; }
    .bk-quick-bar { display: flex; align-items: center; gap: 12px; margin: 2px 0 4px; }
    .bk-quick-bar .bk-quick-label { font-size: 11px; color: var(--muted); letter-spacing: .5px; text-transform: uppercase; }
    .bk-quick-bar .bk-quick-hint { font-size: 11px; color: var(--muted); opacity: .7; flex: 1; }
    .bk-edit-btn {
      cursor: pointer; background: none; border: 1px solid var(--warm-gray); border-radius: 999px;
      font: inherit; font-size: 11px; color: var(--muted); padding: 3px 10px;
    }
    .bk-edit-btn:hover, .bk-section.bk-editing .bk-edit-btn { color: var(--accent-amber); border-color: var(--accent-amber); }
    .bk-tile.is-dragging { opacity: .4; }
    .bk-tile.is-drop-target { background: var(--card-bg); outline: 2px dashed var(--accent-amber); outline-offset: -2px; }
    .bk-del {
      display: none; position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%;
      border: none; background: var(--status-abandoned); color: #fff; font-size: 13px; line-height: 18px;
      cursor: pointer; padding: 0; text-align: center;
    }
    .bk-section.bk-editing .bk-del { display: block; }
    .bk-section.bk-editing .bk-tile { cursor: text; }
    .bk-rename {
      font: inherit; font-size: 12px; width: 100%; box-sizing: border-box; text-align: center;
      border: 1px solid var(--accent-amber); border-radius: 4px; padding: 1px 4px; background: var(--card-bg); color: var(--ink); outline: none;
    }
    .chip-quick:hover { color: var(--accent-amber) !important; background: rgba(200,113,58,0.08) !important; }
    .chip-quick.is-added { color: var(--accent-amber); opacity: 1; }
    .bk-quick-empty { font-size: 13px; color: var(--muted); font-style: italic; padding: 12px 0 16px; }
    .bk-folders-toggle {
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer; background: none; border: none;
      font: inherit; font-size: 12px; color: var(--muted); padding: 6px 0; margin-bottom: 14px; letter-spacing: .3px;
    }
    .bk-folders-toggle:hover { color: var(--accent-amber); }
    .bk-folders-toggle svg { width: 12px; height: 12px; transition: transform .2s; }
    .bk-folders-toggle.is-open svg { transform: rotate(90deg); }
    .bk-cards { columns: 280px; column-gap: 12px; margin-bottom: 40px; }
    .bk-card {
      background: var(--card-bg); border: 1px solid var(--warm-gray); border-radius: 8px;
      padding: 16px 18px; position: relative; overflow: hidden;
      break-inside: avoid; margin-bottom: 12px;
      transition: box-shadow .25s ease, transform .25s ease;
    }
    .bk-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--accent-sage); }
    .bk-card:hover { box-shadow: 0 4px 20px var(--shadow); transform: translateY(-1px); }
    .bk-card .mission-top { cursor: pointer; user-select: none; }
    .bk-card .mission-top .open-tabs-badge { margin-left: auto; }
    .bk-card.is-collapsed .mission-pages { display: none; }
    .bk-card.is-collapsed .mission-top { margin-bottom: 0; }
    .bk-link { text-decoration: none; }
    .bk-link:hover .chip-text { color: var(--accent-amber); }
    .bk-card:not(.is-expanded) .bk-hidden { display: none; }
    .bk-more {
      cursor: pointer; color: var(--muted); background: none; border: none;
      font: inherit; font-size: 12px; width: 100%; text-align: left; padding: 8px 4px 2px;
    }
    .bk-more:hover { color: var(--accent-amber); }
    .bk-empty { font-size: 13px; color: var(--muted); font-style: italic; padding: 24px 0; text-align: center; }
  `;
  document.head.appendChild(style);

  // ---------- 骨架：插在 dashboard-columns 之前，占整行 ----------
  const anchor = document.getElementById('dashboardColumns');
  if (!anchor) return;
  const section = document.createElement('div');
  section.className = 'active-section bk-section';
  section.id = 'bkSection';
  section.innerHTML = `
    <div class="section-header">
      <h2>Bookmarks</h2>
      <div class="section-line"></div>
      <span class="bk-tools"><a href="../manager/manager.html">整理书签</a><a href="../options/options.html">设置</a></span>
      <div class="section-count" id="bkCount"></div>
    </div>
    <input class="bk-search" id="bkSearch" type="search" placeholder="搜索全部书签…" autocomplete="off" spellcheck="false">
    <div class="bk-results" id="bkResults" style="display:none"></div>
    <div class="bk-quick-bar">
      <span class="bk-quick-label">快捷书签</span>
      <span class="bk-quick-hint">拖一个图标到另一个上 = 合并成分组</span>
      <button class="bk-edit-btn" id="bkEdit" type="button">编辑</button>
    </div>
    <div class="bk-quick-grid" id="bkQuick"></div>
    <div class="bk-group-row" id="bkGroupRow" style="display:none"></div>
    <button class="bk-folders-toggle" id="bkFoldersToggle" type="button">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>
      <span id="bkFoldersLabel">All folders</span>
    </button>
    <div class="bk-cards" id="bkCards" style="display:none"></div>`;
  anchor.parentNode.insertBefore(section, anchor);

  const $ = (id) => section.querySelector('#' + id);
  const searchEl = $('bkSearch'), resultsEl = $('bkResults'), quickEl = $('bkQuick'), groupRowEl = $('bkGroupRow');
  const countEl = $('bkCount'), cardsEl = $('bkCards'), foldersToggle = $('bkFoldersToggle'), foldersLabel = $('bkFoldersLabel');

  // ================= 搜索全部书签 =================
  const search = async (query) => searchBookmarks(query, await allBookmarks(), RESULT_LIMIT);

  let allPromise = null;
  const allBookmarks = () => (allPromise ??= chrome.bookmarks.getTree().then((tree) => {
    const list = [];
    (function walk(nodes, path) {
      for (const n of nodes) {
        if (n.url) list.push({ id: n.id, title: n.title || n.url, url: n.url, path });
        if (n.children) walk(n.children, n.title ? (path ? `${path} / ${n.title}` : n.title) : path);
      }
    })(tree, '');
    return list;
  }));

  let results = [], selected = -1, searchSeq = 0;
  function renderResults() {
    if (!results.length) {
      resultsEl.innerHTML = '<div class="bk-noresult">没有匹配的书签</div>';
      return;
    }
    resultsEl.innerHTML = results.map((b, i) => `
      <a class="bk-result${i === selected ? ' is-selected' : ''}" href="${esc(b.url)}" data-bk-idx="${i}">
        <img src="${favicon(b.url, 32)}" alt="" loading="lazy">
        <div class="bk-r-text">
          <div class="bk-r-title">${esc(b.title)}</div>
          <div class="bk-r-sub">${b.path ? `<b>${esc(b.path)}</b> · ` : ''}${esc(b.url)}</div>
        </div>
      </a>`).join('');
  }
  async function runSearch() {
    const q = searchEl.value.trim();
    if (!q) { resultsEl.style.display = 'none'; results = []; selected = -1; return; }
    const mine = ++searchSeq;
    const found = await search(q);
    if (mine !== searchSeq) return;          // 输入已变，丢弃过期结果
    results = found;
    selected = results.length ? 0 : -1;
    renderResults();
    resultsEl.style.display = 'block';
  }
  let searchTimer;
  searchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 60); });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchEl.value = ''; runSearch(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      renderResults();
      resultsEl.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && selected >= 0) {
      e.preventDefault();
      location.href = results[selected].url;
    }
  });

  // ================= 快捷书签（来自书签管家；拖拽合并 / 编辑与弹窗同一套规则） =================
  let quickLinks = [], openGroup = -1, editing = false, dragIndex = -1;
  const editBtn = $('bkEdit');
  const displayTitle = (l) => l.title || l.url;
  const toast = (m) => { if (typeof showToast === 'function') showToast(m); };

  let lastSaved = '';
  async function saveQuick() {
    try {
      lastSaved = JSON.stringify(quickLinks);
      await chrome.storage.sync.set({ quickLinks });
    } catch (e) {
      toast('保存失败：' + (e.message || e));
      await loadQuick();
    }
  }
  const delBtn = (title) => `<button class="bk-del" type="button" data-bk-del title="${esc(title)}">×</button>`;
  function tile(link, idx, inGroup = false) {
    return `<a class="bk-tile" href="${esc(link.url)}" title="${esc(link.url)}" draggable="${inGroup ? 'false' : 'true'}" data-bk-idx="${idx}"${inGroup ? ' data-bk-in-group="1"' : ''}>
      <img src="${favicon(link.url, 64)}" alt="" loading="lazy" draggable="false">
      <span class="bk-t-title">${esc(displayTitle(link))}</span>
      ${delBtn(inGroup ? '移出分组' : '删除')}
    </a>`;
  }
  function groupTile(g, i) {
    const collage = g.items.slice(0, 4).map((l) => `<img src="${favicon(l.url, 32)}" alt="" loading="lazy" draggable="false">`).join('');
    return `<div class="bk-tile is-group${openGroup === i ? ' is-open' : ''}" data-bk-idx="${i}" data-bk-group="${i}" title="${esc(g.name)}（${g.items.length}）">
      <div class="bk-collage">${collage}</div>
      <span class="bk-t-title">${esc(g.name)}</span>
      ${delBtn('解散分组（成员放回顶层）')}
    </div>`;
  }
  function renderQuick() {
    queueMicrotask(() => markAdded());
    section.classList.toggle('bk-editing', editing);
    editBtn.textContent = editing ? '完成' : '编辑';
    if (openGroup >= 0 && !isGroup(quickLinks[openGroup])) openGroup = -1;
    if (!quickLinks.length) {
      quickEl.innerHTML = '<div class="bk-quick-empty">还没有快捷书签。在网页上按 Alt+Shift+B 或右键「加入快捷书签」。</div>';
      groupRowEl.style.display = 'none';
      return;
    }
    quickEl.innerHTML = quickLinks.map((it, i) => (isGroup(it) ? groupTile(it, i) : tile(it, i))).join('');
    const g = quickLinks[openGroup];
    if (isGroup(g)) {
      groupRowEl.innerHTML = g.items.map((l, j) => tile(l, j, true)).join('');
      groupRowEl.style.display = 'grid';
    } else {
      groupRowEl.style.display = 'none';
    }
  }
  async function loadQuick() {
    const { quickLinks: raw } = await chrome.storage.sync.get('quickLinks');
    quickLinks = Array.isArray(raw) ? raw : [];
    lastSaved = JSON.stringify(quickLinks);
    renderQuick();
  }

  // ---- 改名：标题换成输入框，失焦提交 ----
  function startRename(titleEl, value, maxLen, onCommit) {
    const input = document.createElement('input');
    input.className = 'bk-rename';
    input.maxLength = maxLen;
    input.value = value;
    titleEl.replaceWith(input);
    input.focus(); input.select();
    let cancelled = false;
    input.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { cancelled = true; input.blur(); }
    });
    input.addEventListener('blur', async () => {
      const v = input.value.trim();
      if (!cancelled && v && v !== value) await onCommit(v);
      renderQuick();
    });
  }

  // ---- 点击：编辑模式改名 / 删除；平时打开链接或展开分组 ----
  async function onQuickClick(e) {
    const del = e.target.closest('[data-bk-del]');
    const tileEl = e.target.closest('.bk-tile');
    if (!tileEl) return;
    const inGroup = tileEl.dataset.bkInGroup === '1';
    const idx = Number(tileEl.dataset.bkIdx);
    if (del) {
      e.preventDefault(); e.stopPropagation();
      if (inGroup) {
        // 移出分组放回顶层；剩 1 个时分组自动解散
        const g = quickLinks[openGroup];
        const [link] = g.items.splice(idx, 1);
        quickLinks.push(link);
        if (g.items.length <= 1) { quickLinks.splice(openGroup, 1, ...g.items); openGroup = -1; }
      } else if (isGroup(quickLinks[idx])) {
        quickLinks.splice(idx, 1, ...quickLinks[idx].items);
        openGroup = -1;
      } else {
        quickLinks.splice(idx, 1);
      }
      renderQuick();
      await saveQuick();
      return;
    }
    if (editing) {
      e.preventDefault();
      const titleEl = tileEl.querySelector('.bk-t-title');
      if (!titleEl) return;
      if (tileEl.dataset.bkGroup !== undefined) {
        const g = quickLinks[idx];
        startRename(titleEl, g.name, 12, async (v) => { g.name = v; await saveQuick(); });
      } else {
        const link = inGroup ? quickLinks[openGroup].items[idx] : quickLinks[idx];
        startRename(titleEl, displayTitle(link), 20, async (v) => { link.title = v; link.custom = true; await saveQuick(); });
      }
      return;
    }
    if (tileEl.dataset.bkGroup !== undefined) {
      openGroup = openGroup === idx ? -1 : idx;
      renderQuick();
    }
    // 普通链接：<a> 默认跳转
  }
  quickEl.addEventListener('click', onQuickClick);
  groupRowEl.addEventListener('click', onQuickClick);
  editBtn.addEventListener('click', () => { editing = !editing; if (editing) openGroup = openGroup; renderQuick(); });

  // ---- 拖拽：只有「链接」能被拖到别的格子；拖到链接上 = 新建分组，拖到分组上 = 加入 ----
  quickEl.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.bk-tile');
    if (!t || t.dataset.bkGroup !== undefined) { e.preventDefault(); return; }
    dragIndex = Number(t.dataset.bkIdx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragIndex));
    t.classList.add('is-dragging');
  });
  quickEl.addEventListener('dragend', () => {
    dragIndex = -1;
    quickEl.querySelectorAll('.is-dragging, .is-drop-target').forEach((el) => el.classList.remove('is-dragging', 'is-drop-target'));
  });
  quickEl.addEventListener('dragover', (e) => {
    const t = e.target.closest('.bk-tile');
    if (!t || dragIndex === -1 || Number(t.dataset.bkIdx) === dragIndex) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    t.classList.add('is-drop-target');
  });
  quickEl.addEventListener('dragleave', (e) => {
    const t = e.target.closest('.bk-tile');
    if (t && !t.contains(e.relatedTarget)) t.classList.remove('is-drop-target');
  });
  quickEl.addEventListener('drop', async (e) => {
    const t = e.target.closest('.bk-tile');
    if (!t) return;
    e.preventDefault();
    t.classList.remove('is-drop-target');
    const i = Number(t.dataset.bkIdx);
    if (dragIndex === -1 || dragIndex === i || isGroup(quickLinks[dragIndex])) return;
    const src = quickLinks[dragIndex];
    const tgt = quickLinks[i];
    if (isGroup(tgt)) tgt.items.push(src);
    else quickLinks[i] = { type: 'group', name: '分组', items: [tgt, src] };
    quickLinks.splice(dragIndex, 1);
    if (openGroup > dragIndex) openGroup--;
    dragIndex = -1;
    renderQuick();
    await saveQuick();
  });

  // ---- 「打开标签」卡片里的 ☆：把那个标签加入快捷书签（按钮由 app.js 渲染，data-action="quick-add-tab"）----
  const hasQuick = (url) => quickLinks.some((it) => (isGroup(it) ? it.items.some((l) => l.url === url) : it.url === url));
  async function addQuickFromTab(url, title) {
    if (!url || !/^https?:/.test(url)) { toast('这种地址不能加入快捷书签'); return false; }
    if (hasQuick(url)) { toast('已经在快捷书签里了'); return false; }
    quickLinks.push({ title: shortTitle(title, url), url });
    renderQuick();
    await saveQuick();
    toast('已加入快捷书签');
    return true;
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="quick-add-tab"]');
    if (!btn) return;
    e.preventDefault();
    const added = await addQuickFromTab(btn.dataset.tabUrl, btn.dataset.tabTitle);
    if (added) btn.classList.add('is-added');
  });
  // 卡片重绘后按钮状态跟着数据走：已在快捷书签里的标星
  const markAdded = () => {
    document.querySelectorAll('[data-action="quick-add-tab"]').forEach((b) => b.classList.toggle('is-added', hasQuick(b.dataset.tabUrl)));
  };
  new MutationObserver(markAdded).observe(document.getElementById('openTabsMissions') || document.body, { childList: true, subtree: true });

  // ================= 全部文件夹（默认收起） =================
  async function collectFolders() {
    const tree = await chrome.bookmarks.getTree();
    const cards = [];
    const walk = (node, path) => {
      const kids = node.children || [];
      const links = kids.filter((n) => n.url);
      const subs = kids.filter((n) => !n.url);
      const name = path ? `${path} / ${node.title}` : node.title;
      if (links.length) cards.push({ id: node.id, name, links });
      for (const s of subs) walk(s, path === null ? '' : name);
    };
    for (const root of tree[0]?.children || []) walk(root, null);
    return cards;
  }
  const linkChip = (b, hidden) => `<a class="page-chip bk-link${hidden ? ' bk-hidden' : ''}" href="${esc(b.url)}" title="${esc(b.title || b.url)}">
      <img class="chip-favicon" src="${favicon(b.url)}" alt="" loading="lazy">
      <span class="chip-text">${esc(b.title || b.url)}</span>
    </a>`;
  function renderCard(card, collapsed) {
    const extra = card.links.length - CHIP_LIMIT;
    const chips = card.links.map((b, i) => linkChip(b, i >= CHIP_LIMIT)).join('');
    const more = extra > 0 ? `<button class="bk-more" data-bk-more="${esc(card.id)}">+${extra} more</button>` : '';
    return `
      <div class="bk-card${collapsed.has(card.id) ? ' is-collapsed' : ''}" data-bk-id="${esc(card.id)}">
        <div class="mission-top" data-bk-toggle="${esc(card.id)}">
          <span class="mission-name">${esc(card.name)}</span>
          <span class="open-tabs-badge">${card.links.length}</span>
        </div>
        <div class="mission-pages">${chips}${more}</div>
      </div>`;
  }
  let foldersRendered = false;
  async function renderFolders() {
    try {
      const cards = await collectFolders();
      const collapsed = new Set(lsGet(LS_COLLAPSED, []));
      const total = cards.reduce((s, c) => s + c.links.length, 0);
      countEl.textContent = total ? `${total} links · ${cards.length} folders` : '';
      foldersLabel.textContent = `All folders (${cards.length})`;
      cardsEl.innerHTML = cards.length
        ? cards.map((c) => renderCard(c, collapsed)).join('')
        : '<div class="bk-empty">No bookmarks yet.</div>';
      foldersRendered = true;
    } catch (err) {
      console.warn('[tab-out/bk] bookmarks unavailable:', err);
    }
  }
  function setFoldersOpen(open) {
    lsSet(LS_FOLDERS, open);
    foldersToggle.classList.toggle('is-open', open);
    cardsEl.style.display = open ? 'block' : 'none';
    if (open && !foldersRendered) renderFolders();
  }
  foldersToggle.addEventListener('click', () => setFoldersOpen(cardsEl.style.display === 'none'));
  cardsEl.addEventListener('click', (e) => {
    const more = e.target.closest('[data-bk-more]');
    if (more) {
      const card = more.closest('.bk-card');
      const expanded = card.classList.toggle('is-expanded');
      more.textContent = expanded ? 'Show less' : `+${card.querySelectorAll('.bk-hidden').length} more`;
      return;
    }
    const toggle = e.target.closest('[data-bk-toggle]');
    if (toggle) {
      const id = toggle.dataset.bkToggle;
      const set = new Set(lsGet(LS_COLLAPSED, []));
      set.has(id) ? set.delete(id) : set.add(id);
      lsSet(LS_COLLAPSED, [...set]);
      toggle.closest('.bk-card').classList.toggle('is-collapsed', set.has(id));
    }
  });

  // ================= 刷新 =================
  let refreshTimer;
  const onBookmarksChanged = () => {
    allPromise = null;                 // 搜索索引下次按需重建
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { renderFolders(); if (searchEl.value.trim()) runSearch(); }, 300);
  };
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered']) {
    chrome.bookmarks[ev]?.addListener(onBookmarksChanged);
  }
  // 弹窗 / 快捷键 / 右键菜单改了快捷书签，这里实时跟上；自己刚保存的那次跳过；编辑或改名中不打断
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.quickLinks) return;
    if (JSON.stringify(changes.quickLinks.newValue ?? []) === lastSaved) return;
    if (editing || section.querySelector('.bk-rename')) return;
    loadQuick();
  });

  renderFolders();                        // 顺便算出 header 的数量
  setFoldersOpen(lsGet(LS_FOLDERS, false));
  loadQuick();
})();

