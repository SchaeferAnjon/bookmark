import Foundation

/// 扩展发来的消息 → 回复。Chrome（经本地通信）和 Safari（经扩展处理程序）共用。
///
///   { cmd: "load" }            → { ok, records, rev, icloud }
///   { cmd: "put", records }    → 合并写入后同上
///   { cmd: "rev" }             → { ok, rev, icloud }
///   { cmd: "ping" }            → { ok, version, icloud }
///   出错                        → { ok: false, error }
public final class Bridge {
    public let kind: String
    private let appGroup: String?
    private let queue = DispatchQueue(label: "bookmarkkeeper.bridge")
    private var store: QuickStore?
    private var isICloud = false
    private var resolvedAt = Date.distantPast
    private let locate: (String?) -> StoreLocation.Resolved

    /// kind：写入方后缀（"chrome" / "safari"），同一台 Mac 上两个浏览器各写各的文件
    public init(kind: String, appGroup: String?, locate: @escaping (String?) -> StoreLocation.Resolved = StoreLocation.resolve) {
        self.kind = kind
        self.appGroup = appGroup
        self.locate = locate
    }

    public func handle(_ message: Any?) -> JSONObject {
        queue.sync {
            do {
                return try handleUnlocked(message)
            } catch {
                return ["ok": false, "error": error.localizedDescription]
            }
        }
    }

    private func handleUnlocked(_ message: Any?) throws -> JSONObject {
        guard let msg = message as? [String: Any], let cmd = msg["cmd"] as? String else {
            return ["ok": false, "error": "无法识别的消息"]
        }
        let store = currentStore()
        switch cmd {
        case "ping":
            return ["ok": true, "icloud": isICloud, "version": Self.version]
        case "rev":
            return ["ok": true, "icloud": isICloud, "rev": store.revision()]
        case "load":
            let r = try store.load()
            return ["ok": true, "icloud": isICloud, "records": r.records, "rev": r.rev]
        case "put":
            let r = try store.put(try QuickStore.validate(msg["records"]))
            return ["ok": true, "icloud": isICloud, "records": r.records, "rev": r.rev]
        default:
            return ["ok": false, "error": "未知命令：\(cmd)"]
        }
    }

    /// iCloud 可能中途打开：没在用 iCloud 时每分钟重新看一次；切到 iCloud 时把本机暂存的数据并过去
    private func currentStore() -> QuickStore {
        if let store, isICloud || Date().timeIntervalSince(resolvedAt) < 60 { return store }
        let location = locate(appGroup)
        resolvedAt = Date()
        let writer = "\(StoreLocation.machineID())-\(kind)"
        let next = QuickStore(directory: location.directory, writerID: writer)
        if location.isICloud {
            Self.adoptLocalData(into: next, appGroup: appGroup)
        }
        store = next
        isICloud = location.isICloud
        return next
    }

    /// iCloud 没开期间写在本机的快捷书签，iCloud 打开后并进去；本机目录改名留作备份
    static func adoptLocalData(into store: QuickStore, appGroup: String?) {
        let local = StoreLocation.localDirectory(appGroup: appGroup)
        guard local.standardizedFileURL != store.directory.standardizedFileURL,
              FileManager.default.fileExists(atPath: local.path),
              let records = try? QuickStore(directory: local, writerID: store.writerID).load().records,
              !records.isEmpty else { return }
        if (try? store.put(records)) != nil {
            let backup = local.deletingLastPathComponent()
                .appendingPathComponent("QuickLinks-merged-into-iCloud-\(Int(Date().timeIntervalSince1970))")
            try? FileManager.default.moveItem(at: local, to: backup)
        }
    }

    public static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    }
}
