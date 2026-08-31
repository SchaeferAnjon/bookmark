# 书签管家 BookmarkKeeper

开源的 Chrome 书签管理扩展（Manifest V3，纯原生 JS，零依赖、无构建步骤）。

## 功能

- **🔍 全局书签搜索** — 点扩展图标即搜，支持标题/网址匹配、键盘上下键选择、回车打开。
- **🧹 一键清理失效书签** — 并发扫描所有书签链接，区分「确认失效」（404/410、域名无法解析、连接失败）与「疑似问题」（403、超时等，可能只是网站反爬），勾选后批量删除，删除前二次确认。
- **⚡ 快捷书签** — 弹窗里固定常用页面（一键把当前页加入），点开即达。
- **✨ AI 智能整理** — 把全部书签发给大模型按主题自动分类，先预览再应用（书签移动到书签栏下的「AI 整理 <日期>」文件夹，不删除任何书签）。支持自填 API Key，兼容 **智谱 GLM-5.3** 与 **DeepSeek**，也支持任意 OpenAI 兼容接口。

## 安装（开发者模式加载）

1. 下载/克隆本仓库。
2. 打开 `chrome://extensions/`，右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择本项目根目录。

## AI 配置

扩展设置页（弹窗右下角 ⚙️）中选择服务商并填入 API Key：

| 服务商 | API 地址（自动填充） | 默认模型 | 申请 Key |
|---|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.3-flash` | open.bigmodel.cn |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` | platform.deepseek.com |
| 自定义 | 任意 OpenAI 兼容地址 | 自填 | — |

API Key 仅存于本机 `chrome.storage.local`（不随浏览器账号同步），只在调用你所选模型官方接口时发送。

## 隐私

- 无任何遥测、无第三方服务器。
- 失效检测直接从本机访问书签地址；AI 整理仅在你主动点击时，把书签的标题与 URL 发送给你自己配置的模型接口。

## 目录结构

```
manifest.json        MV3 清单
background.js        service worker（安装初始化）
popup/               弹窗：搜索 + 快捷书签
manager/             整理中心：全部书签 / 失效检测 / AI 整理
options/             设置：API Key / 服务商 / 模型
shared/              公共模块（LLM API 封装、工具函数）
scripts/make_icons.py  图标生成脚本（纯 Python 标准库）
```

## License

MIT
