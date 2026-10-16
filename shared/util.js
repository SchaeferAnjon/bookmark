// 公共小工具
import { HAS_FAVICON_API } from './env.js';

// Chrome：扩展自带的本地 favicon 缓存，不走网络。
// Safari 没有这个接口：先用 Chrome 经 iCloud 同步过来的图标（setSyncedIcons），没有再取网站的
// /favicon.ico，还取不到由 installFaviconFallback 换成首字母图标。
let syncedIcons = {};
export function setSyncedIcons(map) {
  syncedIcons = map || {};
  globalThis.bkSyncedIcons = syncedIcons; // 给 newtab/app.js（普通脚本，不能 import）用
}

function chromeFavicon(pageUrl, size) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}

export function faviconUrl(pageUrl, size = 32) {
  if (HAS_FAVICON_API) return chromeFavicon(pageUrl, size);
  try {
    const u = new URL(pageUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') return syncedIcons[u.origin] || `${u.origin}/favicon.ico`;
  } catch { /* 落到首字母图标 */ }
  return letterIcon(pageUrl);
}

// Chrome 页面里把本地缓存的图标画成 64px 的 data URL（同源图片，canvas 不会被污染）。
// Chrome 没见过的网站会给一个默认地球图标：和它一样的不要，免得 Safari 显示一排地球。
let defaultIcon = null;
async function drawFavicon(pageUrl) {
  const img = new Image();
  img.src = chromeFavicon(pageUrl, 64);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  canvas.getContext('2d').drawImage(img, 0, 0, 64, 64);
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
export async function renderFavicon(pageUrl) {
  if (!HAS_FAVICON_API || typeof document === 'undefined') return null;
  try {
    defaultIcon ??= drawFavicon('https://bookmarkkeeper-no-such-site.invalid/');
    const [data, fallback] = await Promise.all([drawFavicon(pageUrl), defaultIcon]);
    return data === fallback ? null : data;
  } catch {
    return null;
  }
}

// 域名首字母 + 按域名定色的圆角方块（SVG data URL）
export function letterIcon(pageUrl) {
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { host = String(pageUrl || ''); }
  const ch = (host.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
  let h = 0;
  for (const c of host) h = (h * 31 + c.codePointAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl(${h},38%,52%)"/>`
    + `<text x="16" y="21.5" font-family="-apple-system,Helvetica,sans-serif" font-size="16" font-weight="600" fill="#fff" text-anchor="middle">${escapeHtml(ch)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Safari 下网站没有 /favicon.ico 时，整页统一换成首字母图标（捕获阶段监听图片加载失败）
export function installFaviconFallback(root = document) {
  if (HAS_FAVICON_API) return;
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.bkFallback || img.src.startsWith('data:')) return;
    img.dataset.bkFallback = '1';
    img.style.display = '';
    img.src = letterIcon(img.src);
  }, true);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// 遍历书签树，收集所有真实书签（带路径）
export async function collectAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const list = [];
  (function walk(nodes, path) {
    for (const n of nodes) {
      if (n.url) list.push({ id: n.id, title: n.title || n.url, url: n.url, path });
      if (n.children) {
        const next = n.title ? (path ? `${path} / ${n.title}` : n.title) : path;
        walk(n.children, next);
      }
    }
  })(tree, '');
  return list;
}

// 快捷书签显示名：取标题第一段（去掉「| 站名」「- 站名」之类后缀），空则用域名，最多 20 字
export function shortTitle(title, url) {
  let s = (title || '').trim();
  s = s.split(/\s*[|·•]\s*|\s+[-–—]\s+|\s*[:：]\s+/)[0].trim();
  if (!s) {
    try { s = new URL(url).hostname.replace(/^www\./, ''); } catch { s = url; }
  }
  return s.slice(0, 20);
}
