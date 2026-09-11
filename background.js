// 后台 service worker：热重载后恢复页面 + 开发热重载（按需开启，1 小时自动关闭）
//
// 2026-09-10 教训：此前热重载常驻——每秒 fetch 13 个源文件做 SHA-1，并用 getPlatformInfo
// 把 SW 永久保活。真机探针显示弹窗 HTML 几毫秒就到，但解析/取 popup.js/取 favicon 各要
// 数秒（最长 92 秒），且读取失败时假触发 runtime.reload() 让点图标完全没反应。
// 弹窗本身完全不依赖 SW（只直接调 chrome.storage/bookmarks/tabs），所以 SW 该闲就闲。

chrome.runtime.onInstalled.addListener(async () => {
  // 热重载后恢复之前打开的扩展页面（manager / options）
  const { reopenUrls } = await chrome.storage.local.get('reopenUrls');
  if (Array.isArray(reopenUrls) && reopenUrls.length) {
    await chrome.storage.local.remove('reopenUrls');
    const open = new Set((await chrome.tabs.query({})).map((t) => t.url));
    for (const url of reopenUrls) {
      if (!open.has(url)) chrome.tabs.create({ url });
    }
  }
});

// ---------- 开发热重载（可选） ----------
// 仅未打包（开发者模式加载）的扩展可用；在设置页勾选后生效，storage.local.hotReloadUntil
// 记录到期时间（最多 1 小时），到期或取消勾选即停止，SW 随后正常空闲退出。
const IS_UNPACKED = !('update_url' in chrome.runtime.getManifest());

const WATCH_FILES = [
  'manifest.json',
  'background.js',
  'popup/popup.html', 'popup/popup.js',
  'manager/manager.html', 'manager/manager.css', 'manager/manager.js',
  'options/options.html', 'options/options.css', 'options/options.js',
  'shared/api.js', 'shared/util.js', 'shared/fuzzy.js',
];

async function snapshot() {
  const parts = await Promise.all(WATCH_FILES.map(async (f) => {
    const res = await fetch(chrome.runtime.getURL(f), { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }));
  return parts.join('|');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hotReloadEnabled() {
  const { hotReloadUntil = 0 } = await chrome.storage.local.get('hotReloadUntil');
  return Date.now() < hotReloadUntil;
}

let watching = false;
async function hotReloadLoop() {
  if (watching || !IS_UNPACKED) return;
  watching = true;
  try {
    if (!(await hotReloadEnabled())) return;
    let last = await snapshot().catch(() => null);
    while (await hotReloadEnabled()) {
      await sleep(2000);
      // 任何读取失败一律跳过：宁可漏掉一次变化，也不能假触发 reload 把弹窗弄没
      const cur = await snapshot().catch(() => null);
      if (cur === null || last === null) { last = cur ?? last; continue; }
      if (cur === last) continue;
      await sleep(500);
      const confirmed = await snapshot().catch(() => null);
      if (confirmed !== cur) continue;
      const prefix = chrome.runtime.getURL('');
      const tabs = await chrome.tabs.query({});
      const reopenUrls = tabs.filter((t) => t.url?.startsWith(prefix)).map((t) => t.url);
      await chrome.storage.local.set({ reopenUrls });
      chrome.runtime.reload();
      return;
    }
  } finally {
    watching = false;
  }
}

if (IS_UNPACKED) {
  hotReloadLoop();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.hotReloadUntil) hotReloadLoop();
  });
}

// ---------- 对外接口：Tab Out 新标签页 ----------
// manifest.externally_connectable 只放行 Tab Out（解包路径 ~/Documents/chrome_plugin/tab-out/extension）
// 的扩展 ID。外部消息会唤醒 SW，回完即闲，不影响弹窗。
// 搜索放在这边做而不是把 fuzzy.js 给对方 import：扩展页 CSP 是 script-src 'self'，
// 跨扩展加载脚本会被拦；走消息则算法只有一份。
import { collectAllBookmarks, shortTitle } from './shared/util.js';
import { searchBookmarks } from './shared/fuzzy.js';

const isGroup = (it) => it?.type === 'group'; // 与 popup.js 一致：分组以 type 标记
let allBookmarksPromise = null;
const invalidateBookmarks = () => { allBookmarksPromise = null; };
for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered']) {
  chrome.bookmarks[ev].addListener(invalidateBookmarks);
}

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getQuickLinks') {
    chrome.storage.sync.get('quickLinks').then(({ quickLinks }) => {
      sendResponse({ quickLinks: Array.isArray(quickLinks) ? quickLinks : [] });
    });
    return true;
  }
  if (msg?.type === 'setQuickLinks') {
    // Tab Out 页面上拖拽合并 / 编辑后的整份写回；结构校验一下再落盘
    const ok = Array.isArray(msg.quickLinks) && msg.quickLinks.every((it) =>
      it && typeof it === 'object' && (isGroup(it)
        ? typeof it.name === 'string' && Array.isArray(it.items) && it.items.every((l) => l && typeof l.url === 'string')
        : typeof it.url === 'string'));
    if (!ok) { sendResponse({ ok: false, error: 'bad shape' }); return false; }
    chrome.storage.sync.set({ quickLinks: msg.quickLinks })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === 'searchBookmarks') {
    allBookmarksPromise ??= collectAllBookmarks();
    allBookmarksPromise.then((all) => {
      sendResponse({ results: searchBookmarks(String(msg.query || ''), all, Number(msg.limit) || 50) });
    });
    return true;
  }
  return false;
});

// ---------- 不开弹窗加快捷书签：快捷键 Alt+Shift+B / 页面右键菜单 ----------
// 弹窗每次要重开渲染进程，机器吃紧时要等好几秒；SW 只是几 KB 的脚本，唤醒即写入。
// 反馈用图标角标：✓ 已加入，= 已存在，× 不能加（chrome:// 之类）。

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

export async function addQuickLink(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) { await flashBadge('×', '#b35a5a'); return 'invalid'; }
  const { quickLinks: raw } = await chrome.storage.sync.get('quickLinks');
  const quickLinks = Array.isArray(raw) ? raw : [];
  const exists = quickLinks.some((it) => (isGroup(it) ? it.items.some((l) => l.url === tab.url) : it.url === tab.url));
  if (exists) { await flashBadge('=', '#9a918a'); return 'exists'; }
  quickLinks.push({ title: shortTitle(tab.title, tab.url), url: tab.url });
  await chrome.storage.sync.set({ quickLinks });
  await flashBadge('✓', '#3d7a4a');
  return 'added';
}
globalThis.addQuickLink = addQuickLink; // 供端到端测试从 SW 直接调用

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'add-quick-link') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await addQuickLink(tab);
});

const MENU_ID = 'bk-add-quick-link';
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: '加入快捷书签', contexts: ['page', 'frame', 'link'] }, () => chrome.runtime.lastError);
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  // 在链接上右键 → 收藏那个链接；否则收藏当前页
  const target = info.linkUrl ? { url: info.linkUrl, title: info.selectionText || info.linkUrl } : tab;
  await addQuickLink(target);
});
