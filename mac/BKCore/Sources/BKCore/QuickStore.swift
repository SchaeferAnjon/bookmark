import Foundation

public typealias JSONObject = [String: Any]
public typealias Records = [String: JSONObject]

public enum QuickStoreError: LocalizedError {
    case invalidRecords(String)
    case tooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidRecords(let why): return "快捷书签数据格式不对：\(why)"
        case .tooLarge: return "快捷书签数据过大"
        }
    }
}

/// 快捷书签记录仓库。
///
/// 一个目录（iCloud 容器里的 `QuickLinks/`），每个写入方一个 JSON 文件
/// （`<机器>-chrome.json`、`<机器>-safari.json`），读的时候合并全部文件。
/// 每个文件只有一个写入方，所以 iCloud 不会产生冲突副本。
///
/// 记录的字段由扩展端（shared/qlmodel.js）定义，这里只认合并要用的两个：
/// `t`（修改时间，毫秒）和 `d`（写入方）。同一个 id 取 t 大的；t 相同比 d。
public final class QuickStore {
    public static let schema = 1
    static let maxRecords = 20_000

    public let directory: URL
    public let writerID: String
    private let fm = FileManager.default

    public init(directory: URL, writerID: String) {
        self.directory = directory
        self.writerID = writerID
    }

    private var ownFile: URL { directory.appendingPathComponent("\(writerID).json") }

    // MARK: 合并规则（与 qlmodel.js 的 newer / mergeRecords 一致）

    public static func newer(_ a: JSONObject, than b: JSONObject?) -> Bool {
        guard let b else { return true }
        let ta = number(a["t"]), tb = number(b["t"])
        if ta != tb { return ta > tb }
        return string(a["d"]) > string(b["d"])
    }

    public static func merge(_ maps: [Records]) -> Records {
        var out = Records()
        for map in maps {
            for (id, record) in map where newer(record, than: out[id]) {
                out[id] = record
            }
        }
        return out
    }

    static func number(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }

    /// 是数字而不是布尔。注意不能用 `is Bool`：JSON 解析出的 NSNumber 1 / 0 也会被当成 Bool
    static func isNumber(_ v: Any?) -> Bool {
        guard let n = v as? NSNumber else { return false }
        return CFGetTypeID(n) != CFBooleanGetTypeID()
    }
    static func string(_ v: Any?) -> String { (v as? String) ?? "" }

    /// 扩展发来的记录：键必须等于记录的 id，t 是数字，d 是字符串
    public static func validate(_ value: Any?) throws -> Records {
        guard let dict = value as? [String: Any] else { throw QuickStoreError.invalidRecords("records 不是对象") }
        if dict.count > maxRecords { throw QuickStoreError.tooLarge }
        var out = Records()
        for (key, raw) in dict {
            guard let r = raw as? JSONObject else { throw QuickStoreError.invalidRecords("\(key) 不是对象") }
            guard (r["id"] as? String) == key, !key.isEmpty, key.count <= 200 else { throw QuickStoreError.invalidRecords("\(key) 的 id 不一致") }
            guard isNumber(r["t"]) else { throw QuickStoreError.invalidRecords("\(key) 缺少时间戳") }
            guard r["d"] is String else { throw QuickStoreError.invalidRecords("\(key) 缺少写入方") }
            out[key] = r
        }
        return out
    }

    // MARK: 读写

    /// 合并目录里所有写入方的文件
    public func load() throws -> (records: Records, rev: String) {
        var maps: [Records] = []
        for url in try jsonFiles() {
            if let records = try? readRecords(at: url) { maps.append(records) }
        }
        return (Self.merge(maps), revision())
    }

    /// 把收到的记录合并进本写入方的文件，返回合并后的全部记录
    public func put(_ incoming: Records) throws -> (records: Records, rev: String) {
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: ownFile, options: .forMerging, error: &coordError) { url in
            do {
                let current = (try? self.readRecordsUncoordinated(at: url)) ?? [:]
                let merged = Self.merge([current, incoming])
                let doc: JSONObject = [
                    "schema": Self.schema,
                    "writer": self.writerID,
                    "updated": Int(Date().timeIntervalSince1970 * 1000),
                    "records": merged,
                ]
                let data = try JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])
                try data.write(to: url, options: .atomic)
            } catch {
                writeError = error
            }
        }
        if let e = coordError ?? writeError { throw e }
        return try load()
    }

    /// 目录内容的指纹（文件名 + 大小 + 修改时间）。内容一变它就变，扩展用它判断要不要重新读。
    public func revision() -> String {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        let items = (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys)) ?? []
        let parts = items
            .filter { $0.lastPathComponent.hasSuffix(".json") || $0.lastPathComponent.hasSuffix(".icloud") }
            .map { url -> String in
                let v = try? url.resourceValues(forKeys: Set(keys))
                let mtime = v?.contentModificationDate?.timeIntervalSince1970 ?? 0
                return "\(url.lastPathComponent):\(v?.fileSize ?? -1):\(Int(mtime * 1000))"
            }
            .sorted()
        return Self.fnv1a(parts.joined(separator: "|"))
    }

    // MARK: 内部

    private func jsonFiles() throws -> [URL] {
        guard fm.fileExists(atPath: directory.path) else { return [] }
        let items = try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        var out: [URL] = []
        for url in items {
            let name = url.lastPathComponent
            if name.hasSuffix(".json") {
                out.append(url)
            } else if name.hasPrefix("."), name.hasSuffix(".json.icloud") {
                // 旧式 iCloud 占位文件（内容还在云端）：请求下载，这次先跳过
                let real = directory.appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count)))
                try? fm.startDownloadingUbiquitousItem(at: real)
            }
        }
        return out
    }

    private func readRecords(at url: URL) throws -> Records {
        var coordError: NSError?
        var result: Result<Records, Error> = .success([:])
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { url in
            result = Result { try self.readRecordsUncoordinated(at: url) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    private func readRecordsUncoordinated(at url: URL) throws -> Records {
        let data = try Data(contentsOf: url)
        guard let doc = try JSONSerialization.jsonObject(with: data) as? JSONObject,
              let records = doc["records"] as? [String: Any] else { return [:] }
        return records.compactMapValues { $0 as? JSONObject }
    }

    /// 跨进程稳定的字符串哈希（Swift 自带的 Hasher 每个进程随机，不能用）
    public static func fnv1a(_ s: String) -> String {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for b in s.utf8 {
            h ^= UInt64(b)
            h = h &* 0x0000_0100_0000_01b3
        }
        return String(h, radix: 36)
    }
}
