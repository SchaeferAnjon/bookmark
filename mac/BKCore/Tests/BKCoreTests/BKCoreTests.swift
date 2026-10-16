import XCTest
@testable import BKCore

final class QuickStoreTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("bk-tests-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    func rec(_ id: String, _ title: String, t: Int, d: String = "A", deleted: Bool = false) -> JSONObject {
        ["id": id, "kind": "link", "title": title, "url": "https://\(id)/", "parent": "", "order": 0,
         "deleted": deleted, "t": t, "d": d]
    }

    func testPutThenLoadRoundTrip() throws {
        let store = QuickStore(directory: dir, writerID: "m1-chrome")
        let r = try store.put(["a": rec("a", "A", t: 10)])
        XCTAssertEqual(r.records["a"]?["title"] as? String, "A")
        XCTAssertEqual(try store.load().records.count, 1)
    }

    func testWritersKeepSeparateFilesAndLoadMergesThem() throws {
        let chrome = QuickStore(directory: dir, writerID: "m1-chrome")
        let safari = QuickStore(directory: dir, writerID: "m1-safari")
        _ = try chrome.put(["a": rec("a", "from chrome", t: 10), "b": rec("b", "B", t: 10)])
        _ = try safari.put(["a": rec("a", "from safari", t: 20, d: "S")])
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        XCTAssertEqual(files, ["m1-chrome.json", "m1-safari.json"])
        let merged = try chrome.load().records
        XCTAssertEqual(merged["a"]?["title"] as? String, "from safari")
        XCTAssertEqual(merged.count, 2)
    }

    func testOlderWriteDoesNotOverwriteNewer() throws {
        let store = QuickStore(directory: dir, writerID: "m1-chrome")
        _ = try store.put(["a": rec("a", "new", t: 20)])
        let r = try store.put(["a": rec("a", "old", t: 10)])
        XCTAssertEqual(r.records["a"]?["title"] as? String, "new")
    }

    func testTieBreaksOnWriterRegardlessOfOrder() {
        let a = rec("x", "A", t: 5, d: "A")
        let b = rec("x", "B", t: 5, d: "B")
        XCTAssertEqual(QuickStore.merge([["x": a], ["x": b]])["x"]?["title"] as? String, "B")
        XCTAssertEqual(QuickStore.merge([["x": b], ["x": a]])["x"]?["title"] as? String, "B")
    }

    func testTombstonesSurviveMerge() throws {
        let store = QuickStore(directory: dir, writerID: "m1-chrome")
        _ = try store.put(["a": rec("a", "A", t: 10)])
        let r = try store.put(["a": rec("a", "A", t: 11, deleted: true)])
        XCTAssertEqual(r.records["a"]?["deleted"] as? Bool, true)
    }

    func testRevisionChangesAfterWrite() throws {
        let store = QuickStore(directory: dir, writerID: "m1-chrome")
        let before = store.revision()
        _ = try store.put(["a": rec("a", "A", t: 10)])
        XCTAssertNotEqual(before, store.revision())
        XCTAssertEqual(store.revision(), store.revision())
    }

    func testValidateRejectsMalformedRecords() {
        XCTAssertThrowsError(try QuickStore.validate("nope"))
        XCTAssertThrowsError(try QuickStore.validate(["a": ["id": "b", "t": 1, "d": "A"]]))   // id 不一致
        XCTAssertThrowsError(try QuickStore.validate(["a": ["id": "a", "d": "A"]]))           // 没有 t
        XCTAssertThrowsError(try QuickStore.validate(["a": ["id": "a", "t": true, "d": "A"]])) // t 不是数字
        XCTAssertNoThrow(try QuickStore.validate(["a": rec("a", "A", t: 1)]))
    }

    /// 端到端测试抓到的：JSON 里的 t:1（导入记录的时间戳）被 `is Bool` 误判成布尔
    func testValidateAcceptsZeroAndOneFromRealJSON() throws {
        let json = #"{"a":{"id":"a","t":1,"d":"x"},"b":{"id":"b","t":0,"d":"x"}}"#
        let parsed = try JSONSerialization.jsonObject(with: Data(json.utf8))
        XCTAssertEqual(try QuickStore.validate(parsed).count, 2)
        let boolean = try JSONSerialization.jsonObject(with: Data(#"{"a":{"id":"a","t":true,"d":"x"}}"#.utf8))
        XCTAssertThrowsError(try QuickStore.validate(boolean))
    }

    func testCorruptFileFromAnotherWriterIsIgnored() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("{not json".utf8).write(to: dir.appendingPathComponent("broken-safari.json"))
        let store = QuickStore(directory: dir, writerID: "m1-chrome")
        let r = try store.put(["a": rec("a", "A", t: 10)])
        XCTAssertEqual(r.records.count, 1)
    }

    func testFnvIsStable() {
        XCTAssertEqual(QuickStore.fnv1a("hello"), QuickStore.fnv1a("hello"))
        XCTAssertNotEqual(QuickStore.fnv1a("hello"), QuickStore.fnv1a("hellp"))
    }
}

final class BridgeTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("bk-bridge-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    func makeBridge(_ kind: String) -> Bridge {
        let dir = self.dir!
        return Bridge(kind: kind, appGroup: nil) { _ in StoreLocation.Resolved(directory: dir, isICloud: false) }
    }

    func testChromeAndSafariSeeEachOthersWrites() {
        let chrome = makeBridge("chrome")
        let safari = makeBridge("safari")
        let put = chrome.handle(["cmd": "put", "records": ["a": ["id": "a", "kind": "link", "title": "A", "t": 1, "d": "c"]]])
        XCTAssertEqual(put["ok"] as? Bool, true)
        let load = safari.handle(["cmd": "load"])
        XCTAssertEqual((load["records"] as? Records)?["a"]?["title"] as? String, "A")
        XCTAssertEqual(load["icloud"] as? Bool, false)
    }

    func testBadMessagesReturnErrorsInsteadOfCrashing() {
        let b = makeBridge("chrome")
        XCTAssertEqual(b.handle(nil)["ok"] as? Bool, false)
        XCTAssertEqual(b.handle(["cmd": "nope"])["ok"] as? Bool, false)
        XCTAssertEqual(b.handle(["cmd": "put", "records": 5])["ok"] as? Bool, false)
    }

    func testRevMatchesLoadRev() {
        let b = makeBridge("chrome")
        _ = b.handle(["cmd": "put", "records": ["a": ["id": "a", "t": 1, "d": "c"]]])
        XCTAssertEqual(b.handle(["cmd": "rev"])["rev"] as? String, b.handle(["cmd": "load"])["rev"] as? String)
    }
}

final class NativeMessagingTests: XCTestCase {
    func testFramingRoundTrip() throws {
        let pipe = Pipe()
        try NativeMessaging.write(["cmd": "load", "n": 1], to: pipe.fileHandleForWriting)
        try pipe.fileHandleForWriting.close()
        let msg = try NativeMessaging.read(from: pipe.fileHandleForReading) as? JSONObject
        XCTAssertEqual(msg?["cmd"] as? String, "load")
        XCTAssertNil(try NativeMessaging.read(from: pipe.fileHandleForReading), "EOF 返回 nil")
    }

    func testHostLoopAnswersEveryMessageThenExitsOnEOF() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("bk-host-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let bridge = Bridge(kind: "chrome", appGroup: nil) { _ in StoreLocation.Resolved(directory: dir, isICloud: false) }
        let input = Pipe(), output = Pipe()
        try NativeMessaging.write(["cmd": "ping"], to: input.fileHandleForWriting)
        try NativeMessaging.write(["cmd": "load"], to: input.fileHandleForWriting)
        try input.fileHandleForWriting.close()
        NativeMessaging.runHost(bridge: bridge, input: input.fileHandleForReading, output: output.fileHandleForWriting)
        try output.fileHandleForWriting.close()
        let first = try NativeMessaging.read(from: output.fileHandleForReading) as? JSONObject
        let second = try NativeMessaging.read(from: output.fileHandleForReading) as? JSONObject
        XCTAssertEqual(first?["ok"] as? Bool, true)
        XCTAssertNotNil(second?["records"])
    }

    func testOversizedReplyBecomesAnError() throws {
        let big = String(repeating: "x", count: 1_100_000)
        let data = try NativeMessaging.encode(["ok": true, "blob": big])
        let pipe = Pipe()
        try pipe.fileHandleForWriting.write(contentsOf: data)
        try pipe.fileHandleForWriting.close()
        let msg = try NativeMessaging.read(from: pipe.fileHandleForReading) as? JSONObject
        XCTAssertEqual(msg?["ok"] as? Bool, false)
    }
}

final class ChromeHostInstallerTests: XCTestCase {
    func testWritesManifestOnlyForInstalledBrowsers() throws {
        let support = FileManager.default.temporaryDirectory.appendingPathComponent("bk-support-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: support) }
        try FileManager.default.createDirectory(at: support.appendingPathComponent("Google/Chrome"), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: support.appendingPathComponent("Google/Chrome/Local State"))
        // 别的程序给没装的 Edge 建了注册目录，里面还有我们以前误写的文件：不该算已安装，并且要清掉我们的文件
        let edgeHosts = support.appendingPathComponent("Microsoft Edge/NativeMessagingHosts")
        try FileManager.default.createDirectory(at: edgeHosts, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: edgeHosts.appendingPathComponent("com.other.host.json"))
        try Data("{}".utf8).write(to: edgeHosts.appendingPathComponent("\(ChromeHostInstaller.hostName).json"))

        let installed = ChromeHostInstaller.install(executablePath: "/Applications/BookmarkKeeper.app/Contents/MacOS/BookmarkKeeper",
                                                    extensionIDs: ["aggplciegellbdfnhcbefkdnjcgnhdef"],
                                                    applicationSupport: support)
        XCTAssertEqual(installed, ["Google Chrome"])
        let file = support.appendingPathComponent("Google/Chrome/NativeMessagingHosts/\(ChromeHostInstaller.hostName).json")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? JSONObject
        XCTAssertEqual(json?["allowed_origins"] as? [String], ["chrome-extension://aggplciegellbdfnhcbefkdnjcgnhdef/"])
        XCTAssertEqual(json?["type"] as? String, "stdio")
        XCTAssertFalse(FileManager.default.fileExists(atPath: edgeHosts.appendingPathComponent("\(ChromeHostInstaller.hostName).json").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: edgeHosts.appendingPathComponent("com.other.host.json").path), "别人的文件不动")
        XCTAssertEqual(ChromeHostInstaller.installedBrowsers(executablePath: "/Applications/BookmarkKeeper.app/Contents/MacOS/BookmarkKeeper",
                                                             applicationSupport: support), ["Google Chrome"])
    }

    func testDetectsChromeInvocation() {
        XCTAssertTrue(ChromeHostInstaller.isHostInvocation(["/x/BookmarkKeeper", "chrome-extension://abc/"]))
        XCTAssertFalse(ChromeHostInstaller.isHostInvocation(["/x/BookmarkKeeper"]))
        XCTAssertFalse(ChromeHostInstaller.isHostInvocation(["/x/BookmarkKeeper", "-NSDocumentRevisionsDebugMode", "YES"]))
    }
}
