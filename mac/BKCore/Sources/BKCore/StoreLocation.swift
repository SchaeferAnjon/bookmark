import Foundation
import IOKit

/// 快捷书签放在哪：优先 App 自己的 iCloud 容器；iCloud 没开时退到 App Group 共享目录（只在本机）。
/// Chrome 本地通信模式（App 主程序）和 Safari 扩展都能访问这两个位置，所以两边读写的是同一处。
public enum StoreLocation {
    public static let iCloudContainerID = "iCloud.io.github.schaeferanjon.BookmarkKeeper"
    static let folderName = "QuickLinks"

    public struct Resolved {
        public let directory: URL
        public let isICloud: Bool
    }

    /// 端到端测试用：设了这个环境变量就读写指定目录，不碰真实的 iCloud 数据
    public static let overrideEnv = "BOOKMARKKEEPER_STORE_DIR"

    /// 注意：第一次调用 `url(forUbiquityContainerIdentifier:)` 可能要几秒，别在主线程调
    public static func resolve(appGroup: String?) -> Resolved {
        if let dir = ProcessInfo.processInfo.environment[overrideEnv], !dir.isEmpty {
            return Resolved(directory: URL(fileURLWithPath: dir, isDirectory: true), isICloud: false)
        }
        if let container = FileManager.default.url(forUbiquityContainerIdentifier: iCloudContainerID) {
            return Resolved(directory: container.appendingPathComponent(folderName, isDirectory: true), isICloud: true)
        }
        return Resolved(directory: localDirectory(appGroup: appGroup), isICloud: false)
    }

    public static func localDirectory(appGroup: String?) -> URL {
        if let appGroup, !appGroup.isEmpty,
           let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return group.appendingPathComponent(folderName, isDirectory: true)
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("BookmarkKeeper/\(folderName)", isDirectory: true)
    }

    /// 本机标识：硬件 UUID 的哈希（不把原始硬件编号写进 iCloud 文件名）。同一台 Mac 上
    /// Chrome 模式和 Safari 扩展算出来的一样，再各自加后缀区分写入方。
    public static func machineID() -> String {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        defer { IOObjectRelease(service) }
        if service != 0,
           let uuid = IORegistryEntryCreateCFProperty(service, "IOPlatformUUID" as CFString, kCFAllocatorDefault, 0)?
               .takeRetainedValue() as? String {
            return "mac-" + QuickStore.fnv1a("bookmarkkeeper:" + uuid)
        }
        let key = "BKMachineID"
        if let saved = UserDefaults.standard.string(forKey: key) { return saved }
        let made = "mac-" + UUID().uuidString.lowercased().prefix(12)
        UserDefaults.standard.set(made, forKey: key)
        return made
    }
}
