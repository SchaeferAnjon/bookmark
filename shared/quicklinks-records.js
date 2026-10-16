// 快捷书签存储（主方案）：经 Mac App（BookmarkKeeper.app）存进 iCloud，Chrome 和 Safari 读写同一份。
// 数据模型见 qlmodel.js；这里只负责跟 App 通信、导入旧数据、把改动通知给其他页面。
//
// 通信：chrome/browser.runtime.sendNativeMessage。Chrome 每次调用会拉起一次 App 的命令行模式
// （几十毫秒），Safari 发给扩展自带的处理程序。消息：
//   { cmd:'load' }            → { ok, records, rev, icloud }
//   { cmd:'put', records }    → 合并写入后同上
//   { cmd:'rev' }             → { ok, rev }  只看有没有变化，很轻
import {
  toList, diffList, appendRecord, importRecords, missingOnly, randomId, META_MIGRATED,
  iconsFrom, iconRecord, originsNeedingIcons,
} from './qlmodel.js';
import { shortTitle } from './util.js';
import { NATIVE_HOST } from './env.js';

const CHANGED_MSG = 'bk-quick-changed';
const IMPORTED_KEY = 'bkImportedToRecords';
const POLL_MS = 30e3;

export function nativeTransport() {
  const api = globalThis.browser?.runtime?.sendNativeMessage ? globalThis.browser : chrome;
  const t = { kind: 'native', info: {} };
  const send = async (msg) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('BookmarkKeeper App 无响应')), 8000);
    });
    try {
      const res = await Promise.race([api.runtime.sendNativeMessage(NATIVE_HOST, msg), timeout]);
      if (!res?.ok) throw new Error(res?.error || 'BookmarkKeeper App 返回了错误');
      if ('icloud' in res) t.info = { icloud: !!res.icloud };
      return res;
    } finally {
      clearTimeout(timer);
    }
  };
  t.load = () => send({ cmd: 'load' });
  t.put = (records) => send({ cmd: 'put', records });
  t.rev = async () => (await send({ cmd: 'rev' })).rev;
  return t;
}

let devicePromise = null;
const deviceId = () => (devicePromise ??= (async () => {
  const { bkDeviceId } = await chrome.storage.local.get('bkDeviceId');
  if (bkDeviceId) return bkDeviceId;
  const id = randomId().replace(/^q-/, 'dev-');
  await chrome.storage.local.set({ bkDeviceId: id });
  return id;
})());

/**
 * transport：{ load, put, rev, info }；initial：第一次 load 的结果（选后端时已经读过，省一次往返）；
 * importer：返回旧书签文件夹里的列表（仅 Chrome 有），每个浏览器资料首次运行时补进 iCloud。
 */
export function createRecordsBackend(transport, { initial = null, importer = null } = {}) {
  let records = {};
  let rev = null;
  const accept = (res) => {
    records = res?.records || {};
    rev = res?.rev ?? null;
  };
  let warm = !!initial;
  if (initial) accept(initial);

  const refresh = async () => accept(await transport.load());

  let importing = null;
  const ensureImported = () => {
    if (!importer) return Promise.resolve();
    importing ??= (async () => {
      if ((await chrome.storage.local.get(IMPORTED_KEY))[IMPORTED_KEY]) return;
      const list = await importer();
      await refresh();
      const d = await deviceId();
      const add = missingOnly(importRecords(list, { device: d }), records);
      if (!records[META_MIGRATED]) {
        add[META_MIGRATED] = { id: META_MIGRATED, kind: 'meta', title: d, deleted: false, t: Date.now(), d };
      }
      if (Object.keys(add).length) {
        accept(await transport.put(add));
        warm = true;
      }
      await chrome.storage.local.set({ [IMPORTED_KEY]: Date.now() });
    })().catch((e) => {
      importing = null;
      console.warn('[quicklinks] 导入旧快捷书签失败', e);
    });
    return importing;
  };

  // 没有别的页面在听时 sendMessage 会报「Receiving end does not exist」，忽略
  const notify = () => {
    try { chrome.runtime.sendMessage({ type: CHANGED_MSG })?.catch?.(() => {}); } catch { /* 同上 */ }
  };

  return {
    kind: 'native',
    info: () => transport.info,

    async loadQuickLinks() {
      await ensureImported();
      if (warm) warm = false;
      else await refresh();
      return toList(records);
    },

    async saveQuickLinks(list, prev = []) {
      const changes = diffList(list, prev, records, { now: Date.now(), device: await deviceId(), newId: randomId });
      if (!Object.keys(changes).length) return;
      accept(await transport.put(changes));
      notify();
    },

    // 快捷键 / 右键菜单：不经过整表对账，直接在末尾追加。返回 'added' | 'exists'
    async appendQuickLink({ title, url }) {
      await ensureImported();
      await refresh();
      const add = appendRecord(records, { title: shortTitle(title, url), url }, {
        now: Date.now(), device: await deviceId(), newId: randomId,
      });
      if (!add) return 'exists';
      accept(await transport.put(add));
      notify();
      return 'added';
    },

    // ---- 网站图标（见 qlmodel.js）：Chrome 存，Safari 用 ----
    icons: () => iconsFrom(records),
    needIcons: (list) => originsNeedingIcons(list, records, { now: Date.now() }),
    async saveIcons(entries) {
      const d = await deviceId();
      const now = Date.now();
      const recs = Object.assign({}, ...Object.entries(entries).map(([origin, data]) => iconRecord(origin, data, { now, device: d })));
      if (!Object.keys(recs).length) return;
      accept(await transport.put(recs));
      notify();
    },

    // 同一浏览器里别的页面写入：立即收到消息；别的浏览器 / 别的电脑：页面回到前台时
    // 和每 30 秒问一次 App 有没有变化（只比较修订号，不传数据）。后台 SW 不轮询。
    onQuickLinksChanged(cb) {
      chrome.runtime.onMessage.addListener((m) => {
        if (m?.type === CHANGED_MSG) cb();
      });
      if (typeof document === 'undefined') return;
      let busy = false;
      const check = async () => {
        if (busy || document.visibilityState !== 'visible') return;
        busy = true;
        try {
          const r = await transport.rev();
          if (r != null && r !== rev) cb();
        } catch { /* App 暂时不可用，下次再试 */ } finally {
          busy = false;
        }
      };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('focus', check);
      setInterval(check, POLL_MS);
    },
  };
}
