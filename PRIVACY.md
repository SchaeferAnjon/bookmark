# Privacy Policy / 隐私政策

_Last updated: 2026-10-16_

BookmarkKeeper (书签管家) consists of a Chrome extension, a Safari extension and a Mac app. It is open source: <https://github.com/SchaeferAnjon/bookmark>.

## What data is handled

| Data | Where it stays |
|---|---|
| Quick links (titles, URLs, groups) | With the Mac app installed: your own iCloud account (the app's private iCloud container). Without the app: your Chrome bookmarks, synced by your Google account if you enabled Chrome sync. |
| Open tabs (titles, URLs) | Read locally to draw the new tab page. Never stored or sent anywhere. |
| "Saved for later" list | `chrome.storage.local` in your browser only. |
| AI settings, including your API key | `chrome.storage.local` in your browser only. Not synced. |
| Your bookmarks (Chrome only) | Read locally for search, the folder view and the organizer. |

## What is sent over the network

- **Nothing to the author.** There is no telemetry, analytics or server operated by the author.
- **iCloud**: quick links are synced by Apple's iCloud Drive between devices signed in to your Apple ID.
- **Dead-link check** (only when you start it): the extension requests each bookmark URL directly from your computer to see whether it still works.
- **AI organizing** (only when you click it): bookmark titles and URLs are sent to the model API that **you** configured (e.g. Zhipu GLM, DeepSeek or any OpenAI-compatible endpoint), using your own API key. That provider's privacy policy applies to that request.
- **Favicons in Safari**: the new tab page loads `https://<site>/favicon.ico` for the sites in your quick links and open tabs, like a normal web page would.

## Permissions (Chrome)

- `bookmarks` — search, folder view, organizer, and the fallback quick-links folder.
- `tabs` — show and manage open tabs on the new tab page.
- `storage` — save settings and the "Saved for later" list locally.
- `favicon` — show site icons from Chrome's local cache.
- `contextMenus` — "Add to quick links" in the right-click menu.
- `nativeMessaging` — talk to the BookmarkKeeper Mac app, which syncs quick links through your iCloud.
- Host access to all sites — only for the dead-link check you start yourself, and for calling the AI endpoint you configured.

## Contact

Open an issue at <https://github.com/SchaeferAnjon/bookmark/issues>.

---

**中文摘要**：没有遥测，没有作者的服务器。快捷书签只存在你自己的 iCloud（装了 Mac App 时）或你的 Chrome 书签里；「稍后再看」和 AI 配置（含 API Key）只存在本机浏览器。失效检测和 AI 整理只在你主动点击时进行，AI 请求只发往你自己配置的模型接口。
