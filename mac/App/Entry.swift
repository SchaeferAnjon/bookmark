import AppKit
import BKCore
import SwiftUI

/// 同一个可执行文件两种用法：
///   - 用户双击打开 → 设置窗口（检查 iCloud / Safari 扩展 / Chrome 注册）
///   - Chrome 拉起（第一个参数是 chrome-extension://…）→ 本地通信模式，读写快捷书签后退出，不出现在 Dock
/// 两种用法共用 App 的签名和 iCloud 权限，所以 Chrome 那边不需要另装一个程序。
@main
enum Entry {
    static func main() {
        if ChromeHostInstaller.isHostInvocation() {
            NativeMessaging.runHost(bridge: Bridge(kind: "chrome", appGroup: AppInfo.appGroup))
            exit(0)
        }
        if CommandLine.arguments.contains("--diagnose") {
            Diagnose.run()
            exit(0)
        }
        BookmarkKeeperApp.main()
    }
}

struct BookmarkKeeperApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        Window(L("书签管家", "BookmarkKeeper"), id: "main") {
            ContentView()
                .environmentObject(model)
        }
        .windowResizability(.contentSize)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

enum AppInfo {
    static func info<T>(_ key: String) -> T? { Bundle.main.object(forInfoDictionaryKey: key) as? T }

    static var appGroup: String? { info("BKAppGroup") }
    static var extensionBundleID: String {
        info("BKExtensionBundleID") ?? "io.github.schaeferanjon.BookmarkKeeper.Extension"
    }
    static var chromeExtensionIDs: [String] { info("BKChromeExtensionIDs") ?? [] }
    static var chromeWebStoreURL: URL? {
        guard let s: String = info("BKChromeWebStoreURL"), !s.isEmpty else { return nil }
        return URL(string: s)
    }
    static var version: String { info("CFBundleShortVersionString") ?? "dev" }
    static let repoURL = URL(string: "https://github.com/SchaeferAnjon/bookmark")!
}

/// 界面文字：系统首选语言里有中文就用中文（扩展本身是中文界面），否则英文
func L(_ zh: String, _ en: String) -> String {
    Locale.preferredLanguages.contains { $0.hasPrefix("zh") } ? zh : en
}
