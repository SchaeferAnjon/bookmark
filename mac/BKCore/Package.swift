// swift-tools-version:5.9
// BKCore：Mac App、Chrome 本地通信模式、Safari 扩展处理程序共用的核心逻辑。
// 单测不需要签名：swift test --package-path mac/BKCore
import PackageDescription

let package = Package(
    name: "BKCore",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "BKCore", targets: ["BKCore"]),
    ],
    targets: [
        .target(name: "BKCore"),
        .testTarget(name: "BKCoreTests", dependencies: ["BKCore"]),
    ]
)
