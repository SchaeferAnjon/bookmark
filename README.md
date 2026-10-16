# 书签管家 BookmarkKeeper

[English](README.en.md)

接管浏览器的新标签页：打开的标签按网站整理成卡片，上面是快捷书签和书签搜索。**快捷书签经 iCloud 在 Chrome、Safari 和你的所有 Mac 之间同步。**

- **Chrome 扩展**：完整功能。没装 Mac App 时也能单独用（快捷书签随 Chrome 书签同步，Windows 也可以）。
- **Safari 扩展**：快捷书签 + 打开的标签。Safari 内存占用比 Chrome 小，适合日常浏览。
- **Mac App**：负责把快捷书签存进你的 iCloud，让 Chrome 和 Safari 读写同一份。平时不用打开。

## 功能

| | Chrome | Safari |
|---|:-:|:-:|
| 新标签页：打开的标签按网站分组，一键关闭整组、去重、稍后再看 | ✅ | ✅ |
| 快捷书签：大图标，拖一个到另一个上合并成分组，编辑模式改名 / 删除 | ✅ | ✅ |
| 不开弹窗加快捷书签：`Alt+Shift+B` 或右键「加入快捷书签」 | ✅ | ✅ |
| 搜索全部书签、展开全部书签文件夹 | ✅ | — |
| 整理中心：一键找出失效链接、AI 按主题整理书签（智谱 GLM / DeepSeek / 任意 OpenAI 兼容接口） | ✅ | — |

Safari 没有给扩展开放书签接口，所以 Chrome 的书签本身（书签栏里那些）不会出现在 Safari 里；两边共享的是快捷书签。

## 安装

### Mac（Chrome + Safari）

1. 从 [Releases](https://github.com/SchaeferAnjon/bookmark/releases/latest) 下载 `BookmarkKeeper-<版本>.dmg`，把「BookmarkKeeper」拖进「应用程序」，打开一次。
2. App 窗口里会显示三项状态：
   - **iCloud**：需要登录 Apple ID 并打开 iCloud 云盘。
   - **Safari**：点「在 Safari 中启用」，勾选「书签管家」。想让新标签页也用它：Safari →「设置」→「通用」→「新标签页打开方式」选「书签管家」。
   - **Chrome**：App 会自动连接本机的 Chrome（以及 Edge、Brave、Arc 等）。
3. Chrome 里安装扩展：点 App 里的「扩展文件夹」，访达会选中一个文件夹；打开 `chrome://extensions`，开启右上角「开发者模式」，把这个文件夹拖进页面。以后更新 App 时这个文件夹会跟着更新，在 `chrome://extensions` 点一下扩展的刷新按钮即可。
4. 其他 Mac 重复以上步骤。只要登录同一个 Apple ID，快捷书签会自动出现。

第一次连上 App 时，Chrome 里原来的快捷书签（「其他书签 / 书签管家·快捷书签」文件夹）会自动导入 iCloud。原文件夹保留不动，当备份。

### 只用 Chrome（Windows / Linux / 不想装 App 的 Mac）

下载本仓库（Code → Download ZIP，解压），在 `chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」选解压出来的目录。快捷书签存成 Chrome 书签「其他书签 / 书签管家·快捷书签」，随 Chrome 书签同步到登录同一 Google 账号的电脑。

## 同步是怎么做的

```
Chrome 扩展 ──本地通信──┐
                        ├─→ BookmarkKeeper App ─→ 你的 iCloud（App 专用容器）─→ 其他 Mac
Safari 扩展 ──扩展消息──┘
```

- 快捷书签只存在**你自己的 iCloud** 里，按 Apple ID 区分。插件没有账号、不用登录；作者和其他用户都看不到你的数据。
- 每个链接、每个分组是一条单独的记录，带修改时间。两台电脑同时改不同的书签，两边的改动都保留；同时改同一个，以后改的为准。删除会留下标记，不会被另一台电脑同步回来。
- 每台 Mac 上 Chrome 和 Safari 各写各的文件，读的时候合并，所以 iCloud 不会产生冲突副本。
- 同步只走 iCloud 一条线，不和 Chrome 自带的书签同步混在一起，避免重复。
- iCloud 云盘没开时，快捷书签先存在本机；打开 iCloud 后自动并进去。

**不同步的**：「稍后再看」列表、AI 配置（含 API Key）只存在各个浏览器的扩展里。换电脑或重装扩展前，可以在设置页「备份与迁移」导出、再导入。

## 隐私

- 没有遥测，没有作者的服务器。快捷书签只在你的设备和你的 iCloud 之间流动。
- 失效检测直接从本机访问书签地址；AI 整理只在你点击时，把书签标题和网址发给**你自己配置**的模型接口。
- 详见 [PRIVACY.md](PRIVACY.md)。

## License

MIT。新标签页的打开标签仪表盘改自 [Tab Out](https://github.com/zarazhangrui/tab-out)（MIT，见 `newtab/LICENSE-tab-out.md`）。
