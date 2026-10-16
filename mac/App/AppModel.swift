import AppKit
import BKCore
import OSLog
import SafariServices

private let log = Logger(subsystem: "io.github.schaeferanjon.BookmarkKeeper", category: "app")

@MainActor
final class AppModel: ObservableObject {
    enum ICloud { case checking, on, off }

    @Published var icloud: ICloud = .checking
    @Published var safariEnabled: Bool?
    @Published var chromeBrowsers: [String] = []
    @Published var linkCount: Int?
    @Published var groupCount = 0
    @Published var lastUpdated: Date?
    @Published var notice: String?
    @Published var safariError: String?

    /// 打开 App / 回到前台时调用：重写 Chrome 注册、查 Safari 扩展状态、读快捷书签概况
    func refresh() {
        if let path = Bundle.main.executablePath {
            chromeBrowsers = ChromeHostInstaller.install(executablePath: path, extensionIDs: AppInfo.chromeExtensionIDs)
        }

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: AppInfo.extensionBundleID) { state, error in
            let enabled = state?.isEnabled
            let detail = error.map { "\(($0 as NSError).domain) \(($0 as NSError).code): \($0.localizedDescription)" }
            log.notice("Safari extension state: enabled=\(String(describing: enabled), privacy: .public) error=\(detail ?? "-", privacy: .public)")
            Task { @MainActor in
                self.safariEnabled = enabled ?? false
                self.safariError = detail
            }
        }

        let group = AppInfo.appGroup
        Task.detached(priority: .userInitiated) {
            let location = StoreLocation.resolve(appGroup: group)
            let store = QuickStore(directory: location.directory, writerID: "app-readonly")
            let records = (try? store.load().records) ?? [:]
            let live = records.values.filter { ($0["deleted"] as? Bool) != true }
            let links = live.filter { ($0["kind"] as? String) == "link" }.count
            let groups = live.filter { ($0["kind"] as? String) == "group" }.count
            let newest = records.values.compactMap { ($0["t"] as? NSNumber)?.doubleValue }.filter { $0 > 1 }.max()
            await MainActor.run {
                self.icloud = location.isICloud ? .on : .off
                self.linkCount = links
                self.groupCount = groups
                self.lastUpdated = newest.map { Date(timeIntervalSince1970: $0 / 1000) }
            }
        }
    }

    func openSafariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: AppInfo.extensionBundleID) { error in
            guard let error else { return }
            log.error("showPreferencesForExtension failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code) \(error.localizedDescription, privacy: .public)")
            Task { @MainActor in
                self.notice = L("打不开 Safari 设置。请手动打开 Safari →「设置」→「扩展」，勾选「书签管家」。",
                                "Couldn't open Safari settings. Open Safari → Settings → Extensions and enable BookmarkKeeper.")
            }
        }
    }

    func openICloudSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.systempreferences.AppleIDSettings")!)
    }

    func openChromeWebStore() {
        if let url = AppInfo.chromeWebStoreURL { NSWorkspace.shared.open(url) }
    }

    /// 把 App 里带的 Chrome 扩展拷到一个固定位置并在访达里选中，用户把它拖进 chrome://extensions。
    /// 每次都覆盖成当前 App 带的版本，扩展更新后在 chrome://extensions 点一下刷新即可。
    func revealChromeExtension() {
        guard let bundled = Bundle.main.resourceURL?.appendingPathComponent("ChromeExtension", isDirectory: true) else { return }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let target = support.appendingPathComponent("BookmarkKeeper/Chrome Extension", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: target.path) {
                try FileManager.default.removeItem(at: target)
            }
            try FileManager.default.copyItem(at: bundled, to: target)
            NSWorkspace.shared.activateFileViewerSelecting([target])
        } catch {
            notice = error.localizedDescription
        }
    }
}
