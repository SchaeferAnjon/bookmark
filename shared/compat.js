// Safari 兼容：Safari 的 chrome.* 不保证返回 Promise，而本项目到处用 await chrome.xxx()。
// Safari 同时提供完全 Promise 化的 browser.*，这里让 chrome 指向它。
// 必须最先执行：模块页面把它放在第一个 import，普通脚本页面放在第一个 <script>。
(() => {
  const b = globalThis.browser;
  if (!b?.runtime?.getURL || globalThis.chrome === b) return;
  if (!String(b.runtime.getURL('')).startsWith('safari-web-extension:')) return;
  try {
    globalThis.chrome = b;
  } catch {
    Object.defineProperty(globalThis, 'chrome', { value: b, configurable: true, writable: true });
  }
})();
