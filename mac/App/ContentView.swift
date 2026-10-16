import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            VStack(spacing: 0) {
                icloudRow
                Divider()
                safariRow
                Divider()
                chromeRow
            }
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.quaternary))

            summary

            if let notice = model.notice {
                Text(notice).font(.callout).foregroundStyle(.orange).textSelection(.enabled)
            }

            HStack {
                Link(L("使用说明与源码", "Docs & source"), destination: AppInfo.repoURL)
                Spacer()
                Text("v\(AppInfo.version)").foregroundStyle(.tertiary)
                Button(L("刷新", "Refresh")) { model.refresh() }
            }
            .font(.callout)
        }
        .padding(24)
        .frame(width: 520)
        .onAppear { model.refresh() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { model.refresh() }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(L("书签管家", "BookmarkKeeper")).font(.title2.bold())
                Text(L("快捷书签经 iCloud 在 Chrome、Safari 和你的所有 Mac 之间同步。这个窗口只用来检查设置，平时不用打开。",
                       "Quick links sync through iCloud between Chrome, Safari and all your Macs. This window is only for setup — you don't need to keep it open."))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var icloudRow: some View {
        StatusRow(
            icon: "icloud",
            title: "iCloud",
            state: model.icloud == .checking ? nil : model.icloud == .on,
            detail: model.icloud == .off
                ? L("iCloud 云盘没有打开：快捷书签只保存在这台 Mac 上。", "iCloud Drive is off: quick links stay on this Mac only.")
                : L("快捷书签保存在你的 iCloud 里，别人看不到。", "Quick links live in your own iCloud. Nobody else can see them.")
        ) {
            if model.icloud == .off {
                Button(L("打开 iCloud 设置", "Open iCloud Settings")) { model.openICloudSettings() }
            }
        }
    }

    private var safariRow: some View {
        StatusRow(
            icon: "safari",
            title: "Safari",
            state: model.safariEnabled,
            detail: model.safariEnabled == true
                ? L("扩展已启用。新标签页设成「书签管家」：Safari →「设置」→「通用」→「新标签页打开方式」。",
                    "Extension enabled. To use it as the new tab page: Safari → Settings → General → New tabs open with.")
                : L("在 Safari 设置的「扩展」里勾选「书签管家」。", "Enable “BookmarkKeeper” in Safari Settings → Extensions.")
                    + (model.safariError.map { "\n" + L("读取状态出错：", "Couldn't read state: ") + $0 } ?? "")
        ) {
            if model.safariEnabled != true {
                Button(L("在 Safari 中启用", "Enable in Safari")) { model.openSafariSettings() }
            }
        }
    }

    private var chromeRow: some View {
        StatusRow(
            icon: "globe",
            title: "Chrome",
            state: model.chromeBrowsers.isEmpty ? false : true,
            detail: model.chromeBrowsers.isEmpty
                ? L("没找到 Chrome。装好 Chrome 后再打开一次这个 App。", "Chrome not found. Open this app again after installing Chrome.")
                : L("已连接：\(model.chromeBrowsers.joined(separator: "、"))。Chrome 里还需要装「书签管家」扩展。",
                    "Connected: \(model.chromeBrowsers.joined(separator: ", ")). Install the BookmarkKeeper extension in Chrome too.")
        ) {
            if AppInfo.chromeWebStoreURL != nil {
                Button(L("Chrome 应用商店", "Chrome Web Store")) { model.openChromeWebStore() }
            }
            Button(L("扩展文件夹", "Extension folder")) { model.revealChromeExtension() }
                .help(L("在访达中显示 Chrome 扩展文件夹：打开 chrome://extensions，开启「开发者模式」，把它拖进去",
                        "Reveal the Chrome extension folder: open chrome://extensions, turn on Developer mode, drag it in"))
        }
    }

    private var summary: some View {
        Group {
            if let count = model.linkCount {
                let when = model.lastUpdated.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "—"
                Text(L("快捷书签：\(count) 个链接、\(model.groupCount) 个分组 · 最近修改 \(when)",
                       "Quick links: \(count) links, \(model.groupCount) groups · last change \(when)"))
            } else {
                Text(L("正在读取快捷书签…", "Reading quick links…"))
            }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }
}

private struct StatusRow<Actions: View>: View {
    let icon: String
    let title: String
    let state: Bool?
    let detail: String
    @ViewBuilder let actions: Actions

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .frame(width: 28)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(title).font(.headline)
                    switch state {
                    case .some(true): Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    case .some(false): Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
                    case .none: ProgressView().controlSize(.small)
                    }
                }
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack { actions }
                    .controlSize(.small)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }
}
