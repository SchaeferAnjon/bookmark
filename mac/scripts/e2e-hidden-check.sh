#!/bin/bash
# 测试模式自检（mac/App/TestMode.swift）：Debug 构建 → E2E=1 启动 → 第 1、5、10 秒各查一次这个进程在屏幕上有没有看得见的窗口，
# 另外从启动起每 10 毫秒看一次，14 秒里一次也不许看得见 → 查它不进程序坞（BackgroundOnly）→ 点「扩展文件夹」
# （拷到临时家目录，「在访达里显示」只记下来）、「在 Safari 中启用」、「使用说明与源码」（都只记下来）
# → 截窗口（PNG 不是空的、不是一个颜色）→ 退出。
# 快捷书签在临时目录，Chrome 注册写进临时家目录（先放一个假的 Chrome「Local State」，让 App 当作装了 Chrome）。
# 用法：mac/scripts/e2e-hidden-check.sh [输出目录]；SKIP_BUILD=1 用上次的构建；DERIVED=<目录> 换构建目录（默认临时目录下）
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-$(mktemp -d)/e2e}"
derived="${DERIVED:-${TMPDIR:-/tmp}/bookmarkkeeper-e2e-derived}"
mkdir -p "$out"
work="$(mktemp -d)"
pid=""
cleanup() { [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

if [ -z "${SKIP_BUILD:-}" ]; then
  xcodebuild -project mac/BookmarkKeeper.xcodeproj -scheme BookmarkKeeper -configuration Debug -derivedDataPath "$derived" \
    CODE_SIGNING_ALLOWED=NO build > "$out/build.log" 2>&1 || { tail -30 "$out/build.log"; exit 1; }
fi
app="$derived/Build/Products/Debug/BookmarkKeeper.app"

cat > "$work/wincheck.swift" <<'SWIFT'
// wincheck pid <pid>：这一刻这个进程有没有看得见的窗口（在屏幕上、不透明、和某个显示器相交）
// wincheck watch <pid> <秒>：每 10 毫秒看一次，看完报一共看了几次、几次有窗口排在屏幕上、几次看得见
// wincheck png <文件>：图里有几种颜色（隔 7 个像素取一个）
import AppKit
let args = CommandLine.arguments
if args[1] == "png" {
  guard let rep = NSBitmapImageRep(data: (try? Data(contentsOf: URL(fileURLWithPath: args[2]))) ?? Data()) else { print(0); exit(1) }
  var colors = Set<UInt32>()
  for y in stride(from: 0, to: rep.pixelsHigh, by: 7) { for x in stride(from: 0, to: rep.pixelsWide, by: 7) {
    var p = [Int](repeating: 0, count: 4); rep.getPixel(&p, atX: x, y: y)
    colors.insert(UInt32(p[0]) << 16 | UInt32(p[1]) << 8 | UInt32(p[2]))
  } }
  print(colors.count); exit(0)
}
let pid = Int32(args[2])!
let mainH = NSScreen.screens[0].frame.height
let displays = NSScreen.screens.map { CGRect(x: $0.frame.minX, y: mainH - $0.frame.maxY, width: $0.frame.width, height: $0.frame.height) }
func look() -> (all: Int, onscreen: Int, visible: [String]) {
  var all = 0, onscreen = 0, visible: [String] = []
  for w in (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? [] where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
    all += 1
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
    guard (w[kCGWindowIsOnscreen as String] as? Bool) ?? false else { continue }
    onscreen += 1
    let alpha = (w[kCGWindowAlpha as String] as? Double) ?? 0
    if alpha > 0.01 && r.width > 1 && r.height > 1 && displays.contains(where: { $0.intersects(r) }) {
      visible.append("\((w[kCGWindowName as String] as? String) ?? "") \(Int(r.width))x\(Int(r.height))@\(Int(r.minX)),\(Int(r.minY)) alpha \(alpha)")
    }
  }
  return (all, onscreen, visible)
}
if args[1] == "watch" {
  let end = Date().addingTimeInterval(Double(args[3])!)
  var samples = 0, onscreen = 0, visible = 0, seen = Set<String>()
  while Date() < end {
    let now = look()
    samples += 1
    if now.onscreen > 0 { onscreen += 1 }
    if !now.visible.isEmpty { visible += 1; seen.formUnion(now.visible) }
    usleep(10_000)
  }
  print("{\"samples\":\(samples),\"onscreen\":\(onscreen),\"visible\":\(visible),\"list\":\"\(seen.sorted().joined(separator: "; "))\"}")
  exit(visible == 0 ? 0 : 1)
}
let now = look()
print("{\"windows\":\(now.all),\"onscreen\":\(now.onscreen),\"visible\":\(now.visible.count),\"list\":\"\(now.visible.joined(separator: "; "))\"}")
exit(now.visible.isEmpty ? 0 : 1)
SWIFT
swiftc -O -o "$work/wincheck" "$work/wincheck.swift"

data="$work/data"
mkdir -p "$data/home/Library/Application Support/Google/Chrome"
echo '{}' > "$data/home/Library/Application Support/Google/Chrome/Local State"
real_host="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.schaeferanjon.bookmarkkeeper.json"
real_before="$(shasum "$real_host" 2>/dev/null || echo 没有)"
# 点三下：「扩展文件夹」、「在 Safari 中启用」、左下「使用说明与源码」链接
CLICK_DEFAULT="111:385+124:301+65:468"
shot="$out/main-e2e.png"
rm -f "$shot"
E2E=1 E2E_DATA_DIR="$data" E2E_SNAPSHOT="$shot" E2E_SNAPSHOT_DELAY=3 E2E_CLICKS="${E2E_CLICKS-$CLICK_DEFAULT}" \
  "$app/Contents/MacOS/BookmarkKeeper" > "$out/app.log" 2>&1 &
pid=$!
fail=0
"$work/wincheck" watch "$pid" 14 > "$work/watch.json" &
watcher=$!
last=0
for at in 1 5 10; do
  sleep $((at - last)); last=$at
  if result="$("$work/wincheck" pid "$pid")"; then echo "第 ${at} 秒：$result"; else echo "第 ${at} 秒有窗口在屏幕上：$result"; fail=1; fi
done
for _ in $(seq 40); do [ -s "$shot" ] && break; sleep 0.25; done
if wait "$watcher"; then echo "每 10 毫秒看一次：$(cat "$work/watch.json")"; else echo "盯着时看见过窗口：$(cat "$work/watch.json")"; fail=1; fi
kind="$(lsappinfo info -only applicationtype "$pid" 2>/dev/null || true)"
echo "程序坞：$kind"
case "$kind" in *BackgroundOnly*) ;; *) echo "不是 BackgroundOnly"; fail=1 ;; esac
if [ -s "$shot" ] && colors="$("$work/wincheck" png "$shot")" && [ "$colors" -gt 20 ]; then
  echo "截图：${shot}（$(wc -c < "$shot" | tr -d ' ') 字节，${colors} 种颜色）"
else
  echo "截图没出来或是一个颜色：${shot}"; fail=1
fi
fake_host="$data/home/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.schaeferanjon.bookmarkkeeper.json"
if [ -s "$fake_host" ]; then echo "Chrome 注册写进了临时家目录"; else echo "临时家目录里没有 Chrome 注册"; fail=1; fi
if [ "$(shasum "$real_host" 2>/dev/null || echo 没有)" = "$real_before" ]; then echo "真 Chrome 的注册没动"; else echo "真 Chrome 的注册被改了"; fail=1; fi
if [ -z "${E2E_CLICKS+x}" ]; then
  record="$(cat "$data/record.jsonl" 2>/dev/null || true)"
  if [[ "$record" == *activateFileViewerSelecting* ]] && [ -d "$data/home/Library/Application Support/BookmarkKeeper/Chrome Extension" ]; then
    echo "点「扩展文件夹」：拷到了临时家目录，访达只记下来"
  else
    echo "点「扩展文件夹」没反应"; fail=1
  fi
  if [[ "$record" == *SFSafariApplication.showPreferencesForExtension* ]]; then echo "点「在 Safari 中启用」：只记下来"; else echo "点「在 Safari 中启用」没记下来"; fail=1; fi
  if [[ "$record" == *github.com/SchaeferAnjon/bookmark* ]]; then echo "点「使用说明与源码」：只记下来，没开浏览器"; else echo "点「使用说明与源码」没记下来"; fail=1; fi
fi
grep -q '换不了' "$out/app.log" && { grep '换不了' "$out/app.log"; fail=1; }
grep '^\[E2E\]' "$out/app.log" || true
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
pid=""
# 构建时 Xcode 把这个 Debug 包登记进了 LaunchServices；撤掉，免得系统拿它当正式版
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$app" 2>/dev/null || true
[ "$fail" = 0 ] && echo "通过" || { echo "没通过"; exit 1; }
