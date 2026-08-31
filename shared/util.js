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
