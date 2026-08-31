// 后台 service worker：仅做安装时的默认值初始化
chrome.runtime.onInstalled.addListener(async () => {
  const { quickLinks } = await chrome.storage.sync.get('quickLinks');
  if (!Array.isArray(quickLinks)) {
    await chrome.storage.sync.set({ quickLinks: [] });
  }
});
