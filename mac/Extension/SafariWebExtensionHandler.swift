import BKCore
import Foundation
import SafariServices

/// Safari 扩展的本地处理程序：browser.runtime.sendNativeMessage 发来的消息都到这里。
/// 和 Chrome 那边共用 BKCore.Bridge，写入方后缀为 "safari"。
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let bridge = Bridge(
        kind: "safari",
        appGroup: Bundle.main.object(forInfoDictionaryKey: "BKAppGroup") as? String
    )

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        // iCloud 第一次定位可能要几秒，别占着调用线程
        DispatchQueue.global(qos: .userInitiated).async {
            let response = Self.bridge.handle(message)
            let reply = NSExtensionItem()
            reply.userInfo = [SFExtensionMessageKey: response]
            context.completeRequest(returningItems: [reply], completionHandler: nil)
        }
    }
}
