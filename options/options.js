import '../shared/compat.js';
import { PROVIDERS, getAIConfig, saveAIConfig, chatComplete } from '../shared/api.js';
import { syncStatus } from '../shared/quicklinks.js';
import { APP_DOWNLOAD_URL } from '../shared/env.js';

const $ = (s) => document.querySelector(s);

// ---------- 快捷书签同步方式 ----------
(async function renderSync() {
  const s = await syncStatus();
  const app = `<a href="${APP_DOWNLOAD_URL}" target="_blank" rel="noopener">BookmarkKeeper App</a>`;
  $('#sync-state').innerHTML = {
    icloud: '✅ 经 Mac 上的 BookmarkKeeper App 存在 iCloud：这台电脑的 Chrome、Safari，以及登录同一 Apple ID 的其他 Mac 共用同一份快捷书签。',
    local: '⚠️ BookmarkKeeper App 已连接，但 iCloud 云盘没有打开：快捷书签只保存在这台 Mac 上。打开「系统设置 → Apple ID → iCloud → iCloud 云盘」后自动开始同步。',
    chrome: s.lost
      ? `⚠️ 以前用过 ${app}，现在连不上，显示的是 Chrome 书签文件夹里的旧数据。打开一次 App 即可恢复。`
      : `存在 Chrome 书签「其他书签 / 书签管家·快捷书签」里，随 Chrome 书签同步到登录同一 Google 账号的电脑。想和 Safari 共用，在 Mac 上安装 ${app}。`,
    error: `❌ 连不上 ${app}：${s.error || ''}`,
  }[s.mode];
})();

// ---------- 备份与迁移：只导出扩展自己存的数据（不含快捷书签） ----------
const BACKUP_KEYS = ['deferred', 'aiConfig'];
const backupStatus = (text, ok) => {
  const el = $('#backup-status');
  el.textContent = text;
  el.className = 'status ' + (ok === undefined ? '' : ok ? 'ok' : 'err');
};

$('#export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(BACKUP_KEYS);
  const blob = new Blob([JSON.stringify({ app: 'bookmark-keeper', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bookmark-keeper-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
  backupStatus('✅ 已导出（文件里含 API Key，注意保管）', true);
});

$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.app !== 'bookmark-keeper' || typeof parsed.data !== 'object') throw new Error('不是书签管家的备份文件');
    const data = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => BACKUP_KEYS.includes(k)));
    // 稍后再看：按网址合并，不覆盖本机已有的
    if (Array.isArray(data.deferred)) {
      const { deferred: cur = [] } = await chrome.storage.local.get('deferred');
      const urls = new Set(cur.map((d) => d.url));
      data.deferred = [...cur, ...data.deferred.filter((d) => d?.url && !urls.has(d.url))];
    }
    await chrome.storage.local.set(data);
    backupStatus(`✅ 已导入：${Object.keys(data).map((k) => ({ deferred: '稍后再看', aiConfig: 'AI 配置' }[k])).join('、') || '没有可导入的数据'}`, true);
    if (data.aiConfig) await fillAIConfig();
  } catch (err) {
    backupStatus(`❌ ${err.message}`, false);
  }
});
const providerEl = $('#provider');
const baseUrlEl = $('#baseUrl');
const modelEl = $('#model');
const apiKeyEl = $('#apiKey');
const statusEl = $('#status');
const keyHelp = $('#key-help');

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + (ok === undefined ? '' : ok ? 'ok' : 'err');
}

function applyProviderDefaults(overwrite) {
  const p = PROVIDERS[providerEl.value];
  if (!p) return;
  if (overwrite || !baseUrlEl.value) baseUrlEl.value = p.baseUrl;
  if (overwrite || !modelEl.value) modelEl.value = p.defaultModel;
  keyHelp.innerHTML = p.keyUrl
    ? `到 <a href="${p.keyUrl}" target="_blank" rel="noopener">${new URL(p.keyUrl).hostname}</a> 申请 API Key`
    : '填写任意 OpenAI 兼容接口的地址（以 /v1 或等价路径结尾）、模型名和 Key';
}

providerEl.addEventListener('change', () => applyProviderDefaults(true));

$('#toggle-key').addEventListener('click', () => {
  const hidden = apiKeyEl.type === 'password';
  apiKeyEl.type = hidden ? 'text' : 'password';
  $('#toggle-key').textContent = hidden ? '隐藏' : '显示';
});

function collect() {
  return {
    provider: providerEl.value,
    baseUrl: baseUrlEl.value.trim(),
    model: modelEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
  };
}

$('#save').addEventListener('click', async () => {
  const cfg = collect();
  if (!cfg.apiKey) return setStatus('请填写 API Key', false);
  if (!cfg.baseUrl) return setStatus('请填写 API 地址', false);
  if (!cfg.model) return setStatus('请填写模型名称', false);
  await saveAIConfig(cfg);
  setStatus('✅ 已保存', true);
});

$('#test').addEventListener('click', async () => {
  const btn = $('#test');
  btn.disabled = true;
  setStatus('测试中…');
  try {
    await saveAIConfig(collect());
    const reply = await chatComplete(
      [{ role: 'user', content: '请只回复两个字：正常' }],
      { maxTokens: 16 }
    );
    setStatus(`✅ 连接成功，模型回复：${reply.trim().slice(0, 20)}`, true);
  } catch (e) {
    setStatus(`❌ ${e.message}`, false);
  } finally {
    btn.disabled = false;
  }
});

// ---------- 开发：热重载开关（仅未打包扩展显示）----------
const HOT_RELOAD_MS = 3600e3;
const hotReloadEl = $('#hotReload');
const hotReloadState = $('#hotReloadState');

async function renderHotReload() {
  const { hotReloadUntil = 0 } = await chrome.storage.local.get('hotReloadUntil');
  const on = Date.now() < hotReloadUntil;
  hotReloadEl.checked = on;
  hotReloadState.textContent = on
    ? `当前已开启，${new Date(hotReloadUntil).toLocaleTimeString()} 自动关闭`
    : '当前未开启';
}

if (!('update_url' in chrome.runtime.getManifest())) {
  $('#dev-card').hidden = false;
  hotReloadEl.addEventListener('change', async () => {
    await chrome.storage.local.set({ hotReloadUntil: hotReloadEl.checked ? Date.now() + HOT_RELOAD_MS : 0 });
    renderHotReload();
  });
  renderHotReload();
}

async function fillAIConfig() {
  const cfg = await getAIConfig();
  providerEl.value = cfg.provider;
  baseUrlEl.value = cfg.baseUrl;
  modelEl.value = cfg.model;
  apiKeyEl.value = cfg.apiKey;
  applyProviderDefaults(false);
}
fillAIConfig();
