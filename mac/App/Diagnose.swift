import BKCore
import Foundation
import SafariServices

/// 排查问题用：BookmarkKeeper.app/Contents/MacOS/BookmarkKeeper --diagnose
/// 打印 iCloud 位置、快捷书签数量、Chrome 注册、Safari 扩展状态，不改任何东西。
enum Diagnose {
    static func run() {
        let location = StoreLocation.resolve(appGroup: AppInfo.appGroup)
        print("version        ", AppInfo.version)
        print("store          ", location.directory.path, location.isICloud ? "(iCloud)" : "(local)")
        let store = QuickStore(directory: location.directory, writerID: "diagnose")
        let files = (try? FileManager.default.contentsOfDirectory(atPath: location.directory.path)) ?? []
        print("files          ", files.sorted().joined(separator: ", "))
        let records = (try? store.load().records) ?? [:]
        print("records        ", records.count, "(live links:",
              records.values.filter { ($0["kind"] as? String) == "link" && ($0["deleted"] as? Bool) != true }.count, ")")
        if let path = Bundle.main.executablePath {
            print("chrome hosts   ", ChromeHostInstaller.installedBrowsers(executablePath: path).joined(separator: ", "))
        }
        print("extension id   ", AppInfo.extensionBundleID)

        let done = DispatchSemaphore(value: 0)
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: AppInfo.extensionBundleID) { state, error in
            print("safari state   ", state.map { "enabled=\($0.isEnabled)" } ?? "nil", error.map { "error=\($0 as NSError)" } ?? "")
            done.signal()
        }
        if done.wait(timeout: .now() + 10) == .timedOut {
            print("safari state    (no reply in 10s)")
        }
    }
}
