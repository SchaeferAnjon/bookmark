# 发布流程

## 每次发布

1. 改版本号（三处保持一致）：`manifest.json` 的 `version`、`package.json` 的 `version`、`mac/project.yml` 的 `MARKETING_VERSION`（并把 `CURRENT_PROJECT_VERSION` 加 1）。改了 `project.yml` 就运行 `xcodegen generate --spec mac/project.yml`。
2. 跑测试：`npm test`，`swift test --package-path mac/BKCore`。
3. 打 Mac 包：`scripts/release-mac.sh`。它会归档、用 Developer ID 签名、提交 Apple 公证、生成 `mac/build/release/BookmarkKeeper-<版本>.dmg`。
4. GitHub 上新建 Release，标签 `v<版本>`，上传 DMG。Chrome 扩展包含在 App 里（也可以直接下载仓库源码加载），不上架应用商店。
5. 在 `process.md` 记一笔。

## 第一次在一台电脑上发布（只做一次）

1. Xcode → Settings → Accounts 登录付费开发者账号，「Manage Certificates」里要有 **Developer ID Application**。
2. `cp mac/Config/Signing.local.xcconfig.example mac/Config/Signing.local.xcconfig`，填上 Team ID。
3. 保存公证凭据。先到 <https://appleid.apple.com> →「登录与安全」→「App 专用密码」生成一个，然后在终端：
   ```bash
   xcrun notarytool store-credentials bookmarkkeeper-notary --apple-id <你的 Apple ID> --team-id <Team ID>
   ```
   按提示粘贴 App 专用密码。凭据存在钥匙串里，脚本按名字 `bookmarkkeeper-notary` 取用。

## 如果以后想上架 Chrome 应用商店

1. <https://chrome.google.com/webstore/devconsole> 注册开发者（一次性 5 美元）。
2. `scripts/build.py` 生成的 `dist/bookmark-keeper-<版本>-chrome-web-store.zip` 去掉了 manifest 里的 `key`（商店不接受这个字段），直接上传。隐私政策链接填仓库里的 `PRIVACY.md`。
3. 上架后商店会分配新的扩展 ID。把商店后台给的公钥填回 `manifest.json` 的 `key`，开发版和商店版 ID 就一致；或者把新 ID 加进 `mac/project.yml` 的 `BKChromeExtensionIDs`，并把商店页面网址填进 `BKChromeWebStoreURL`（App 里会出现「Chrome 应用商店」按钮）。

## 换扩展 ID 时的数据

快捷书签在 iCloud 里，和扩展 ID 无关。「稍后再看」和 AI 配置存在扩展自己的 `chrome.storage.local`，ID 一变就读不到：换之前在旧扩展的设置页「备份与迁移」导出，装好新扩展后导入。
