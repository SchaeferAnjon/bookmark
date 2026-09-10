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
