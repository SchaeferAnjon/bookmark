// 公共小工具

export function faviconUrl(pageUrl, size = 32) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
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
