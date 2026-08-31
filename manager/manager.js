import { faviconUrl, debounce, collectAllBookmarks } from '../shared/util.js';
import { getAIConfig, chatComplete, extractJSON, PROVIDERS } from '../shared/api.js';
import { searchBookmarks } from '../shared/fuzzy.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---------- 面板切换 ----------

$$('.nav-btn[data-panel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-btn[data-panel]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.panel').forEach((p) => (p.hidden = p.id !== btn.dataset.panel));
  });
});

$('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

// ---------- 通用：两步确认删除按钮 ----------

function makeDeleteButton(onDelete) {
  const btn = document.createElement('button');
  btn.className = 'bm-del';
  btn.textContent = '删除';
  let armed = false;
  let timer;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!armed) {
      armed = true;
      btn.textContent = '确认删除?';
      btn.classList.add('confirm');
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = '删除';
        btn.classList.remove('confirm');
      }, 3000);
    } else {
      clearTimeout(timer);
      await onDelete();
    }
  });
  return btn;
}

// ---------- 全部书签 ----------

const allTree = $('#all-tree');
const allFlat = $('#all-flat');
const allSearch = $('#all-search');

async function renderAllTree() {
  const tree = await chrome.bookmarks.getTree();
  allTree.textContent = '';
  let total = 0;

  function countBookmarks(node) {
    if (node.url) return 1;
    return (node.children || []).reduce((s, c) => s + countBookmarks(c), 0);
  }

  function renderNode(node, container, depth) {
    if (node.url) {
      total++;
      container.append(bookmarkRow(node, { showUrl: true }));
      return;
    }
    const details = document.createElement('details');
    if (depth < 2) details.open = true;
    const summary = document.createElement('summary');
    summary.innerHTML = '';
    summary.textContent = `📁 ${node.title || '书签'} `;
    const cnt = document.createElement('span');
    cnt.className = 'count';
    cnt.textContent = `(${countBookmarks(node)})`;
    summary.append(cnt);
    details.append(summary);
    for (const child of node.children || []) renderNode(child, details, depth + 1);
    container.append(details);
  }

  for (const root of tree[0].children || []) renderNode(root, allTree, 0);
  $('#all-count').textContent = `共 ${total} 条`;
}

function bookmarkRow(node, { showUrl = false, path = '' } = {}) {
  const row = document.createElement('div');
  row.className = 'bm-row';
  const img = document.createElement('img');
  img.src = faviconUrl(node.url, 32);
  const a = document.createElement('a');
  a.href = node.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = node.title || node.url;
  a.title = node.url;
  row.append(img, a);
  if (path) {
    const p = document.createElement('span');
    p.className = 'bm-url';
    p.textContent = path;
    row.append(p);
  } else if (showUrl) {
    const u = document.createElement('span');
    u.className = 'bm-url';
    u.textContent = node.url;
    row.append(u);
  }
  row.append(makeDeleteButton(async () => {
    await chrome.bookmarks.remove(node.id);
    row.remove();
  }));
  return row;
}

allSearch.addEventListener('input', debounce(async () => {
  const q = allSearch.value.trim();
  if (!q) {
    allFlat.hidden = true;
    allTree.hidden = false;
    return;
  }
  const all = await collectAllBookmarks();
  const hits = searchBookmarks(q, all, 200);
  allFlat.textContent = '';
  for (const b of hits) {
    const li = document.createElement('li');
    li.append(bookmarkRow(b, { path: b.path }));
    allFlat.append(li);
  }
  if (!hits.length) {
    const li = document.createElement('li');
    li.textContent = '没有匹配的书签';
    allFlat.append(li);
  }
  allFlat.hidden = false;
  allTree.hidden = true;
}, 150));

// ---------- 失效检测 ----------

const scanBtn = $('#scan-btn');
const scanStop = $('#scan-stop');
const scanProgress = $('#scan-progress');
const scanBarWrap = $('#scan-bar-wrap');
const scanBar = $('#scan-bar');
const deadResults = $('#dead-results');
const deadList = $('#dead-list');
const warnList = $('#warn-list');

let scanAbort = false;

async function checkUrl(url, timeoutMs = 12000) {
  if (!/^https?:/i.test(url)) return { status: 'skip' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'HEAD', redirect: 'follow', credentials: 'omit', signal: ctrl.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      res = null;
    }
    // 很多网站不支持 HEAD 或对其返回错误，换 GET 再试一次
    if (!res || res.status >= 400) {
      res = await fetch(url, {
        method: 'GET', redirect: 'follow', credentials: 'omit', signal: ctrl.signal,
      });
    }
    if (res.status === 404 || res.status === 410) return { status: 'dead', code: `HTTP ${res.status}` };
    if (res.status >= 400) return { status: 'warn', code: `HTTP ${res.status}` };
    return { status: 'ok', code: `HTTP ${res.status}` };
  } catch (e) {
    if (e.name === 'AbortError') return { status: 'warn', code: '超时' };
    return { status: 'dead', code: '无法连接' };
  } finally {
    clearTimeout(timer);
  }
}

async function runScan() {
  scanAbort = false;
  scanBtn.disabled = true;
  scanStop.hidden = false;
  deadResults.hidden = true;
  deadList.textContent = '';
  warnList.textContent = '';

  const all = await collectAllBookmarks();
  const targets = all.filter((b) => /^https?:/i.test(b.url));
  let done = 0;
  const dead = [];
  const warn = [];

  scanBarWrap.hidden = false;
  scanProgress.textContent = `0 / ${targets.length}`;

  const CONCURRENCY = 10;
  const queue = [...targets];
  async function worker() {
    while (queue.length && !scanAbort) {
      const b = queue.shift();
      const result = await checkUrl(b.url);
      done++;
      if (result.status === 'dead') dead.push({ ...b, code: result.code });
      else if (result.status === 'warn') warn.push({ ...b, code: result.code });
      scanProgress.textContent = `${done} / ${targets.length}（失效 ${dead.length}，疑似 ${warn.length}）`;
      scanBar.style.width = `${(done / targets.length) * 100}%`;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  scanBtn.disabled = false;
  scanBtn.textContent = '重新扫描';
  scanStop.hidden = true;
  scanProgress.textContent = scanAbort
    ? `已停止（检查了 ${done} / ${targets.length}，失效 ${dead.length}，疑似 ${warn.length}）`
    : `扫描完成：共 ${targets.length} 条，失效 ${dead.length}，疑似问题 ${warn.length}`;

  renderScanResults(dead, warn);
}

function scanResultItem(b, checked) {
  const li = document.createElement('li');
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = checked;
  chk.dataset.id = b.id;
  chk.addEventListener('change', updateSelCount);
  const img = document.createElement('img');
  img.src = faviconUrl(b.url, 32);
  const a = document.createElement('a');
  a.href = b.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = b.title;
  a.title = b.url;
  const code = document.createElement('span');
  code.className = 'bm-code';
  code.textContent = b.code;
  const path = document.createElement('span');
  path.className = 'bm-path';
  path.textContent = b.path;
  li.append(chk, img, a, code, path);
  return li;
}

function renderScanResults(dead, warn) {
  deadList.textContent = '';
  warnList.textContent = '';
  dead.forEach((b) => deadList.append(scanResultItem(b, true)));
  warn.forEach((b) => warnList.append(scanResultItem(b, false)));
  $('#dead-count').textContent = `${dead.length} 条`;
  $('#warn-count').textContent = `${warn.length} 条`;
  deadResults.hidden = false;
  updateSelCount();
}

function updateSelCount() {
  const n = $$('#dead-results input[type=checkbox][data-id]:checked').length;
  $('#sel-count').textContent = n;
  $('#delete-selected').disabled = n === 0;
}

$('#check-all-dead').addEventListener('change', (e) => {
  $$('#dead-list input[type=checkbox][data-id]').forEach((c) => (c.checked = e.target.checked));
  updateSelCount();
});

$('#delete-selected').addEventListener('click', async () => {
  const checked = [...$$('#dead-results input[type=checkbox][data-id]:checked')];
  if (!checked.length) return;
  const btn = $('#delete-selected');
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = `确认删除这 ${checked.length} 条书签？（再点一次执行）`;
    setTimeout(() => {
      btn.dataset.armed = '0';
      btn.innerHTML = `删除选中 (<span id="sel-count">${checked.length}</span>)`;
    }, 4000);
    return;
  }
  for (const c of checked) {
    try {
      await chrome.bookmarks.remove(c.dataset.id);
      c.closest('li').remove();
    } catch { /* 可能已被删除 */ }
  }
  btn.dataset.armed = '0';
  btn.innerHTML = '删除选中 (<span id="sel-count">0</span>)';
  updateSelCount();
  renderAllTree();
});

scanBtn.addEventListener('click', runScan);
scanStop.addEventListener('click', () => { scanAbort = true; });

// ---------- AI 智能整理 ----------

const aiStart = $('#ai-start');
const aiProgress = $('#ai-progress');
const aiPreview = $('#ai-preview');
const aiGroups = $('#ai-groups');
const aiApply = $('#ai-apply');
const aiApplyStatus = $('#ai-apply-status');

let aiPlan = null; // [{ name, bookmarks: [{id,title,url}] }]

async function refreshAIStatus() {
  const cfg = await getAIConfig();
  const el = $('#ai-config-status');
  if (cfg.apiKey) {
    el.textContent = `当前模型：${PROVIDERS[cfg.provider]?.name || cfg.provider} · ${cfg.model} ✓`;
  } else {
    el.innerHTML = '⚠️ 尚未配置 API Key，请先到 <a href="#" id="goto-options">设置</a> 中填写（支持智谱 GLM-5.3 / DeepSeek）。';
    $('#goto-options')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
  return cfg;
}

const CHUNK_SIZE = 80;

async function categorizeChunk(chunk, knownCategories) {
  const lines = chunk.map((b) => `${b.id}\t${b.title.slice(0, 80)}\t${b.url.slice(0, 120)}`).join('\n');
  const reuse = knownCategories.length
    ? `尽量复用这些已有分类名（语义相符时必须复用）：${knownCategories.join('、')}。`
    : '';
  const messages = [
    {
      role: 'system',
      content:
        '你是浏览器书签整理助手。用户提供一批书签（每行格式：id<TAB>标题<TAB>URL），' +
        '请按主题把它们分类。要求：分类名用简洁中文（2~6 个字，如「开发工具」「新闻资讯」「学术论文」）；' +
        '每条书签必须且只能属于一个分类；不确定的归入「其他」。' + reuse +
        '只返回 JSON，格式：{"categories":[{"name":"分类名","ids":["id1","id2"]}]}，不要任何其他文字。',
    },
    { role: 'user', content: lines },
  ];
  const reply = await chatComplete(messages, { temperature: 0.1 });
  const parsed = extractJSON(reply);
  if (!parsed || !Array.isArray(parsed.categories)) throw new Error('模型返回的 JSON 结构不符合预期');
  return parsed.categories;
}

aiStart.addEventListener('click', async () => {
  const cfg = await refreshAIStatus();
  if (!cfg.apiKey) return;

  aiStart.disabled = true;
  aiPreview.hidden = true;
  aiGroups.textContent = '';
  aiPlan = null;

  try {
    const all = await collectAllBookmarks();
    const targets = all.filter((b) => /^https?:/i.test(b.url));
    const byId = new Map(targets.map((b) => [b.id, b]));
    const chunks = [];
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) chunks.push(targets.slice(i, i + CHUNK_SIZE));

    const merged = new Map(); // name -> Set(ids)
    for (let i = 0; i < chunks.length; i++) {
      aiProgress.textContent = `正在分类… ${i + 1} / ${chunks.length} 批（共 ${targets.length} 条书签）`;
      const categories = await categorizeChunk(chunks[i], [...merged.keys()]);
      for (const cat of categories) {
        if (!cat?.name || !Array.isArray(cat.ids)) continue;
        const name = String(cat.name).trim().slice(0, 20) || '其他';
        if (!merged.has(name)) merged.set(name, new Set());
        for (const id of cat.ids) {
          if (byId.has(String(id))) merged.get(name).add(String(id));
        }
      }
    }

    // 汇总，去掉空分类
    aiPlan = [...merged.entries()]
      .map(([name, ids]) => ({ name, bookmarks: [...ids].map((id) => byId.get(id)) }))
      .filter((g) => g.bookmarks.length > 0)
      .sort((a, b) => b.bookmarks.length - a.bookmarks.length);

    const categorized = aiPlan.reduce((s, g) => s + g.bookmarks.length, 0);
    aiProgress.textContent = `分类完成：${aiPlan.length} 个分类，覆盖 ${categorized} / ${targets.length} 条书签。请预览后应用。`;
    renderAIPreview();
  } catch (e) {
    aiProgress.textContent = `❌ 出错：${e.message}`;
  } finally {
    aiStart.disabled = false;
  }
});

function renderAIPreview() {
  aiGroups.textContent = '';
  for (const group of aiPlan) {
    const div = document.createElement('div');
    div.className = 'ai-group';
    const h3 = document.createElement('h3');
    h3.textContent = `📁 ${group.name}（${group.bookmarks.length}）`;
    div.append(h3);
    for (const b of group.bookmarks) {
      const row = document.createElement('div');
      row.className = 'bm-row';
      const img = document.createElement('img');
      img.src = faviconUrl(b.url, 32);
      const a = document.createElement('a');
      a.href = b.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = b.title;
      a.title = b.url;
      row.append(img, a);
      div.append(row);
    }
    aiGroups.append(div);
  }
  aiPreview.hidden = false;
}

aiApply.addEventListener('click', async () => {
  if (!aiPlan?.length) return;
  aiApply.disabled = true;
  try {
    const date = new Date().toISOString().slice(0, 10);
    // parentId "1" = 书签栏
    const root = await chrome.bookmarks.create({ parentId: '1', title: `AI 整理 ${date}` });
    let moved = 0;
    const totalToMove = aiPlan.reduce((s, g) => s + g.bookmarks.length, 0);
    for (const group of aiPlan) {
      const folder = await chrome.bookmarks.create({ parentId: root.id, title: group.name });
      for (const b of group.bookmarks) {
        try {
          await chrome.bookmarks.move(b.id, { parentId: folder.id });
          moved++;
        } catch { /* 书签可能已被删除 */ }
        if (moved % 20 === 0) aiApplyStatus.textContent = `移动中… ${moved} / ${totalToMove}`;
      }
    }
    aiApplyStatus.textContent = `✅ 完成：已把 ${moved} 条书签整理进「AI 整理 ${date}」文件夹`;
    renderAllTree();
  } catch (e) {
    aiApplyStatus.textContent = `❌ 出错：${e.message}`;
  } finally {
    aiApply.disabled = false;
  }
});

// ---------- 初始化 ----------

renderAllTree();
refreshAIStatus();
