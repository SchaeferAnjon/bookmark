// 后台 service worker：安装初始化 + 开发版热重载

// 注册 onStartup：让 Chrome 在浏览器启动时唤醒本 SW（否则重启后 watcher 不会跑，
// 热重载整条通道失效——2026-09-03 实际踩到）
chrome.runtime.onStartup.addListener(() => { /* 唤醒即可，逻辑都在顶层 */ });

// SW 启动日志：如果这里的时间戳频繁增长，说明 SW 在不断被杀/重启（keep-alive 失效），
// 弹窗慢可能是每次点击都在等 SW 冷启动
(async () => {
  try {
    const { swStarts = [] } = await chrome.storage.local.get('swStarts');
    swStarts.push(Date.now());
    while (swStarts.length > 50) swStarts.shift();
    await chrome.storage.local.set({ swStarts });
  } catch { /* ignore */ }
})();

// 注意：不要在这里「初始化」quickLinks——先查后写和其他写入者有竞态，
// 且各页面本就把缺失值当空数组处理
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

// ---------- 开发热重载 ----------
// 仅未打包（开发者模式加载）的扩展生效：磁盘文件一变，自动整体重载，无需手动刷新。
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
    // 只用「二次确认稳定」判定真实变化：瞬时读取失败不会连续两次一致，
    // 而真删除文件是稳定状态、应当照常触发重载
    // （此前对 missing 一律跳过，导致删除被监控文件后热重载永久卡死）
    await new Promise((r) => setTimeout(r, 500));
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
