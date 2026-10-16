import Foundation

/// Chrome 本地通信协议：每条消息 = 4 字节长度（本机字节序，Mac 上是小端）+ UTF-8 JSON。
/// Chrome 每次 sendNativeMessage 拉起一个进程、发一条、读一条回复，然后关掉 stdin。
public enum NativeMessaging {
    /// Chrome 规定程序回给浏览器的单条消息不能超过 1 MB
    static let maxOutgoing = 1024 * 1024
    static let maxIncoming = 64 * 1024 * 1024

    public static func read(from handle: FileHandle) throws -> Any? {
        guard let header = try readExactly(4, from: handle) else { return nil }
        let length = header.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
        guard length <= maxIncoming else { throw QuickStoreError.tooLarge }
        guard let body = try readExactly(length, from: handle) else { return nil }
        return try JSONSerialization.jsonObject(with: body)
    }

    public static func encode(_ message: JSONObject) throws -> Data {
        var body = try JSONSerialization.data(withJSONObject: message)
        if body.count > maxOutgoing {
            body = try JSONSerialization.data(withJSONObject: ["ok": false, "error": "快捷书签数据超过 1 MB，无法传给 Chrome"])
        }
        var length = UInt32(body.count).littleEndian
        return Data(bytes: &length, count: 4) + body
    }

    public static func write(_ message: JSONObject, to handle: FileHandle) throws {
        try handle.write(contentsOf: encode(message))
    }

    /// 本地通信模式的主循环：一直处理到 Chrome 关掉 stdin
    public static func runHost(bridge: Bridge,
                               input: FileHandle = .standardInput,
                               output: FileHandle = .standardOutput) {
        while true {
            let message: Any?
            do {
                guard let m = try read(from: input) else { return }
                message = m
            } catch {
                try? write(["ok": false, "error": error.localizedDescription], to: output)
                return
            }
            do {
                try write(bridge.handle(message), to: output)
            } catch {
                return
            }
        }
    }

    private static func readExactly(_ count: Int, from handle: FileHandle) throws -> Data? {
        var data = Data()
        while data.count < count {
            guard let chunk = try handle.read(upToCount: count - data.count), !chunk.isEmpty else {
                return data.isEmpty ? nil : data
            }
            data.append(chunk)
        }
        return data
    }
}
