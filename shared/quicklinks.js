// 快捷书签存储：Chrome 书签里的「书签管家·快捷书签」文件夹（默认建在「其他书签」下，可被挪到别处）。
// 顶层书签 = 链接，子文件夹 = 分组。走 Chrome 自带书签同步，两台机器登录同一账号就共享，
// 与扩展 ID 无关——v0.6.x 存在 chrome.storage.sync，但解包扩展的 ID 按目录路径算，两台路径不同就不共享。
//
// 内存结构与旧版一致：链接 { id, title, url }，分组 { id, type:'group', name, items:[链接] }。
// id 是本机书签节点 id（不同机器不同），只用于把改动落回对应节点。
// 写入是「按 id 对账」而不是整包覆盖：本端没见过的节点（另一台刚同步来的）不会被删。
import { shortTitle } from './util.js';

export const QUICK_FOLDER_TITLE = '书签管家·快捷书签';
const MIGRATED_KEY = 'quickLinksMigrated';

const isGroup = (it) => it?.type === 'group' && Array.isArray(it.items);
// 弹窗、新标签页、SW 可能同时写；Web Locks 跨同一扩展的所有上下文生效
const withLock = (fn) => (globalThis.navigator?.locks ? navigator.locks.request('bk-quick-links', fn) : fn());

let writing = 0; // 本上下文正在写入时，书签事件回调先不读，免得读到写了一半的状态

async function otherRootId() {
  const roots = await chrome.bookmarks.getChildren('0');
  return (roots.find((n) => n.folderType === 'other') || roots.find((n) => n.id === '2') || roots[1] || roots[0]).id;
}

// 找文件夹；两台机器在同步到达前各建了一个时，合并进最早那个。必须在锁内调用
async function findFolder({ create = false } = {}) {
  const found = (await chrome.bookmarks.search({ title: QUICK_FOLDER_TITLE }))
    .filter((n) => !n.url)
    .sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0) || Number(a.id) - Number(b.id));
  for (const dup of found.slice(1)) {
    for (const child of await chrome.bookmarks.getChildren(dup.id)) {
      await chrome.bookmarks.move(child.id, { parentId: found[0].id });
    }
    await chrome.bookmarks.remove(dup.id).catch(() => {});
  }
  if (found[0]) return found[0];
  if (!create) return null;
  return chrome.bookmarks.create({ parentId: await otherRootId(), title: QUICK_FOLDER_TITLE });
}

const toLink = (n) => ({ id: n.id, title: n.title || shortTitle('', n.url), url: n.url });

function fromTree(folder) {
  return (folder.children || []).map((n) => (n.url
    ? toLink(n)
    : { id: n.id, type: 'group', name: n.title, items: (n.children || []).filter((c) => c.url).map(toLink) }));
}

async function readList() {
  const folder = await findFolder();
  if (!folder) return [];
  const [tree] = await chrome.bookmarks.getSubTree(folder.id);
  return fromTree(tree);
}

// 把一项放到 parentId 的第 index 位；有 id 就更新/移动原节点，没有就新建。
// 有 id 但节点已不在（别处删了）返回 null，不复活。
async function place(item, parentId, index, fields) {
  if (item.id) {
    const [node] = await chrome.bookmarks.get(item.id).catch(() => []);
    if (!node || !!node.url !== !!fields.url) return null;
    const changes = {};
    if (node.title !== fields.title) changes.title = fields.title;
    if (fields.url && node.url !== fields.url) changes.url = fields.url;
    if (Object.keys(changes).length) await chrome.bookmarks.update(node.id, changes);
    // 按顺序逐个放置：前 index 个已就位，所以本节点若在同一父级，当前位置必然 ≥ index，向前移不踩 Chrome 的索引偏移
    if (node.parentId !== parentId || node.index !== index) await chrome.bookmarks.move(node.id, { parentId, index });
    return node;
  }
  const node = await chrome.bookmarks.create({ parentId, index, ...fields });
  item.id = node.id;
  return node;
}

const flatten = (list) => list.flatMap((it) => (isGroup(it) ? [it, ...it.items] : [it]));

// list：要写成的样子；prev：本端上次读到的样子（决定哪些节点是「用户删掉的」）
async function writeList(list, prev) {
  const folder = await findFolder({ create: true });
  let pos = 0;
  for (const it of list) {
    if (isGroup(it)) {
      const node = await place(it, folder.id, pos, { title: it.name || '分组' });
      if (!node) continue;
      pos++;
      let j = 0;
      for (const l of it.items) {
        if (await place(l, it.id, j, { title: l.title || shortTitle('', l.url), url: l.url })) j++;
      }
    } else if (await place(it, folder.id, pos, { title: it.title || shortTitle('', it.url), url: it.url })) {
      pos++;
    }
  }
  const keep = new Set(flatten(list).map((it) => it.id).filter(Boolean));
  for (const it of flatten(prev)) {
    if (!it.id || keep.has(it.id)) continue;
    try {
      if (isGroup(it)) {
        // 解散的分组里若还有本端没见过的书签（刚同步来的），挪到顶层而不是跟着删
        for (const child of await chrome.bookmarks.getChildren(it.id)) {
          await chrome.bookmarks.move(child.id, { parentId: folder.id });
        }
      }
      await chrome.bookmarks.remove(it.id);
    } catch { /* 已被别处删除 */ }
  }
}

const locked = async (fn) => {
  writing++;
  try { return await withLock(fn); } finally { writing--; }
};

// ---------- 旧数据迁移：chrome.storage.sync.quickLinks → 书签文件夹（每台机器一次，旧数据保留作备份） ----------
let migration = null;
export function migrateFromStorageSync() {
  migration ??= locked(async () => {
    if ((await chrome.storage.local.get(MIGRATED_KEY))[MIGRATED_KEY]) return;
    const { quickLinks: old } = await chrome.storage.sync.get('quickLinks');
    if (Array.isArray(old) && old.length) {
      const cur = await readList();
      const urls = new Set(flatten(cur).map((it) => it.url).filter(Boolean));
      const merged = structuredClone(cur);
      const fresh = (l) => l?.url && !urls.has(l.url) && urls.add(l.url);
      for (const it of old) {
        if (isGroup(it)) {
          const items = it.items.filter(fresh).map((l) => ({ title: l.title, url: l.url }));
          if (!items.length) continue;
          const same = merged.find((g) => isGroup(g) && g.name === it.name);
          if (same) same.items.push(...items);
          else merged.push({ type: 'group', name: it.name || '分组', items });
        } else if (fresh(it)) {
          merged.push({ title: it.title, url: it.url });
        }
      }
      await writeList(merged, cur);
    }
    await chrome.storage.local.set({ [MIGRATED_KEY]: Date.now() });
  }).catch((e) => { migration = null; throw e; });
  return migration;
}

export async function loadQuickLinks() {
  await migrateFromStorageSync().catch((e) => console.warn('[quicklinks] migrate failed', e));
  return withLock(readList);
}

export async function saveQuickLinks(list, prev = []) {
  await migrateFromStorageSync().catch(() => {});
  return locked(() => writeList(list, prev));
}

// 不经过整表对账、直接在末尾追加一条（快捷键 / 右键菜单用）。返回 'added' | 'exists'
export async function appendQuickLink({ title, url }) {
  await migrateFromStorageSync().catch(() => {});
  return locked(async () => {
    const folder = await findFolder({ create: true });
    const [tree] = await chrome.bookmarks.getSubTree(folder.id);
    if (flatten(fromTree(tree)).some((it) => it.url === url)) return 'exists';
    await chrome.bookmarks.create({ parentId: folder.id, title: shortTitle(title, url), url });
    return 'added';
  });
}

// 快捷书签文件夹里全部节点 id（含文件夹本身），给「AI 整理」排除用
export async function quickFolderIds() {
  const ids = new Set();
  for (const f of (await chrome.bookmarks.search({ title: QUICK_FOLDER_TITLE })).filter((n) => !n.url)) {
    (function walk(n) { ids.add(n.id); (n.children || []).forEach(walk); })((await chrome.bookmarks.getSubTree(f.id))[0]);
  }
  return ids;
}

// 书签有任何变动（本机操作或同步到达）时回调，250ms 防抖；本上下文写入期间延后
export function onQuickLinksChanged(cb) {
  let timer;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (writing ? fire() : cb()), 250);
  };
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[ev]?.addListener(fire);
  }
}
