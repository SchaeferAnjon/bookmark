# BookmarkKeeper

[中文](README.md)

Replaces your browser's new tab page: open tabs grouped by site, with quick links and bookmark search on top. **Quick links sync through iCloud between Chrome, Safari and all your Macs.**

- **Chrome extension** — full feature set. Works on its own without the Mac app (quick links then sync with Chrome bookmarks, Windows included).
- **Safari extension** — quick links + open tabs. Safari uses less memory than Chrome, so it's nice for everyday browsing.
- **Mac app** — stores quick links in your iCloud so Chrome and Safari share one copy. You don't need to keep it open.

## Features

| | Chrome | Safari |
|---|:-:|:-:|
| New tab: open tabs grouped by site; close a group, dedupe, save for later | ✅ | ✅ |
| Quick links: big icons, drag one onto another to make a group, rename / delete in edit mode | ✅ | ✅ |
| Add a quick link without opening the popup: `Alt+Shift+B` or right-click "加入快捷书签" | ✅ | ✅ |
| Search all bookmarks, browse all bookmark folders | ✅ | — |
| Organizer: find dead links, AI-sort bookmarks by topic (Zhipu GLM / DeepSeek / any OpenAI-compatible API) | ✅ | — |

Safari doesn't expose a bookmarks API to extensions, so Chrome's own bookmarks (the bookmarks bar) don't appear in Safari. What the two share is your quick links.

## Install

### Mac (Chrome + Safari)

1. Download `BookmarkKeeper-<version>.dmg` from [Releases](https://github.com/SchaeferAnjon/bookmark/releases/latest), drag BookmarkKeeper into Applications and open it once.
2. The app shows three checks:
   - **iCloud** — sign in to your Apple ID and turn on iCloud Drive.
   - **Safari** — click "Enable in Safari" and tick BookmarkKeeper. To use it for new tabs: Safari → Settings → General → New tabs open with → BookmarkKeeper.
   - **Chrome** — the app connects to Chrome (and Edge, Brave, Arc, …) automatically.
3. Install the Chrome extension: click "Extension folder" in the app (Finder selects a folder), open `chrome://extensions`, turn on Developer mode and drag that folder onto the page. The folder is updated whenever you update the app; then just click the extension's reload button in `chrome://extensions`.
4. Repeat on your other Macs. With the same Apple ID, your quick links show up automatically.

The first time Chrome connects to the app, your existing quick links (the "Other bookmarks / 书签管家·快捷书签" folder) are imported into iCloud. The folder itself is left untouched as a backup.

### Chrome only (Windows / Linux / Mac without the app)

Download this repo (Code → Download ZIP, unzip) and use `chrome://extensions` → Developer mode → "Load unpacked" on the unzipped folder. Quick links are stored as Chrome bookmarks and sync with your Google account.

## How sync works

```
Chrome extension ──native messaging──┐
                                     ├─→ BookmarkKeeper app ─→ your iCloud (app container) ─→ other Macs
Safari extension ──extension message─┘
```

- Quick links live only in **your own iCloud**, keyed by your Apple ID. The extension has no account and no login; neither the author nor other users can see your data.
- Every link and group is a separate record with a modification time. Edits to different links on two Macs both survive; edits to the same link resolve to the later one. Deletions leave a marker, so another Mac can't sync a deleted link back.
- On each Mac, Chrome and Safari write separate files that are merged on read, so iCloud never produces conflict copies.
- There is exactly one sync path (iCloud). It is never mixed with Chrome's own bookmark sync, which avoids duplicates.
- If iCloud Drive is off, quick links stay on the Mac and are merged into iCloud once you turn it on.

**Not synced:** the "Saved for later" list and AI settings (including the API key) stay inside each browser's extension. Before moving to another computer or reinstalling the extension, use Export / Import in the extension's settings page.

## Privacy

- No telemetry and no servers run by the author. Quick links only travel between your devices and your iCloud.
- Dead-link checks fetch bookmark URLs directly from your machine. AI organizing sends bookmark titles and URLs only when you click it, and only to the model API **you** configured.
- See [PRIVACY.md](PRIVACY.md).

## Development

See the layout and commands in the [Chinese README](README.md#开发). In short:

```bash
npm test                                     # JS unit tests (Node 20+)
swift test --package-path mac/BKCore         # Swift unit tests
python3 scripts/build.py                     # build extensions into dist/
xcodegen generate --spec mac/project.yml     # regenerate the Xcode project after editing project.yml
```

Building the Mac app needs Xcode 15+ and a paid Apple Developer account (iCloud containers require one). Copy `mac/Config/Signing.local.xcconfig.example` to `Signing.local.xcconfig` with your Team ID and replace the `io.github.schaeferanjon` prefix in `project.yml`. Releasing: [docs/RELEASING.md](docs/RELEASING.md).

## License

MIT. The open-tabs dashboard is adapted from [Tab Out](https://github.com/zarazhangrui/tab-out) (MIT, see `newtab/LICENSE-tab-out.md`).
