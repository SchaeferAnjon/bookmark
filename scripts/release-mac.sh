#!/bin/bash
# 打包 Mac App 发布版：Developer ID 签名 →（可选）Apple 公证 → DMG。产物在 mac/build/release/。
# 默认不公证（2026-11-22 用户定，和画布笔记一样）：第一次打开时在访达里右键「打开」，README 写了怎么做。
#
# 第一次用之前（每台电脑一次）：
#   1. Xcode → Settings → Accounts 登录开发者账号，证书里有「Developer ID Application」
#   2. mac/Config/Signing.local.xcconfig 写上 DEVELOPMENT_TEAM = 你的 Team ID
#   3. 要公证时才需要：保存公证凭据（App 专用密码在 appleid.apple.com 生成），开发者账号的协议要签着：
#        xcrun notarytool store-credentials bookmarkkeeper-notary --apple-id 你的AppleID --team-id 你的TeamID
#
# 用法：scripts/release-mac.sh              签名、不公证（默认）
#       NOTARIZE=1 scripts/release-mac.sh   签名并公证 App 和 DMG
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAC="$ROOT/mac"
OUT="$MAC/build/release"
PROFILE="${NOTARY_PROFILE:-bookmarkkeeper-notary}"
NOTARIZE="${NOTARIZE:-0}"
TEAM="$(sed -n 's/^DEVELOPMENT_TEAM *= *//p' "$MAC/Config/Signing.local.xcconfig" 2>/dev/null | tr -d '[:space:]')"
VERSION="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"

[ -n "$TEAM" ] || { echo "缺少 mac/Config/Signing.local.xcconfig（见 Signing.local.xcconfig.example）" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

echo "▶ 1/5 生成扩展资源"
/usr/bin/python3 "$ROOT/scripts/build.py" >/dev/null

echo "▶ 2/5 归档（Release）"
xcodebuild -project "$MAC/BookmarkKeeper.xcodeproj" -scheme BookmarkKeeper -configuration Release \
  -derivedDataPath "$MAC/build/dd" -destination "generic/platform=macOS" -archivePath "$OUT/BookmarkKeeper.xcarchive" \
  -allowProvisioningUpdates archive -quiet

echo "▶ 3/5 导出 Developer ID 签名的 App"
cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>developer-id</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
EOF
xcodebuild -exportArchive -archivePath "$OUT/BookmarkKeeper.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates -quiet
APP="$OUT/export/BookmarkKeeper.app"
codesign --verify --deep --strict "$APP"

notarize() {
  xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait
}

if [ "$NOTARIZE" = 1 ]; then
  echo "▶ 4/5 公证 App（几分钟）"
  ditto -c -k --keepParent "$APP" "$OUT/BookmarkKeeper-notarize.zip"
  notarize "$OUT/BookmarkKeeper-notarize.zip"
  xcrun stapler staple "$APP"
  rm "$OUT/BookmarkKeeper-notarize.zip"
else
  echo "▶ 4/5 不公证（默认；要公证用 NOTARIZE=1）"
fi

echo "▶ 5/5 生成 DMG"
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/BookmarkKeeper-$VERSION.dmg"
hdiutil create -volname "书签管家 BookmarkKeeper $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG" -quiet
codesign --sign "Developer ID Application" --timestamp "$DMG"
if [ "$NOTARIZE" = 1 ]; then
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  spctl --assess --type open --context context:primary-signature -v "$DMG"
fi
# 收尾：编译过程中的 App 副本会被系统登记，Safari 设置里就会出现重复的扩展。注销后删掉，只留 DMG。
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for copy in "$STAGE/BookmarkKeeper.app" "$APP" \
  "$MAC/build/dd/Build/Intermediates.noindex/ArchiveIntermediates/BookmarkKeeper/InstallationBuildProductsLocation/Applications/BookmarkKeeper.app"; do
  [ -d "$copy" ] && "$LSREGISTER" -u "$copy" 2>/dev/null || true
done
rm -rf "$STAGE" "$OUT/export" "$OUT/ExportOptions.plist" "$OUT/BookmarkKeeper.xcarchive" \
  "$MAC/build/dd/Build/Intermediates.noindex/ArchiveIntermediates"

echo
echo "完成：$DMG$([ "$NOTARIZE" = 1 ] && echo "（已公证）" || echo "（签了名，没公证）")"
echo "Chrome 扩展（已打包进 App）：$ROOT/dist/chrome"
