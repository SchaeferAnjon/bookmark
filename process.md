# Process log

---

## 2026-09-10 · v0.4.7 — 热重载改按需 + 弹窗启动再瘦身

### What I did
- 从用户真实 Chrome 的 LevelDB 读出 v0.4.3 埋的 perfLog：HTML 几毫秒就到（respEnd 7ms），但 domInteractive 2.6s / 7.3s / 最长 92.7s，随后取 popup.js 2.5s、favicon 4s——整个扩展进程和资源路径在爬。同时机器 swap 19/20 GB、load 23，`Secure Preferences` 里 SW 注册版本还停在 0.4.6，说明用户 Chrome 里 SW 早已不在跑（改文件也不触发重载）。结论：主因是内存吃紧下扩展渲染进程被换出，点开要从 swap 换回；扩展能做的是把自己在冷启动关键路径上的活压到最少。
- `background.js` 热重载不再常驻：设置页「开发」卡片勾选后生效，`storage.local.hotReloadUntil` 记到期时间（1 小时自动关），轮询 2s，读取失败一律跳过不重载（2026-08-31 记过的「假 reload 让点图标没反应」这条路彻底堵死）。去掉 onStartup / getPlatformInfo 保活和 swStarts 日志，SW 该闲就闲；弹窗本就不依赖 SW。
- 弹窗全部书签预取从「打开后 800ms idle」改为「搜索框第一次按键」；诊断行 SW 启动次数换成热重载开关状态。
- Playwright 加载真实扩展：SW 空闲 5s 内 0 次源文件 fetch；开关开 26 次/5s，关回 0；开着改 util.js 1.5s 后 SW 关闭（reload 触发）；格子渲染、搜索、无报错。headless 下 `runtime.reload()` 后扩展不会回来（旧版同样如此），是 harness 限制，不是回归。

### 未解 / 给用户的话
- 92s 那次没有单一代码解释，机器层面的换页是最合理的解释；本机常驻 iOS 模拟器、多个 Claude/Codex、微信小程序等，Chrome 22 小时未重启。扩展侧已无常驻负载，剩下的慢是系统的。

---

## 2026-09-01 · v0.3.0 — 模糊搜索 + 相关性排序

### What I did
- 新建 `shared/fuzzy.js`（纯函数，无 chrome 依赖）：别名归一（c++↔cpp、c#↔csharp、node.js↔nodejs 等，查询和文本两侧同做替换）→ 每个查询词在 标题×3 / 路径×1.5 / URL×1 三字段取最高分（完整子串 100+ 词首/位置加成 > 模糊子序列封顶 70；URL 不做模糊，长 URL 会乱命中）→ 多词全命中才算匹配，按总分降序。
- 弹窗搜索从 `chrome.bookmarks.search` 换成 打开时预取全部书签 + 内存模糊搜索；管理页过滤同样接入。
- Node 单测 5 组断言全过；CDP 在用户真实书签上实测：`c++`/`cpp` 结果一致，前四名全为 C++ 相关（菜鸟教程/cppreference/编程c++），弱模糊命中垫底。
- `package.json` 加 `"type":"module"`（仅供 Node 工具链识别 ESM，扩展本身不用）；fuzzy.js 加入热重载监控列表。

### Bugs / surprises
- 模糊子序列对 URL 字段噪音极大（任意长 URL 都能凑出 c…p…p），改为 URL 只做子串匹配后干净很多。

### Files touched
- `shared/fuzzy.js` — 新增
- `popup/popup.js`、`manager/manager.js` — 接入 searchBookmarks
- `background.js` — 监控列表加 fuzzy.js
- `manifest.json`、`package.json` — 0.3.0

---

## 2026-09-01 · v0.2.1 — 快捷书签格子修复 + 假重载修复

### What I did
- 修弹窗被撑爆：grid `repeat(4,1fr)` 的 1fr 实为 minmax(auto,1fr)，不换行长标题的 min-content 会把轨道和整个弹窗撑到 Chrome 800px 上限。改 `minmax(0,1fr)` + `.quick-item{min-width:0}` + `.q-title{width:100%}` 锁死四列等宽。
- 标题层面也治本：新增 `shortTitle()`（按 `|`、`·`、` - `、`: ` 等分隔符取第一段，≤20 字），添加与渲染时都走它，已存的长标题条目同样生效。
- 修「点图标弹窗偶尔没反应」：热重载 watcher 之前把文件哈希瞬时读取失败（'missing'）也当成变化 → 触发假 `runtime.reload()`，重载瞬间点图标就无响应。现在 missing 状态一律跳过，且变化需 400ms 后二次快照确认才重载。
- 全程 CDP 验证：热重载自动升到 0.2.1；开 popup.html 实测 `gridWidth:380, bodyScrollW:380`，截图确认。

### Bugs / surprises
- chrome://extensions 的 runtimeErrors 里堆了一堆各网站的 preload 警告——Chrome 会把带 `<all_urls>` host 权限的未打包扩展关联到的页面警告归集进来，无害噪音，非本扩展代码错误。

### Files touched
- `popup/popup.css` — minmax(0,1fr) / min-width:0 / q-title width:100%
- `popup/popup.js` — shortTitle() 截取主标题
- `background.js` — watcher 防假重载（missing 跳过 + 二次确认）
- `manifest.json` — 0.2.0 → 0.2.1

---

## 2026-08-31 · v0.2.0 — 智谱 Coding Plan 支持 + 开发热重载

### What I did
- 新增服务商「智谱 Coding Plan（订阅套餐）」：base URL `https://open.bigmodel.cn/api/coding/paas/v4`（经官方文档确认，与按量付费的 `/api/paas/v4` 不同），默认模型 `glm-5.3`。用户在设置页下拉切换即可，已填的 Key 保留。
- `background.js` 加开发热重载：仅未打包扩展生效（判断 manifest 无 `update_url`），每秒对 13 个源文件做 SHA-1 快照比对，变化即 `chrome.runtime.reload()`；重载前把打开的扩展页 URL 存 storage.local，`onInstalled` 时去重恢复。循环里调 `chrome.runtime.getPlatformInfo()` 重置 SW 30s 空闲计时保持常驻。
- 通过 web-access CDP proxy 在 `chrome://extensions` 页面上下文调 `chrome.developerPrivate.reload(id)`，帮用户完成了最后一次手动重载；随后改 manifest 版本号验证热重载生效（~3s 自动升到 0.2.0，零报错）。

### Bugs / surprises
- `chrome://` 页面无法用普通扩展自动化，但 CDP 可以直接 eval 进 WebUI 上下文使用 `chrome.developerPrivate` API——重载/查询扩展状态都走得通，是很好用的开发路径。
- 未打包扩展的 `fetch(chrome.runtime.getURL(...))` 读的是磁盘实时内容，这是热重载能工作的前提。

### Files touched
- `shared/api.js` — 新增 zhipu-coding provider
- `options/options.html` — 下拉加 Coding Plan 选项
- `background.js` — 热重载 watcher + 页面恢复
- `manifest.json` — 0.1.0 → 0.2.0

---

## 2026-08-31 · release — 默认模型改 flash + 建仓推送 GitHub

### What I did
- 智谱默认模型从 `glm-5.3` 改为 `glm-5.3-flash`（免费/快速档），同步更新 options 占位符和 README 表格。
- `git init` + `gh repo create`，公开仓库 https://github.com/SchaeferAnjon/bookmark ，首个提交 v0.1.0（21 文件）已推送 main。

### Bugs / surprises
- 无。

### Files touched
- `shared/api.js`、`options/options.html`、`README.md` — 默认模型 glm-5.3-flash
- `.gitignore` — 补充凭据/视频类防泄漏默认清单

---

## 2026-08-31 · bookmark extension — 从零开发「书签管家」Chrome 扩展 v0.1.0

### What I did
- 从空目录搭起完整 MV3 扩展（纯原生 JS + ES modules，零依赖、无构建步骤）：
  - `popup/`：全局书签搜索（chrome.bookmarks.search，↑↓+回车键盘导航）+ 快捷书签网格（storage.sync，「＋当前页」添加、编辑模式删除）。
  - `manager/`：整理中心页，三个面板 —— 全部书签树（可折叠、行内两步确认删除、扁平过滤搜索）；失效检测（10 并发 HEAD→GET 回退、12s 超时，404/410/DNS 失败归「确认失效」，403/超时归「疑似问题」，勾选批量删除）；AI 智能整理（80 条/批发给 LLM 分类，跨批复用分类名，预览后才移动到书签栏「AI 整理 <日期>」文件夹，不删书签）。
  - `options/`：服务商选择（智谱 GLM，默认 glm-5.3-flash / DeepSeek / 自定义 OpenAI 兼容），API Key 存 storage.local（不同步），带「测试连接」。
  - `shared/api.js`：统一 chat/completions 封装 + JSON 提取（容忍 ```json 围栏）。
  - 图标用纯 Python 标准库生成 PNG（scripts/make_icons.py，圆角渐变底+书签丝带，2x2 超采样抗锯齿）。
- 用本机 npx 缓存里的 playwright-core（匹配 chromium-1208）写 smoke test：加载扩展 → 三个页面无报错 → provider 切换联动正确 → 造 3 条书签真实跑失效扫描（example.com 通过、404 与假域名判死）→ 两步确认批量删除成功。

### Bugs / surprises
- npx 缓存里有 5 个版本的 playwright-core，只有 e41f203b7505f1fb 那份要求的 chromium-1208 与本机浏览器缓存匹配，其余版本会报 Executable doesn't exist。
- 死链扫描时被扫的 URL 本身会在 manager 页产生 console error（ERR_NAME_NOT_RESOLVED / 404 资源加载失败），属预期噪音，测试断言时需过滤。
- 截图里进度条显示 ~30%：CSS `transition: width 0.2s` 在三条书签几乎同时完成时被截在动画中途，非数据 bug。

### Files touched
- `manifest.json` — MV3 清单（bookmarks/storage/favicon/tabs + <all_urls>）
- `background.js` — 安装时初始化 quickLinks
- `popup/popup.{html,css,js}` — 搜索 + 快捷书签弹窗
- `manager/manager.{html,css,js}` — 整理中心（树/失效检测/AI 整理）
- `options/options.{html,css,js}` — API 配置页
- `shared/api.js`、`shared/util.js` — LLM 封装与公共工具
- `scripts/make_icons.py`、`icons/icon{16,48,128}.png` — 图标
- `README.md`、`LICENSE`（MIT）、`.gitignore`
