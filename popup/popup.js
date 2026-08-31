import { faviconUrl, debounce, collectAllBookmarks } from '../shared/util.js';
import { searchBookmarks } from '../shared/fuzzy.js';

const $ = (s) => document.querySelector(s);
const searchInput = $('#search');
const resultsSection = $('#results-section');
const resultsList = $('#results');
const noResults = $('#no-results');
const quickSection = $('#quick-section');
const quickGrid = $('#quick-grid');
const quickEmpty = $('#quick-empty');

let selectedIndex = -1;
let currentResults = [];

// 弹窗打开时预取全部书签，之后每次输入在内存里做模糊搜索
const allBookmarksPromise = collectAllBookmarks();

// ---------- 搜索 ----------

async function doSearch(query) {
  if (!query.trim()) {
    resultsSection.hidden = true;
    quickSection.hidden = false;
    currentResults = [];
    selectedIndex = -1;
    return;
  }
  const all = await allBookmarksPromise;
  currentResults = searchBookmarks(query, all, 50);
  selectedIndex = currentResults.length ? 0 : -1;
  renderResults();
  resultsSection.hidden = false;
  quickSection.hidden = true;
}

function renderResults() {
  resultsList.textContent = '';
  noResults.hidden = currentResults.length > 0;
  currentResults.forEach((n, i) => {
    const li = document.createElement('li');
    li.className = 'result-item' + (i === selectedIndex ? ' selected' : '');
    const img = document.createElement('img');
    img.src = faviconUrl(n.url, 32);
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

// ---------- 快捷书签 ----------

let quickLinks = [];
let editing = false;

// 网页标题往往带一长串副标题/站点名，格子里只显示第一段主标题
function shortTitle(title, url) {
  let s = (title || '').trim();
  s = s.split(/\s*[|·•]\s*|\s+[-–—]\s+|\s*[:：]\s+/)[0].trim();
  if (!s) {
    try { s = new URL(url).hostname.replace(/^www\./, ''); } catch { s = url; }
  }
  return s.slice(0, 20);
}

async function loadQuickLinks() {
  const data = await chrome.storage.sync.get('quickLinks');
  quickLinks = Array.isArray(data.quickLinks) ? data.quickLinks : [];
  renderQuickLinks();
}

async function saveQuickLinks() {
  await chrome.storage.sync.set({ quickLinks });
}

function renderQuickLinks() {
  quickGrid.textContent = '';
  quickEmpty.hidden = quickLinks.length > 0;
  quickGrid.classList.toggle('editing', editing);
  document.body.classList.toggle('editing', editing);
  quickLinks.forEach((link, i) => {
    const item = document.createElement('div');
    item.className = 'quick-item';
    item.title = link.url;
    const img = document.createElement('img');
    img.src = faviconUrl(link.url, 64);
    const title = document.createElement('span');
    title.className = 'q-title';
    title.textContent = shortTitle(link.title, link.url);
    const del = document.createElement('button');
    del.className = 'q-del';
    del.textContent = '×';
    del.title = '移除';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      quickLinks.splice(i, 1);
      await saveQuickLinks();
      renderQuickLinks();
    });
    item.append(img, title, del);
    item.addEventListener('click', () => {
      if (!editing) openUrl(link.url);
    });
    quickGrid.append(item);
  });
}

$('#add-current').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  if (quickLinks.some((l) => l.url === tab.url)) return;
  quickLinks.push({ title: shortTitle(tab.title, tab.url), url: tab.url });
  await saveQuickLinks();
  renderQuickLinks();
});

$('#toggle-edit').addEventListener('click', (e) => {
  editing = !editing;
  e.target.classList.toggle('active', editing);
  e.target.textContent = editing ? '完成' : '编辑';
  renderQuickLinks();
});

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
