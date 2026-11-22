// 新标签页和工具栏弹窗搜索的端到端检查：无头 Chromium、全新浏览器资料、假书签，真打字真按键。
// 不碰本机 Chrome 和真书签；不弹窗口（headless）。
//   node tests/e2e/newtab-search.e2e.mjs [截图目录]      （npm run e2e）
// 需要 Playwright（npm i -g playwright && npx playwright install chromium）；
// 浏览器版本和 Playwright 对不上时用 BK_CHROMIUM=<Chromium 可执行文件> 指一个现成的。
//
// 假书签：快捷书签里有顶层链接和两个分组（学校、hiwi2），快捷书签外面有书签栏和一个文件夹，
// 外面的书签故意和快捷书签撞词（Moodle Archive、Mail Archive）。
// 第二段模拟 Safari：页面里去掉书签接口，快捷书签由一个假的 Mac App 给。
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffList } from '../../shared/qlmodel.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'bk-e2e-shots-')));
mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* 项目没有 node_modules，退到全局安装 */ }
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 20e3 }).trim();
  return createRequire(join(globalRoot, 'noop.js'))('playwright');
}
const { chromium } = await loadPlaywright();

const QUICK = [
  { title: 'Quick Mail', url: 'https://mail.example/' },
  { title: 'GitHub', url: 'https://github.example/' },
  { type: 'group', name: '学校', items: [
    { title: 'Moodle', url: 'https://moodle.example/' },
    { title: 'Uni Portal', url: 'https://portal.uni.example/' },
  ] },
  { type: 'group', name: 'hiwi2', items: [
    { title: 'Jira', url: 'https://jira.example/' },
    { title: 'Slack', url: 'https://slack.example/' },
  ] },
];
const OUTSIDE_BAR = [
  { title: 'Moodle Archive', url: 'https://archive.moodle-old.example/' },
  { title: 'Outside Docs', url: 'https://outside-docs.example/' },
];
const OUTSIDE_FOLDER = { title: '工作', children: [
  { title: 'Mail Archive', url: 'https://mail-archive.example/' },
  { title: 'Wiki Outside', url: 'https://wiki.example/' },
] };

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const titles = (page) => page.$$eval('#bkResults .bk-result .bk-r-title', (els) => els.map((e) => e.textContent.trim()));
async function typeQuery(page, q) {
  const box = page.locator('#bkSearch');
  await box.fill('');
  await page.waitForFunction(() => document.querySelector('#bkResults')?.style.display === 'none', null, { timeout: 3000 });
  await box.pressSequentially(q, { delay: 20 });
  // 等结果框出现、内容连着两次一样（防抖 60 ms）
  await page.waitForFunction(() => {
    const r = document.querySelector('#bkResults');
    if (!r || r.style.display === 'none') return false;
    const html = r.innerHTML;
    const prev = window.__e2ePrev;
    window.__e2ePrev = html;
    return prev === html;
  }, null, { polling: 200, timeout: 5000 });
  await page.evaluate(() => { delete window.__e2ePrev; });
}

const userDataDir = mkdtempSync(join(tmpdir(), 'bk-e2e-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  executablePath: process.env.BK_CHROMIUM || undefined,
  headless: true,
  viewport: { width: 1280, height: 860 },
  locale: 'zh-CN',
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});
try {
  // 假网站：点链接 / 回车不出网
  await context.route(/^https:\/\/[^/]*\.example\//, (route) => route.fulfill({
    contentType: 'text/html', body: `<title>fake</title><h1>${route.request().url()}</h1>`,
  }));
  const ours = (w) => w.url().endsWith('/background.js');
  const sw = context.serviceWorkers().find(ours)
    || await context.waitForEvent('serviceworker', { predicate: ours, timeout: 15e3 });
  const extId = new URL(sw.url()).host;
  // 刚起来的扩展后台，chrome.bookmarks 要过一会儿才挂上
  for (let i = 0; i < 50 && !(await sw.evaluate(() => !!globalThis.chrome?.bookmarks)); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }

  await sw.evaluate(async ({ QUICK, OUTSIDE_BAR, OUTSIDE_FOLDER }) => {
    const roots = await chrome.bookmarks.getChildren('0');
    const bar = roots.find((n) => n.folderType === 'bookmarks-bar') || roots[0];
    const other = roots.find((n) => n.folderType === 'other') || roots[1];
    for (const b of OUTSIDE_BAR) await chrome.bookmarks.create({ parentId: bar.id, ...b });
    const f = await chrome.bookmarks.create({ parentId: bar.id, title: OUTSIDE_FOLDER.title });
    for (const b of OUTSIDE_FOLDER.children) await chrome.bookmarks.create({ parentId: f.id, ...b });
    const q = await chrome.bookmarks.create({ parentId: other.id, title: '书签管家·快捷书签' });
    for (const it of QUICK) {
      if (it.type === 'group') {
        const g = await chrome.bookmarks.create({ parentId: q.id, title: it.name });
        for (const l of it.items) await chrome.bookmarks.create({ parentId: g.id, ...l });
      } else {
        await chrome.bookmarks.create({ parentId: q.id, ...it });
      }
    }
  }, { QUICK, OUTSIDE_BAR, OUTSIDE_FOLDER });

  const newtab = `chrome-extension://${extId}/newtab/index.html`;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(newtab);
  await page.waitForSelector('#bkQuick .bk-tile');
  await page.waitForFunction(() => document.querySelectorAll('#bkQuick .bk-tile').length >= 4);
  const mode = await page.evaluate(async () => (await import('../shared/quicklinks.js')).syncStatus());
  check(mode.mode === 'chrome', `快捷书签存在这个临时浏览器的书签里（不连本机 App）：${JSON.stringify(mode)}`);
  await page.screenshot({ path: join(OUT, 'chrome-1-idle.png') });

  // 1. 占位字
  const placeholder = await page.getAttribute('#bkSearch', 'placeholder');
  check(/快捷书签/.test(placeholder || ''), `搜索框占位字说只搜快捷书签：「${placeholder}」`);

  // 2. 分组里的书签能搜到，外面撞词的搜不到
  await typeQuery(page, 'moodle');
  let t = await titles(page);
  await page.screenshot({ path: join(OUT, 'chrome-2-moodle.png') });
  check(t.includes('Moodle'), `搜 moodle：分组「学校」里的 Moodle 在结果里 ${JSON.stringify(t)}`);
  check(!t.includes('Moodle Archive'), `搜 moodle：快捷书签外面的 Moodle Archive 不在结果里 ${JSON.stringify(t)}`);
  const sub = await page.locator('#bkResults .bk-result').first().locator('.bk-r-sub').textContent().catch(() => '');
  check(/学校/.test(sub || ''), `结果下面一行写出所在分组「学校」：「${(sub || '').trim()}」`);

  // 3. 顶层快捷书签能搜到，外面的 Mail Archive 搜不到
  await typeQuery(page, 'mail');
  t = await titles(page);
  check(t.includes('Quick Mail') && !t.includes('Mail Archive'), `搜 mail：只有 Quick Mail ${JSON.stringify(t)}`);

  // 4. 按分组名搜：出这个分组里的每一条
  await typeQuery(page, 'hiwi2');
  t = await titles(page);
  check(t.includes('Jira') && t.includes('Slack'), `搜分组名 hiwi2：Jira、Slack 都出来 ${JSON.stringify(t)}`);

  // 5. 只在外面有的：搜不到，提示只搜了快捷书签，给「在全部书签里找」
  await typeQuery(page, 'outside');
  t = await titles(page);
  const empty = (await page.locator('#bkResults .bk-noresult').textContent().catch(() => '')) || '';
  await page.screenshot({ path: join(OUT, 'chrome-3-none.png') });
  await page.setViewportSize({ width: 420, height: 760 });
  await page.screenshot({ path: join(OUT, 'chrome-3-none-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 860 });
  check(t.length === 0, `搜 outside：没有结果 ${JSON.stringify(t)}`);
  check(/快捷书签/.test(empty), `搜不到时说明只搜了快捷书签：「${empty.trim()}」`);
  const allLink = page.locator('#bkResults a[data-bk-all]');
  check(await allLink.count() === 1, '搜不到时有「在全部书签里找」');
  if (await allLink.count()) {
    await page.locator('#bkSearch').press('Enter'); // 搜不到时回车 = 点「在全部书签里找」
    await page.waitForURL(/manager\/manager\.html/, { timeout: 5000 }).catch(() => {});
    check(page.url().startsWith(`chrome-extension://${extId}/manager/manager.html`), `回车在这一页打开整理书签：${page.url()}`);
    await page.waitForFunction(() => !document.querySelector('#all-flat')?.hidden, null, { timeout: 5000 }).catch(() => {});
    const v = await page.inputValue('#all-search').catch(() => '');
    const rows = await page.$$eval('#all-flat .bm-row a', (els) => els.map((e) => e.textContent.trim()));
    await page.screenshot({ path: join(OUT, 'chrome-4-manager.png') });
    check(v === 'outside' && rows.includes('Outside Docs'), `整理书签页带着「outside」搜全部书签：${JSON.stringify(rows)}`);
    await page.goBack();
    await page.waitForSelector('#bkQuick .bk-tile');
    // 鼠标点链接也一样
    await typeQuery(page, 'wiki');
    await page.locator('#bkResults a[data-bk-all]').click();
    await page.waitForURL(/manager\/manager\.html\?q=wiki/, { timeout: 5000 }).catch(() => {});
    check(/manager\/manager\.html\?q=wiki$/.test(page.url()), `点「在全部书签里找」打开整理书签：${page.url()}`);
    await page.goBack();
    await page.waitForSelector('#bkQuick .bk-tile');
  }

  // 6. 搜着的时候新加一条快捷书签，结果跟着出来
  await typeQuery(page, 'newbie');
  await sw.evaluate(async () => {
    const [q] = await chrome.bookmarks.search({ title: '书签管家·快捷书签' });
    await chrome.bookmarks.create({ parentId: q.id, title: 'Newbie Site', url: 'https://newbie.example/' });
  });
  const live = await page.waitForFunction(() => [...document.querySelectorAll('#bkResults .bk-r-title')].some((e) => e.textContent.includes('Newbie')), null, { timeout: 4000 }).then(() => true, () => false);
  check(live, '搜着时新加的快捷书签出现在结果里');

  // 7. 键盘：搜 slack 出 Slack 一条，↓ 再 ↑ 回到它，回车打开
  await typeQuery(page, 'slack');
  t = await titles(page);
  await page.locator('#bkSearch').press('ArrowDown');
  await page.locator('#bkSearch').press('ArrowUp');
  await page.locator('#bkSearch').press('Enter');
  await page.waitForURL(/\.example\//, { timeout: 4000 }).catch(() => {});
  check(page.url().startsWith('https://slack.example/'), `搜 slack 回车打开分组 hiwi2 里的 Slack：${page.url()} ${JSON.stringify(t)}`);

  // 8. Esc 清空
  await page.goto(newtab);
  await page.waitForSelector('#bkQuick .bk-tile');
  await typeQuery(page, 'jira');
  await page.locator('#bkSearch').press('Escape');
  check(await page.locator('#bkResults').isHidden(), 'Esc 清空搜索、收起结果');
  check(errors.length === 0, `页面没有报错 ${JSON.stringify(errors)}`);
  await page.close();

  // ---------- 工具栏弹窗：同样只搜快捷书签 ----------
  const popupUrl = `chrome-extension://${extId}/popup/popup.html`;
  const popupTitles = (p) => p.$$eval('#results .r-title', (els) => els.map((e) => e.textContent.trim()));
  async function popupQuery(p, q) {
    const box = p.locator('#search');
    await box.fill('');
    await p.waitForFunction(() => document.querySelector('#results-section').hidden, null, { timeout: 3000 });
    await box.pressSequentially(q, { delay: 20 });
    await p.waitForFunction(() => {
      const r = document.querySelector('#results-section');
      if (r.hidden) return false;
      const html = r.innerHTML;
      const prev = window.__e2ePrev;
      window.__e2ePrev = html;
      return prev === html;
    }, null, { polling: 200, timeout: 5000 });
    await p.evaluate(() => { delete window.__e2ePrev; });
  }
  async function openPopup(scheme) {
    const p = await context.newPage();
    await p.emulateMedia({ colorScheme: scheme });
    await p.setViewportSize({ width: 380, height: 560 });
    p.on('pageerror', (e) => errors.push('popup: ' + e.message));
    await p.goto(popupUrl);
    await p.waitForFunction(() => document.querySelectorAll('#quick-grid > *').length >= 4, null, { timeout: 8000 });
    return p;
  }
  for (const scheme of ['light', 'dark']) {
    const p = await openPopup(scheme);
    await p.screenshot({ path: join(OUT, `popup-${scheme}-1-idle.png`) });
    const ph = await p.getAttribute('#search', 'placeholder');
    check(/快捷书签/.test(ph || ''), `弹窗（${scheme}）占位字：「${ph}」`);
    await popupQuery(p, 'moodle');
    t = await popupTitles(p);
    const sub = (await p.locator('#results .r-url').first().textContent().catch(() => '')) || '';
    await p.screenshot({ path: join(OUT, `popup-${scheme}-2-moodle.png`) });
    check(t.includes('Moodle') && !t.includes('Moodle Archive'), `弹窗（${scheme}）搜 moodle：只有分组里的 Moodle ${JSON.stringify(t)}`);
    check(/学校/.test(sub), `弹窗（${scheme}）结果写出分组「学校」：「${sub.trim()}」`);
    await popupQuery(p, 'outside');
    t = await popupTitles(p);
    const none = (await p.locator('#no-results').textContent().catch(() => '')) || '';
    await p.screenshot({ path: join(OUT, `popup-${scheme}-3-none.png`) });
    check(t.length === 0 && /快捷书签/.test(none), `弹窗（${scheme}）搜 outside：没有结果，说明只搜了快捷书签「${none.trim()}」 ${JSON.stringify(t)}`);
    await p.close();
  }
  {
    // 弹窗里点「在全部书签里找」：新标签打开整理书签页并带着词
    const p = await openPopup('light');
    await popupQuery(p, 'outside');
    const btn = p.locator('#no-results [data-bk-all]');
    check(await btn.count() === 1, '弹窗搜不到时有「在全部书签里找」');
    if (await btn.count()) {
      const [mgr] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }), btn.click()]);
      await mgr.waitForLoadState();
      await mgr.waitForFunction(() => !document.querySelector('#all-flat')?.hidden, null, { timeout: 5000 }).catch(() => {});
      const rows = await mgr.$$eval('#all-flat .bm-row a', (els) => els.map((e) => e.textContent.trim()));
      check(/manager\/manager\.html\?q=outside$/.test(mgr.url()) && rows.includes('Outside Docs'), `弹窗点了打开整理书签搜全部：${mgr.url()} ${JSON.stringify(rows)}`);
      await mgr.close();
    }
    if (!p.isClosed()) await p.close();
    // 回车：搜不到时同样打开整理书签；搜得到时打开选中的那条
    const q = await openPopup('light');
    await popupQuery(q, 'wiki');
    const [mgr2] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), q.locator('#search').press('Enter').catch(() => {})]); // 弹窗打开后会关掉自己
    check(!!mgr2 && /manager\/manager\.html\?q=wiki$/.test(mgr2.url()), `弹窗搜不到时回车打开整理书签：${mgr2?.url()}`);
    await mgr2?.close();
    if (!q.isClosed()) await q.close();
    const r = await openPopup('light');
    await popupQuery(r, 'jira');
    await r.locator('#search').press('Enter').catch(() => {}); // 弹窗打开后会关掉自己
    // 扩展用 chrome.tabs.create 开的标签，Playwright 接上时可能已经导航过去：直接问浏览器开了哪些标签
    const opened = await sw.evaluate(async () => {
      for (let i = 0; i < 25; i++) {
        const hit = (await chrome.tabs.query({})).find((t) => (t.pendingUrl || t.url || '').startsWith('https://jira.example/'));
        if (hit) { await chrome.tabs.remove(hit.id); return true; }
        await new Promise((res) => setTimeout(res, 200));
      }
      return false;
    });
    check(opened, '弹窗搜 jira 回车，新标签打开分组里的 Jira');
    if (!r.isClosed()) await r.close();
  }
  check(errors.length === 0, `弹窗没有报错 ${JSON.stringify(errors)}`);

  // ---------- 模拟 Safari：没有书签接口，快捷书签来自 Mac App ----------
  const records = diffList(structuredClone(QUICK), [], {}, { device: 'mac', now: 1000, newId: (() => { let i = 0; return () => `r${++i}`; })() });
  const safari = await context.newPage();
  const asSafari = (p) => p.addInitScript((records) => {
    if (!location.protocol.startsWith('chrome-extension')) return;
    Object.defineProperty(chrome, 'bookmarks', { value: undefined, configurable: true });
    const fake = async (_host, msg) => {
      if (msg.cmd === 'rev') return { ok: true, rev: '1' };
      if (msg.cmd === 'put') Object.assign(records, msg.records);
      return { ok: true, records, rev: '1', icloud: true };
    };
    Object.defineProperty(chrome.runtime, 'sendNativeMessage', { value: fake, configurable: true });
  }, records);
  await asSafari(safari);
  const sErrors = [];
  safari.on('pageerror', (e) => sErrors.push(e.message));
  await safari.goto(newtab);
  await safari.waitForFunction(() => document.querySelectorAll('#bkQuick .bk-tile').length >= 4, null, { timeout: 8000 });
  await safari.screenshot({ path: join(OUT, 'safari-1-idle.png') });
  const hasBox = await safari.locator('#bkSearch').count();
  check(hasBox === 1, 'Safari（模拟）新标签页也有搜索框');
  if (hasBox) {
    await typeQuery(safari, 'moodle');
    t = await titles(safari);
    await safari.screenshot({ path: join(OUT, 'safari-2-moodle.png') });
    check(t.includes('Moodle'), `Safari 搜 moodle 找到分组里的 Moodle ${JSON.stringify(t)}`);
    await typeQuery(safari, 'outside');
    check(await safari.locator('#bkResults a[data-bk-all]').count() === 0, 'Safari 搜不到时不给「在全部书签里找」（Safari 没有整理书签页）');
    await safari.screenshot({ path: join(OUT, 'safari-3-none.png') });
  }
  {
    const sp = await context.newPage();
    await asSafari(sp);
    await sp.setViewportSize({ width: 380, height: 560 });
    sp.on('pageerror', (e) => sErrors.push('popup: ' + e.message));
    await sp.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sp.waitForFunction(() => document.querySelectorAll('#quick-grid > *').length >= 4, null, { timeout: 8000 });
    const visible = await sp.locator('#search').isVisible();
    check(visible, 'Safari（模拟）弹窗也有搜索框');
    if (visible) {
      await popupQuery(sp, 'moodle');
      t = await popupTitles(sp);
      check(t.includes('Moodle'), `Safari 弹窗搜 moodle 找到分组里的 Moodle ${JSON.stringify(t)}`);
      await popupQuery(sp, 'outside');
      check(await sp.locator('#no-results [data-bk-all]').count() === 0, 'Safari 弹窗搜不到时不给「在全部书签里找」');
      await sp.screenshot({ path: join(OUT, 'safari-popup-none.png') });
    }
    await sp.close();
  }
  check(sErrors.length === 0, `Safari 页面没有报错 ${JSON.stringify(sErrors)}`);
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\n截图：${OUT}`);
if (failures.length) {
  console.log(`${failures.length} 项没过`);
  process.exit(1);
}
console.log('全部通过');
