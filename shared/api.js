// 大模型 API 封装：兼容智谱 GLM 与 DeepSeek（均为 OpenAI 风格 chat/completions 接口）

export const PROVIDERS = {
  zhipu: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  custom: {
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    defaultModel: '',
    keyUrl: '',
  },
};

const DEFAULT_CONFIG = {
  provider: 'zhipu',
  apiKey: '',
  baseUrl: PROVIDERS.zhipu.baseUrl,
  model: PROVIDERS.zhipu.defaultModel,
};

// API Key 存在 storage.local（不随 Chrome 账号同步，避免泄露面扩大）
export async function getAIConfig() {
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  return { ...DEFAULT_CONFIG, ...(aiConfig || {}) };
}

export async function saveAIConfig(cfg) {
  await chrome.storage.local.set({ aiConfig: cfg });
}

export async function chatComplete(messages, { temperature = 0.2, maxTokens = 4096 } = {}) {
  const cfg = await getAIConfig();
  if (!cfg.apiKey) throw new Error('未配置 API Key，请先在「设置」中填写');
  if (!cfg.baseUrl) throw new Error('未配置 API 地址');

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API 请求失败 (HTTP ${res.status})：${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('API 返回格式异常：' + JSON.stringify(data).slice(0, 300));
  return content;
}

// 从模型返回文本中提取 JSON（容忍 ```json 围栏和前后闲话）
export function extractJSON(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  // 从末尾往回找匹配的收尾括号
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (end >= 0) t = t.slice(0, end + 1);
  return JSON.parse(t);
}
