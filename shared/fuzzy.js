// 模糊搜索 + 相关性排序
// 纯函数模块，不依赖 chrome API，方便单测

// 常见技术词别名归一：查询和文本两侧都做同样替换，
// 于是 "c++" 能命中 "cpp / cppreference"，"cpp" 也能命中 "C++ Primer"
const ALIASES = [
  ['c++', 'cpp'],
  ['c#', 'csharp'],
  ['f#', 'fsharp'],
  ['node.js', 'nodejs'],
  ['vue.js', 'vuejs'],
  ['react.js', 'reactjs'],
  ['next.js', 'nextjs'],
  ['three.js', 'threejs'],
  ['.net', 'dotnet'],
];

export function normalize(s) {
  let t = String(s || '').toLowerCase();
  for (const [from, to] of ALIASES) t = t.split(from).join(to);
  return t;
}

const BOUNDARY = ' \t-_/.、·|()[]【】:：,，';

// 子序列模糊匹配打分：连续命中、词首命中加分，跳跃扣分；不匹配返回 -1
function fuzzyScore(term, hay) {
  let score = 0;
  let pos = 0;
  let prev = -2;
  let streak = 0;
  for (let i = 0; i < term.length; i++) {
    const idx = hay.indexOf(term[i], pos);
    if (idx === -1) return -1;
    if (idx === prev + 1) {
      streak++;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1 - Math.min(3, (idx - pos) * 0.2);
    }
    if (idx === 0 || BOUNDARY.includes(hay[idx - 1])) score += 3;
    prev = idx;
    pos = idx + 1;
  }
  return Math.max(1, score);
}

// 单个查询词在单个字段里的得分：完整子串 > 词首 > 模糊子序列
function termScore(term, hay, { allowFuzzy = true } = {}) {
  if (!hay) return -1;
  const idx = hay.indexOf(term);
  if (idx !== -1) {
    let s = 100;
    if (idx === 0) s += 40;
    else if (BOUNDARY.includes(hay[idx - 1])) s += 25;
    s -= Math.min(25, idx * 0.5); // 出现位置越靠前越相关
    return s;
  }
  if (allowFuzzy && term.length >= 2) {
    const f = fuzzyScore(term, hay);
    if (f > 0) return Math.min(70, 20 + f); // 模糊命中封顶，永远低于完整子串
  }
  return -1;
}

/**
 * 对书签列表做模糊搜索，按相关性降序返回。
 * @param {string} query 用户输入，支持空格分隔多词（全部命中才算匹配）
 * @param {Array<{title,url,path?}>} bookmarks
 */
export function searchBookmarks(query, bookmarks, limit = 50) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const b of bookmarks) {
    const title = normalize(b.title);
    const url = normalize(b.url);
    const path = normalize(b.path || '');
    let total = 0;
    let matched = true;
    for (const t of terms) {
      // 标题权重最高可模糊；URL 只做子串匹配（模糊会在长 URL 里乱命中）
      const s = Math.max(
        termScore(t, title) * 3,
        termScore(t, path) * 1.5,
        termScore(t, url, { allowFuzzy: false }) * 1
      );
      if (s < 0) { matched = false; break; }
      total += s;
    }
    if (!matched) continue;
    total += Math.max(0, 15 - title.length * 0.1); // 短标题微加成
    results.push({ ...b, _score: total });
  }
  results.sort((a, b) => b._score - a._score);
  return results.slice(0, limit);
}

/**
 * 新标签页的搜索：只在快捷书签里搜（顶层链接 + 分组里的每一条）。
 * 分组名当作 path，按分组名也能搜到组里的书签；同一网址只出一次。
 * @param {Array} quickLinks 界面列表：链接 { title, url }，分组 { type:'group', name, items }
 */
export function searchQuickLinks(query, quickLinks, limit = 50) {
  const seen = new Set();
  const list = [];
  for (const it of quickLinks || []) {
    const group = it?.type === 'group' && Array.isArray(it.items);
    for (const l of group ? it.items : [it]) {
      if (!l?.url || seen.has(l.url)) continue;
      seen.add(l.url);
      list.push({ title: l.title || l.url, url: l.url, path: group ? it.name || '' : '' });
    }
  }
  return searchBookmarks(query, list, limit);
}
