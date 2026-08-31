// 后台 service worker：安装初始化 + 开发版热重载

chrome.runtime.onInstalled.addListener(async () => {
  const { quickLinks } = await chrome.storage.sync.get('quickLinks');
  if (!Array.isArray(quickLinks)) {
    await chrome.storage.sync.set({ quickLinks: [] });
  }
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

// ---------- 开发热重载 ----------
// 仅未打包（开发者模式加载）的扩展生效：磁盘文件一变，自动整体重载，无需手动刷新。
const IS_UNPACKED = !('update_url' in chrome.runtime.getManifest());

const WATCH_FILES = [
  'manifest.json',
  'background.js',
  'popup/popup.html', 'popup/popup.css', 'popup/popup.js',
  'manager/manager.html', 'manager/manager.css', 'manager/manager.js',
  'options/options.html', 'options/options.css', 'options/options.js',
  'shared/api.js', 'shared/util.js', 'shared/fuzzy.js',
];

async function snapshot() {
  const parts = await Promise.all(WATCH_FILES.map(async (f) => {
    try {
      const res = await fetch(chrome.runtime.getURL(f), { cache: 'no-store' });
      const buf = await res.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-1', buf);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return 'missing';
    }
  }));
  return parts.join('|');
}

async function hotReloadLoop() {
  let last = await snapshot();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    // 调一次扩展 API 重置 service worker 的 30s 空闲计时，保证 watcher 常驻
    chrome.runtime.getPlatformInfo();
    let cur;
    try {
      cur = await snapshot();
    } catch {
      continue;
    }
    if (cur === last) continue;
    // 文件瞬时读取失败（写入中/系统抖动）不算变化，否则会触发假重载，
    // 重载瞬间点扩展图标会没反应
    if (cur.includes('missing')) continue;
    if (last.includes('missing')) { last = cur; continue; }
    // 等写入稳定后二次确认，防止半写状态触发重载
    await new Promise((r) => setTimeout(r, 400));
    let confirmed;
    try {
      confirmed = await snapshot();
    } catch {
      continue;
    }
    if (confirmed !== cur) continue;
    // 记录当前打开的扩展页面，重载后由 onInstalled 恢复
    const prefix = chrome.runtime.getURL('');
    const tabs = await chrome.tabs.query({});
    const reopenUrls = tabs.filter((t) => t.url?.startsWith(prefix)).map((t) => t.url);
    await chrome.storage.local.set({ reopenUrls });
    chrome.runtime.reload();
  }
}

if (IS_UNPACKED) hotReloadLoop();
