import { PROVIDERS, getAIConfig, saveAIConfig, chatComplete } from '../shared/api.js';

const $ = (s) => document.querySelector(s);
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

(async function init() {
  const cfg = await getAIConfig();
  providerEl.value = cfg.provider;
  baseUrlEl.value = cfg.baseUrl;
  modelEl.value = cfg.model;
  apiKeyEl.value = cfg.apiKey;
  applyProviderDefaults(false);
})();
