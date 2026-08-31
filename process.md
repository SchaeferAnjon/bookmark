# Process log

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
