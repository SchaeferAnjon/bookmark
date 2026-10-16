// 快捷书签对外接口：页面和后台只认这一个模块，内部按环境挑存储。
//   装了 Mac App → iCloud（quicklinks-records.js），Chrome 和 Safari、多台 Mac 共用一份
//   没装 App 的 Chrome → Chrome 书签文件夹（quicklinks-bookmarks.js），靠 Chrome 书签同步
// Safari 没有书签接口，只能走 App；App 不可用时报错，由界面提示去安装。
import * as folder from './quicklinks-bookmarks.js';
import { createRecordsBackend, nativeTransport } from './quicklinks-records.js';
import { HAS_BOOKMARKS, HAS_FAVICON_API } from './env.js';
import { originOf } from './qlmodel.js';
import { renderFavicon } from './util.js';

export { QUICK_FOLDER_TITLE } from './quicklinks-bookmarks.js';

const USED_NATIVE_KEY = 'bkUsedNative';

const folderBackend = {
  kind: 'chrome',
  info: () => ({}),
  loadQuickLinks: folder.loadQuickLinks,
  saveQuickLinks: folder.saveQuickLinks,
  appendQuickLink: folder.appendQuickLink,
  onQuickLinksChanged: folder.onQuickLinksChanged,
};

// 「没装 App」的结论只信 10 秒：用户可能在浏览器开着时装上 App，后台 SW 又可能一直活着，
// 不重新探测的话快捷键加的书签会一直写进旧的书签文件夹。连上 App 之后就不再换。
const FALLBACK_TTL = 10e3;
let chosen = null;
let fallbackAt = 0;
function backend() {
  if (fallbackAt && Date.now() - fallbackAt > FALLBACK_TTL) {
    chosen = null;
    fallbackAt = 0;
  }
  chosen ??= (async () => {
    const transport = nativeTransport();
    try {
      const initial = await transport.load();
      chrome.storage.local.set({ [USED_NATIVE_KEY]: Date.now() }).catch(() => {});
      return createRecordsBackend(transport, { initial, importer: HAS_BOOKMARKS ? folder.loadQuickLinks : null });
    } catch (e) {
      if (!HAS_BOOKMARKS) throw e;
      fallbackAt = Date.now();
      return folderBackend;
    }
  })().catch((e) => {
    chosen = null; // Safari 下 App 暂时不可用：下次调用再试
    throw e;
  });
  return chosen;
}

export async function loadQuickLinks() {
  return (await backend()).loadQuickLinks();
}

export async function saveQuickLinks(list, prev = []) {
  return (await backend()).saveQuickLinks(list, prev);
}

// 不开弹窗直接追加一条（快捷键 / 右键菜单）。返回 'added' | 'exists'
export async function appendQuickLink(link) {
  return (await backend()).appendQuickLink(link);
}

export function onQuickLinksChanged(cb) {
  backend().then((b) => b.onQuickLinksChanged(cb), () => {});
}

/**
 * 当前同步方式，给界面显示提示用：
 *   'icloud'  经 App 存在 iCloud      'local'  App 在，但 iCloud 没开（只存本机）
 *   'chrome'  没装 App，用 Chrome 书签同步（lost=true：以前用过 App，现在连不上）
 *   'error'   Safari 下连不上 App
 */
export async function syncStatus() {
  try {
    const b = await backend();
    if (b.kind === 'native') return { mode: b.info().icloud ? 'icloud' : 'local' };
    const { [USED_NATIVE_KEY]: used } = await chrome.storage.local.get(USED_NATIVE_KEY);
    return { mode: 'chrome', lost: !!used };
  } catch (e) {
    return { mode: 'error', error: e?.message || String(e) };
  }
}

/** iCloud 里同步的网站图标 { origin: dataURL }（没连 App 时为空） */
export async function quickIcons() {
  const b = await backend().catch(() => null);
  return b?.icons ? b.icons() : {};
}

/**
 * Chrome 页面调用：把快捷书签用到、iCloud 里还没有的网站图标从 Chrome 的本地缓存取出来存进去，
 * 给 Safari 用。Safari 自己没有 favicon 缓存。每个网站 30 天刷新一次。
 */
export async function shareIcons(list) {
  if (!HAS_FAVICON_API) return;
  const b = await backend().catch(() => null);
  if (b?.kind !== 'native') return;
  const origins = b.needIcons(list);
  if (!origins.length) return;
  const pageFor = new Map();
  for (const it of list.flatMap((x) => (x.items ? x.items : [x]))) {
    const o = originOf(it.url);
    if (o && !pageFor.has(o)) pageFor.set(o, it.url);
  }
  const entries = {};
  for (const o of origins) {
    // Chrome 也没有的图标记成空串：30 天内不再反复尝试，Safari 那边退回取 /favicon.ico
    entries[o] = (await renderFavicon(pageFor.get(o) || o + '/')) || '';
  }
  await b.saveIcons(entries);
}

// 后台启动时调用：旧 storage.sync 数据搬进书签文件夹（v0.7 迁移），再把文件夹导入 iCloud（v0.8）
export async function prepareQuickLinks() {
  await loadQuickLinks();
}

// 快捷书签文件夹里全部节点 id，给「AI 整理」排除用（只有 Chrome 有书签）
export function quickFolderIds() {
  return HAS_BOOKMARKS ? folder.quickFolderIds() : Promise.resolve(new Set());
}
