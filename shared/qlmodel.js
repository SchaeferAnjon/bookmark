// 快捷书签的同步数据模型（纯函数，无 chrome 依赖，Node 可直接测）。
//
// 存储单位是「记录」而不是整张列表：每个链接 / 分组一条，按 id 索引。
//   { id, kind: 'link' | 'group' | 'meta', title, url, parent, order, deleted, t, d }
//   - group 的名字放在 title；link 的 parent 是所在分组 id，顶层为 ''
//   - t = 修改时间（毫秒），d = 写入方标识；合并时整条记录「后写者胜」，t 相同比 d
//   - 删除不抹掉记录，而是留一条 deleted:true 的墓碑，免得另一台机器把它同步回来
// 两台机器同时改不同的书签互不影响；同时改同一个，以后改的为准。
//
// 界面层用的仍是旧的混合数组：
//   链接 { id, title, url }；分组 { id, type:'group', name, items:[链接] }

export const isGroup = (it) => it?.type === 'group' && Array.isArray(it.items);
export const META_MIGRATED = 'meta-migrated';

const cmpId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || cmpId(a, b);

/** a 是否比 b 新（b 不存在时 a 胜） */
export function newer(a, b) {
  if (!b) return true;
  if ((a.t ?? 0) !== (b.t ?? 0)) return (a.t ?? 0) > (b.t ?? 0);
  return String(a.d ?? '') > String(b.d ?? '');
}

/** 合并若干记录表，每个 id 取最新的一条（与 Mac App 端 QuickStore 的规则一致） */
export function mergeRecords(...maps) {
  const out = {};
  for (const m of maps) {
    for (const [id, r] of Object.entries(m || {})) {
      if (newer(r, out[id])) out[id] = r;
    }
  }
  return out;
}

/** 记录表 → 界面列表。父分组已删除或不存在的链接放回顶层，空分组不显示 */
export function toList(records) {
  const live = Object.values(records || {}).filter((r) => !r.deleted && (r.kind === 'link' || r.kind === 'group'));
  const groups = new Set(live.filter((r) => r.kind === 'group').map((r) => r.id));
  const top = [];
  const kids = new Map();
  for (const r of live) {
    if (r.kind === 'link' && r.parent && groups.has(r.parent)) {
      if (!kids.has(r.parent)) kids.set(r.parent, []);
      kids.get(r.parent).push(r);
    } else {
      top.push(r);
    }
  }
  const link = (r) => ({ id: r.id, title: r.title || '', url: r.url });
  return top.sort(byOrder).flatMap((r) => {
    if (r.kind === 'link') return [link(r)];
    const items = (kids.get(r.id) || []).sort(byOrder).map(link);
    return items.length ? [{ id: r.id, type: 'group', name: r.title || '分组', items }] : [];
  });
}

export const flatten = (list) => (list || []).flatMap((it) => (isGroup(it) ? [it, ...it.items] : [it]));

const FIELDS = ['kind', 'title', 'url', 'parent', 'order'];
const sameFields = (a, b) => FIELDS.every((k) => (a[k] ?? '') === (b[k] ?? ''));

/**
 * 界面列表的改动 → 需要写入的记录。
 * list：要写成的样子（没有 id 的项会被就地分配 id）；prev：上次读到的样子，
 * 在 prev 里而不在 list 里的 = 用户删掉的，写墓碑；records：当前已知的全部记录。
 * 只返回真正变化的记录。
 */
export function diffList(list, prev, records, { now, device, newId }) {
  const out = {};
  const seen = new Set();
  const put = (it, fields) => {
    it.id ||= newId();
    seen.add(it.id);
    const cur = records[it.id];
    const next = { id: it.id, ...fields, deleted: false };
    if (cur && !cur.deleted && sameFields(cur, next)) return;
    out[it.id] = { ...next, t: now, d: device };
  };
  list.forEach((it, i) => {
    if (isGroup(it)) {
      put(it, { kind: 'group', title: it.name || '分组', url: '', parent: '', order: i });
      it.items.forEach((l, j) => put(l, { kind: 'link', title: l.title || '', url: l.url, parent: it.id, order: j }));
    } else {
      put(it, { kind: 'link', title: it.title || '', url: it.url, parent: '', order: i });
    }
  });
  for (const it of flatten(prev)) {
    const cur = it.id && records[it.id];
    if (cur && !cur.deleted && !seen.has(it.id)) out[it.id] = { ...cur, deleted: true, t: now, d: device };
  }
  return out;
}

/** 在顶层末尾追加一个链接；网址已存在返回 null */
export function appendRecord(records, { title, url }, { now, device, newId }) {
  const live = Object.values(records || {}).filter((r) => !r.deleted);
  if (live.some((r) => r.kind === 'link' && r.url === url)) return null;
  const topOrders = live.filter((r) => r.kind === 'group' || !r.parent).map((r) => r.order ?? 0);
  const id = newId();
  return { [id]: { id, kind: 'link', title, url, parent: '', order: Math.max(-1, ...topOrders) + 1, deleted: false, t: now, d: device } };
}

// cyrb53：小而稳定的 53 位字符串哈希，只用来生成确定性 id
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * 把旧存储（Chrome 书签文件夹）里的列表转成记录。id 由「分组名 + 网址 + 第几次出现」
 * 算出来，两台机器各自导入同一份数据会得到完全相同的记录，合并后不会重复；
 * t 固定为 1，之后任何真实修改（包括删除）都比它新，不会被导入覆盖。
 */
export function importRecords(list, { device }) {
  const out = {};
  const seen = new Map();
  const nth = (key) => {
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return `${key}\u0000${n}`;
  };
  const rec = (id, fields) => { out[id] = { id, ...fields, deleted: false, t: 1, d: device }; };
  (list || []).forEach((it, i) => {
    if (isGroup(it)) {
      const gkey = nth(`g\u0000${it.name || ''}`);
      const gid = 'g-' + hash53(gkey);
      rec(gid, { kind: 'group', title: it.name || '分组', url: '', parent: '', order: i });
      it.items.forEach((l, j) => {
        if (!l?.url) return;
        rec('l-' + hash53(nth(`${gkey}\u0000${l.url}`)), { kind: 'link', title: l.title || '', url: l.url, parent: gid, order: j });
      });
    } else if (it?.url) {
      rec('l-' + hash53(nth(`\u0000${it.url}`)), { kind: 'link', title: it.title || '', url: it.url, parent: '', order: i });
    }
  });
  return out;
}

/** 导入时只补「记录表里从未出现过的 id」：已改过、已删除（墓碑）的一律不动 */
export function missingOnly(imported, records) {
  return Object.fromEntries(Object.entries(imported).filter(([id]) => !(id in (records || {}))));
}

// ---------- 网站图标：Chrome 有本地 favicon 缓存，Safari 没有。Chrome 把快捷书签用到的图标
// 存成 kind:'icon' 的记录（按网站 origin 一条），随 iCloud 同步，Safari 直接显示同样的图标。
// 图标记录和书签记录互不影响：toList 只看 link / group。

export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

export const iconId = (origin) => 'i-' + hash53(origin);

/** 记录表里的图标：{ origin: dataURL } */
export function iconsFrom(records) {
  const out = {};
  for (const r of Object.values(records || {})) {
    if (r.kind === 'icon' && !r.deleted && r.url && typeof r.data === 'string') out[r.url] = r.data;
  }
  return out;
}

/** 列表里用到、但还没有图标（或图标超过 maxAge）的 origin */
export function originsNeedingIcons(list, records, { now, maxAge = 30 * 86400e3, limit = 200 } = {}) {
  const want = new Set();
  for (const it of flatten(list)) {
    const o = it.url && originOf(it.url);
    if (o) want.add(o);
  }
  return [...want].filter((o) => {
    const r = records?.[iconId(o)];
    return !r || r.deleted || now - (r.t || 0) > maxAge;
  }).slice(0, limit);
}

export function iconRecord(origin, data, { now, device }) {
  const id = iconId(origin);
  return { [id]: { id, kind: 'icon', url: origin, data, deleted: false, t: now, d: device } };
}

export function randomId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return 'q-' + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('');
}
