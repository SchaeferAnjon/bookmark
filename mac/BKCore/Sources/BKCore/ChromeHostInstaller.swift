import Foundation

/// 给 Chrome 系浏览器注册本地通信程序：在各浏览器的 NativeMessagingHosts 目录写一个 JSON，
/// 告诉浏览器「扩展 xxx 要找 io.github.schaeferanjon.bookmarkkeeper 时，运行这个 App」。
/// 只给真正用过的浏览器写（数据目录里有 Local State）——别的程序（比如 Claude 的浏览器插件）会给
/// 没装的浏览器也建 NativeMessagingHosts 目录，不能只看目录在不在。没装的浏览器里若有我们以前写的
/// 注册文件，顺手删掉。App 每次启动都重写一遍（App 被挪了位置也能自动修好）。
public enum ChromeHostInstaller {
    public static let hostName = "io.github.schaeferanjon.bookmarkkeeper"

    /// (显示名, Application Support 下的数据目录)
    public static let browsers: [(name: String, dataDir: String)] = [
        ("Google Chrome", "Google/Chrome"),
        ("Google Chrome Beta", "Google/Chrome Beta"),
        ("Google Chrome Dev", "Google/Chrome Dev"),
        ("Google Chrome Canary", "Google/Chrome Canary"),
        ("Chromium", "Chromium"),
        ("Microsoft Edge", "Microsoft Edge"),
        ("Brave", "BraveSoftware/Brave-Browser"),
        ("Arc", "Arc/User Data"),
        ("Vivaldi", "Vivaldi"),
    ]

    public static func manifest(executablePath: String, extensionIDs: [String]) -> JSONObject {
        [
            "name": hostName,
            "description": "BookmarkKeeper — 快捷书签 iCloud 同步",
            "path": executablePath,
            "type": "stdio",
            "allowed_origins": extensionIDs.map { "chrome-extension://\($0)/" },
        ]
    }

    /// 返回写入成功的浏览器名
    @discardableResult
    public static func install(executablePath: String, extensionIDs: [String],
                               applicationSupport: URL = defaultApplicationSupport) -> [String] {
        guard let data = try? JSONSerialization.data(
            withJSONObject: manifest(executablePath: executablePath, extensionIDs: extensionIDs),
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) else { return [] }
        var installed: [String] = []
        for browser in browsers {
            let base = applicationSupport.appendingPathComponent(browser.dataDir, isDirectory: true)
            let dir = base.appendingPathComponent("NativeMessagingHosts", isDirectory: true)
            guard FileManager.default.fileExists(atPath: base.appendingPathComponent("Local State").path) else {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(hostName).json"))
                continue
            }
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try data.write(to: dir.appendingPathComponent("\(hostName).json"), options: .atomic)
                installed.append(browser.name)
            } catch {
                continue
            }
        }
        return installed
    }

    /// 已注册、且指向当前这个 App 的浏览器
    public static func installedBrowsers(executablePath: String,
                                         applicationSupport: URL = defaultApplicationSupport) -> [String] {
        browsers.compactMap { browser in
            let file = applicationSupport
                .appendingPathComponent(browser.dataDir, isDirectory: true)
                .appendingPathComponent("NativeMessagingHosts/\(hostName).json")
            guard let data = try? Data(contentsOf: file),
                  let json = try? JSONSerialization.jsonObject(with: data) as? JSONObject,
                  json["path"] as? String == executablePath else { return nil }
            return browser.name
        }
    }

    public static var defaultApplicationSupport: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }

    /// Chrome 启动本地通信程序时，第一个参数是调用方扩展的 origin
    public static func isHostInvocation(_ arguments: [String] = CommandLine.arguments) -> Bool {
        arguments.dropFirst().contains { $0.hasPrefix("chrome-extension://") }
    }
}
