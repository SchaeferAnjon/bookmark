import { faviconUrl, debounce, collectAllBookmarks, shortTitle } from '../shared/util.js';
import { searchBookmarks } from '../shared/fuzzy.js';

// ---------- 性能探针：记录每次弹窗打开的时间线（最近 20 次，localStorage）----------
// moduleStart/paint 都是相对 navigation start 的毫秒。若这些值很小但用户体感很慢，
// 说明卡顿发生在 navigation 之前（Chrome 侧：进程/SW/协议层），不在页面本身。
const MODULE_T0 = performance.now();
window.addEventListener('load', () => {
  requestAnimationFrame(() => setTimeout(() => {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      const rec = {
        at: new Date().toISOString(),
        moduleStart: Math.round(MODULE_T0),
        reqStart: Math.round(nav?.requestStart ?? -1),
        respEnd: Math.round(nav?.responseEnd ?? -1),
        domInteractive: Math.round(nav?.domInteractive ?? -1),
        loadEnd: Math.round(nav?.loadEventEnd ?? -1),
      };
      for (const p of performance.getEntriesByType('paint')) rec[p.name] = Math.round(p.startTime);
      const log = JSON.parse(localStorage.getItem('perfLog') || '[]');
      log.push(rec);
      while (log.length > 20) log.shift();
      localStorage.setItem('perfLog', JSON.stringify(log));
      chrome.storage.local.set({ perfLog: log }); // 镜像一份给 SW 侧诊断读取
      showDevInfo(log);
    } catch { /* 探针失败不影响功能 */ }
  }, 0));
});

// 开发版诊断行（未打包扩展才显示）：版本 + 最近几次打开的首帧耗时 + 热重载是否开着
async function showDevInfo(log) {
  const manifest = chrome.runtime.getManifest();
  if ('update_url' in manifest) return;
  const el = document.querySelector('#devinfo');
  const { hotReloadUntil = 0 } = await chrome.storage.local.get('hotReloadUntil');
  const recent = log.slice(-5).map((r) => `${r['first-contentful-paint'] ?? r['first-paint'] ?? r.loadEnd}ms`).join(' ');
  const hot = Date.now() < hotReloadUntil ? '热重载开' : '热重载关';
  el.textContent = `v${manifest.version} · 首帧(近5次) ${recent} · 模块 ${log[log.length - 1]?.moduleStart}ms · ${hot}`;
  el.hidden = false;
}

const $ = (s) => document.querySelector(s);
const searchInput = $('#search');
const resultsSection = $('#results-section');
const resultsList = $('#results');
const noResults = $('#no-results');
const quickSection = $('#quick-section');
const quickGrid = $('#quick-grid');
const quickEmpty = $('#quick-empty');
const groupSection = $('#group-section');
const groupGrid = $('#group-grid');
const groupNameInput = $('#group-name');

let selectedIndex = -1;
let currentResults = [];

// ---------- 书签预取：用户开始打字才拉全部书签 ----------
// 之前是打开后 800ms 内 idle 预取；机器内存吃紧时这份额外 IO 会和弹窗自身的资源加载抢，
// 而多数点击只是点快捷格子、根本不搜索。现在第一次按键才取，搜索本身有 120ms 防抖兜底。

let allBookmarksPromise = null;
function ensureBookmarks() {
  if (!allBookmarksPromise) allBookmarksPromise = collectAllBookmarks();
  return allBookmarksPromise;
}
searchInput.addEventListener('keydown', () => ensureBookmarks(), { once: true });

// ---------- 区块可见性 ----------

function updateSections() {
  const searching = !!searchInput.value.trim();
  const inGroup = openGroup >= 0;
  resultsSection.hidden = !searching;
  groupSection.hidden = searching || !inGroup;
  quickSection.hidden = searching || inGroup;
}

// ---------- 搜索 ----------

async function doSearch(query) {
  if (!query.trim()) {
    currentResults = [];
    selectedIndex = -1;
    updateSections();
    return;
  }
  const all = await ensureBookmarks();
  currentResults = searchBookmarks(query, all, 50);
  selectedIndex = currentResults.length ? 0 : -1;
  renderResults();
  updateSections();
}

function renderResults() {
  resultsList.textContent = '';
  noResults.hidden = currentResults.length > 0;
  currentResults.forEach((n, i) => {
    const li = document.createElement('li');
    li.className = 'result-item' + (i === selectedIndex ? ' selected' : '');
    const img = document.createElement('img');
    img.src = faviconUrl(n.url, 32);
    img.decoding = 'async';
    const text = document.createElement('div');
    text.className = 'r-text';
    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = n.title || n.url;
    const url = document.createElement('div');
    url.className = 'r-url';
    url.textContent = n.url;
    text.append(title, url);
    li.append(img, text);
    li.addEventListener('click', () => openUrl(n.url));
    resultsList.append(li);
  });
}

function openUrl(url) {
  chrome.tabs.create({ url });
  window.close();
}

searchInput.addEventListener('input', debounce(() => doSearch(searchInput.value), 120));

searchInput.addEventListener('keydown', (e) => {
  if (!currentResults.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % currentResults.length;
    renderResults();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
    renderResults();
  } else if (e.key === 'Enter' && selectedIndex >= 0) {
    openUrl(currentResults[selectedIndex].url);
  }
});

// ---------- 快捷书签（含 iOS 式分组）----------
// 数据结构：quickLinks 是混合数组
//   链接： { title, url }
//   分组： { type:'group', name, items:[{title,url}, ...] }

let quickLinks = [];
let editing = false;
let openGroup = -1; // 当前打开的分组在 quickLinks 里的索引
let dragIndex = -1; // 正在拖动的格子索引（仅顶层）

const isGroup = (it) => it?.type === 'group';

// localStorage 镜像：弹窗打开时同步渲染首帧，chrome.storage 异步校准
function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem('quickLinksCache'));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
function writeCache() {
  try { localStorage.setItem('quickLinksCache', JSON.stringify(quickLinks)); } catch { /* 空间满等 */ }
}

async function loadQuickLinks() {
  const cached = readCache();
  if (cached) {
    quickLinks = cached;
    renderQuick();
  }
  const data = await chrome.storage.sync.get('quickLinks');
  const fresh = Array.isArray(data.quickLinks) ? data.quickLinks : [];
  if (!cached || JSON.stringify(fresh) !== JSON.stringify(quickLinks)) {
    quickLinks = fresh;
    renderQuick();
  }
  writeCache();
}

async function saveQuickLinks() {
  writeCache();
  await chrome.storage.sync.set({ quickLinks });
}

function makeDelBadge(onClick) {
  const del = document.createElement('button');
  del.className = 'q-del';
  del.textContent = '×';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return del;
}

function makeFavicon(url, size) {
  const img = document.createElement('img');
  img.src = faviconUrl(url, size);
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

// 链接显示名：手动改过名的（custom）原样显示，否则套 shortTitle 截取规则
function displayTitle(link) {
  return link.custom ? link.title : shortTitle(link.title, link.url);
}

// 编辑模式下点击格子：标题变输入框就地改名。Enter/失焦保存，Esc 取消
function startRename(titleEl, value, onCommit) {
  const input = document.createElement('input');
  input.className = 'q-rename';
  input.maxLength = 20;
  input.value = value;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  input.addEventListener('click', (e) => e.stopPropagation());
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

function renameLink(titleEl, link) {
  startRename(titleEl, displayTitle(link), async (v) => {
    link.title = v;
    link.custom = true;
    await saveQuickLinks();
  });
}

// 顶层格子：链接
function linkTile(link, i) {
  const item = document.createElement('div');
  item.className = 'quick-item';
  item.title = link.url;
  item.append(makeFavicon(link.url, 64));
  const title = document.createElement('span');
  title.className = 'q-title';
  title.textContent = displayTitle(link);
  item.append(title);
  item.append(makeDelBadge(async () => {
    quickLinks.splice(i, 1);
    await saveQuickLinks();
    renderQuick();
  }));
  item.addEventListener('click', () => {
    if (editing) renameLink(title, link);
    else openUrl(link.url);
  });
  attachDnD(item, i);
  return item;
}

// 顶层格子：分组（2×2 favicon 拼贴）
function groupTile(group, i) {
  const item = document.createElement('div');
  item.className = 'quick-item group-tile';
  item.title = `${group.name}（${group.items.length}）`;
  const collage = document.createElement('div');
  collage.className = 'collage';
  group.items.slice(0, 4).forEach((l) => collage.append(makeFavicon(l.url, 32)));
  item.append(collage);
  const title = document.createElement('span');
  title.className = 'q-title';
  title.textContent = group.name;
  item.append(title);
  // 编辑模式的 × = 解散分组（成员放回顶层，不删除任何链接）
  item.append(makeDelBadge(async () => {
    quickLinks.splice(i, 1, ...group.items);
    await saveQuickLinks();
    renderQuick();
  }));
  item.addEventListener('click', () => {
    if (editing) {
      // 编辑模式：就地改组名；想管理成员就退出编辑再点开分组
      startRename(title, group.name, async (v) => {
        group.name = v.slice(0, 12);
        await saveQuickLinks();
      });
    } else {
      openGroup = i;
      renderQuick();
    }
  });
  attachDnD(item, i);
  return item;
}

// iOS 式拖拽成组：把一个链接格子拖到另一个格子上
function attachDnD(item, i) {
  item.draggable = true;
  item.addEventListener('dragstart', (e) => {
    dragIndex = i;
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => {
    dragIndex = -1;
    quickGrid.querySelectorAll('.dragging, .drop-target').forEach((el) =>
      el.classList.remove('dragging', 'drop-target'));
  });
  item.addEventListener('dragover', (e) => {
    // 只有「链接」可以被拖进别的格子；分组不能整组拖进分组
    if (dragIndex === -1 || dragIndex === i || isGroup(quickLinks[dragIndex])) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.classList.add('drop-target');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
  item.addEventListener('drop', async (e) => {
    e.preventDefault();
    item.classList.remove('drop-target');
    if (dragIndex === -1 || dragIndex === i || isGroup(quickLinks[dragIndex])) return;
    const src = quickLinks[dragIndex];
    const tgt = quickLinks[i];
    if (isGroup(tgt)) {
      tgt.items.push(src);
    } else {
      quickLinks[i] = { type: 'group', name: '分组', items: [tgt, src] };
    }
    quickLinks.splice(dragIndex, 1);
    dragIndex = -1;
    await saveQuickLinks();
    renderQuick();
  });
}

function renderQuick() {
  // 分组可能被删除/解散，索引失效时退回顶层
  if (openGroup >= 0 && !isGroup(quickLinks[openGroup])) openGroup = -1;
  updateSections();
  document.body.classList.toggle('editing', editing);

  if (openGroup >= 0) {
    renderGroupView();
    return;
  }
  quickGrid.textContent = '';
  quickEmpty.hidden = quickLinks.length > 0;
  quickLinks.forEach((it, i) => {
    quickGrid.append(isGroup(it) ? groupTile(it, i) : linkTile(it, i));
  });
}

// ---------- 分组视图 ----------

function renderGroupView() {
  const g = quickLinks[openGroup];
  groupNameInput.value = g.name;
  groupGrid.textContent = '';
  g.items.forEach((link, j) => {
    const item = document.createElement('div');
    item.className = 'quick-item';
    item.title = link.url;
    item.append(makeFavicon(link.url, 64));
    const title = document.createElement('span');
    title.className = 'q-title';
    title.textContent = displayTitle(link);
    item.append(title);
    // 编辑模式的 × = 移出分组（放回顶层）；剩 1 个时分组自动解散
    item.append(makeDelBadge(async () => {
      g.items.splice(j, 1);
      quickLinks.push(link);
      if (g.items.length <= 1) {
        quickLinks.splice(openGroup, 1, ...g.items);
        openGroup = -1;
      }
      await saveQuickLinks();
      renderQuick();
    }));
    item.addEventListener('click', () => {
      if (editing) renameLink(title, link);
      else openUrl(link.url);
    });
    groupGrid.append(item);
  });
}

$('#group-back').addEventListener('click', () => {
  openGroup = -1;
  renderQuick();
});

groupNameInput.addEventListener('change', async () => {
  const g = quickLinks[openGroup];
  if (!g) return;
  g.name = groupNameInput.value.trim().slice(0, 12) || '分组';
  groupNameInput.value = g.name;
  await saveQuickLinks();
});

// ---------- 顶部操作 ----------

$('#add-current').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const link = { title: shortTitle(tab.title, tab.url), url: tab.url };
  const exists = (list) => list.some((l) => l.url === tab.url);
  if (openGroup >= 0) {
    const g = quickLinks[openGroup];
    if (exists(g.items)) return;
    g.items.push(link);
  } else {
    if (quickLinks.some((it) => (isGroup(it) ? exists(it.items) : it.url === tab.url))) return;
    quickLinks.push(link);
  }
  await saveQuickLinks();
  renderQuick();
});

function setEditing(v) {
  editing = v;
  for (const btn of [$('#toggle-edit'), $('#toggle-edit2')]) {
    btn.classList.toggle('active', editing);
    btn.textContent = editing ? '完成' : '编辑';
  }
  renderQuick();
}
$('#toggle-edit').addEventListener('click', () => setEditing(!editing));
$('#toggle-edit2').addEventListener('click', () => setEditing(!editing));

// ---------- 底栏 ----------

$('#open-manager').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
  window.close();
});

$('#open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

loadQuickLinks();
