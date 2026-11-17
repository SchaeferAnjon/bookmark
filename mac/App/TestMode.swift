import AppKit
import BKCore
import ObjectiveC
import SafariServices

/// 测试模式：环境变量 E2E=1（或启动参数 -E2E 1）启动时，窗口绝不出现在屏幕上，不抢焦点、不进程序坞、不碰用户的真数据。
/// Entry.main 第一行调 setUp()，赶在任何代码读家目录、偏好、快捷书签之前。做的事：
/// - 家目录换成临时目录（CFFIXED_USER_HOME）：Chrome 各浏览器的 NativeMessagingHosts 注册、拷出来的 Chrome 扩展文件夹都写在
///   E2E_DATA_DIR/home 下，不改真浏览器的注册（不给 E2E_DATA_DIR 就用系统临时目录下 bookmarkkeeper-e2e-<pid>）
/// - 快捷书签读写 E2E_DATA_DIR/QuickLinks（BOOKMARKKEEPER_STORE_DIR 给了就用它），不碰 iCloud 里的真数据
/// - 偏好用独立的域 io.github.schaeferanjon.BookmarkKeeper.e2e（UserDefaults.standard 换成它，每次启动先清空）
/// - App 设成 .prohibited（不进程序坞、没有菜单栏、不能被激活），窗口不排到屏幕上（orderWindow 排进来的一律不做），
///   透明、不收鼠标；NSApp.activate 不做（只有 E2E_CLICKS 点的那一下透明地排进来，见下）
/// - 打开网址（含「使用说明与源码」链接、系统设置）、在访达里显示、打开 Safari 的扩展设置、打开存储面板、提示框、弹出菜单都不真做，
///   只记一行：写到 stderr（[E2E] 开头）和 E2E_RECORD（默认 E2E_DATA_DIR/record.jsonl），存储面板和提示框回「取消」
/// - E2E_SNAPSHOT=<png>：启动 E2E_SNAPSHOT_DELAY 秒（默认 3）后把窗口画成 PNG（cacheDisplay，窗口不用在屏幕上）；
///   E2E_CLICKS="x:y+x:y" 截之前先在窗口里点这几下（点，离窗口左上角，每下等 1.5 秒），走真的按钮。
///   排出去的窗口 SwiftUI 不认点，点的那一下窗口挪到屏幕外再排进来，一直透明、不收真鼠标，点完排出去
/// 验证脚本 mac/scripts/e2e-hidden-check.sh：构建、开关下启动、一直盯着屏幕上有没有它看得见的窗口、点「扩展文件夹」、截图。
enum TestMode {
    static let on: Bool = {
        let env = ProcessInfo.processInfo.environment["E2E"] ?? ""
        if ["1", "true", "yes"].contains(env.lowercased()) { return true }
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "-E2E"), args.count > index + 1 {
            return ["1", "yes", "true"].contains(args[index + 1].lowercased())
        }
        return false
    }()

    static let defaultsSuite = "io.github.schaeferanjon.BookmarkKeeper.e2e"

    nonisolated(unsafe) private(set) static var dataDir = URL(fileURLWithPath: NSTemporaryDirectory())
    nonisolated(unsafe) private(set) static var recorded: [String] = []
    nonisolated(unsafe) private static var recordFile: URL?
    private static let lock = NSLock()

    static func setUp() {
        guard on else { return }
        let env = ProcessInfo.processInfo.environment
        dataDir = URL(fileURLWithPath: env["E2E_DATA_DIR"] ?? NSTemporaryDirectory() + "bookmarkkeeper-e2e-\(getpid())", isDirectory: true)
        let home = dataDir.appendingPathComponent("home", isDirectory: true)
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        setenv("CFFIXED_USER_HOME", home.path, 1)
        if (env[StoreLocation.overrideEnv] ?? "").isEmpty {
            setenv(StoreLocation.overrideEnv, dataDir.appendingPathComponent("QuickLinks", isDirectory: true).path, 1)
        }
        recordFile = env["E2E_RECORD"].map { URL(fileURLWithPath: $0) } ?? dataDir.appendingPathComponent("record.jsonl")

        swizzleDefaults()
        swizzleWindows()
        swizzleRecorders()

        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        NotificationCenter.default.addObserver(forName: NSApplication.didFinishLaunchingNotification, object: nil, queue: .main) { _ in
            NSApp.setActivationPolicy(.prohibited)
            NSApp.windows.forEach(hide)
            MainActor.assumeIsolated { scheduleSnapshot() }
        }
        // SwiftUI 晚一点才建的窗口、改大小以后也再收一遍
        for name in [NSWindow.didUpdateNotification, NSWindow.didResizeNotification, NSWindow.didBecomeKeyNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { note in
                if let window = note.object as? NSWindow, window.isVisible || window.alphaValue > 0 || !window.ignoresMouseEvents { hide(window) }
            }
        }
        log("测试模式：数据 \(dataDir.path)，快捷书签 \(ProcessInfo.processInfo.environment[StoreLocation.overrideEnv] ?? "")，偏好域 \(defaultsSuite)")
    }

    /// 记一次本该弹到屏幕上、或者本该交给别的 App 的动作
    static func record(_ action: String, _ detail: String = "") {
        let line = detail.isEmpty ? action : "\(action) \(detail)"
        lock.lock()
        recorded.append(line)
        let file = recordFile
        lock.unlock()
        log(line)
        guard let file,
              let json = try? JSONSerialization.data(withJSONObject: ["t": Date().timeIntervalSince1970, "action": action, "detail": detail],
                                                     options: .withoutEscapingSlashes)
        else { return }
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(json + Data("\n".utf8))
            try? handle.close()
        } else {
            try? (json + Data("\n".utf8)).write(to: file)
        }
    }

    static func log(_ text: String) {
        FileHandle.standardError.write(Data("[E2E] \(text)\n".utf8))
    }

    /// 窗口透明、不收鼠标、从屏幕上拿下来
    static func hide(_ window: NSWindow) {
        if window.alphaValue != 0 { window.alphaValue = 0 }
        if !window.ignoresMouseEvents { window.ignoresMouseEvents = true }
        if window.isVisible { window.e2e_orderWindow(.out, relativeTo: 0) }
    }

    // MARK: 截图

    /// 启动 E2E_SNAPSHOT_DELAY 秒后：先按 E2E_CLICKS 点几下（每下等 1.5 秒），再截 E2E_SNAPSHOT
    @MainActor private static func scheduleSnapshot() {
        let env = ProcessInfo.processInfo.environment
        let path = env["E2E_SNAPSHOT"] ?? ""
        let clicks = (env["E2E_CLICKS"] ?? "").split(separator: "+").compactMap { pair -> CGPoint? in
            let xy = pair.split(separator: ":").compactMap { Double($0) }
            return xy.count == 2 ? CGPoint(x: xy[0], y: xy[1]) : nil
        }
        guard !path.isEmpty || !clicks.isEmpty else { return }
        let delay = Double(env["E2E_SNAPSHOT_DELAY"] ?? "") ?? 3
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(delay))
            for point in clicks {
                click(at: point)
                try? await Task.sleep(for: .seconds(1.5))
            }
            if !path.isEmpty { snapshot(to: URL(fileURLWithPath: path)) }
        }
    }

    @MainActor private static var mainWindow: NSWindow? {
        NSApp.windows.filter { $0.styleMask.contains(.titled) && $0.contentView != nil }
            .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    }

    /// 在主窗口里点一下（点，离窗口左上角，含标题栏），走真的 AppKit 鼠标事件
    @MainActor static func click(at point: CGPoint) {
        guard let window = mainWindow, let frame = window.contentView?.superview else { return }
        // 排出去的窗口 SwiftUI 不认点：点的时候排进来，但一直透明、不收真鼠标（屏幕上看不见），点完再排出去
        // 先挪到屏幕外：系统把它拉回来也是透明的
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.setFrameOrigin(NSPoint(x: -30000, y: -30000))
        if !window.isVisible { window.e2e_orderWindow(.above, relativeTo: 0) }
        window.makeKey()
        let location = NSPoint(x: point.x, y: frame.bounds.height - point.y)
        func event(_ type: NSEvent.EventType) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        }
        // 和 main-shot 一样：抬起先排进队列，按下走 NSApp.sendEvent（先过 App 的本地监听；输入框按下后自己转圈等抬起）
        if let up = event(.leftMouseUp) { NSApp.postEvent(up, atStart: false) }
        if let down = event(.leftMouseDown) { NSApp.sendEvent(down) }
        DispatchQueue.main.async { hide(window) }
        log("点了 \(Int(point.x)):\(Int(point.y))")
    }

    /// 最大的那个带标题栏的窗口（主窗口）连标题栏一起画成 2 倍 PNG
    @MainActor static func snapshot(to url: URL) {
        guard let window = mainWindow, let view = window.contentView?.superview ?? window.contentView else {
            log("截图：没有窗口")
            return
        }
        view.layoutSubtreeIfNeeded()
        let bounds = view.bounds
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(bounds.width * 2), pixelsHigh: Int(bounds.height * 2),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { return }
        rep.size = bounds.size
        view.cacheDisplay(in: bounds, to: rep)
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try rep.representation(using: .png, properties: [:])?.write(to: url)
            log("截图：\(url.path)（\(Int(bounds.width))x\(Int(bounds.height))）")
        } catch {
            log("截图写不出：\(error.localizedDescription)")
        }
    }

    // MARK: 换方法

    /// 系统方法按 Objective-C 的名字写，换不上（系统改了名字）就在 stderr 说一声，验证脚本会看到
    private static func swap(_ cls: AnyClass, _ original: String, _ replacement: Selector, classMethod: Bool = false) {
        guard let target: AnyClass = classMethod ? object_getClass(cls) : cls,
              let a = class_getInstanceMethod(target, NSSelectorFromString(original)), let b = class_getInstanceMethod(target, replacement) else {
            log("换不了 \(cls).\(original)")
            return
        }
        method_exchangeImplementations(a, b)
    }

    private static func swizzleDefaults() {
        UserDefaults.e2eSuite.removePersistentDomain(forName: defaultsSuite)
        swap(UserDefaults.self, "standardUserDefaults", #selector(getter: UserDefaults.e2e_standard), classMethod: true)
        // 不恢复上次的窗口（保存的窗口状态也在临时家目录里，这里再保险一次）
        UserDefaults.standard.register(defaults: ["ApplePersistenceIgnoreState": true, "NSQuitAlwaysKeepsWindows": false])
    }

    private static func swizzleWindows() {
        swap(NSWindow.self, "orderWindow:relativeTo:", #selector(NSWindow.e2e_orderWindow(_:relativeTo:)))
        swap(NSWindow.self, "orderFrontRegardless", #selector(NSWindow.e2e_orderFrontRegardless))
        swap(NSWindow.self, "makeKeyAndOrderFront:", #selector(NSWindow.e2e_makeKeyAndOrderFront(_:)))
        swap(NSWindow.self, "orderFront:", #selector(NSWindow.e2e_orderFront(_:)))
        swap(NSWindow.self, "setIsVisible:", #selector(NSWindow.e2e_setIsVisible(_:)))
        swap(NSApplication.self, "activateIgnoringOtherApps:", #selector(NSApplication.e2e_activate(ignoringOtherApps:)))
        swap(NSApplication.self, "activate", #selector(NSApplication.e2e_activateNow))
        swap(NSRunningApplication.self, "activateWithOptions:", #selector(NSRunningApplication.e2e_activate(options:)))
        swap(NSMenu.self, "popUpMenuPositioningItem:atLocation:inView:", #selector(NSMenu.e2e_popUp(positioning:at:in:)))
        swap(NSMenu.self, "popUpContextMenu:withEvent:forView:", #selector(NSMenu.e2e_popUpContextMenu(_:with:for:)), classMethod: true)
        swap(NSMenu.self, "popUpContextMenu:withEvent:forView:withFont:", #selector(NSMenu.e2e_popUpContextMenu(_:with:for:with:)), classMethod: true)
    }

    private static func swizzleRecorders() {
        swap(NSWorkspace.self, "openURL:", #selector(NSWorkspace.e2e_open(_:)))
        swap(NSWorkspace.self, "openURL:configuration:completionHandler:", #selector(NSWorkspace.e2e_open(_:configuration:completionHandler:)))
        swap(NSWorkspace.self, "openURLs:withApplicationAtURL:configuration:completionHandler:",
             #selector(NSWorkspace.e2e_open(_:withApplicationAt:configuration:completionHandler:)))
        swap(NSWorkspace.self, "openApplicationAtURL:configuration:completionHandler:",
             #selector(NSWorkspace.e2e_openApplication(at:configuration:completionHandler:)))
        swap(NSWorkspace.self, "activateFileViewerSelectingURLs:", #selector(NSWorkspace.e2e_activateFileViewerSelecting(_:)))
        swap(NSWorkspace.self, "selectFile:inFileViewerRootedAtPath:", #selector(NSWorkspace.e2e_selectFile(_:inFileViewerRootedAtPath:)))
        swap(NSSavePanel.self, "runModal", #selector(NSSavePanel.e2e_runModal))
        swap(NSSavePanel.self, "beginWithCompletionHandler:", #selector(NSSavePanel.e2e_begin(completionHandler:)))
        swap(NSSavePanel.self, "beginSheetModalForWindow:completionHandler:", #selector(NSSavePanel.e2e_beginSheetModal(for:completionHandler:)))
        swap(NSAlert.self, "runModal", #selector(NSAlert.e2e_runModal))
        swap(NSAlert.self, "beginSheetModalForWindow:completionHandler:", #selector(NSAlert.e2e_beginSheetModal(for:completionHandler:)))
        swap(SFSafariApplication.self, "showPreferencesForExtensionWithIdentifier:completionHandler:",
             #selector(SFSafariApplication.e2e_showPreferencesForExtension(withIdentifier:completionHandler:)), classMethod: true)
    }
}

// 下面这些方法和系统的换过实现：在 e2e_ 方法里调 e2e_ 自己就是调原来的系统实现

extension UserDefaults {
    static let e2eSuite = UserDefaults(suiteName: TestMode.defaultsSuite)!

    @objc class var e2e_standard: UserDefaults { e2eSuite }
}

extension NSWindow {
    @objc func e2e_orderWindow(_ place: NSWindow.OrderingMode, relativeTo other: Int) {
        if place == .out { e2e_orderWindow(place, relativeTo: other) } else { TestMode.hide(self) }
    }

    @objc func e2e_orderFrontRegardless() { TestMode.hide(self) }
    @objc func e2e_makeKeyAndOrderFront(_ sender: Any?) { TestMode.hide(self) }
    @objc func e2e_orderFront(_ sender: Any?) { TestMode.hide(self) }

    @objc func e2e_setIsVisible(_ flag: Bool) {
        if flag { TestMode.hide(self) } else { e2e_setIsVisible(false) }
    }
}

extension NSApplication {
    @objc func e2e_activate(ignoringOtherApps flag: Bool) { TestMode.record("NSApp.activate") }
    @objc func e2e_activateNow() { TestMode.record("NSApp.activate") }
}

extension NSRunningApplication {
    @objc func e2e_activate(options: NSApplication.ActivationOptions) -> Bool {
        TestMode.record("NSRunningApplication.activate", bundleIdentifier ?? "")
        return true
    }
}

extension NSMenu {
    @objc func e2e_popUp(positioning item: NSMenuItem?, at location: NSPoint, in view: NSView?) -> Bool {
        TestMode.record("NSMenu.popUp", items.map(\.title).joined(separator: " | "))
        return false
    }

    @objc class func e2e_popUpContextMenu(_ menu: NSMenu, with event: NSEvent, for view: NSView) {
        TestMode.record("NSMenu.popUpContextMenu", menu.items.map(\.title).joined(separator: " | "))
    }

    @objc class func e2e_popUpContextMenu(_ menu: NSMenu, with event: NSEvent, for view: NSView, with font: NSFont?) {
        TestMode.record("NSMenu.popUpContextMenu", menu.items.map(\.title).joined(separator: " | "))
    }
}

extension NSWorkspace {
    @objc func e2e_open(_ url: URL) -> Bool {
        TestMode.record("NSWorkspace.open", url.absoluteString)
        return true
    }

    @objc func e2e_open(_ url: URL, configuration: NSWorkspace.OpenConfiguration,
                        completionHandler: ((NSRunningApplication?, Error?) -> Void)?) {
        TestMode.record("NSWorkspace.open", url.absoluteString)
        completionHandler?(nil, nil)
    }

    @objc func e2e_open(_ urls: [URL], withApplicationAt app: URL, configuration: NSWorkspace.OpenConfiguration,
                        completionHandler: ((NSRunningApplication?, Error?) -> Void)?) {
        TestMode.record("NSWorkspace.open", urls.map(\.absoluteString).joined(separator: " ") + " 用 " + app.path)
        completionHandler?(nil, nil)
    }

    @objc func e2e_openApplication(at app: URL, configuration: NSWorkspace.OpenConfiguration,
                                   completionHandler: ((NSRunningApplication?, Error?) -> Void)?) {
        TestMode.record("NSWorkspace.openApplication", app.path)
        completionHandler?(nil, nil)
    }

    @objc func e2e_activateFileViewerSelecting(_ urls: [URL]) {
        TestMode.record("NSWorkspace.activateFileViewerSelecting", urls.map(\.path).joined(separator: " "))
    }

    @objc func e2e_selectFile(_ path: String?, inFileViewerRootedAtPath root: String) -> Bool {
        TestMode.record("NSWorkspace.selectFile", path ?? root)
        return true
    }
}

extension NSSavePanel {
    @objc func e2e_runModal() -> NSApplication.ModalResponse {
        TestMode.record(self is NSOpenPanel ? "NSOpenPanel.runModal" : "NSSavePanel.runModal", message)
        return .cancel
    }

    @objc func e2e_begin(completionHandler: @escaping (NSApplication.ModalResponse) -> Void) {
        TestMode.record(self is NSOpenPanel ? "NSOpenPanel.begin" : "NSSavePanel.begin", message)
        DispatchQueue.main.async { completionHandler(.cancel) }
    }

    @objc func e2e_beginSheetModal(for window: NSWindow, completionHandler: @escaping (NSApplication.ModalResponse) -> Void) {
        TestMode.record(self is NSOpenPanel ? "NSOpenPanel.beginSheet" : "NSSavePanel.beginSheet", message)
        DispatchQueue.main.async { completionHandler(.cancel) }
    }
}

extension NSAlert {
    @objc func e2e_runModal() -> NSApplication.ModalResponse {
        TestMode.record("NSAlert.runModal", messageText)
        return .cancel
    }

    @objc func e2e_beginSheetModal(for window: NSWindow, completionHandler: ((NSApplication.ModalResponse) -> Void)?) {
        TestMode.record("NSAlert.beginSheet", messageText)
        DispatchQueue.main.async { completionHandler?(.cancel) }
    }
}

extension SFSafariApplication {
    @objc class func e2e_showPreferencesForExtension(withIdentifier identifier: String, completionHandler: ((Error?) -> Void)?) {
        TestMode.record("SFSafariApplication.showPreferencesForExtension", identifier)
        completionHandler?(nil)
    }
}
